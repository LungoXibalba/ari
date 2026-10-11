// Small remembered choices, kept on the phone in localStorage.
// Every access is wrapped in try/catch because browsers can block storage (for example in private windows).

const LOCATION_KEY = 'ari-attach-location'

// Should new notes and photos ask for the position? On unless the owner switched it off.
export function attachLocationEnabled() {
  try {
    return localStorage.getItem(LOCATION_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setAttachLocationEnabled(on) {
  try {
    localStorage.setItem(LOCATION_KEY, on ? 'on' : 'off')
  } catch {
    // the switch still works for this session
  }
}
