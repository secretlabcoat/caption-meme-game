export type Phase = 'lobby' | 'caption' | 'vote' | 'score' | 'end';

export interface Player {
  id: string;
  name: string;
  score: number;
  connected: boolean;
}

export interface Caption {
  id: string;
  playerId: string;
  text: string;
}

export interface Round {
  number: number;
  imageUrl: string;
  captions: Caption[];
  votes: Record<string, string>; // voterId -> captionId
  phaseEndsAt: number | null;
}

export interface Room {
  code: string;
  hostId: string;
  players: Map<string, Player>;
  phase: Phase;
  round: Round | null;
  totalRounds: number;
  captionSeconds: number;
  usedImageIndexes: number[];
}

export interface PublicPlayer {
  id: string;
  name: string;
  score: number;
  connected: boolean;
  isHost: boolean;
}

export interface PublicCaption {
  id: string;
  text: string;
  voteCount?: number;
}

export interface RoomState {
  code: string;
  phase: Phase;
  players: PublicPlayer[];
  youId: string;
  isHost: boolean;
  roundNumber: number;
  totalRounds: number;
  captionSeconds: number;
  imageUrl: string | null;
  phaseEndsAt: number | null;
  captions: PublicCaption[];
  submittedCount: number;
  myCaptionSubmitted: boolean;
  myVoteCaptionId: string | null;
  winnerIds: string[];
}
