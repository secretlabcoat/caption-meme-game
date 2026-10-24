import { randomBytes } from 'crypto';
import type { Caption, Phase, Player, Room, RoomState, Round } from './types.js';
import { pickImage } from './images.js';

const rooms = new Map<string, Room>();
const socketToRoom = new Map<string, string>();

const DEFAULT_ROUNDS = 3;
const DEFAULT_CAPTION_SECONDS = 90;
const MIN_PLAYERS = 2;

function generateCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = randomBytes(4);
  for (let i = 0; i < 4; i++) code += alphabet[bytes[i] % alphabet.length];
  if (rooms.has(code)) return generateCode();
  return code;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function createRoom(
  hostSocketId: string,
  name: string,
  opts?: { totalRounds?: number; captionSeconds?: number }
): Room {
  const code = generateCode();
  const host: Player = { id: hostSocketId, name: name.trim().slice(0, 24), score: 0, connected: true };
  const room: Room = {
    code,
    hostId: hostSocketId,
    players: new Map([[hostSocketId, host]]),
    phase: 'lobby',
    round: null,
    totalRounds: opts?.totalRounds ?? DEFAULT_ROUNDS,
    captionSeconds: opts?.captionSeconds ?? DEFAULT_CAPTION_SECONDS,
    usedImageIndexes: [],
  };
  rooms.set(code, room);
  socketToRoom.set(hostSocketId, code);
  return room;
}

export function joinRoom(code: string, socketId: string, name: string): Room | { error: string } {
  const room = rooms.get(code.toUpperCase());
  if (!room) return { error: 'Room not found' };
  if (room.players.has(socketId)) {
    const me = room.players.get(socketId)!;
    me.connected = true;
    socketToRoom.set(socketId, room.code);
    return room;
  }
  if (room.phase !== 'lobby') return { error: 'Game already started' };
  if ([...room.players.values()].some((p) => p.name.toLowerCase() === name.trim().toLowerCase())) {
    return { error: 'Name already taken in this room' };
  }
  const player: Player = {
    id: socketId,
    name: name.trim().slice(0, 24),
    score: 0,
    connected: true,
  };
  room.players.set(socketId, player);
  socketToRoom.set(socketId, room.code);
  return room;
}

export function getRoomBySocket(socketId: string): Room | undefined {
  const code = socketToRoom.get(socketId);
  return code ? rooms.get(code) : undefined;
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code.toUpperCase());
}

export function leaveRoom(socketId: string): { room: Room; emptied: boolean } | null {
  const room = getRoomBySocket(socketId);
  if (!room) return null;
  const player = room.players.get(socketId);
  if (!player) return null;
  if (room.phase === 'lobby') socketToRoom.delete(socketId);

  if (room.phase === 'lobby') {
    room.players.delete(socketId);
  } else {
    player.connected = false;
  }

  if (room.hostId === socketId) {
    const nextHost = [...room.players.values()].find((p) => p.connected && p.id !== socketId);
    if (nextHost) room.hostId = nextHost.id;
  }

  const anyConnected = [...room.players.values()].some((p) => p.connected);
  if (!anyConnected || (room.phase === 'lobby' && room.players.size === 0)) {
    rooms.delete(room.code);
    return { room, emptied: true };
  }
  return { room, emptied: false };
}

export function startGame(room: Room, requesterId: string): { error: string } | null {
  if (room.hostId !== requesterId) return { error: 'Only the host can start' };
  if (room.phase !== 'lobby') return { error: 'Game already started' };
  const connected = [...room.players.values()].filter((p) => p.connected);
  if (connected.length < MIN_PLAYERS) return { error: `Need at least ${MIN_PLAYERS} players` };
  beginRound(room, 1);
  return null;
}

function beginRound(room: Room, number: number) {
  const { url, index } = pickImage(room.usedImageIndexes);
  room.usedImageIndexes.push(index);
  room.phase = 'caption';
  room.round = {
    number,
    imageUrl: url,
    captions: [],
    votes: {},
    phaseEndsAt: Date.now() + room.captionSeconds * 1000,
  };
}

export function submitCaption(room: Room, playerId: string, text: string): { error: string } | null {
  if (room.phase !== 'caption' || !room.round) return { error: 'Not in caption phase' };
  const trimmed = text.trim().slice(0, 140);
  if (!trimmed) return { error: 'Caption cannot be empty' };
  if (room.round.captions.some((c) => c.playerId === playerId)) return { error: 'Already submitted' };
  const caption: Caption = {
    id: randomBytes(8).toString('hex'),
    playerId,
    text: trimmed,
  };
  room.round.captions.push(caption);
  maybeAdvanceFromCaption(room);
  return null;
}

function connectedPlayerIds(room: Room): string[] {
  return [...room.players.values()].filter((p) => p.connected).map((p) => p.id);
}

export function maybeAdvanceFromCaption(room: Room) {
  if (room.phase !== 'caption' || !room.round) return;
  const needed = connectedPlayerIds(room);
  const submitted = new Set(room.round.captions.map((c) => c.playerId));
  const allIn = needed.every((id) => submitted.has(id));
  const timedOut = room.round.phaseEndsAt !== null && Date.now() >= room.round.phaseEndsAt;
  if (allIn || timedOut) enterVotePhase(room);
}

function enterVotePhase(room: Room) {
  if (!room.round) return;
  // Players who didn't submit get a placeholder so vote UI still works; skip empty rooms
  room.phase = 'vote';
  room.round.phaseEndsAt = null;
  room.round.votes = {};
}

