// Ask for the current position once. Never tracks: one request per call, only when called.
// Resolves with { lat, lon, accuracy, at } or null (denied, no signal, or too slow).
// The shape matches the card's `location` field (see CLAUDE.md, "Card fields").

export function getLocation({ timeoutMs = 20000 } = {}) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null)
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy: Math.round(position.coords.accuracy), // meters
          at: new Date(position.timestamp).toISOString(), // when it was measured
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs },
    )
  })
}
