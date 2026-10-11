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
| `src/main.js` | Assembles the page: heading, inbox, back-up section, status footer | The page is empty |
| `src/style.css` | Phone layout; keeps content clear of the notch (`env(safe-area-inset-*)`); 16 px inputs so iOS does not zoom | Unstyled, cramped page |
| `src/cards.js` | The card's shape in one place (`newCard`) and `describeLocation`; fields per "Card fields" below | Each part of the app would invent its own card shape |
| `src/storage.js` | The only file that touches IndexedDB (version 2): `saveCard`, `saveCardWithMedia` (card + blob in one all-or-nothing step), `getCard`, `getMedia`, `updateCard` (read-modify-write in one transaction, sets `updated`), `listCards`, `deleteCard` (removes media and export record too), `listExportRecords`, `markExported`. Stores `cards`, `media` (blobs keyed by card id) and `exports` (`{ id, updated }` as exported or imported). Replaceable (sync, other database) by changing this file alone | Nothing is kept after the app closes |
| `src/inbox.js` | Note box, "Attach location when saving" switch, Save note, Take photo, Record voice memo (tap to start, tap to stop, timer on the button; the card is saved when the recording ends, however it ends), inbox list (time, gist, photo or play control, text, place and coordinates or "No location", source), Edit and Delete (with confirmation). Everything typed is shown with `textContent`, never as HTML. After saving, asks for the location once (only if the switch is on). Shows a lasting notice when a recording was cut short by the app leaving the screen, and a "file is missing" line on cards whose photo/recording was not imported. Dispatches `cards-changed` on `window` after each redraw. A card with its Edit form open is never removed from the page during a refresh, so typing and keyboard focus survive a location arriving | Nothing to capture or read |
| `src/recorder.js` | `startRecording()`: microphone + `MediaRecorder`, chunks every second; returns `{ stop, finished }` where `finished` resolves with the Blob (type read from the recorded data, because `recorder.mimeType` is empty on iOS at the start) or `null`; also stops and keeps what was recorded if the system ends the microphone | No voice memos |
| `src/export.js` | Builds export files (one `.json` per card plus its photo/recording), the batching rule (`planBatches`, size-first), "new or changed" selection, and `shareBatch` (share sheet, no title or text) | No export |
| `src/import.js` | Reads export files, validates and cleans each card, replaces by newer `updated` or skips, restores a missing photo/recording, reports problems | No import |
| `src/backup.js` | The "Back up and transfer" section: Export new and changed, Export all, per-batch Share buttons, Import files. A batch is marked exported only after its share succeeded | No way to run export or import |
| `src/edit-form.js` | Builds one card's Edit form (text/caption, gist, place, source, Remove coordinates); the caller decides what Save, Cancel and Remove do | No way to add captions, gist, place or source, or to remove coordinates |
| `src/settings.js` | Remembers the Location switch in `localStorage` (default on), with every access in try/catch | The switch would reset on every launch |
| `src/location.js` | `getLocation()`: asks for the position once (never tracks), returns `{ lat, lon, accuracy, at }` or `null` | Cards would never get coordinates |
| `src/status.js` | Status lines (installed/browser, offline copy, server reachable, storage persistent, build time) and registers the service worker | No way to read test results on the phone; no offline copy |
| `public/sw.js` | The service worker (a script the phone runs between the app and the network). Saves the page and the files it lists; page is network first (4 s limit), everything else saved copy first; deletes saved files the new page no longer lists. Static: it does not change between builds | Nothing opens without signal |
| `.github/workflows/deploy.yml` | On push to `main`: `npm ci`, `npm run build`, publish `dist/` to Pages (Node 24) | No automatic deploy |
| `.gitignore` | Keeps `node_modules/` and `dist/` out of git | Tens of thousands of files would go to GitHub |

