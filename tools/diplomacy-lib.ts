import type { DiplomacySource } from '../src/content/diplomacy';
import type { MapProvince } from '../src/content/map';
import { dateToDay } from '../src/sim/calendar';
import { SCALE, type DiplomacyDef } from '../src/sim/content';
import type { ScenarioRealm } from '../src/sim/scenario';
import { placeFinder, type MapContext } from './data-lib';

/** Converts data/content/diplomacy.yaml: realm keys to ids, dates to days, spawn points to provinces. */
export function compileDiplomacy(src: DiplomacySource, realms: ScenarioRealm[], provinces: MapProvince[], ctx: MapContext): { diplomacy: DiplomacyDef; errors: string[] } {
  const errors: string[] = [];
  const ids = new Map(realms.map((r) => [r.key, r.id]));
  const realm = (k: string, where: string) => {
    const id = ids.get(k);
    if (!id) errors.push(`diplomacy.yaml ${where}: unknown realm ${k}`);
    return id ?? 0;
  };
  const land = provinces.filter((p) => p.kind === 'land');
  const find = placeFinder(land, new Map(provinces.map((p) => [p.id, p])), ctx, errors);
  if (!src.vassals.contracts.some((c) => c.key === 'normal')) errors.push('diplomacy.yaml: a "normal" contract is required');
  const o = src.opinion;
  return {
    errors,
    diplomacy: {
      opinion: { sameFaith: o.same_faith, sameFamily: o.same_family, otherFamily: o.other_family, sameCultureGroup: o.same_culture_group, alliance: o.alliance, marriage: o.marriage, truce: o.truce, atWar: o.at_war, paysTribute: o.pays_tribute },
      alliance: { minOpinion: src.alliance.min_opinion, breakPrestige: src.alliance.break_prestige, callOpinion: src.alliance.call_opinion },
      marriage: { minOpinion: src.marriage.min_opinion, age: src.marriage.age, warPrestige: src.marriage.war_prestige, callOpinion: src.marriage.call_opinion },
      truceDays: Math.round(src.truce_years * 365.25),
      gift: { cost: Math.round(src.gift.cost * SCALE), costMonths: src.gift.cost_months, opinion: src.gift.opinion, days: src.gift.days, perEminence: src.gift.per_eminence, cooldown: src.gift.cooldown },
      tributeDemand: { share: src.tribute_demand.share, days: Math.round(src.tribute_demand.years * 365.25), power: src.tribute_demand.power, opinion: src.tribute_demand.opinion },
      peaceTribute: { share: src.peace_tribute.share, days: Math.round(src.peace_tribute.years * 365.25), cost: src.peace_tribute.cost },
      startAlliances: src.start_alliances.map(([a, b]) => [realm(a, 'start_alliances'), realm(b, 'start_alliances')]),
      vassals: {
        base: src.vassals.base, legitimacy: src.vassals.legitimacy, prestigeTier: src.vassals.prestige_tier, unpaid: src.vassals.unpaid, contractChange: src.vassals.contract_change,
        contracts: src.vassals.contracts.map((c) => ({ key: c.key, name: c.name, description: c.description, dues: c.dues, opinion: c.opinion, joinsWars: c.joins_wars })),
      },
      factions: { joinBelow: src.factions.join_below, revoltPower: src.factions.revolt_power, revoltDays: src.factions.revolt_days },
      replyDays: src.reply_days,
      timeline: src.timeline.map((t, i) => ({
        day: dateToDay({ year: t.date[0], month: t.date[1], day: t.date[2] }), type: t.type,
        from: realm(t.from, `timeline ${i}`), to: realm(t.to, `timeline ${i}`), share: t.share, days: Math.round(t.years * 365.25), men: t.men,
        spawn: find(t.spawn, `timeline ${i} spawn`)?.id ?? 0,
      })),
    },
  };
}
