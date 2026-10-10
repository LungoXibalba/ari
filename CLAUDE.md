# ARI: code notes for Claude Code

An installable web app (PWA) for capturing material in the field and revisiting it later. Plain JavaScript + Vite, no framework. The project plan (concept, decisions, milestones) is kept outside this repository and is private; the owner will provide it when needed. This repository is **public**.

## How to work with the owner
- The owner is learning by building. Before each step, explain what you are about to do. Explain every file you create: what it is for and what would break without it.
- Take small steps; finish one slice end to end before starting the next. Do not build features from later milestones unless asked.
- Walk the owner through anything they must do themselves (signing in, approving downloads). Ask before downloading anything or publishing anything.
- Prefer simple, low-maintenance solutions. Automate chores; keep human steps few and light.

## Rules
- **Never put an AI API key, or any secret, in this repo or in the app code.** The repo is public and the app runs in the browser, so anything in the code is readable by anyone. When AI features arrive, calls need a small go-between server or a key each user enters themselves.
- Captured user data stays on the user's devices. Only code is public.
- `base` in `vite.config.js` must equal the GitHub repository name (`ari`).
- Git identity is set per repository (not globally): name "Nemo", GitHub noreply email. Do not use a real email.

## Commands
- `npm run dev`: local test server.
- `npm run build`: package into `dist/`.
- `npm run preview`: serve `dist/` locally; the address includes `/ari/`.
- Deploy: `git push` to `main`. GitHub Actions builds and publishes to Pages in about a minute.

## Addresses
- Live: https://lungoxibalba.github.io/ari/
- Repo: https://github.com/LungoXibalba/ari

## Files
| File | What it is for | What breaks without it |
|---|---|---|
| `package.json`, `package-lock.json` | Project identity, commands, exact package versions (only dependency: Vite 8) | `npm` and the GitHub build can't install tools; versions could drift |
| `vite.config.js` | `base: '/ari/'`, the Pages sub-path | Built page asks for files at the site root and shows blank on Pages |
| `index.html` | The single page; links the manifest, iOS meta tags, touch icon | No home-screen app behavior |
| `public/manifest.webmanifest` | App name, `display: standalone`, colors, icons; `start_url` and `scope` are relative (`./`) so they follow `base` | Add to Home Screen makes a bookmark that opens in Safari |
| `public/icons/` | Placeholder icons (180, 192, 512 px PNG). iOS ignores SVG icons | Generic icon on the home screen |
| `src/main.js`, `src/style.css` | "Hello, ARI" page; shows whether it runs installed or in the browser; CSS keeps content clear of the notch (`env(safe-area-inset-*)`) | The page is empty |
| `.github/workflows/deploy.yml` | On push to `main`: `npm ci`, `npm run build`, publish `dist/` to Pages (Node 24) | No automatic deploy |
| `.gitignore` | Keeps `node_modules/` and `dist/` out of git | Tens of thousands of files would go to GitHub |

## Status (2026-10-11)
Only the empty installable skeleton exists, verified on an iPhone (opens full-screen from the home screen). Not built yet: service worker, storage, camera, audio, location, export/import.

**Next: the service worker (offline), first step of M1.** Field capture happens without signal, so the app must open offline. Explain the update rule before building it: once a service worker exists, it decides when new versions reach the phone. A reasonable default is to fetch the page fresh when online and keep the hashed asset files cached.

## Notes
- Pages updates take about a minute after a push; iOS may cache the old version, so close the app fully to see an update.
- Replace the placeholder icons with real artwork at some point.
- The deploy workflow shows a Node 20 deprecation notice for `checkout@v4` and `setup-node@v4`; harmless for now, bump versions eventually.
- Unverified: whether the installed iPhone app is exempt from Safari's 7-day storage deletion. Test once storage exists.
