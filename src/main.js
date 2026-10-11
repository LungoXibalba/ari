import './style.css'

document.querySelector('#app').innerHTML = `
  <main>
    <h1>Hello, ARI</h1>
    <p id="mode"></p>
    <p id="offline"></p>
    <p id="build"></p>
  </main>
`

// iOS sets navigator.standalone to true only when launched from the home screen.
// This tells you at a glance whether you are in the installed app or in Safari.
const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches
document.querySelector('#mode').textContent = standalone
  ? 'Running as an installed app'
  : 'Running in the browser'

// Which version is on screen: the time the code was built (stamped in by vite.config.js).
document.querySelector('#build').textContent = `Build ${__BUILD_TIME__}`

// The service worker (public/sw.js) keeps a saved copy of the app so it opens without signal.
// It is only registered in the built app, not on the dev server, where saved copies would hide edits.
const canWorkOffline = 'serviceWorker' in navigator && import.meta.env.PROD
if (canWorkOffline) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
}

// Can the server be reached right now? Asks for a small file and waits up to 3 seconds.
// navigator.onLine is not used: iOS reports "online" even in airplane mode.
// The ?ping part makes the address new each time, so the service worker has no saved copy
// of it and the request really goes to the network.
async function serverReachable() {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3000)
  try {
    await fetch(`${import.meta.env.BASE_URL}manifest.webmanifest?ping=${Date.now()}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

// Show whether the saved copy exists and whether the server can be reached right now.
async function showOfflineStatus() {
  const element = document.querySelector('#offline')
  let copy = 'Offline copy: not used in development'
  if (canWorkOffline) {
    await navigator.serviceWorker.ready
    const files = (await (await caches.open('ari-shell')).keys()).length
    copy = files ? `Offline copy saved (${files} files)` : 'Offline copy not saved yet'
  }
  const reachable = await serverReachable()
  element.textContent = `${copy}. Server ${reachable ? 'reachable' : 'not reachable'} (${new Date().toLocaleTimeString()})`
}
showOfflineStatus()
addEventListener('online', showOfflineStatus)
addEventListener('offline', showOfflineStatus)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') showOfflineStatus()
})
