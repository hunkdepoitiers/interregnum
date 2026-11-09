import type { WarSource } from '../src/content/war';
import { SCALE, type WarDef } from '../src/sim/content';

const ducats = (n: number) => Math.round(n * SCALE);

/** Converts data/content/war.yaml to the sim's units. */
export function compileWar(src: WarSource): WarDef {
  const casusBelli = Object.entries(src.casus_belli).map(([key, c]) => ({
    key, name: c.name, description: c.description, prestige: c.prestige, piety: c.piety, winPrestige: c.win_prestige, winPiety: c.win_piety, minPiety: c.min_piety, governments: c.governments,
  }));
  const f = src.forts;
  const s = src.siege;
  const a = src.assault;
  const p = src.peace;
  return {
    forts: {
      capital: f.capital, development: f.development, tradeCentre: f.trade_centre, maxLevel: f.max_level, garrisonPerLevel: f.garrison_per_level,
      supplyBase: f.supply_base, supplyPerLevel: f.supply_per_level, capturedGarrison: f.captured_garrison, refill: f.refill, castleBuilding: f.castle_building,
    },
    siege: {
      progress: s.progress, menMin: s.men_min, menMax: s.men_max, warcraft: s.warcraft, engineerBonus: s.engineer_bonus, maxEngineers: s.max_engineers,
      engineerCost: ducats(s.engineer_cost), starvingProgress: s.starving_progress, starvingLoss: s.starving_loss, prestige: s.prestige, eventChance: s.event_chance,
      events: s.events, diseaseLoss: s.disease_loss, sallyLoss: s.sally_loss, sallyGarrisonLoss: s.sally_garrison_loss, breachProgress: s.breach_progress,
      storesLostDays: s.stores_lost_days, traitorStores: s.traitor_stores,
    },
    assault: {
      base: a.base, perProgress: a.per_progress, breach: a.breach, perRatio: a.per_ratio, ratioCap: a.ratio_cap, perLevel: a.per_level, min: a.min, max: a.max,
      lossesWon: a.losses_won, lossesLost: a.losses_lost, garrisonLost: a.garrison_lost, moraleLost: a.morale_lost, cooldown: a.cooldown,
    },
    bribe: { cost: ducats(src.bribe.cost), chances: src.bribe.chances, unpaidBonus: src.bribe.unpaid_bonus, perEminence: src.bribe.per_eminence, perLevel: src.bribe.per_level, cooldown: src.bribe.cooldown },
    desertion: src.desertion, levyRecovery: src.levy_recovery, battlePrestigeMen: src.battle_prestige_men,
    companies: src.companies.map((c) => ({ ...c, cost: ducats(c.cost), wage: ducats(c.wage), strength: Math.round(c.strength * SCALE) })),
    casusBelli, raidLoot: ducats(src.raid_loot),
    score: { battleCap: src.score.battle_cap, battleMen: src.score.battle_men, battleMax: src.score.battle_max, tickingCap: src.score.ticking_cap, ticking: src.score.ticking },
    peace: {
      land: p.land, indemnityPerMonth: p.indemnity_per_month, indemnityMonths: p.indemnity_months, vassalize: p.vassalize, releaseVassal: p.release_vassal, humiliate: p.humiliate, humiliatePrestige: p.humiliate_prestige, breakAlliances: p.break_alliances, winPrestige: p.win_prestige, losePrestige: p.lose_prestige,
      aiScore: p.ai_score, aiDays: p.ai_days, aiWhite: p.ai_white, concede: p.concede,
    },
  };
}
