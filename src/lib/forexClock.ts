/**
 * Forex weekly-close clock, shared by the browser quote hub and the API quote
 * routes. Forex trades Mon-Fri; the weekly break is Fri 21:00 UTC -> Sun 21:00
 * UTC. Keeping this in one tiny dependency-free module means the client that
 * renders a price and the server that supplies it agree on "closed".
 */
export function isForexMarketClosedUTC(now: Date = new Date()): boolean {
  const day = now.getUTCDay(); // 0 Sun .. 6 Sat
  const hour =
    now.getUTCHours() +
    now.getUTCMinutes() / 60 +
    now.getUTCSeconds() / 3600;

  if (day === 6) return true; // Saturday
  if (day === 5 && hour >= 21) return true; // Friday after 21:00 UTC
  if (day === 0 && hour < 21) return true; // Sunday before 21:00 UTC
  return false;
}
