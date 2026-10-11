import './style.css'
import { mountBackup } from './backup.js'
import { mountInbox } from './inbox.js'
import { mountStatus } from './status.js'

document.querySelector('#app').innerHTML = `
  <main>
    <h1>ARI</h1>
    <div id="inbox"></div>
    <div id="backup"></div>
    <footer id="status"></footer>
  </main>
`

const inbox = mountInbox(document.querySelector('#inbox'))
mountBackup(document.querySelector('#backup'), { refreshInbox: inbox.render })
mountStatus(document.querySelector('#status'))