## Status (2026-10-11)
M1 steps 1 to 6 are done and confirmed on the iPhone: test session (removed), offline (service worker; airplane mode works; the update path failed once because GitHub caches pages for 10 minutes, fixed with `cache: 'no-cache'` in `public/sw.js`), card fields, storage + text notes (`Storage: persistent` in the installed app), photo, voice memo, plus a remembered "Attach location when saving" switch and an Edit form per card (text, gist, place, source, remove coordinates). Known limits: iOS asks for the microphone on every launch; recording stops when the app leaves the screen (confirmed on the iPhone) and what was recorded so far is now saved at once with a notice (built, tested locally, not yet confirmed on the iPhone); an app killed mid-recording loses that recording (held in memory until stopped). **Step 7 (export and import) is built and tested locally; not yet pushed or tested on the iPhone.** It adds a database upgrade to version 2 (an `exports` store). The persistence request (`navigator.storage.persist()`) is already made on every launch by `src/status.js` on every device.

## M1 order (agreed 2026-10-11)
M1 finish line: a photo, a voice memo, and a text note captured on the iPhone survive closing the app, appear in the inbox with time and location, export to OneDrive, and import on the laptop. Work in this order, one step at a time; a failed test changes the plan before anything is built on it.

1. **Test session (throwaway buttons on the hello page, deployed to the public site, removed afterwards).** Log each answer under "Test results" below.
   - a. Share a small file from the installed app into OneDrive via the share sheet; open it on the laptop. (Plain blob downloads in installed iPhone web apps are said to be unreliable; unverified.)
   - b. How location permission behaves in the installed app (re-asked on every launch? unverified).
   - c. Record 10 s of audio; note its format and `mimeType`; play it on the laptop; lock the screen mid-recording and see whether recording continues.
   - d. (added 2026-10-11) Dictation: type into a plain text box using the iPhone keyboard's dictation (microphone) key; see whether the text survives closing the app (the box saves to `localStorage` as you type).
   - The test page also has a "Copy log" button (puts the on-page log on the clipboard so results can be pasted), and the location test logs seconds-to-arrive and accuracy in meters.
2. **Offline:** service worker, tested in airplane mode. Explain the update rule before building it: a service worker decides when new versions reach the phone. A reasonable default is to fetch the page fresh when online and keep the hashed asset files cached.
3. **Card fields:** approved 2026-10-11 (see below). DONE.
4. **Storage + text notes:** IndexedDB behind our own small interface so sync can replace it later. Text first: no permissions, so a failure points at storage alone. (Built with the browser's IndexedDB directly instead of the Dexie library the plan mentions: about 60 lines, no new dependency, swappable behind `storage.js`.)
5. **Photo:** native camera via a file input (`<input type="file" accept="image/*" capture>`). Location comes from the Geolocation API at capture time, not from the photo (iPhone strips it; unverified). Save the card at once and attach location when it arrives, so capture never waits for GPS. (Built: the location request starts after the camera closes, not at the tap, because iOS pauses the page behind the camera and the request could time out; the `at` field records when the fix was really measured. Text notes also ask for location after saving, to meet the M1 finish line.)
6. **Voice memo:** `MediaRecorder`; store `mimeType` with every recording, never assume a format. (Built. Audio is kept until the owner deletes the card; the automatic-deletion rule is deferred until a "processed" flow exists, since nothing deletes audio automatically yet. Known limits: iOS asks for the microphone on every launch; recording needs the app open on screen (lock-screen untested); an app killed mid-recording loses that recording, since it is held in memory until stopped.)
7. **Real export and import:** export in batches or one file per card (one big in-memory bundle can crash Safari; inference); import skips cards whose `id` already exists. Until export exists, captured items are at risk of Safari deleting site data. (Built 2026-10-11 as described under "Export files".)

### Card fields (APPROVED 2026-10-11, schemaVersion 1)
Every card has all these fields; "optional" means the value is `null` (or `''` for `text`) when unused.
- `id`: random unique ID made on the phone (`crypto.randomUUID()`), so imports never collide and importing twice skips duplicates.
- `schemaVersion`: `1`. So old cards can be migrated later (new fields, such as a reliability note, arrive through a new version).
- `kind`: `text`, `photo` or `audio`.
- `created`, `updated`: times as ISO 8601 UTC strings.
- `text`: the note's text. **Allowed on every kind** (a caption or dictated note on a photo or recording). `''` when none.
- `gist`: optional one-line summary in the owner's own words (the plan's one human step per card).
- `source`: optional free text.
- `place`: optional text the owner types (for example "Central Library, 2nd floor"). Separate from `location`.
- `location`: optional `{ lat, lon, accuracy, at }`: latitude, longitude, accuracy in meters, time measured (ISO string). `null` if denied or no signal. The card is saved first and location attached when it arrives, so capture never waits for GPS.
- `media`: optional `{ mimeType, size }`. The blob itself is stored in a separate object store keyed by the card `id`, so listing the inbox never loads photos or recordings. `mimeType` comes from the recorded data, never from `recorder.mimeType` (empty on iOS at start).
- `status`: `inbox` or `processed`.
- Left out on purpose for M1: tags (no tag upkeep; they matter once AI suggests them), change history (one user, no AI; add with the provenance record in M3), "seen, not relevant" (an M2 board state), a reliability note (the owner writes it in `text` when it matters; add a field via `schemaVersion` if needed).
- Deleting a card is an action (inbox, step 4), not a field. Accepted for now: importing an old export can bring a deleted card back.
- Audio cleanup rule (when a recording is deleted): decide later.

