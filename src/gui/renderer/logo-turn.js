// A small touch: the header logo starts each session turned by a random quarter, like a worldline seen from another side.
// Purely cosmetic. A broken random source falls back to 0, never to a stray angle.
export function quarterTurn(random = Math.random) {
  const r = Number(random())
  return Number.isFinite(r) && r >= 0 && r < 1 ? Math.floor(r * 4) * 90 : 0
}
