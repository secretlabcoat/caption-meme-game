import express from 'express';
import { createServer } from 'http';
import { Server, type Socket } from 'socket.io';
import cors from 'cors';
import {
  backToLobby,
  createRoom,
  getRoomBySocket,
  joinBlockReason,
  joinRoom,
  exitRoom,
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

/** Grace period before a disconnected player is removed from the lobby (phone lock, network blip). */
const RECONNECT_GRACE_MS = 3 * 60 * 1000;
const pendingLeaves = new Map<string, NodeJS.Timeout>();
/**
 * Sockets that have actually entered a room (create, join, or resume).
 * A home-screen connection must not count — a refresh or a new tab shares the
 * player key, and counting it would keep a seat "live" after the player left.
 */
const seatedSockets = new Map<string, number>();

function clearPendingLeave(pid: string) {
  const pending = pendingLeaves.get(pid);
  if (!pending) return;
  clearTimeout(pending);
  pendingLeaves.delete(pid);
}

/** Mark this socket as sitting in the room and cancel any pending removal. */
function seatSocket(socket: Socket, pid: string, room: Room) {
  const me = room.players.get(pid);
  if (!me) return;
  me.connected = true;
  socket.join(room.code);
  if (!socket.data.seated) {
    socket.data.seated = true;
    seatedSockets.set(pid, (seatedSockets.get(pid) ?? 0) + 1);
  }
  clearPendingLeave(pid);
}

/**
 * Drop this player out of whatever room they are in.
 * Other tabs with the same player key are told to leave the game screen.
 */
function releaseSeat(socket: Socket, pid: string) {
  clearPendingLeave(pid);
  const peers = io.sockets.adapter.rooms.get(pid);
  if (peers) {
    for (const id of peers) {
      if (id === socket.id) continue;
      const other = io.sockets.sockets.get(id);
      if (!other) continue;
      other.data.seated = false;
      other.emit('room:left');
    }
  }
  socket.data.seated = false;
  seatedSockets.delete(pid);
  const result = exitRoom(pid);
  if (result) socket.leave(result.room.code);
  if (result && !result.emptied) emitRoom(result.room);
}

function emitRoom(room: Room) {
  for (const playerId of room.players.keys()) {
    io.to(playerId).emit('room:state', toPublicState(room, playerId));
  }
}

io.on('connection', (socket) => {
  const rawKey = (socket.handshake.auth as { playerKey?: unknown } | undefined)?.playerKey;
  const pid = typeof rawKey === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(rawKey) ? rawKey : socket.id;
  socket.join(pid);
  // Do not put this socket back in a room here. A refresh and a new tab use the
  // same player key as a phone that slept. Only room:resume (the page that was
  // already in the game) should reclaim the seat.

  socket.on('room:resume', (payload, ack) => {
    // Clients may emit the ack with or without a payload object.
    const done = typeof payload === 'function' ? payload : ack;
    const existing = getRoomBySocket(pid);
    const me = existing?.players.get(pid);
    if (!existing || !me) {
      done?.({ error: 'Not in a room' });
      return;
    }
    seatSocket(socket, pid, existing);
    done?.({ state: toPublicState(existing, pid) });
    emitRoom(existing);
  });

  socket.on('room:create', (payload: { name: string; totalRounds?: number; captionSeconds?: number }, ack?) => {
    const name = (payload?.name ?? '').trim();
    if (!name) {
      ack?.({ error: 'Name required' });
      return;
    }
    if (getRoomBySocket(pid)) releaseSeat(socket, pid);
    const room = createRoom(pid, name, {
      totalRounds: payload.totalRounds,
      captionSeconds: payload.captionSeconds,
    });
    seatSocket(socket, pid, room);
    const state = toPublicState(room, pid);
    ack?.({ state });
    emitRoom(room);
  });

  socket.on('room:join', (payload: { code: string; name: string }, ack?) => {
    const name = (payload?.name ?? '').trim();
    const code = (payload?.code ?? '').trim().toUpperCase();
    if (!name || !code) {
      ack?.({ error: 'Name and room code required' });
      return;
    }
    // Refuse before leaving the current seat, so a typo doesn't kick them out.
    const blocked = joinBlockReason(code, pid, name);
    if (blocked) {
      ack?.({ error: blocked });
      return;
    }
    const current = getRoomBySocket(pid);
    if (current && current.code !== code) releaseSeat(socket, pid);
    const result = joinRoom(code, pid, name);
    if ('error' in result) {
      ack?.({ error: result.error });
      return;
    }
    seatSocket(socket, pid, result);
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

  socket.on('room:leave', (_payload, ack?) => {
    clearPendingLeave(pid);
    if (socket.data.seated) {
      socket.data.seated = false;
      const n = (seatedSockets.get(pid) ?? 1) - 1;
      if (n > 0) seatedSockets.set(pid, n);
      else seatedSockets.delete(pid);
    }
    // Another tab of this same player is still in the game.
    if ((seatedSockets.get(pid) ?? 0) > 0) {
      ack?.({ ok: true });
      return;
    }
    const result = exitRoom(pid);
    if (result) socket.leave(result.room.code);
    if (result && !result.emptied) emitRoom(result.room);
    ack?.({ ok: true });
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
    // A tab sitting on create/join never took a seat. Closing it must not
    // mark the player offline in a game that another tab is still playing.
    if (!socket.data.seated) return;
    socket.data.seated = false;
    const n = (seatedSockets.get(pid) ?? 1) - 1;
    if (n > 0) {
      seatedSockets.set(pid, n);
      return;
    }
    seatedSockets.delete(pid);
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
        if ((seatedSockets.get(pid) ?? 0) > 0) return;
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