### Export files (format version 1)
- One `.json` per card plus, for photos and recordings, the media as a normal file with the same base name. Base name: `ari-<created, colons as dashes>-<first 8 characters of id>`, e.g. `ari-2026-10-11T19-28-03Z-3f2a9c1e.json` and `....m4a`. Extensions come from the mime type (`jpg`, `png`, `heic`, `m4a`, `webm`, ...; `bin` if unknown).
- The `.json` holds `{ format: "ari-card", formatVersion: 1, card: {...all card fields...}, mediaFile: "<media file name>" | null }`.
- **Which cards:** "Export new and changed" = cards with no export record, or `updated` later than the recorded one; "Export all" = every card. Records are per card (`exports` store), because with batches a single "last export date" would hide cards from a batch that was cancelled. A card's record is written only after its batch's share succeeded (`navigator.share` resolved); cancelled or failed shares mark nothing. The recorded time is the `updated` the card had when the files were prepared, so an edit made between preparing and sharing still counts as changed. Caveat: "shared" means the share sheet reported success, not that a file is known to have arrived.
- **Batches:** cards are never split (json and media stay together). Limit 25 MB per batch (`MAX_BATCH_BYTES` in `export.js`) and 100 files (sanity limit); a card larger than the limit gets its own batch. **The 25 MB figure is a guess: the largest file ever shared in a test was about 100 KB.** The first real export of several photos is the real test; change the constant if a share fails.
- **Import:** pick all the files at once. A card with an unknown `id` is imported; a known `id` is replaced if the incoming `updated` is newer, otherwise skipped; a card whose photo/recording was missing locally is also updated when the file is now provided. Media is matched by the file name in the `.json` and checked by size. Imported cards are recorded as exported on that device. Report: "N imported, N updated, N skipped" plus problems. Files made by a newer app version are refused.
- Accepted: importing an old export can bring a deleted card back; an edit made on one device is not pushed to the other unless that card's newer `.json` is imported there.
- Export/import stays as a permanent option and backup even after sync exists.

