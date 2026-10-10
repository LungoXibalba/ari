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

## M1 order (agreed 2026-10-11)
M1 finish line: a photo, a voice memo, and a text note captured on the iPhone survive closing the app, appear in the inbox with time and location, export to OneDrive, and import on the laptop. Work in this order, one step at a time; a failed test changes the plan before anything is built on it.

1. **Test session (throwaway buttons on the hello page, deployed to the public site, removed afterwards).** Log each answer under "Test results" below.
   - a. Share a small file from the installed app into OneDrive via the share sheet; open it on the laptop. (Plain blob downloads in installed iPhone web apps are said to be unreliable; unverified.)
   - b. How location permission behaves in the installed app (re-asked on every launch? unverified).
   - c. Record 10 s of audio; note its format and `mimeType`; play it on the laptop; lock the screen mid-recording and see whether recording continues.
2. **Offline:** service worker, tested in airplane mode. Explain the update rule before building it: a service worker decides when new versions reach the phone. A reasonable default is to fetch the page fresh when online and keep the hashed asset files cached.
3. **Card fields:** the owner approves them (draft below) before any storage code.
4. **Storage + text notes:** IndexedDB behind our own small interface so sync can replace it later. Text first: no permissions, so a failure points at storage alone.
5. **Photo:** native camera via a file input (`<input type="file" accept="image/*" capture>`). Location comes from the Geolocation API at capture time, not from the photo (iPhone strips it; unverified). Save the card at once and attach location when it arrives, so capture never waits for GPS.
6. **Voice memo:** `MediaRecorder`; store `mimeType` with every recording, never assume a format.
7. **Real export and import:** export in batches or one file per card (one big in-memory bundle can crash Safari; inference); import skips cards whose `id` already exists. Until export exists, captured items are at risk of Safari deleting site data.

### Card fields (DRAFT, owner must approve before code)
- `id`: random unique ID made on the phone, so imports never collide and importing twice skips duplicates.
- `schemaVersion`: so old cards can be migrated later.
- `kind`: `text`, `photo` or `audio`.
- `created`, `updated`: times.
- `location`: optional (permission can be denied, or no signal).
- `text`: for notes.
- `media`: the stored blob, plus `mimeType` and size.
- `gist`: optional one-line summary in the owner's own words (the plan's one human step per card).
- `source`: optional free text.
- `status`: `inbox` or `processed`.
- Left out on purpose for M1: tags (no tag upkeep; they matter once AI suggests them), change history (one user, no AI; add with the provenance record in M3), "seen, not relevant" (an M2 board state).

### Test results (fill in during step 1)
- 1a share to OneDrive: not tested yet
- 1b location permission in installed app: not tested yet
- 1c audio format / playback on laptop / screen-lock recording: not tested yet

## Notes
- Pages updates take about a minute after a push; iOS may cache the old version, so close the app fully to see an update.
- Replace the placeholder icons with real artwork at some point.
- The deploy workflow shows a Node 20 deprecation notice for `checkout@v4` and `setup-node@v4`; harmless for now, bump versions eventually.
- Unverified: whether the installed iPhone app is exempt from Safari's 7-day storage deletion. Test once storage exists.
