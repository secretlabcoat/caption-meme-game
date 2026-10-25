import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { isMusicOn, setMusicOn, subscribeMusic, unlockMusic } from './music';
import { socket } from './socket';
import type { RoomState } from './types';
import { isVoiceOn, setVoiceOn, speakCaptions, stopSpeaking, unlockSpeech } from './speak';
import './App.css';

type Screen = 'home' | 'game';

const PHASE_LABEL: Record<RoomState['phase'], string> = {
  lobby: 'Lobby',
  caption: 'Caption',
  vote: 'Vote',
  score: 'Scores',
  end: 'Finale',
};

const CHIP_COLORS = ['pink', 'gold', 'mint', 'sky', 'grape'] as const;

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
  const [captionSeconds, setCaptionSeconds] = useState(90);
  const [state, setState] = useState<RoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(socket.connected);
  const [captionText, setCaptionText] = useState('');
  const [busy, setBusy] = useState(false);
  const [voiceOn, setVoiceOnState] = useState(() => isVoiceOn());
  const [musicOn, setMusicOnState] = useState(() => isMusicOn());
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [musicDucked, setMusicDucked] = useState(false);
  const spokenKeyRef = useRef<string>('');

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

  useEffect(() => subscribeMusic((snapshot) => {
    setMusicOnState(snapshot.enabled);
    setMusicPlaying(snapshot.playing);
    setMusicDucked(snapshot.ducked);
  }), []);

  // Browsers block sound until a gesture. Any tap or key starts the lounge bed.
  useEffect(() => {
    const arm = () => unlockMusic();
    window.addEventListener('pointerdown', arm);
    window.addEventListener('keydown', arm);
    return () => {
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('keydown', arm);
    };
  }, []);

  useEffect(() => {
    if (name) localStorage.setItem('cmg-name', name);
  }, [name]);

  // Read captions aloud when voting or results appear (anonymous — text only)
  useEffect(() => {
    if (!state) return;
    if (state.phase !== 'vote' && state.phase !== 'score') {
      if (state.phase === 'caption' || state.phase === 'lobby' || state.phase === 'end') {
        stopSpeaking();
        spokenKeyRef.current = '';
      }
      return;
    }
    const texts = state.captions.map((c) => c.text).filter((t) => t.trim());
    if (!texts.length) return;
    const key = `${state.phase}:${state.roundNumber}:${texts.join('|')}`;
    if (spokenKeyRef.current === key) return;
    spokenKeyRef.current = key;
    void speakCaptions(texts);
  }, [state]);

  function toggleVoice() {
    unlockSpeech();
    const next = !voiceOn;
    setVoiceOn(next);
    setVoiceOnState(next);
    if (!next) return;
    // Turning voice back on during vote/results — read captions now
    if (!state || (state.phase !== 'vote' && state.phase !== 'score')) return;
    const texts = state.captions.map((c) => c.text).filter((t) => t.trim());
    if (!texts.length) return;
    spokenKeyRef.current = `${state.phase}:${state.roundNumber}:${texts.join('|')}`;
    void speakCaptions(texts);
  }

  function toggleMusic() {
    setMusicOn(!musicOn);
  }

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
    socket.timeout(60000).emit(event, payload, (err: Error | null, res: { error?: string; state?: RoomState } & Record<string, unknown>) => {
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
    unlockSpeech();
    unlockMusic();
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
    unlockSpeech();
    unlockMusic();
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

  const toggles = (
    <PartyToggles
      musicOn={musicOn}
      musicPlaying={musicPlaying}
      musicDucked={musicDucked}
      voiceOn={voiceOn}
      onToggleMusic={toggleMusic}
      onToggleVoice={toggleVoice}
    />
  );

  if (screen === 'home' || !state) {
    return (
      <div className="app home">
        <header className="hero">
          <p className="eyebrow">Party caption game</p>
          <h1>
            <span className="title-word">Caption</span>{' '}
            <span className="title-word pop">Meme</span>
          </h1>
          <p className="lede">
            Everyone gets the same photo. Write the funniest caption. Vote. Flex on the leaderboard.
          </p>
          <ul className="sticker-row">
            <li>Same photo</li>
            <li>Anonymous captions</li>
            <li>Vote &amp; score</li>
          </ul>
          <p className={`status ${connected ? 'ok' : 'bad'}`}>
            <span className="status-dot" aria-hidden="true" />
            {connected ? 'Connected to server' : 'Connecting…'}
          </p>
          {toggles}
        </header>

        <div className="card-grid">
          <form className="card create" onSubmit={createRoom}>
            <p className="card-kicker">Host</p>
            <h2>Create room</h2>
            <label>
              Display name
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} placeholder="Your name" autoComplete="nickname" />
            </label>
            <label>
              Rounds
              <input
                type="number"
                inputMode="numeric"
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
                inputMode="numeric"
                min={10}
                max={180}
                value={captionSeconds}
                onChange={(e) => setCaptionSeconds(Number(e.target.value) || 90)}
              />
            </label>
            <button type="submit" disabled={busy || !connected}>
              Create &amp; host
            </button>
          </form>

          <form className="card join" onSubmit={joinRoom}>
            <p className="card-kicker">Guest</p>
            <h2>Join room</h2>
            <label>
              Display name
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} placeholder="Your name" autoComplete="nickname" />
            </label>
            <label>
              Room code
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                maxLength={6}
                placeholder="ABCD"
                className="code-input"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
              />
            </label>
            <button type="submit" disabled={busy || !connected}>
              Join the party
            </button>
          </form>
        </div>
        {error && <p className="error banner" role="alert">{error}</p>}
      </div>
    );
  }

  const connectedCount = state.players.filter((p) => p.connected).length;
  const readingAloud = musicDucked && voiceOn && (state.phase === 'vote' || state.phase === 'score');
  const topVotes = state.captions.reduce((max, c) => Math.max(max, c.voteCount ?? 0), 0);

  return (
    <div className={`app phase-${state.phase}`}>
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">Caption Meme</span>
          <p className="room-meta">
            Room <strong className="code">{state.code}</strong>
            <span className="meta-sep">·</span>
            Round {state.roundNumber || '—'} / {state.totalRounds}
            {state.roundNumber > 0 && (
              <span className="round-pips" aria-hidden="true">
                {Array.from({ length: state.totalRounds }, (_, i) => (
                  <i key={i} className={i < state.roundNumber ? 'on' : ''} />
                ))}
              </span>
            )}
          </p>
        </div>
        <div className="topbar-actions">
          {toggles}
          <div className={`phase-pill phase-${state.phase}`}>{PHASE_LABEL[state.phase]}</div>
        </div>
      </header>

      {error && <p className="error banner" role="alert">{error}</p>}

      {state.phase === 'lobby' && (
        <section className="panel lobby">
          <p className="card-kicker">Waiting room</p>
          <h2>Share this code</h2>
          <p className="room-code" aria-label={`Room code ${state.code}`}>{state.code}</p>
          <p className="lede">Friends join with the code. Extra tabs on this computer work too.</p>
          <ul className="player-list">
            {state.players.map((p, i) => (
              <li key={p.id} className={`${!p.connected ? 'dim' : ''} chip-${CHIP_COLORS[i % CHIP_COLORS.length]}`}>
                <span className="player-name">
                  {p.name}
                  {p.isHost ? <span className="badge host">Host</span> : null}
                  {p.id === state.youId ? <span className="badge you">You</span> : null}
                  {!p.connected ? <span className="badge off">Offline</span> : null}
                </span>
              </li>
            ))}
          </ul>
          {state.isHost ? (
            <>
              <button
                type="button"
                disabled={busy || connectedCount < 2}
                onClick={() => withAck('game:start', {})}
              >
                Start game
              </button>
              {connectedCount < 2 && <p className="muted hint">Need at least 2 players in the room.</p>}
            </>
          ) : (
            <p className="muted hint">Waiting for the host to start…</p>
          )}
        </section>
      )}

      {(state.phase === 'caption' || state.phase === 'vote' || state.phase === 'score') && state.imageUrl && (
        <div className={`photo-wrap${state.phase === 'caption' ? ' compact' : ''}`}>
          <div className={`stage-flag stage-${state.phase}`}>
            {state.phase === 'caption' && 'This round'}
            {state.phase === 'vote' && 'Vote'}
            {state.phase === 'score' && 'Results'}
          </div>
          <img src={state.imageUrl} alt="Round photo" />
          {state.phase === 'caption' && secondsLeft !== null && (
            <div className={`timer ${secondsLeft <= 10 ? 'urgent' : ''}`}>{secondsLeft}s</div>
          )}
        </div>
      )}

      {state.phase === 'caption' && (
        <section className="panel">
          <p className="card-kicker">Your line</p>
          <h2>Write a caption</h2>
          {state.myCaptionSubmitted ? (
            <p className="ok-text">Submitted. Waiting for the rest of the room…</p>
          ) : (
            <form onSubmit={submitCaption} className="stack">
              <textarea
                value={captionText}
                onChange={(e) => setCaptionText(e.target.value)}
                maxLength={140}
                rows={3}
                placeholder="Make it a meme…"
              />
              <div className="char-count">{captionText.length}/140</div>
              <button type="submit" disabled={busy || !captionText.trim()}>
                Submit caption
              </button>
            </form>
          )}
          <div className="progress" aria-hidden="true">
            <span style={{ width: `${connectedCount ? (state.submittedCount / connectedCount) * 100 : 0}%` }} />
          </div>
          <p className="muted">
            {state.submittedCount} / {connectedCount} submitted
          </p>
        </section>
      )}

      {state.phase === 'vote' && (
        <section className="panel">
          <p className="card-kicker">Ballot</p>
          <h2>Vote for your favorite</h2>
          <p className="muted">
            {voiceOn
              ? 'Listen for number one, number two… Captions stay anonymous.'
              : 'Pick a favorite. Captions stay anonymous.'}
          </p>
          {readingAloud && <p className="now-reading">Reading the captions…</p>}
          {state.myVoteCaptionId ? (
            <p className="ok-text">Vote locked in. Waiting for the room…</p>
          ) : (
            <ul className="caption-list">
              {state.captions.map((c, i) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="caption-btn"
                    disabled={busy}
                    aria-label={`Number ${i + 1}. ${c.text}`}
                    onClick={() => withAck('vote:submit', { captionId: c.id })}
                  >
                    <span className={`num-badge tone-${i % 5}`}>{i + 1}</span>
                    <span className="caption-text">{c.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {state.captions.length === 0 && <p className="muted">No captions this round. The host can continue after the scores.</p>}
        </section>
      )}

      {state.phase === 'score' && (
        <section className="panel">
          <p className="card-kicker">Scoreboard</p>
          <h2>Round results</h2>
          {readingAloud && <p className="now-reading">Reading the captions…</p>}
          <ul className="caption-list results">
            {state.captions.map((c, i) => {
              const votes = c.voteCount ?? 0;
              const favorite = topVotes > 0 && votes === topVotes;
              return (
                <li key={c.id} className={favorite ? 'favorite' : ''}>
                  <div className="result-row">
                    <span className={`num-badge tone-${i % 5}`}>{i + 1}</span>
                    <span className="caption-text">{c.text}</span>
                    <span className="votes">
                      {votes} vote{votes === 1 ? '' : 's'}
                      {favorite ? <span className="badge top">Top laugh</span> : null}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="muted anonymity">Captions stay anonymous. Points land on the leaderboard.</p>
          <Leaderboard players={sortedPlayers} youId={state.youId} />
          {state.isHost ? (
            <button type="button" disabled={busy} onClick={() => withAck('game:next', {})}>
              {state.roundNumber >= state.totalRounds ? 'See final results' : 'Next round'}
            </button>
          ) : (
            <p className="muted hint">Waiting for the host…</p>
          )}
        </section>
      )}

      {state.phase === 'end' && (
        <section className="panel end">
          <p className="card-kicker">That’s a wrap</p>
          <h2>Game over</h2>
          <p className="winner-kicker">{state.winnerIds.length === 1 ? 'Winner' : 'Tie'}</p>
          <p className="winner">
            {state.winnerIds.length === 1
              ? (state.players.find((p) => p.id === state.winnerIds[0])?.name ?? '??')
              : state.winnerIds.map((id) => state.players.find((p) => p.id === id)?.name).filter(Boolean).join(', ')}
          </p>
          <Leaderboard players={sortedPlayers} youId={state.youId} />
          {state.isHost ? (
            <div className="row">
              <button type="button" disabled={busy} onClick={() => withAck('game:rematch', {})}>
                Rematch
              </button>
              <button type="button" className="secondary" disabled={busy} onClick={() => withAck('game:lobby', {})}>
                Back to lobby
              </button>
            </div>
          ) : (
            <p className="muted hint">Waiting for the host…</p>
          )}
        </section>
      )}
    </div>
  );
}

function PartyToggles({
  musicOn,
  musicPlaying,
  musicDucked,
  voiceOn,
  onToggleMusic,
  onToggleVoice,
}: {
  musicOn: boolean;
  musicPlaying: boolean;
  musicDucked: boolean;
  voiceOn: boolean;
  onToggleMusic: () => void;
  onToggleVoice: () => void;
}) {
  const eqMode = !musicOn ? 'off' : musicDucked ? 'ducked' : musicPlaying ? 'live' : 'idle';
  return (
    <div className="toggle-row">
      <button
        type="button"
        className={`pill-toggle ${musicOn ? 'on' : 'off'}`}
        aria-pressed={musicOn}
        aria-label={musicOn ? 'Mute lounge music' : 'Play lounge music'}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onToggleMusic}
      >
        <EqBars mode={eqMode} />
        {musicOn ? 'Music on' : 'Music off'}
      </button>
      <button
        type="button"
        className={`pill-toggle voice ${voiceOn ? 'on' : 'off'}`}
        aria-pressed={voiceOn}
        aria-label={voiceOn ? 'Turn caption voice off' : 'Turn caption voice on'}
        onClick={onToggleVoice}
      >
        {voiceOn ? 'Voice on' : 'Voice off'}
      </button>
    </div>
  );
}

function EqBars({ mode }: { mode: 'off' | 'idle' | 'live' | 'ducked' }) {
  return (
    <span className={`eq eq-${mode}`} aria-hidden="true">
      <i /><i /><i />
    </span>
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
        {players.map((p, i) => (
          <li key={p.id} className={`${p.id === youId ? 'you' : ''} place-${Math.min(i, 3)}`}>
            <span className="rank">{i + 1}</span>
            <span className="lb-name">{p.name}{p.id === youId ? ' (you)' : ''}</span>
            <strong>{p.score}</strong>
          </li>
        ))}
      </ol>
    </div>
  );
}