### Sync (recorded 2026-10-11, NOT built; its own milestone after M1, before the board)
- Goal: the same cards on phone and laptop, tied to a login.
- Chosen direction: each user's own cloud. Log in with Microsoft and store cards and media in an app folder in the user's own OneDrive through Microsoft Graph. No server of the owner's, no storage costs, and the owner never holds anyone's data. Google Drive maybe later.
- Each device keeps its local copy (offline first); sync exchanges changes when online. `src/storage.js` is the one file the local database lives in.
- To work out when we get there: Microsoft app registration and the login flow in iPhone home-screen apps; how edits from two devices are merged (newer `updated` wins as a start); how deletions sync; what happens offline.
- Alternatives considered and set aside: a hosted backend (Supabase/Firebase: the owner would hold everyone's data and pay as users grow) and Dexie Cloud (least code, but paid beyond a free tier and tied to one company).
- Rule that still applies: no secret in this repo or the app. (Claude's knowledge, unverified: a browser app using the Microsoft login flow with PKCE needs an app ID but no client secret.)

### Decisions (2026-10-11)
- **Voice to text:** use the iPhone keyboard's dictation key in a text box. Audio recording (the voice memo, M1 step 6) stays optional.
- **Open question:** when is a recording deleted? Proposal: kept until the card is marked `processed`, then deleted unless the owner chooses to keep it.
- **Browser speech recognition is skipped.** WebKit bug 225298 (closed as deferred) says it was unavailable in Home Screen web apps.
- **Persistent storage (2026-10-11):** already requested on every launch by `src/status.js`; the footer shows the answer. MDN (local docs, "Storage quotas and eviction criteria"): persistent data is skipped when the device is short on space; Firefox asks the user, Safari and Chromium browsers decide silently from the user's history with the site. MDN describes Safari's 7-day deletion rule separately and does not say `persist()` exempts a site from it, so that stays unproven. The iPhone installed app answered "persistent". Not yet seen: the laptop browser's answer. Treat the request as a bonus, not protection: export is the backup (deleting the home-screen app deletes its data).
- **Offline update rule (2026-10-11):** the page (`index.html`) is network first, with a 4 s limit before falling back to the saved copy; scripts and styles are saved-copy first (their file names carry a fingerprint, so a saved copy is never an old version of the same name); each fresh page rebuilds the saved set and deletes unused files. The page fetch uses `cache: 'no-cache'` so the server is always asked whether the page changed (see Status). `public/sw.js` itself never changes, so phones never need to replace the worker.
- **Voice memos must be recorded with the app in the foreground** unless the lock-screen test is ever run (the owner skipped it on 2026-10-11, so it is untested, not failed).

### Test results (fill in during step 1)
First two runs, 2026-10-11 (iPhone, iOS 18.7, installed app). Still open: the lock-screen test and a few details, listed under each item.
- 1a share to OneDrive: **works**, twice (including the audio file). The share sheet opens from the installed app, "Save to Files" to OneDrive works, and the files open on the laptop with the right content. Side effect: passing `title: 'ARI test file'` to `navigator.share` makes iOS also save a stray `text.txt` containing the title with every share. **Share files with no `title` or `text` field.**
- 1b location: **works.** Accuracy 20 m. With permission already given, a fix arrived in 2.4 s (the first run's 17.5 s included answering the prompt). After the app was fully closed and reopened, the Permissions API reported `prompt` again, but iOS did **not** ask again when the button was tapped (owner report), so the Permissions API state is not a reliable guide. The code only asks for a position once per button press; nothing tracks location in the background. The Permissions API `change` event did not fire after allowing, so don't rely on it.
- 1c audio: **recording works** (4.2 s and 4.8 s clips). `recorder.mimeType` is **empty (`""`) at start**; the real type is on the data: `audio/mp4; codecs=mp4a.40.2` (AAC). Store the type from the recorded blob, never from `recorder.mimeType`. Size varies with content (about 46 to 190 kbps). The clip plays back on the phone with the right duration. Files reached the laptop byte-for-byte intact through the share sheet. They are fragmented MP4 (brand `iso5`/`cmfc`, header duration 0), so some laptop players may show no duration or seeking; laptop playback result still to be confirmed. **The microphone asks for permission again on a new launch** (owner report): expect a prompt each time the app is reopened before recording. Lock-screen recording was skipped by the owner (both clips were under 5 s), so it is untested.
- 1d text box: the typed text **survived fully closing the app** (restored 56 characters). The `localStorage` log also survived. Not tested: the dictation key itself. Observed oddity, parked by the owner: tapping a misspelled word did not show iOS's autocorrection suggestion.

## Notes
- The "Server reachable / not reachable" footer line re-checks only at launch, when the app returns to the foreground, and on online/offline events; toggling airplane mode with the app open often leaves it stale until the next launch. Accepted: it is a diagnostic line.
- `navigator.onLine` is wrong on iOS: it said "online" in airplane mode. Test reachability with a real fetch instead.
- Pages updates take about a minute after a push; iOS may cache the old version, so close the app fully to see an update.
- Replace the placeholder icons with real artwork at some point.
- The deploy workflow shows a Node 20 deprecation notice for `checkout@v4` and `setup-node@v4`; harmless for now, bump versions eventually.
- Unverified: whether the installed iPhone app is exempt from Safari's 7-day storage deletion. Test once storage exists.
