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
});

function emitRoom(room: Room) {
  for (const playerId of room.players.keys()) {
    io.to(playerId).emit('room:state', toPublicState(room, playerId));
  }
}

io.on('connection', (socket) => {
  socket.on('room:create', (payload: { name: string; totalRounds?: number; captionSeconds?: number }, ack?) => {
    const name = (payload?.name ?? '').trim();
    if (!name) {
      ack?.({ error: 'Name required' });
      return;
    }
    const room = createRoom(socket.id, name, {
      totalRounds: payload.totalRounds,
      captionSeconds: payload.captionSeconds,
    });
    socket.join(room.code);
    const state = toPublicState(room, socket.id);
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
    const result = joinRoom(code, socket.id, name);
    if ('error' in result) {
      ack?.({ error: result.error });
      return;
    }
    socket.join(result.code);
    ack?.({ state: toPublicState(result, socket.id) });
    emitRoom(result);
  });

  socket.on('game:start', (_payload, ack?) => {
    const room = getRoomBySocket(socket.id);
    if (!room) {
      ack?.({ error: 'Not in a room' });
      return;
    }
    const err = startGame(room, socket.id);
    if (err) {
      ack?.({ error: err.error });
      return;
    }
    ack?.({ ok: true });
    emitRoom(room);
  });

  socket.on('caption:submit', (payload: { text: string }, ack?) => {
    const room = getRoomBySocket(socket.id);
    if (!room) {
      ack?.({ error: 'Not in a room' });
      return;
    }
    const err = submitCaption(room, socket.id, payload?.text ?? '');
    if (err) {
      ack?.({ error: err.error });
      return;
    }
    ack?.({ ok: true });
    emitRoom(room);
  });

  socket.on('vote:submit', (payload: { captionId: string }, ack?) => {
    const room = getRoomBySocket(socket.id);
    if (!room) {
      ack?.({ error: 'Not in a room' });
      return;
    }
    const err = submitVote(room, socket.id, payload?.captionId ?? '');
    if (err) {
      ack?.({ error: err.error });
      return;
    }
    ack?.({ ok: true });
    emitRoom(room);
  });

  socket.on('game:next', (_payload, ack?) => {
    const room = getRoomBySocket(socket.id);
    if (!room) {
      ack?.({ error: 'Not in a room' });
      return;
    }
    const err = nextRoundOrEnd(room, socket.id);
    if (err) {
      ack?.({ error: err.error });
      return;
    }
    ack?.({ ok: true });
    emitRoom(room);
  });

  socket.on('game:rematch', (_payload, ack?) => {
    const room = getRoomBySocket(socket.id);
    if (!room) {
      ack?.({ error: 'Not in a room' });
      return;
    }
    const err = rematch(room, socket.id);
    if (err) {
      ack?.({ error: err.error });
      return;
    }
    ack?.({ ok: true });
    emitRoom(room);
  });

  socket.on('game:lobby', (_payload, ack?) => {
    const room = getRoomBySocket(socket.id);
    if (!room) {
      ack?.({ error: 'Not in a room' });
      return;
    }
    const err = backToLobby(room, socket.id);
    if (err) {
      ack?.({ error: err.error });
      return;
    }
    ack?.({ ok: true });
    emitRoom(room);
  });

  socket.on('disconnect', () => {
    const result = leaveRoom(socket.id);
    if (result && !result.emptied) emitRoom(result.room);
  });
});

setInterval(() => {
  tickCaptionTimers((room) => emitRoom(room));
}, 1000);

// Bind 0.0.0.0 so Render (and other hosts) can health-check the service
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Caption Meme Game API + sockets on http://0.0.0.0:${PORT}`);
});
