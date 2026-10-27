import { io, Socket } from 'socket.io-client';

const URL = import.meta.env.VITE_SOCKET_URL ?? '';

/**
 * Stable per-browser id so a phone that sleeps can resume the same seat.
 * The key alone must not rejoin a room: a refresh or a new tab shares it and
 * should land on create/join. The open page asks for room:resume instead.
 */
function getPlayerKey(): string {
  const KEY = 'cmg-player-key';
  let k = localStorage.getItem(KEY);
  if (!k || !/^[A-Za-z0-9_-]{8,64}$/.test(k)) {
    k = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(KEY, k);
  }
  return k;
}

export const socket: Socket = io(URL, {
  autoConnect: true,
  transports: ['websocket', 'polling'],
  auth: { playerKey: getPlayerKey() },
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 60000, // Render free tier cold start can take ~30-60s
});

// Keep the Render free-tier server awake while the page is open (it sleeps after ~15 min without HTTP traffic,
// which wipes in-memory rooms). Ping /health every 4 minutes.
if (URL) {
  const ping = () => {
    fetch(`${URL.replace(/\/$/, '')}/health`, { cache: 'no-store' }).catch(() => {});
  };
  ping();
  setInterval(ping, 4 * 60 * 1000);
  // Reconnect promptly when the phone comes back to the tab
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      ping();
      if (!socket.connected) socket.connect();
    }
  });
}
