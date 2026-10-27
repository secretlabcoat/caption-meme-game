export type Phase = 'lobby' | 'caption' | 'vote' | 'score' | 'end';

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

/** A top-voted line from a finished round. Anonymous — no writer. */
export interface Highlight {
  roundNumber: number;
  text: string;
  voteCount: number;
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
  highlights: Highlight[];
}
