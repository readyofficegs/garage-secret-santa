// Garage Society Secret Santa — one function, one blob.
// GET  /api/santa                -> public state (names, who's drawn, budget, date). Never the matches.
// POST /api/santa {action:...}   -> setup | claim | mine | hint | check | release | reset
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

function device(ua = "") {
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android";
  if (/Macintosh|Mac OS X/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows";
  return "Other device";
}

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
    organiser: d.organiser || "",
    full: claimed.length >= d.names.length,
  };
}

// What one person is allowed to see: who they got, that person's hint, and their own hint.
function myView(d, name) {
  const match = d.pairs[name];
  const theirs = (d.hints || {})[match];
  const mine = (d.hints || {})[name];
  return {
    ok: true,
    name,
    match,
    matchHint: theirs ? theirs.text : "",
    matchHintAt: theirs ? theirs.at : "",
    myHint: mine ? mine.text : "",
    token: d.claims[name].token,
    ...publicView(d),
  };
}

function findByToken(d, t) {
  if (!d || !t) return null;
  for (const [name, c] of Object.entries(d.claims || {})) if (c.token === t) return name;
  return null;
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
          names, pairs, claims: {}, hints: {},
          budget: clean(body.budget, 30), date: clean(body.date, 60), organiser: clean(body.organiser, 40),
          pinHash: hash(pin), createdAt: new Date().toISOString(),
        };
        return { write: draw, response: json({ ok: true, ...publicView(draw) }) };
      });
    }

    if (action === "claim") {
      const name = clean(body.name, 40);
      const ua = device(req.headers.get("user-agent") || "");
      return mutate(async (d) => {
        if (!d) return { response: json({ error: "There's no draw yet." }, 404) };
        if (!d.names.includes(name)) return { response: json({ error: "That name isn't in the sack." }, 404) };
        const existing = d.claims[name];
        if (existing) {
          if (body.token && existing.token === body.token) return { response: json(myView(d, name)) };
          const who = d.organiser ? d.organiser : "the organiser";
          return { response: json({ error: `${name} has already been drawn. If that wasn't you, message ${who} and they'll sort it out.`, ...publicView(d) }, 409) };
        }
        const next = { ...d, claims: { ...d.claims, [name]: { token: token(), at: new Date().toISOString(), device: ua } } };
        return { write: next, response: json(myView(next, name)) };
      });
    }

    if (action === "mine") {
      const d = await store().get(KEY, { type: "json" });
      const name = findByToken(d, clean(body.token, 64));
      if (!name) return json({ error: "That link doesn't match the current draw." }, 404);
      return json(myView(d, name));
    }

    if (action === "hint") {
      const t = clean(body.token, 64);
      const text = clean(body.text, 140);
      return mutate(async (d) => {
        const name = findByToken(d, t);
        if (!name) return { response: json({ error: "That link doesn't match the current draw." }, 404) };
        const hints = { ...(d.hints || {}) };
        if (text) hints[name] = { text, at: new Date().toISOString() };
        else delete hints[name];
        const next = { ...d, hints };
        return { write: next, response: json(myView(next, name)) };
      });
    }

    if (action === "details") {
      const pin = clean(body.pin, 40);
      return mutate(async (d) => {
        if (!d) return { response: json({ error: "There's no draw yet." }, 404) };
        if (d.pinHash !== hash(pin)) return { response: json({ error: "Wrong PIN." }, 403) };
        const next = { ...d, budget: clean(body.budget, 30), date: clean(body.date, 60), organiser: clean(body.organiser, 40) };
        return { write: next, response: json({ ok: true, ...publicView(next) }) };
      });
    }

    if (action === "release" || action === "reset" || action === "check") {
      const pin = clean(body.pin, 40);
      const s = store();
      if (action === "check") {
        const d = await s.get(KEY, { type: "json" });
        if (!d || d.pinHash !== hash(pin)) return json({ error: "Wrong PIN." }, 403);
        const people = d.names.map((n) => {
          const c = d.claims[n];
          return { name: n, drawn: !!c, at: c ? c.at : "", device: c ? c.device || "" : "", hint: !!(d.hints || {})[n] };
        });
        return json({ ok: true, people, ...publicView(d) });
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
        const hints = { ...(d.hints || {}) };
        delete hints[name]; // a wrong tap may have left a hint in their name
        const next = { ...d, claims, hints };
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
