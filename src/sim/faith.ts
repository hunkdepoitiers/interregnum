import type { DeedDef } from './content';
import { add, ledgerIncome, type EconomyContext, type Notice } from './economy';
import { addModifier, hasModifier, removeModifiers } from './modifiers';
import { nextInt } from './rng';
import { changeStanding, ensureStanding, refreshTiers, tierOf } from './standing';
import type { GameState } from './state';

/**
 * Faiths, prestige and piety (DESIGN §5, M6). Both currencies move only by deeds and named events (standing.ts);
 * holy sites held are the one monthly source, and each shows by name in the realm's record.
 */

/** A realm's faith: its ruler's, else its capital's people's; 0 = none. */
export function realmFaith(state: GameState, ctx: EconomyContext, realm: number): number {
  const ruler = state.characters[state.courts[realm]?.ruler ?? 0];
  if (ruler?.religion) return ruler.religion;
  const cap = state.realms[realm]?.capital ?? 0;
  return ctx.religion?.[cap] ?? 0;
}

/** Piety tier names for a religion (by family; christian is the fallback). */
export function pietyNames(ctx: EconomyContext, religion: number): string[] {
  const f = ctx.content.faith;
  const fam = ctx.content.religions[religion - 1]?.family ?? 'christian';
  return f.pietyNames[fam] ?? f.pietyNames.christian ?? [];
}

/** Holy sites of the realm's faith it holds (owns and controls). */
export function holySitesHeld(state: GameState, ctx: EconomyContext, realm: number): { name: string; province: number }[] {
  const sites = ctx.content.faith.faiths[realmFaith(state, ctx, realm) - 1]?.holySites ?? [];
  return sites.filter((s) => state.provinces[s.province]?.owner === realm && state.provinces[s.province]?.controller === realm);
}

/** Every holy site in a province, with its faith's id. */
export function holySitesAt(ctx: EconomyContext, province: number): { name: string; religion: number }[] {
  const out: { name: string; religion: number }[] = [];
  ctx.content.faith.faiths.forEach((f, i) => { for (const s of f.holySites) if (s.province === province) out.push({ name: s.name, religion: i + 1 }); });
  return out;
}

/** Starting prestige by rank; piety by government and a pious ruler. Not logged: it is where the house stands. */
export function startFaith(state: GameState, ctx: EconomyContext): void {
  ensureStanding(state);
  const st = ctx.content.faith.start;
  state.standing.forEach((s, realm) => {
    const r = state.realms[realm];
    if (!s || !r) return;
    const ruler = state.characters[state.courts[realm]?.ruler ?? 0];
    s.prestige = st.prestige[r.rank as keyof typeof st.prestige] ?? 0;
    s.piety = st.piety + (st.pietyGovernment[r.government] ?? 0) + (ruler?.traits.includes('pious') ? st.piousTrait : 0);
    refreshTiers(state, ctx.content, realm);
  });
}

/** A new house keeps only part of the old one's standing. */
export function dynastyChangeStanding(state: GameState, ctx: EconomyContext, realm: number): void {
  const s = state.standing?.[realm];
  if (!s) return;
  const keep = ctx.content.faith.events.dynastyChangeKeep;
  const lose = (v: number) => Math.trunc((v * keep) / 100) - v;
  changeStanding(state, ctx.content, realm, { prestige: lose(s.prestige), piety: lose(s.piety) }, 'A new house on the throne');
}

