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

// Show whether the saved copy exists and whether the phone is online right now.
async function showOfflineStatus() {
  const element = document.querySelector('#offline')
  const network = navigator.onLine ? 'online' : 'offline'
  if (!canWorkOffline) {
    element.textContent = `Offline copy: not used in development. Now ${network}`
    return
  }
  await navigator.serviceWorker.ready
  const files = (await (await caches.open('ari-shell')).keys()).length
  element.textContent = files
    ? `Offline copy saved (${files} files). Now ${network}`
    : `Offline copy not saved yet. Now ${network}`
}
showOfflineStatus()
addEventListener('online', showOfflineStatus)
addEventListener('offline', showOfflineStatus)
