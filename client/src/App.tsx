import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { socket } from './socket';
import type { RoomState } from './types';
import './App.css';

type Screen = 'home' | 'game';

function useCountdown(endsAt: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [endsAt]);
  if (!endsAt) return null;
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [name, setName] = useState(() => localStorage.getItem('cmg-name') ?? '');
  const [joinCode, setJoinCode] = useState('');
  const [rounds, setRounds] = useState(3);
  const [captionSeconds, setCaptionSeconds] = useState(45);
  const [state, setState] = useState<RoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(socket.connected);
  const [captionText, setCaptionText] = useState('');
  const [busy, setBusy] = useState(false);

  const secondsLeft = useCountdown(state?.phaseEndsAt ?? null);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onState = (s: RoomState) => {
      setState(s);
      setScreen('game');
      setError(null);
      if (s.phase !== 'caption') setCaptionText('');
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room:state', onState);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room:state', onState);
    };
  }, []);

  useEffect(() => {
    if (name) localStorage.setItem('cmg-name', name);
  }, [name]);

  const sortedPlayers = useMemo(() => {
    if (!state) return [];
    return [...state.players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }, [state]);

  function withAck(
    event: string,
    payload: unknown,
    onOk?: (res: Record<string, unknown>) => void
  ) {
    setBusy(true);
    setError(null);
    socket.timeout(8000).emit(event, payload, (err: Error | null, res: { error?: string; state?: RoomState } & Record<string, unknown>) => {
      setBusy(false);
      if (err) {
        setError('Server did not respond. Is the API running on port 3001?');
        return;
      }
      if (res?.error) {
        setError(res.error);
        return;
      }
      onOk?.(res);
    });
  }

  function createRoom(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Enter a display name');
      return;
    }
    withAck('room:create', { name: name.trim(), totalRounds: rounds, captionSeconds }, (res) => {
      if (res.state) setState(res.state as RoomState);
    });
  }

  function joinRoom(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !joinCode.trim()) {
      setError('Enter a name and room code');
      return;
    }
    withAck('room:join', { name: name.trim(), code: joinCode.trim() }, (res) => {
      if (res.state) setState(res.state as RoomState);
    });
  }

  function submitCaption(e: FormEvent) {
    e.preventDefault();
    if (!captionText.trim()) return;
    withAck('caption:submit', { text: captionText.trim() });
  }

  if (screen === 'home' || !state) {
    return (
      <div className="app">
        <header className="hero">
          <p className="eyebrow">Party caption game</p>
          <h1>Caption Meme</h1>
          <p className="lede">
            Everyone gets the same photo. Write the funniest caption. Vote. Flex on the leaderboard.
          </p>
          <p className={`status ${connected ? 'ok' : 'bad'}`}>
            {connected ? 'Connected to server' : 'Connecting…'}
          </p>
        </header>

        <div className="card-grid">
          <form className="card" onSubmit={createRoom}>
            <h2>Create room</h2>
            <label>
              Display name
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} placeholder="Your name" />
            </label>
            <label>
              Rounds
              <input
                type="number"
                min={1}
                max={10}
                value={rounds}
                onChange={(e) => setRounds(Number(e.target.value) || 3)}
              />
            </label>
            <label>
              Caption timer (seconds)
              <input
                type="number"
                min={10}
                max={180}
                value={captionSeconds}
                onChange={(e) => setCaptionSeconds(Number(e.target.value) || 45)}
              />
            </label>
            <button type="submit" disabled={busy || !connected}>
              Create & host
            </button>
          </form>

          <form className="card" onSubmit={joinRoom}>
            <h2>Join room</h2>
            <label>
              Display name
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} placeholder="Your name" />
            </label>
            <label>
              Room code
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                maxLength={6}
                placeholder="ABCD"
                className="code-input"
              />
            </label>
            <button type="submit" disabled={busy || !connected}>
              Join
            </button>
          </form>
        </div>
        {error && <p className="error banner">{error}</p>}
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <strong>Room {state.code}</strong>
          <span className="muted">
            {' '}
            · Round {state.roundNumber || '—'} / {state.totalRounds}
          </span>
        </div>
        <div className="phase-pill">{state.phase}</div>
      </header>

      {error && <p className="error banner">{error}</p>}

      {state.phase === 'lobby' && (
        <section className="panel">
          <h2>Lobby</h2>
          <p className="lede">Share code <span className="code">{state.code}</span> with friends. Open more tabs to test locally.</p>
          <ul className="player-list">
            {state.players.map((p) => (
              <li key={p.id} className={!p.connected ? 'dim' : ''}>
                {p.name}
                {p.isHost ? ' 👑' : ''}
                {p.id === state.youId ? ' (you)' : ''}
                {!p.connected ? ' · offline' : ''}
              </li>
            ))}
          </ul>
          {state.isHost ? (
            <button disabled={busy || state.players.filter((p) => p.connected).length < 2} onClick={() => withAck('game:start', {})}>
              Start game
            </button>
          ) : (
            <p className="muted">Waiting for host to start…</p>
          )}
        </section>
      )}

      {(state.phase === 'caption' || state.phase === 'vote' || state.phase === 'score') && state.imageUrl && (
        <div className="photo-wrap">
          <img src={state.imageUrl} alt="Round photo" />
          {state.phase === 'caption' && secondsLeft !== null && (
            <div className="timer">{secondsLeft}s</div>
          )}
        </div>
      )}

      {state.phase === 'caption' && (
        <section className="panel">
          <h2>Write a caption</h2>
          {state.myCaptionSubmitted ? (
            <p className="ok-text">Submitted! Waiting for others…</p>
          ) : (
            <form onSubmit={submitCaption} className="stack">
              <textarea
                value={captionText}
                onChange={(e) => setCaptionText(e.target.value)}
                maxLength={140}
                rows={3}
                placeholder="Make it a meme…"
              />
              <button type="submit" disabled={busy || !captionText.trim()}>
                Submit caption
              </button>
            </form>
          )}
          <p className="muted">
            {state.submittedCount} / {state.players.filter((p) => p.connected).length} submitted
          </p>
        </section>
      )}

      {state.phase === 'vote' && (
        <section className="panel">
          <h2>Vote for your favorite</h2>
          {state.myVoteCaptionId ? (
            <p className="ok-text">Vote locked in. Waiting for others…</p>
          ) : (
            <ul className="caption-list">
              {state.captions.map((c) => (
                  <li key={c.id}>
                    <button
                      className="caption-btn"
                      disabled={busy}
                      onClick={() => withAck('vote:submit', { captionId: c.id })}
                    >
                      {c.text}
                    </button>
                  </li>
                ))}
            </ul>
          )}
          {state.captions.length === 0 && <p className="muted">No captions this round — host can continue after score.</p>}
        </section>
      )}

      {state.phase === 'score' && (
        <section className="panel">
          <h2>Round results</h2>
          <ul className="caption-list results">
            {state.captions.map((c) => (
              <li key={c.id}>
                <div className="result-row">
                  <span className="votes">{c.voteCount ?? 0} vote{(c.voteCount ?? 0) === 1 ? '' : 's'}</span>
                  <strong>{c.text}</strong>
                </div>
              </li>
            ))}
          </ul>
          <p className="muted">Captions stay anonymous — scores update on the leaderboard below.</p>
          <Leaderboard players={sortedPlayers} youId={state.youId} />
          {state.isHost ? (
            <button disabled={busy} onClick={() => withAck('game:next', {})}>
              {state.roundNumber >= state.totalRounds ? 'See final results' : 'Next round'}
            </button>
          ) : (
            <p className="muted">Waiting for host…</p>
          )}
        </section>
      )}

      {state.phase === 'end' && (
        <section className="panel end">
          <h2>Game over</h2>
          <p className="winner">
            {state.winnerIds.length === 1
              ? `Winner: ${state.players.find((p) => p.id === state.winnerIds[0])?.name ?? '??'}`
              : `Tie: ${state.winnerIds.map((id) => state.players.find((p) => p.id === id)?.name).join(', ')}`}
          </p>
          <Leaderboard players={sortedPlayers} youId={state.youId} />
          {state.isHost ? (
            <div className="row">
              <button disabled={busy} onClick={() => withAck('game:rematch', {})}>
                Rematch
              </button>
              <button className="secondary" disabled={busy} onClick={() => withAck('game:lobby', {})}>
                Back to lobby
              </button>
            </div>
          ) : (
            <p className="muted">Waiting for host…</p>
          )}
        </section>
      )}
    </div>
  );
}

function Leaderboard({
  players,
  youId,
}: {
  players: RoomState['players'];
  youId: string;
}) {
  return (
    <div className="leaderboard">
      <h3>Leaderboard</h3>
      <ol>
        {players.map((p) => (
          <li key={p.id} className={p.id === youId ? 'you' : ''}>
            <span>{p.name}{p.id === youId ? ' (you)' : ''}</span>
            <strong>{p.score}</strong>
          </li>
        ))}
      </ol>
    </div>
  );
}
