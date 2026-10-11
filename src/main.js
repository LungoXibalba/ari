import './style.css'
import { mountSpike } from './spike.js' // throwaway test session; remove with spike.js

document.querySelector('#app').innerHTML = `
  <main>
    <h1>Hello, ARI</h1>
    <p id="mode"></p>
  </main>
`

// iOS sets navigator.standalone to true only when launched from the home screen.
// This tells you at a glance whether you are in the installed app or in Safari.
const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches
document.querySelector('#mode').textContent = standalone
  ? 'Running as an installed app'
  : 'Running in the browser'

mountSpike(document.querySelector('main'))