/** Month start, before deaths: holy sites, pilgrims on the road and home again, and the Pope's anger. */
export function monthlyFaith(state: GameState, ctx: EconomyContext): Notice[] {
  const { content } = ctx;
  const f = content.faith;
  ensureStanding(state);
  const notices: Notice[] = [];
  state.standing.forEach((s, realm) => {
    if (!s || !state.realms[realm]) return;
    const sites = holySitesHeld(state, ctx, realm);
    const cap = f.pietyTiers[f.pietyTiers.length - 1]!.min;
    if (sites.length && f.holySitePiety && s.piety < cap) changeStanding(state, content, realm, { piety: sites.length * f.holySitePiety }, 'Holy sites held');
    const p = s.pilgrimage;
    if (p) {
      const pilgrim = state.characters[p.ruler];
      const target = { kind: 'realm' as const, id: realm };
      if (!pilgrim || pilgrim.died !== null || state.courts[realm]?.ruler !== p.ruler) {
        s.pilgrimage = null;
        removeModifiers(state, f.deeds.pilgrimage?.modifier ?? '', target);
      } else if (state.day >= p.until) {
        s.pilgrimage = null;
        removeModifiers(state, f.deeds.pilgrimage?.modifier ?? '', target);
        const d = f.deeds.pilgrimage!;
        changeStanding(state, content, realm, { prestige: d.prestige, piety: d.piety }, d.name);
        notices.push({ realm, text: `${pilgrim.name} has come home from pilgrimage.` });
      } else if (f.pilgrimageRisk && nextInt(state.rng, 10000) < f.pilgrimageRisk) {
        pilgrim.died = state.day;
        notices.push({ realm, text: `${pilgrim.name} of ${state.realms[realm]!.name} died on the pilgrims' road.` });
      }
    }
  });
  notices.push(...excommunications(state, ctx));
  return notices;
}

/** Who may be excommunicated now, and why not. */
export function excommunicationThreat(state: GameState, ctx: EconomyContext, realm: number): { possible: boolean; chance: number } {
  const ex = ctx.content.faith.excommunication;
  const head = ctx.content.faith.faiths[ex.religion - 1]?.head ?? 0;
  const s = state.standing[realm];
  const possible = !!s && !!ex.religion && !!head && realm !== head && !!state.realms[head] && realmFaith(state, ctx, realm) === ex.religion &&
    s.piety < ex.below && !hasModifier(state, ex.modifier, { kind: 'realm', id: realm }) &&
    !(ex.vacancy && hasModifier(state, ex.vacancy, { kind: 'realm', id: head }));
  return { possible, chance: possible ? ex.chance : 0 };
}

function excommunications(state: GameState, ctx: EconomyContext): Notice[] {
  const ex = ctx.content.faith.excommunication;
  const notices: Notice[] = [];
  if (!ex.religion) return notices;
  state.standing.forEach((s, realm) => {
    if (!s || !excommunicationThreat(state, ctx, realm).possible) return;
    if (nextInt(state.rng, 10000) >= ex.chance) return;
    addModifier(state, ctx.content, ex.modifier, { kind: 'realm', id: realm });
    changeStanding(state, ctx.content, realm, { prestige: ex.prestige }, 'Excommunicated');
    const ruler = state.characters[state.courts[realm]?.ruler ?? 0];
    notices.push({ realm, text: `The Pope has excommunicated ${ruler?.name ?? 'the ruler'} of ${state.realms[realm]!.name}.` });
  });
  return notices;
}

// ---------- Deeds

/** What a deed costs this realm now, hundredths of a ducat (from last month's gross income). */
export function deedCost(state: GameState, d: DeedDef, realm: number): number {
  const gross = ledgerIncome(state.economy[realm]?.ledger ?? {});
  return Math.max(d.minCost, d.cost + Math.trunc(gross * d.costMonths));
}

/** What a deed brings into the treasury (seizing church lands). */
export function deedIncome(state: GameState, d: DeedDef, realm: number): number {
  return Math.max(0, Math.trunc(ledgerIncome(state.economy[realm]?.ledger ?? {}) * d.incomeMonths));
}

