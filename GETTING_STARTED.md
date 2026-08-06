# Getting started

## 1. Install Node.js

If you don't already have it, download it from https://nodejs.org (the
"LTS" version) and install it like any other app.

## 2. Open this folder in Terminal

Easiest way: open Terminal, type `cd ` (with a trailing space), then drag
this `pickleball-app` folder from Finder into the Terminal window, then
press Enter.

## 3. Add your `.env` file

This project needs a file named exactly `.env` (not `.env.txt`) in this
same folder, containing your Supabase project's URL and anon key. If you
don't have it handy, ask for it again — it's safe to share, it's the
public key by design.

## 4. Install and run

```
npm install
npm run dev
```

Then open the URL it prints (usually `http://localhost:5173`) in your
browser.

## Common issues

**Blank white page, "supabaseUrl is required" in the console** — your
`.env` file is missing, misnamed, or the dev server was started before you
added it (it only reads `.env` once, at startup — restart it after adding
the file).

**Only seeing part of the app / nav bar missing** — you may have more than
one copy of this folder on your computer, and the Terminal is pointed at
an old one. Search Finder for "pickleball-app" to check.

**Changes not showing up** — fully stop the dev server (Ctrl+C) and start
it again with `npm run dev`, and hard-refresh your browser (Cmd+Shift+R).
This app is a PWA, so your browser may also be showing a cached offline
version — check DevTools → Application → Service Workers if a hard refresh
doesn't help.
