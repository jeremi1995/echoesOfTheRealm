import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { canTravel, guardianMaxHp, inventory, locations, npcAt, npcNames, playerMaxHp, questPhase, world } from '../shared/game.ts';
import type { Command, GameView } from '../shared/game.ts';
import './style.css';

const regions = {
  forest: 'Roadside camp',
  village: 'Village',
  ruins: 'Ancient ruins',
};

const characters = {
  warden: { role: 'Cloaked wanderer', greeting: 'Sit, if you like. I’ve been keeping this fire for someone.', prompt: 'Where does this road lead?' },
  elder: { role: 'Village elder', greeting: 'You came down the lantern road? Good. I need someone who can travel after dark.', prompt: 'What happened here?' },
  guide: { role: 'Veteran warrior', greeting: 'Stay behind the arch. I heard that same scrape the last time I came here.', prompt: 'How do I fight the guardian?' },
};

const objectives = ['Reach the Old Ruins', 'Defeat the guardian', 'Recover the Amber Relic'];

function Health({ name, value, max }: { name: string; value: number; max: number }) {
  return (
    <label className="health">
      <span>{name} <b>{value} / {max}</b></span>
      <meter min={0} max={max} value={value} />
    </label>
  );
}

function App() {
  const [view, setView] = useState<GameView>();
  const [intro, setIntro] = useState(true);
  const [dialogueOpen, setDialogueOpen] = useState(false);
  const [pending, setPending] = useState<Command['type']>();
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [restartOpen, setRestartOpen] = useState(false);
  const [initialAttempt, setInitialAttempt] = useState(0);
  const transcript = useRef<HTMLUListElement>(null);
  const inFlight = useRef(false);
  const busy = pending !== undefined;

  useEffect(() => {
    const abort = new AbortController();
    setError('');
    fetch('/api/game', { signal: abort.signal })
      .then(res => {
        if (!res.ok) throw new Error();
        return res.json() as Promise<GameView>;
      })
      .then(payload => {
        const { game } = payload;
        setIntro(game.location === 'forest' && questPhase(game) === 0 && !game.memory.warden.length && !game.memory.elder.length);
        setView(payload);
      })
      .catch(() => {
        if (!abort.signal.aborted) setError('The game could not connect. Make sure the local server is running.');
      });
    return () => abort.abort();
  }, [initialAttempt]);

  const game = view?.game;
  const npc = game && npcAt(game);
  const lines = game && npc ? game.memory[npc] : undefined;

  useEffect(() => {
    const box = transcript.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [lines, dialogueOpen]);

  async function act(command: Command) {
    if (!view || inFlight.current) return;
    inFlight.current = true;
    setPending(command.type);
    setError('');
    try {
      const res = await fetch('/api/game/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, revision: view.revision }),
      });
      const payload = await res.json() as GameView & { error?: string };
      if (res.ok || res.status === 409) setView(payload);
      if (!res.ok) {
        setError(payload.error ?? 'That command could not be completed.');
        return;
      }
      if (command.type === 'talk') setMessage('');
      if (command.type === 'travel' || command.type === 'restart' || command.type === 'load') {
        setDialogueOpen(false);
        setMessage('');
        setIntro(command.type === 'restart');
      }
    } catch {
      setError('The connection dropped. Try that command again.');
    } finally {
      inFlight.current = false;
      setPending(undefined);
    }
  }

  function submitMessage(event: FormEvent) {
    event.preventDefault();
    if (message.trim()) void act({ type: 'talk', message });
  }

  if (!game || !view || !npc || !lines) return (
    <main className="loading">
      <h1>Echoes of the Realm</h1>
      <p role="status">{error || 'Opening the game…'}</p>
      {error && <button onClick={() => setInitialAttempt(value => value + 1)}>Reconnect</button>}
    </main>
  );

  if (intro) return (
    <main className="prologue forest">
      <div className="prologue-content">
        <span className="eyebrow">Prologue</span>
        <h1>Echoes of<br />the Realm</h1>
        <p>You’ve been on the road since dawn. As night falls, a line of lanterns leads through the woods toward Lanternrest. Someone has lit a fire by the roadside.</p>
        <div className="actions">
          <button className="primary" onClick={() => setIntro(false)} disabled={busy}>Approach the campfire <span aria-hidden="true">→</span></button>
          {view.hasSave && <button disabled={busy} onClick={() => void act({ type: 'load' })}>Load saved game</button>}
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </main>
  );

  const phase = questPhase(game);
  const combat = game.location === 'ruins' && phase === 2;
  const defeated = game.playerHp === 0;
  const character = characters[npc];
  const gear = inventory(game);

  return (
    <div className="game-shell">
      <header className="game-bar">
        <span className="wordmark">Echoes of the Realm</span>
        <div className="actions" aria-label="Game menu">
          <button disabled={busy} onClick={() => setRestartOpen(true)}>New game</button>
          <button disabled={busy || !view.hasSave} onClick={() => void act({ type: 'load' })}>Load</button>
          <button disabled={busy} onClick={() => void act({ type: 'save' })}>Save</button>
        </div>
      </header>
      {restartOpen && (
        <div className="notice" role="group" aria-label="Confirm new game">
          <p>Start over? You can still load your last save.</p>
          <div className="actions">
            <button onClick={() => setRestartOpen(false)}>Cancel</button>
            <button className="primary" disabled={busy} onClick={() => { setRestartOpen(false); void act({ type: 'restart' }); }}>Start over</button>
          </div>
        </div>
      )}
      {error && <p className="notice error" role="alert">{error}</p>}
      <main className="playfield">
        <section className={'scene ' + game.location} aria-labelledby="scene-title">
          <div className="scene-heading">
            <span className="eyebrow">{regions[game.location]}</span>
            <h1 id="scene-title">{world[game.location].name}</h1>
          </div>
          <div className="scene-bottom">
            {dialogueOpen && (
              <section className="conversation" id="conversation" aria-labelledby="conversation-title">
                <div className="conversation-header">
                  <h2 id="conversation-title">{npcNames[npc]}</h2>
                  <button onClick={() => setDialogueOpen(false)}>Close</button>
                </div>
                {lines.length ? (
                  <ul className="transcript" ref={transcript} aria-label="Conversation history" aria-live="polite">
                    {lines.map((line, index) => (
                      <li key={index}>
                        <strong>{line.speaker === 'player' ? 'You' : npcNames[npc]}</strong>
                        <p>{line.text}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <>
                    <p className="greeting">{character.greeting}</p>
                    <button className="reply" disabled={busy} onClick={() => void act({ type: 'talk', message: character.prompt })}>
                      {character.prompt} <span aria-hidden="true">→</span>
                    </button>
                  </>
                )}
                <form onSubmit={submitMessage} className="actions">
                  <label className="sr-only" htmlFor="message">Message to {npcNames[npc]}</label>
                  <input id="message" value={message} disabled={pending === 'talk'} onChange={event => setMessage(event.target.value)}
                    maxLength={240} placeholder="Say something…" />
                  <button type="submit" disabled={busy || !message.trim()}>{pending === 'talk' ? 'Wait…' : 'Send'}</button>
                </form>
              </section>
            )}
            <button className="character" onClick={() => setDialogueOpen(open => !open)} aria-expanded={dialogueOpen}
              aria-controls={dialogueOpen ? 'conversation' : undefined}>
              <img src={'/art/' + npc + '.jpg'} alt="" />
              <span><small>{character.role}</small><strong>{npcNames[npc]}</strong></span>
              <span className="talk-label">{dialogueOpen ? 'Close' : 'Talk'}</span>
            </button>
          </div>
        </section>
        <aside className="field-menu">
          <nav aria-labelledby="travel-title">
            <h2 id="travel-title">Travel</h2>
            <div className="destinations">
              {locations.map(location => {
                const current = location === game.location;
                return (
                  <button key={location} className="destination" disabled={busy || current || !canTravel(game, location)}
                    aria-current={current ? 'location' : undefined}
                    onClick={() => void act({ type: 'travel', destination: location })}>
                    <img src={'/art/' + location + '.jpg'} alt="" />
                    <span><strong>{world[location].name}</strong>
                      <small>{current ? 'You are here' : location === 'ruins' && phase === 0 ? 'Speak to Elder Mara first' : regions[location]}</small>
                    </span>
                    <span aria-hidden="true">{current ? '●' : '→'}</span>
                  </button>
                );
              })}
            </div>
          </nav>
          {phase > 0 && <section className="quest" aria-labelledby="quest-title">
            <span className="eyebrow">Quest journal</span>
            <h2 id="quest-title">The Amber Relic</h2>
            {phase === 4 ? <p className="success">Quest complete</p> : <p>{objectives[phase - 1]}</p>}
          </section>}
          <section className="pack" aria-label="Adventurer status">
            <Health name="Health" value={game.playerHp} max={playerMaxHp} />
            <p><span>Inventory</span> <strong>{gear.join(', ') || 'Empty'}</strong></p>
          </section>
        </aside>
        <section className="action-bar" aria-label="Scene actions">
          <p role="status">{game.narration}</p>
          {combat && <div className="combat">
            <Health name="Guardian" value={game.guardianHp} max={guardianMaxHp} />
            <div className="actions">
              {defeated ? <button className="primary" disabled={busy} onClick={() => void act({ type: 'retry' })}>Retry encounter</button> : <>
                <button className="primary" disabled={busy} onClick={() => void act({ type: 'strike' })}>{game.braced ? 'Strike (braced)' : 'Strike'}</button>
                <button disabled={busy || game.braced} onClick={() => void act({ type: 'brace' })}>Brace</button>
              </>}
            </div>
          </div>}
          {game.location === 'ruins' && phase === 3 &&
            <button className="primary" disabled={busy} onClick={() => void act({ type: 'claim' })}>Claim the relic</button>}
        </section>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
