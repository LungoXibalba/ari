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
| `vite.config.js` | `base: '/ari/'`, the Pages sub-path; stamps the build time into the page (`__BUILD_TIME__`) | Built page asks for files at the site root and shows blank on Pages; no way to tell which version a phone runs |
| `index.html` | The single page; links the manifest, iOS meta tags, touch icon | No home-screen app behavior |
| `public/manifest.webmanifest` | App name, `display: standalone`, colors, icons; `start_url` and `scope` are relative (`./`) so they follow `base` | Add to Home Screen makes a bookmark that opens in Safari |
| `public/icons/` | Placeholder icons (180, 192, 512 px PNG). iOS ignores SVG icons | Generic icon on the home screen |
| `src/main.js`, `src/style.css` | "Hello, ARI" page; shows installed vs browser, whether the offline copy is saved, whether the server can be reached (a real fetch with a 3 s limit, not `navigator.onLine`), and the build time; registers the service worker (built app only, not the dev server); CSS keeps content clear of the notch (`env(safe-area-inset-*)`) | The page is empty; the app never gets an offline copy |
| `public/sw.js` | The service worker (a script the phone runs between the app and the network). Saves the page and the files it lists; page is network first (4 s limit), everything else saved copy first; deletes saved files the new page no longer lists. Static: it does not change between builds | Nothing opens without signal |
| `.github/workflows/deploy.yml` | On push to `main`: `npm ci`, `npm run build`, publish `dist/` to Pages (Node 24) | No automatic deploy |
| `.gitignore` | Keeps `node_modules/` and `dist/` out of git | Tens of thousands of files would go to GitHub |

## Status (2026-10-11)
The installable skeleton exists, verified on an iPhone (opens full-screen from the home screen). Step 1 (test session) is done and its test page removed. Step 2 (offline) is live and **passed on the iPhone** (2026-10-11: airplane mode on, app fully closed and reopened, it opened and showed its build time) and in a local Firefox test (load once online, stop the server, reload; a new build replaces the old copy). The update path **failed on the iPhone** (an installed older build kept showing; the owner had to delete the app and re-add it from Safari). Cause: GitHub Pages sends pages with `Cache-Control: max-age=600`, and the worker's page fetch went through the browser's own cache, so for 10 minutes after any visit it re-read its stored copy. Fixed in `public/sw.js` by fetching the page with `cache: 'no-cache'` (ask the server whether it changed); reproduced and verified with a local test server that sends the same header (`vite preview` sends no such header and hid the bug). The fix is pushed only when the owner approves; after that, confirm on the phone that a newer build replaces the installed one without reinstalling. Not yet tested on the phone: the 4 s slow-network fallback. Not built yet: storage, camera, audio recording, location capture, export/import.

## M1 order (agreed 2026-10-11)
M1 finish line: a photo, a voice memo, and a text note captured on the iPhone survive closing the app, appear in the inbox with time and location, export to OneDrive, and import on the laptop. Work in this order, one step at a time; a failed test changes the plan before anything is built on it.

1. **Test session (throwaway buttons on the hello page, deployed to the public site, removed afterwards).** Log each answer under "Test results" below.
   - a. Share a small file from the installed app into OneDrive via the share sheet; open it on the laptop. (Plain blob downloads in installed iPhone web apps are said to be unreliable; unverified.)
   - b. How location permission behaves in the installed app (re-asked on every launch? unverified).
   - c. Record 10 s of audio; note its format and `mimeType`; play it on the laptop; lock the screen mid-recording and see whether recording continues.
   - d. (added 2026-10-11) Dictation: type into a plain text box using the iPhone keyboard's dictation (microphone) key; see whether the text survives closing the app (the box saves to `localStorage` as you type).
   - The test page also has a "Copy log" button (puts the on-page log on the clipboard so results can be pasted), and the location test logs seconds-to-arrive and accuracy in meters.
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

### Decisions (2026-10-11)
- **Voice to text:** use the iPhone keyboard's dictation key in a text box. Audio recording (the voice memo, M1 step 6) stays optional.
- **Open question:** when is a recording deleted? Proposal: kept until the card is marked `processed`, then deleted unless the owner chooses to keep it.
- **Browser speech recognition is skipped.** WebKit bug 225298 (closed as deferred) says it was unavailable in Home Screen web apps.
- **Offline update rule (2026-10-11):** the page (`index.html`) is network first, with a 4 s limit before falling back to the saved copy; scripts and styles are saved-copy first (their file names carry a fingerprint, so a saved copy is never an old version of the same name); each fresh page rebuilds the saved set and deletes unused files. The page fetch uses `cache: 'no-cache'` so the server is always asked whether the page changed (see Status). `public/sw.js` itself never changes, so phones never need to replace the worker.
- **Voice memos must be recorded with the app in the foreground** unless the lock-screen test is ever run (the owner skipped it on 2026-10-11, so it is untested, not failed).

### Test results (fill in during step 1)
First two runs, 2026-10-11 (iPhone, iOS 18.7, installed app). Still open: the lock-screen test and a few details, listed under each item.
- 1a share to OneDrive: **works**, twice (including the audio file). The share sheet opens from the installed app, "Save to Files" to OneDrive works, and the files open on the laptop with the right content. Side effect: passing `title: 'ARI test file'` to `navigator.share` makes iOS also save a stray `text.txt` containing the title with every share. **Share files with no `title` or `text` field.**
- 1b location: **works.** Accuracy 20 m. With permission already given, a fix arrived in 2.4 s (the first run's 17.5 s included answering the prompt). After the app was fully closed and reopened, the Permissions API reported `prompt` again, but iOS did **not** ask again when the button was tapped (owner report), so the Permissions API state is not a reliable guide. The code only asks for a position once per button press; nothing tracks location in the background. The Permissions API `change` event did not fire after allowing, so don't rely on it.
- 1c audio: **recording works** (4.2 s and 4.8 s clips). `recorder.mimeType` is **empty (`""`) at start**; the real type is on the data: `audio/mp4; codecs=mp4a.40.2` (AAC). Store the type from the recorded blob, never from `recorder.mimeType`. Size varies with content (about 46 to 190 kbps). The clip plays back on the phone with the right duration. Files reached the laptop byte-for-byte intact through the share sheet. They are fragmented MP4 (brand `iso5`/`cmfc`, header duration 0), so some laptop players may show no duration or seeking; laptop playback result still to be confirmed. **The microphone asks for permission again on a new launch** (owner report): expect a prompt each time the app is reopened before recording. Lock-screen recording was skipped by the owner (both clips were under 5 s), so it is untested.
- 1d text box: the typed text **survived fully closing the app** (restored 56 characters). The `localStorage` log also survived. Not tested: the dictation key itself. Observed oddity, parked by the owner: tapping a misspelled word did not show iOS's autocorrection suggestion.

## Notes
- `navigator.onLine` is wrong on iOS: it said "online" in airplane mode. Test reachability with a real fetch instead.
- Pages updates take about a minute after a push; iOS may cache the old version, so close the app fully to see an update.
- Replace the placeholder icons with real artwork at some point.
- The deploy workflow shows a Node 20 deprecation notice for `checkout@v4` and `setup-node@v4`; harmless for now, bump versions eventually.
- Unverified: whether the installed iPhone app is exempt from Safari's 7-day storage deletion. Test once storage exists.
