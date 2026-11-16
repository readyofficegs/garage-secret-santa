# Garage Society Secret Santa

## Deploy (functions need the CLI or Git, not drag-and-drop)
    npm install
    npx netlify-cli deploy --prod

Or push this folder to a GitHub repo and connect it in Netlify. No build settings needed: netlify.toml handles it.

## Run the draw
1. Open the site. The 10 names are pre-filled. Add a budget/date if you like, set an organiser PIN, hit "Fill the sack".
2. Copy the link and send it to everyone.
3. Each person taps their own name, then opens their present. Their name leaves the sack.
4. When all names are drawn, everyone sees "Santa's sack is full!"

"Organiser" (page footer) + your PIN: see who's drawn, put a name back if someone tapped the wrong one, or empty the sack to start again.
Data lives in Netlify Blobs (store "garage-secret-santa"). Nobody can see the full list of matches in the page.
