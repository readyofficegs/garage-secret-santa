// Garage Society Secret Santa — one function, one blob.
// GET  /api/santa                -> public state (names, who's drawn, budget, date). Never the matches.
// POST /api/santa {action:...}   -> setup | claim | mine | release | reset
import { getStore } from "@netlify/blobs";
import { createHash, randomBytes } from "node:crypto";

const KEY = "draw";
const store = () => getStore({ name: "garage-secret-santa", consistency: "strong" });

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const hash = (s) => createHash("sha256").update("gs-santa:" + s).digest("hex");
const token = () => randomBytes(16).toString("hex");
const clean = (s, max) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

function publicView(d) {
  if (!d) return { exists: false };
  const claimed = Object.keys(d.claims || {});
  return {
    exists: true,
    names: d.names,
    claimed,
    remaining: d.names.length - claimed.length,
    total: d.names.length,
    budget: d.budget || "",
    date: d.date || "",
    full: claimed.length >= d.names.length,
  };
}

function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makePairs(names, exclusions) {
  const blocked = (g, r) =>
    g === r || exclusions.some(([a, b]) => (a === g && b === r) || (a === r && b === g));
  // Prefer one big loop so nobody just swaps with each other.
  for (let t = 0; t < 5000; t++) {
    const order = shuffle(names);
    const map = {};
    let ok = true;
    for (let i = 0; i < order.length; i++) {
      const g = order[i], r = order[(i + 1) % order.length];
      if (blocked(g, r)) { ok = false; break; }
      map[g] = r;
    }
    if (ok) return map;
  }
  for (let t = 0; t < 20000; t++) {
    const rec = shuffle(names);
    const map = {};
    let ok = true;
    for (let i = 0; i < names.length; i++) {
      if (blocked(names[i], rec[i])) { ok = false; break; }
      map[names[i]] = rec[i];
    }
    if (ok) return map;
  }
  return null;
}

// Read, change, write — retried if someone else wrote in between.
async function mutate(fn) {
  const s = store();
  for (let attempt = 0; attempt < 6; attempt++) {
    const entry = await s.getWithMetadata(KEY, { type: "json" });
    const current = entry ? entry.data : null;
    const result = await fn(current);
    if (!result.write) return result.response;
    const opts = entry ? { onlyIfMatch: entry.etag } : { onlyIfNew: true };
    const { modified } = await s.setJSON(KEY, result.write, opts);
    if (modified) return result.response;
    await new Promise((r) => setTimeout(r, 80 + Math.random() * 200));
  }
  return json({ error: "Lots of elves at once. Please try again." }, 503);
}

export default async (req) => {
  try {
    if (req.method === "GET") {
      const d = await store().get(KEY, { type: "json" });
      return json(publicView(d));
    }
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    let body;
    try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
    const action = body.action;

    if (action === "setup") {
      const pin = clean(body.pin, 40);
      if (pin.length < 4) return json({ error: "Choose an organiser PIN of at least 4 characters." }, 400);
      const seen = new Set();
      const names = (Array.isArray(body.names) ? body.names : [])
        .map((n) => clean(n, 40))
        .filter((n) => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()));
      if (names.length < 3) return json({ error: "Add at least three names." }, 400);
      if (names.length > 60) return json({ error: "That's a lot of elves. Keep it to 60 or fewer." }, 400);
      const exclusions = (Array.isArray(body.exclusions) ? body.exclusions : [])
        .filter((p) => Array.isArray(p) && names.includes(p[0]) && names.includes(p[1]) && p[0] !== p[1]);
      const pairs = makePairs(names, exclusions);
      if (!pairs) return json({ error: "Those keep-apart rules make a fair draw impossible. Remove one and try again." }, 400);

      return mutate(async (current) => {
        if (current && current.pinHash !== hash(pin)) {
          return { response: json({ error: "A draw is already running. Enter its organiser PIN to replace it." }, 409) };
        }
        const draw = {
          names, pairs, claims: {},
          budget: clean(body.budget, 30), date: clean(body.date, 60),
          pinHash: hash(pin), createdAt: new Date().toISOString(),
        };
        return { write: draw, response: json({ ok: true, ...publicView(draw) }) };
      });
    }

    if (action === "claim") {
      const name = clean(body.name, 40);
      return mutate(async (d) => {
        if (!d) return { response: json({ error: "There's no draw yet." }, 404) };
        if (!d.names.includes(name)) return { response: json({ error: "That name isn't in the sack." }, 404) };
        const existing = d.claims[name];
        if (existing) {
          if (body.token && existing.token === body.token) {
            return { response: json({ ok: true, name, match: d.pairs[name], token: existing.token, ...publicView(d) }) };
          }
          return { response: json({ error: `${name} has already drawn.`, ...publicView(d) }, 409) };
        }
        const t = token();
        const next = { ...d, claims: { ...d.claims, [name]: { token: t, at: new Date().toISOString() } } };
        return { write: next, response: json({ ok: true, name, match: d.pairs[name], token: t, ...publicView(next) }) };
      });
    }

    if (action === "mine") {
      const d = await store().get(KEY, { type: "json" });
      const name = clean(body.name, 40);
      if (!d || !d.claims[name] || d.claims[name].token !== body.token) {
        return json({ error: "Couldn't find your draw on this device." }, 404);
      }
      return json({ ok: true, name, match: d.pairs[name], ...publicView(d) });
    }

    if (action === "release" || action === "reset" || action === "check") {
      const pin = clean(body.pin, 40);
      const s = store();
      if (action === "check") {
        const d = await s.get(KEY, { type: "json" });
        if (!d || d.pinHash !== hash(pin)) return json({ error: "Wrong PIN." }, 403);
        return json({ ok: true, ...publicView(d) });
      }
      if (action === "reset") {
        const d = await s.get(KEY, { type: "json" });
        if (!d) return json({ ok: true, exists: false });
        if (d.pinHash !== hash(pin)) return json({ error: "Wrong PIN." }, 403);
        await s.delete(KEY);
        return json({ ok: true, exists: false });
      }
      const name = clean(body.name, 40);
      return mutate(async (d) => {
        if (!d) return { response: json({ error: "There's no draw yet." }, 404) };
        if (d.pinHash !== hash(pin)) return { response: json({ error: "Wrong PIN." }, 403) };
        const claims = { ...d.claims };
        delete claims[name];
        const next = { ...d, claims };
        return { write: next, response: json({ ok: true, ...publicView(next) }) };
      });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: "Something went wrong at the North Pole. Try again in a moment." }, 500);
  }
};

export const config = { path: "/api/santa" };