export function submitVote(room: Room, voterId: string, captionId: string): { error: string } | null {
  if (room.phase !== 'vote' || !room.round) return { error: 'Not in vote phase' };
  const caption = room.round.captions.find((c) => c.id === captionId);
  if (!caption) return { error: 'Invalid caption' };
  if (caption.playerId === voterId) return { error: 'Cannot vote for your own caption' };
  room.round.votes[voterId] = captionId;
  maybeAdvanceFromVote(room);
  return null;
}

export function maybeAdvanceFromVote(room: Room) {
  if (room.phase !== 'vote' || !room.round) return;
  const voters = connectedPlayerIds(room).filter((id) => {
    // Only players who have a caption that isn't theirs to vote for — if only 1 caption, skip
    const captions = room.round!.captions;
    return captions.some((c) => c.playerId !== id);
  });
  const allVoted = voters.every((id) => room.round!.votes[id]);
  if (allVoted || voters.length === 0) enterScorePhase(room);
}

function enterScorePhase(room: Room) {
  if (!room.round) return;
  const voteCounts = new Map<string, number>();
  for (const captionId of Object.values(room.round.votes)) {
    voteCounts.set(captionId, (voteCounts.get(captionId) ?? 0) + 1);
  }
  for (const caption of room.round.captions) {
    const pts = voteCounts.get(caption.id) ?? 0;
    const player = room.players.get(caption.playerId);
    if (player) player.score += pts;
  }
  room.phase = 'score';
  room.round.phaseEndsAt = null;
}

export function nextRoundOrEnd(room: Room, requesterId: string): { error: string } | null {
  if (room.hostId !== requesterId) return { error: 'Only the host can continue' };
  if (room.phase !== 'score' || !room.round) return { error: 'Not in score phase' };
  if (room.round.number >= room.totalRounds) {
    room.phase = 'end';
    return null;
  }
  beginRound(room, room.round.number + 1);
  return null;
}

export function rematch(room: Room, requesterId: string): { error: string } | null {
  if (room.hostId !== requesterId) return { error: 'Only the host can rematch' };
  if (room.phase !== 'end' && room.phase !== 'score') return { error: 'Cannot rematch now' };
  for (const p of room.players.values()) p.score = 0;
  // Drop disconnected players
  for (const [id, p] of room.players) {
    if (!p.connected) room.players.delete(id);
  }
  room.usedImageIndexes = [];
  room.round = null;
  room.phase = 'lobby';
  return null;
}

export function backToLobby(room: Room, requesterId: string): { error: string } | null {
  if (room.hostId !== requesterId) return { error: 'Only the host can return to lobby' };
  for (const p of room.players.values()) p.score = 0;
  for (const [id, p] of room.players) {
    if (!p.connected) room.players.delete(id);
  }
  room.usedImageIndexes = [];
  room.round = null;
  room.phase = 'lobby';
  return null;
}

export function toPublicState(room: Room, youId: string): RoomState {
  const players = [...room.players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    score: p.score,
    connected: p.connected,
    isHost: p.id === room.hostId,
  }));

  // Captions are ALWAYS anonymous publicly. playerId stays server-only for scoring.
  const showVoteCounts = room.phase === 'score' || room.phase === 'end';
  let captions: RoomState['captions'] = [];
  const submittedCount = room.round?.captions.length ?? 0;

  if (room.round && room.phase !== 'caption' && room.phase !== 'lobby') {
    const voteCounts = new Map<string, number>();
    for (const captionId of Object.values(room.round.votes)) {
      voteCounts.set(captionId, (voteCounts.get(captionId) ?? 0) + 1);
    }
    let list = room.round.captions
      // Vote phase: omit your own caption from the ballot (self-vote also blocked server-side).
      .filter((c) => room.phase !== 'vote' || c.playerId !== youId)
      .map((c) => ({
        id: c.id,
        text: c.text,
        ...(showVoteCounts ? { voteCount: voteCounts.get(c.id) ?? 0 } : {}),
      }));
    if (room.phase === 'vote') list = shuffle(list);
    else if (showVoteCounts) list = list.sort((a, b) => (b.voteCount ?? 0) - (a.voteCount ?? 0));
    captions = list;
  }

  const myCaptionSubmitted = !!room.round?.captions.some((c) => c.playerId === youId);
  const myVoteCaptionId = room.round?.votes[youId] ?? null;

  let winnerIds: string[] = [];
  if (room.phase === 'end') {
    const max = Math.max(0, ...players.map((p) => p.score));
    winnerIds = players.filter((p) => p.score === max && max > 0).map((p) => p.id);
    if (winnerIds.length === 0 && players.length) {
      winnerIds = players.map((p) => p.id);
    }
  }

  return {
    code: room.code,
    phase: room.phase,
    players,
    youId,
    isHost: room.hostId === youId,
    roundNumber: room.round?.number ?? 0,
    totalRounds: room.totalRounds,
    captionSeconds: room.captionSeconds,
    imageUrl: room.round?.imageUrl ?? null,
    phaseEndsAt: room.round?.phaseEndsAt ?? null,
    captions,
    submittedCount,
    myCaptionSubmitted,
    myVoteCaptionId,
    winnerIds,
  };
}

export function tickCaptionTimers(onAdvance: (room: Room) => void) {
  for (const room of rooms.values()) {
    if (room.phase === 'caption' && room.round?.phaseEndsAt && Date.now() >= room.round.phaseEndsAt) {
      maybeAdvanceFromCaption(room);
      onAdvance(room);
    }
  }
}