/** Why this realm cannot do the deed now, or null if it can. */
export function cannotDeed(state: GameState, ctx: EconomyContext, realm: number, key: string): string | null {
  const f = ctx.content.faith;
  const d = f.deeds[key];
  const s = state.standing?.[realm];
  const ec = state.economy[realm];
  if (!d || !s || !ec || !state.realms[realm]) return 'Unknown deed.';
  const ex = f.excommunication;
  const excommunicated = hasModifier(state, ex.modifier, { kind: 'realm', id: realm });
  if (key === 'absolution' && !excommunicated) return 'You are in good standing with the Church.';
  if (key === 'absolution') {
    const head = f.faiths[ex.religion - 1]?.head ?? 0;
    if (!state.realms[head] || (ex.vacancy && hasModifier(state, ex.vacancy, { kind: 'realm', id: head }))) return 'There is no pope to absolve you.';
  }
  if (key === 'pilgrimage') {
    if (s.pilgrimage) return 'The ruler is already away on pilgrimage.';
    if (state.courts[realm]?.regent) return 'A child cannot go on pilgrimage.';
    if (!(f.faiths[realmFaith(state, ctx, realm) - 1]?.holySites.length)) return 'Your faith has no holy sites.';
  }
  if (key === 'seize_church_lands' && excommunicated) return 'There is nothing left to seize.';
  if (d.incomeMonths && !deedIncome(state, d, realm)) return 'Wait for the first month’s accounts.';
  const ready = s.cooldowns[key] ?? 0;
  if (state.day < ready) return `Not again so soon (${ready - state.day} days).`;
  if (ec.treasury < deedCost(state, d, realm)) return 'Not enough in the treasury.';
  return null;
}

/** Does a deed: pays for it, gains its standing (a pilgrimage pays out on the ruler's return) and its modifier. */
export function doDeed(state: GameState, ctx: EconomyContext, realm: number, key: string): Notice[] {
  if (cannotDeed(state, ctx, realm, key)) return [];
  const { content } = ctx;
  const f = content.faith;
  const d = f.deeds[key]!;
  const s = state.standing[realm]!;
  const ec = state.economy[realm]!;
  const target = { kind: 'realm' as const, id: realm };
  const cost = deedCost(state, d, realm);
  const income = deedIncome(state, d, realm);
  ec.treasury += income - cost;
  if (key === 'absolution') {
    const head = f.faiths[f.excommunication.religion - 1]!.head;
    const hec = state.economy[head];
    if (hec) { hec.treasury += cost; add(hec.oneOff, 'gifts', cost); }
    add(ec.oneOff, 'gifts', -cost);
    removeModifiers(state, f.excommunication.modifier, target);
  } else add(ec.oneOff, 'deeds', -cost);
  if (income) add(ec.oneOff, 'church_lands', income);
  if (d.cooldown) s.cooldowns[key] = state.day + d.cooldown;
  if (d.modifier) addModifier(state, content, d.modifier, target);
  const name = state.realms[realm]!.name;
  if (key === 'pilgrimage') {
    s.pilgrimage = { ruler: state.courts[realm]?.ruler ?? 0, until: state.day + d.days };
    const ruler = state.characters[s.pilgrimage.ruler];
    return [{ realm, text: `${ruler?.name ?? 'The ruler'} of ${name} has set out on pilgrimage.` }];
  }
  changeStanding(state, content, realm, { prestige: d.prestige, piety: d.piety }, d.name);
  return key === 'absolution' ? [{ realm, text: `The Pope has lifted the excommunication of ${name}.` }] : [];
}

/** Prestige and piety tier indexes and names, for reports. */
export function tiersOf(state: GameState, ctx: EconomyContext, realm: number) {
  const s = state.standing?.[realm];
  const f = ctx.content.faith;
  if (!s) return null;
  const pt = tierOf(f.prestigeTiers, s.prestige);
  const yt = tierOf(f.pietyTiers, s.piety);
  return { prestigeTier: pt, prestigeName: f.prestigeTiers[pt]!.name, pietyTier: yt, pietyName: pietyNames(ctx, realmFaith(state, ctx, realm))[yt] ?? '' };
}
