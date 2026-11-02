# Interregnum — Roadmap

Every milestone ends deployed on Vercel and playable or testable. The next milestone starts only after approval.

| # | Milestone | Done when |
|---|---|---|
| M1 ✅ | **Foundation**: Vite + TS, lint rules, Vitest, sim worker, seeded RNG, Julian calendar, daily clock with pause + 5 speeds, map pipeline (seed-map, build-map), PixiJS map with pan/zoom/hover/click, province info panel, versioned save skeleton (IndexedDB + export/import), GitHub + Vercel | Link opens, coarse map renders, date runs from 27 July 1302, clicking shows a province, save → export → import restores the date; tests pass |
| M2 ✅ | **Realms and ownership**: full province set (whole world: 8,698 provinces, 6,704 land; Europe and the Middle East at CK3 county density, 2,474 land, generated from seed towns), 114 realms in YAML checked against Euratlas 1300 with 1302 owners, colours, capitals, ranks; owner vs controller; political map mode; realm panel; data validation in build. Later moved to **1 November 1314**: 234 realms drawn as lat/lon outlines after Cyowari's 1314 maps, on the 12,484-province OpenGS map | Political map of 1302 matches the reference list; invalid YAML fails the build |
| M3 ✅ | **Modifier system + conditions/effects DSL**: stat registry, modifiers, `explain`, tooltip component, debug console to add/remove modifiers | Every stat shown in the UI has a breakdown tooltip; unit tests for stacking and expiry |
| M4 | **Economy and treasury**: pops, taxes, trade, tithes, expenses, treasury screen, tax law, buildings, banking houses, loans, default | Run 10 years: treasury moves plausibly; take a loan, build a market, default and see the consequences |
| M5 | **Characters, skills, succession**: characters and dynasties for all realms, council, traits, education, death, succession laws, regency, claimants (pressure without war), legitimacy | Fast-forward 50 years: rulers die, heirs inherit, regencies happen, effects visible |
| M6 | **Faiths, prestige, piety**: faith data, tiers, sources, almsgiving, religious buildings, excommunication | Gain and lose both currencies through deeds only; tier effects in tooltips |
| M7 | **Armies, movement, occupation**: levies, professionals, raising/disbanding, upkeep, pathfinding, supply/attrition, battles, occupation of unfortified provinces; minimal defender AI | Declare a debug war, move armies, fight, occupy |
| M8 | **Sieges, mercenaries, war**: forts, full siege system, starve/assault/bribe/engineers, mercenary companies, desertion, casus belli, war score, peace deals | Win a war through sieges; pay or receive an indemnity |
| M9 | **Diplomacy and vassals**: opinion, alliances, marriages, truces, tribute, vassal contracts, factions, bribery, scripted Ilkhanate/Golden Horde | Vassals rebel when unpaid or unhappy; marriages and alliances matter in wars |
| M10 | **Events engine**: scheduling, on-actions, event UI, historical event pack 1314–1330 | Historical events fire when conditions hold; odds shown |
| M11 | **AI**: budget, war, siege, diplomacy | AI realms expand, borrow, go bankrupt, and survive 100 headless years without crashing |
| M12 | **Polish**: UI pass, autosave, save migrations, balance pass with a headless stats tool, playtest build, Tauri spike | Friends play a full session from the link and send save files |

Deviation from the suggested order: the conditions/effects DSL moves into M3, because decisions, laws and buildings need it before events do. M10 adds only scheduling, UI and content.

## M1 detail

**Setup**
- Vite (vanilla-ts) + `preact`, `@preact/signals`, `pixi.js@8`, `zod`, `yaml`, `idb-keyval`; dev: `vitest`, `eslint`, `typescript-eslint`, `tsx`, `pngjs`. Versions pinned at install.
- `tsconfig` strict. ESLint flat config with the sim restrictions (DESIGN §4.1).
- Scripts: `build:data`, `build:map`, `build` (= data + map + `vite build`), `test`, `lint`, `seed-map`.

**Sim core** (`src/sim/`): `rng.ts` (sfc32, serialisable state), `calendar.ts` (Julian; day 0 = 27 July 1302, later moved to 1 November 1314), `state.ts` (GameState v1: saveVersion, seed, rng, day, speed, paused), `tick.ts` (advance one day, emit month start), `commands.ts`, `save.ts` (serialise, migrate chain, gzip), `hash.ts` (state hash for tests).

**Worker** (`src/worker/`): clock loop via `setTimeout` at speed-based intervals (1000 / 400 / 150 / 50 / 10 ms per day; speed 5 is capped so an empty sim does not race through centuries); protocol types.

**Map**: `data/map/seeds.yaml` with ~120–150 historical towns + ~25 sea seeds (coarse coverage, denser in Anatolia/Balkans); `tools/seed-map.ts` → `data/map/provinces.png` + `definitions.yaml`; `tools/build-map.ts` → `public/generated/`. Coastline: Natural Earth `ne_50m_land` (public domain), downloaded only after confirmation.

**Render** (`src/render/`): Pixi app, map quad + custom shader (ID texture + lookup texture + borders), camera (drag pan, wheel zoom to cursor, clamps), hover/selection highlight via the lookup texture.

**UI** (`src/ui/`): top bar (date, speed buttons, pause; keys Space and 1–5), province panel (name, kind, size, neighbours), save / load / export / import.

**Platform** (`src/platform/`): `Platform` interface (`storage`, `files`) with a web implementation.

**Tests**: RNG reproducibility and state round-trip; calendar (27 Jul 1302 + 1, month ends, 29 Feb 1304, year rollover); tick determinism (two runs of 3650 days → equal hash); save serialise/migrate/deserialise; build-map on a tiny fixture PNG (adjacency, unknown-colour error, contiguity warning).

**Deploy**: `git init`, first commit; repo visibility (public/private) confirmed before `gh repo create`; push; connect Vercel to the repo (build `npm run build`, output `dist`).

**Verification**: `npm test` green; `npm run lint` clean (a deliberate `Math.random` in sim must fail lint); `npm run build` + `npm run preview` shows the map, pan/zoom, correct hover/click, date advancing at each speed, pause, save → export → import; the Vercel production URL behaves the same.
