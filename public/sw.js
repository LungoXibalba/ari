// ARI service worker: keeps a saved copy of the app so it opens with no signal.
//
// Update rule:
//  - The page (index.html): network first. Online, you always get the newest version.
//    Offline, or when the network answers nothing within 4 seconds, you get the saved copy.
//  - Everything else the page lists (scripts, styles, icons, manifest): saved copy first.
//    Script and style file names carry a fingerprint that changes with every build, so a
//    saved copy can never be an old version of the same name.
//  - Each time a fresh page arrives, the saved set is rebuilt from what that page lists and
//    anything it no longer lists is deleted.
// This file itself does not change between builds, so the phone never needs to replace it.

const CACHE = 'ari-shell'
const SLOW_NETWORK_MS = 4000

// Save the fresh page, plus every file it points to, and delete saved files it no longer uses.
async function refreshShell(pageResponse) {
  const base = self.registration.scope
  const html = await pageResponse.clone().text()

  const wanted = new Set([base])
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const url = new URL(match[1], base)
    if (url.href.startsWith(base)) wanted.add(url.href)
  }

  const cache = await caches.open(CACHE)
  await cache.put(base, pageResponse)
  await Promise.all(
    [...wanted]
      .filter((url) => url !== base)
      .map(async (url) => {
        // Fingerprinted files never change: fetch only if missing. Others (manifest, icons): refetch.
        if (url.includes('/assets/') && (await cache.match(url))) return
        await cache.add(new Request(url, { cache: 'reload' }))
      }),
  )
  for (const request of await cache.keys()) {
    if (!wanted.has(request.url)) await cache.delete(request)
  }
}

self.addEventListener('install', (event) => {
  // Fetch the page once and save it with everything it needs, so one online visit is enough.
  event.waitUntil(
    fetch(self.registration.scope, { cache: 'reload' }).then(refreshShell).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  // Take over the page that is already open instead of waiting for the next launch.
  event.waitUntil(self.clients.claim())
})

async function answerPageRequest(event) {
  const network = fetch(event.request)
  const timeout = new Promise((resolve) => setTimeout(resolve, SLOW_NETWORK_MS, null))
  const first = await Promise.race([network.catch(() => null), timeout])

  if (first && first.ok) {
    event.waitUntil(refreshShell(first.clone()).catch(() => {}))
    return first
  }
  const saved = await caches.match(self.registration.scope)
  if (saved) return saved
  return first || network.catch(() => Response.error())
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(answerPageRequest(event))
    return
  }
  event.respondWith(caches.match(request).then((saved) => saved || fetch(request)))
})
