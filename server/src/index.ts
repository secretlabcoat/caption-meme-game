import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import {
  backToLobby,
  createRoom,
  getRoomBySocket,
  joinRoom,
  leaveRoom,
  nextRoundOrEnd,
  rematch,
  startGame,
  submitCaption,
  submitVote,
  tickCaptionTimers,
  toPublicState,
} from './rooms.js';
import type { Room } from './types.js';

const PORT = Number(process.env.PORT) || 3001;

/** Comma-separated list of allowed frontend origins (e.g. https://my-app.netlify.app). Unset = allow all (local / prototype). */
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN;
const corsOrigin = CLIENT_ORIGIN
  ? CLIENT_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)
  : '*';

const app = express();
app.use(cors({ origin: corsOrigin }));
app.get('/health', (_req, res) => res.json({ ok: true }));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: corsOrigin },
  // Tolerate phones that briefly background the tab / switch networks
  pingInterval: 20000,
  pingTimeout: 60000,
  connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000 },
});

/** Grace period before a disconnected player is removed (phone lock, network blip). */
const RECONNECT_GRACE_MS = 3 * 60 * 1000;
const pendingLeaves = new Map<string, NodeJS.Timeout>();
/** Number of live sockets per stable player id. */
const liveSockets = new Map<string, number>();

function emitRoom(room: Room) {
  for (const playerId of room.players.keys()) {
    io.to(playerId).emit('room:state', toPublicState(room, playerId));
  }
}

io.on('connection', (socket) => {
  const rawKey = (socket.handshake.auth as { playerKey?: unknown } | undefined)?.playerKey;
  const pid = typeof rawKey === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(rawKey) ? rawKey : socket.id;
  socket.join(pid);
  liveSockets.set(pid, (liveSockets.get(pid) ?? 0) + 1);
  const pending = pendingLeaves.get(pid);
  if (pending) {
    clearTimeout(pending);
    pendingLeaves.delete(pid);
  }
  // Reconnecting player: restore them into their room
  {
    const existing = getRoomBySocket(pid);
    const me = existing?.players.get(pid);
    if (existing && me) {
      me.connected = true;
      socket.join(existing.code);
      emitRoom(existing);
    }
  }

  socket.on('room:create', (payload: { name: string; totalRounds?: number; captionSeconds?: number }, ack?) => {
    const name = (payload?.name ?? '').trim();
    if (!name) {
      ack?.({ error: 'Name required' });
      return;
    }
    const room = createRoom(pid, name, {
      totalRounds: payload.totalRounds,
      captionSeconds: payload.captionSeconds,
    });
    socket.join(room.code);
    const state = toPublicState(room, pid);
    ack?.({ state });
    emitRoom(room);
  });

  socket.on('room:join', (payload: { code: string; name: string }, ack?) => {
    const name = (payload?.name ?? '').trim();
    const code = (payload?.code ?? '').trim();
    if (!name || !code) {
      ack?.({ error: 'Name and room code required' });
      return;
    }
    const result = joinRoom(code, pid, name);
    if ('error' in result) {
      ack?.({ error: result.error });
      return;
    }
    socket.join(result.code);
    ack?.({ state: toPublicState(result, pid) });
    emitRoom(result);
  });

  socket.on('game:start', (_payload, ack?) => {
    const room = getRoomBySocket(pid);
    if (!room) {
      ack?.({ error: 'Not in a room' });
      return;
    }
    const err = startGame(room, pid);
    if (err) {
      ack?.({ error: err.error });
      return;
    }
    ack?.({ ok: true });
    emitRoom(room);
  });

  socket.on('caption:submit', (payload: { text: string }, ack?) => {
    const room = getRoomBySocket(pid);
    if (!room) {
      ack?.({ error: 'Not in a room' });
      return;
    }
    const err = submitCaption(room, pid, payload?.text ?? '');
    if (err) {
      ack?.({ error: err.error });
      return;
    }
    ack?.({ ok: true });
    emitRoom(room);
  });

  socket.on('vote:submit', (payload: { captionId: string }, ack?) => {
    const room = getRoomBySocket(pid);
    if (!room) {
      ack?.({ error: 'Not in a room' });
      return;
    }
    const err = submitVote(room, pid, payload?.captionId ?? '');
    if (err) {
      ack?.({ error: err.error });
      return;
    }
    ack?.({ ok: true });
    emitRoom(room);
  });

  socket.on('game:next', (_payload, ack?) => {
    const room = getRoomBySocket(pid);
    if (!room) {
      ack?.({ error: 'Not in a room' });
      return;
    }
    const err = nextRoundOrEnd(room, pid);
    if (err) {
      ack?.({ error: err.error });
      return;
    }
    ack?.({ ok: true });
    emitRoom(room);
  });

  socket.on('game:rematch', (_payload, ack?) => {
    const room = getRoomBySocket(pid);
    if (!room) {
      ack?.({ error: 'Not in a room' });
      return;
    }
    const err = rematch(room, pid);
    if (err) {
      ack?.({ error: err.error });
      return;
    }
    ack?.({ ok: true });
    emitRoom(room);
  });

  socket.on('game:lobby', (_payload, ack?) => {
    const room = getRoomBySocket(pid);
    if (!room) {
      ack?.({ error: 'Not in a room' });
      return;
    }
    const err = backToLobby(room, pid);
    if (err) {
      ack?.({ error: err.error });
      return;
    }
    ack?.({ ok: true });
    emitRoom(room);
  });

  socket.on('disconnect', () => {
    const n = (liveSockets.get(pid) ?? 1) - 1;
    if (n > 0) {
      liveSockets.set(pid, n);
      return;
    }
    liveSockets.delete(pid);
    const room = getRoomBySocket(pid);
    const me = room?.players.get(pid);
    if (room && me) {
      me.connected = false;
      emitRoom(room);
    }
    pendingLeaves.set(
      pid,
      setTimeout(() => {
        pendingLeaves.delete(pid);
        if (liveSockets.get(pid)) return;
        const result = leaveRoom(pid);
        if (result && !result.emptied) emitRoom(result.room);
      }, RECONNECT_GRACE_MS)
    );
  });
});

setInterval(() => {
  tickCaptionTimers((room) => emitRoom(room));
}, 1000);

// Bind 0.0.0.0 so Render (and other hosts) can health-check the service
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Caption Meme Game API + sockets on http://0.0.0.0:${PORT}`);
});
