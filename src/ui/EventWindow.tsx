import { command, pendingEvents, status, world } from '../bridge/client';
import type { Action } from '../sim/script';
import { content } from './StatList';

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** An option's effects in words, so nothing is hidden. */
function describe(actions: Action[]): string[] {
  const c = content.value;
  const out: string[] = [];
  for (const a of actions) {
    if ('add_gold' in a) out.push(`${signed(a.add_gold)} ducats`);
    else if ('add_prestige' in a) out.push(`${signed(a.add_prestige)} prestige`);
    else if ('add_piety' in a) out.push(`${signed(a.add_piety)} piety`);
    else if ('add_modifier' in a) out.push(`Gains: ${c?.modifiers[a.add_modifier]?.label ?? a.add_modifier}`);
    else if ('remove_modifier' in a) out.push(`Ends: ${c?.modifiers[a.remove_modifier]?.label ?? a.remove_modifier}`);
    else if ('kill_ruler' in a) out.push('The ruler dies');
    else if ('take_place' in a) out.push('Takes the province');
    else if ('region' in a) out.push(...describe(a.region.actions).map((t) => `Across the region: ${t}`));
    else if ('on_realm' in a) out.push(...describe(a.on_realm.actions).map((t) => `${a.on_realm.realm}: ${t}`));
    else if ('owner' in a) out.push(...describe(a.owner));
  }
  return out;
}

/** The player's oldest unanswered event; the clock stays stopped until it is answered. */
export function EventWindow() {
  const p = pendingEvents.value[0];
  const def = p ? content.value?.events.list.find((e) => e.key === p.key) : undefined;
  if (!p || !def) return null;
  const realm = world.value?.realms[p.realm];
  const fill = (t: string) => t.replace(/\{realm\}/g, realm?.name ?? 'the realm').replace(/\{ruler\}/g, p.ruler);
  const rest = pendingEvents.value.length - 1;
  return (
    <div class="event-veil">
      <div class="event-window folio panel" role="dialog" aria-label={def.title}>
        <h2><span class="initial">{def.title[0]}</span>{def.title.slice(1)}</h2>
        <p class="event-text">{fill(def.text)}</p>
        <div class="event-options">
          {def.options.map((o) => {
            const view = p.options.find((x) => x.key === o.key);
            const effects = describe(o.actions);
            return (
              <button key={o.key} disabled={!view?.open} onClick={() => command({ type: 'eventChoice', event: p.id, option: o.key })}>
                <strong>{o.label}</strong>
                {effects.length > 0 && <span class="event-effects">{effects.join(' · ')}</span>}
                {o.odds && view?.chance !== null && (
                  <>
                    <span class="event-effects">{((view?.chance ?? 0) / 100).toFixed(0)}% chance: {o.odds.success.text} {describe(o.odds.success.actions).join(' · ')}</span>
                    <span class="event-effects">{(100 - (view?.chance ?? 0) / 100).toFixed(0)}% chance: {o.odds.failure.text} {describe(o.odds.failure.actions).join(' · ')}</span>
                  </>
                )}
              </button>
            );
          })}
        </div>
        <p class="muted small">{status.value.paused ? 'The clock is stopped.' : ''}{rest > 0 ? ` ${rest} more waiting.` : ''}</p>
      </div>
    </div>
  );
}
