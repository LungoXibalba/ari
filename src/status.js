// The small status lines at the bottom of the page: installed or browser, offline copy, server
// reachability, storage persistence and the build time. They exist so a phone test can be read at a glance.
// Also registers the service worker (public/sw.js).

export function mountStatus(parent) {
  parent.innerHTML = `
    <p id="mode"></p>
    <p id="offline"></p>
    <p id="storage"></p>
    <p id="build"></p>
  `

  // iOS sets navigator.standalone to true only when launched from the home screen.
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches
  parent.querySelector('#mode').textContent = standalone ? 'Running as an installed app' : 'Running in the browser'

  // Which version is on screen: the time the code was built (stamped in by vite.config.js).
  parent.querySelector('#build').textContent = `Build ${__BUILD_TIME__}`

  // Only registered in the built app, not on the dev server, where saved copies would hide edits.
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

  async function showOfflineStatus() {
    let copy = 'Offline copy: not used in development'
    if (canWorkOffline) {
      await navigator.serviceWorker.ready
      const files = (await (await caches.open('ari-shell')).keys()).length
      copy = files ? `Offline copy saved (${files} files)` : 'Offline copy not saved yet'
    }
    const reachable = await serverReachable()
    parent.querySelector('#offline').textContent =
      `${copy}. Server ${reachable ? 'reachable' : 'not reachable'} (${new Date().toLocaleTimeString()})`
  }
  showOfflineStatus()
  addEventListener('online', showOfflineStatus)
  addEventListener('offline', showOfflineStatus)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') showOfflineStatus()
  })

  // Ask the browser to keep our data. Safari decides silently and may say no; this shows its answer.
  async function showStorageStatus() {
    const element = parent.querySelector('#storage')
    if (!navigator.storage?.persist) {
      element.textContent = 'Storage: persistence not supported'
      return
    }
    const persistent = (await navigator.storage.persisted()) || (await navigator.storage.persist())
    element.textContent = `Storage: ${persistent ? 'persistent' : 'not guaranteed persistent'}`
  }
  showStorageStatus()
}
