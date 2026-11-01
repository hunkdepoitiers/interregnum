import { useState } from 'preact/hooks';
import { world } from '../bridge/client';
import { GOVERNMENTS as governments, RANKS as ranks, type Government, type Rank } from '../sim/scenario';
import { brush, createRealm, discardEdits, editing, exportEdits, sessionEdits } from './editor';

const LIST_LIMIT = 80;

export function EditorPanel() {
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [color, setColor] = useState('#b08a5a');
  const [rank, setRank] = useState<Rank>('duchy');
  const [government, setGovernment] = useState<Government>('feudal_monarchy');
  const w = world.value;
  if (!editing.value || !w) return null;

  const q = query.trim().toLowerCase();
  const realms = w.realms
    .filter((r) => r && (!q || r.name.toLowerCase().includes(q) || r.key.includes(q)))
    .sort((a, b) => a!.name.localeCompare(b!.name))
    .slice(0, LIST_LIMIT);
  const current = brush.value ? w.realms[brush.value] : null;
  const count = sessionEdits.value.size;

  return (
    <aside class="editor-panel panel" aria-label="Map editor">
      <button class="close" aria-label="Close editor" onClick={() => (editing.value = false)}>×</button>
      <h2>Map editor</h2>
      <p class="sub">Drag to paint · Shift erases · Alt picks a realm · right-drag pans</p>
      <p class="brush">
        Brush: {current ? <><span class="swatch" style={{ background: current.color }} />{current.name}</> : <em>Unowned</em>}
      </p>
      <input type="search" placeholder="Find a realm…" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
      <ul class="brush-list">
        <li><button class={brush.value === 0 ? 'on' : ''} onClick={() => (brush.value = 0)}><em>Unowned</em></button></li>
        {realms.map((r) => (
          <li key={r!.id}>
            <button class={brush.value === r!.id ? 'on' : ''} onClick={() => (brush.value = r!.id)}>
              <span class="swatch" style={{ background: r!.color }} />{r!.name}
            </button>
          </li>
        ))}
      </ul>
      <details>
        <summary>New realm</summary>
        <form
          class="new-realm"
          onSubmit={(e) => {
            e.preventDefault();
            createRealm(name, color, rank, government);
            setName('');
          }}
        >
          <input placeholder="Name, e.g. Duchy of Athens" value={name} onInput={(e) => setName(e.currentTarget.value)} required />
          <label>Colour <input type="color" value={color} onInput={(e) => setColor(e.currentTarget.value)} /></label>
          <select value={rank} onChange={(e) => setRank(e.currentTarget.value as Rank)}>
            {ranks.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={government} onChange={(e) => setGovernment(e.currentTarget.value as Government)}>
            {governments.map((g) => <option key={g} value={g}>{g.replace(/_/g, ' ')}</option>)}
          </select>
          <button type="submit">Create and paint with it</button>
        </form>
      </details>
      <p class="sub">{count} province{count === 1 ? '' : 's'} changed, kept in this browser until exported</p>
      <div class="editor-actions">
        <button onClick={exportEdits}>Export edits</button>
        <button onClick={() => confirm('Throw away the unsaved edits in this browser?') && discardEdits()}>Discard</button>
      </div>
    </aside>
  );
}
