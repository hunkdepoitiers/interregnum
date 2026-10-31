# Interregnum — Design

Grand strategy, start date **27 July 1302** (just after the Battle of Bapheus).
Inspirations: Crusader Kings 2/3 (characters, dynasties, modifiers), Europa Universalis 4/5 (provinces, diplomacy, war), Victoria 2/3 (pops, economy), Imperator: Rome (pop-driven provinces, province sieges).

Decisions so far: **EU-style colour bitmap map**, **PixiJS v8 (WebGL)** renderer, **Preact + signals** UI, **YAML content compiled to JSON**, **GitHub + Vercel Git** deployment, TypeScript + Vite, Vitest.

---

## 1. Pillars
1. **Gold is the core resource.** The treasury is the central screen. Taxes, trade, tithes, armies, mercenaries, buildings, bribes and loans all flow through it.
2. **No mana.** Three character skills (Eminence, Statecraft, Warcraft) feed realm modifiers. Decisions cost gold, time and cooldowns, never points.
3. **Prestige and Piety** are earned by deeds only, stored on the realm, tiered. No flat trickle; any passive gain is a visible, sourced modifier.
4. **Province sieges** (Imperator-style): fort level, garrison, supplies, progress bar, starve / assault / bribe / engineers.
5. **Realm-first.** The player is the realm; characters are few and lightweight; a ruler's death is the drama.
6. **People inside systems**: ruler and heir → realm → provinces → pops.
7. **Readable depth, data-driven.** Every number has a breakdown; all content lives in YAML.

## 2. v1 scope
- Map: Iberia to the Caspian edge, Scotland/Baltic down to Aswan and Mecca (map edge 20.5°N). Starter map: ~1,830 provinces (1,747 land, 65 sea zones, 21 wastelands) and 114 realms including vassals and tributaries, with 1302 borders checked against the Euratlas map of 1300. The province budget was raised to ~1,000 in M2; prune seeds in `data/map/seeds.yaml` or merge realms in `data/scenario/1302.yaml` if it proves too much. Ilkhanate and Golden Horde are scripted neighbours (data-driven timelines of tribute demands and invasions, simplified armies).
- Start 27 July 1302 on the **Julian calendar** (historically correct: leap year every 4 years, so 1304 has 29 February). Daily tick, pause, 5 speeds.
- Singleplayer, browser (Vercel static site); later a Tauri desktop build.

## 3. Deliberately cut from v1
- **Navies and naval combat.** Sea zones exist for the map, coastal flags and straits; armies cross only at defined straits (Bosporus, Dardanelles, Messina, Otranto, Gibraltar, Øresund…). Ship transport comes later.
- Gunpowder, tech trees, innovations.
- Intrigue, schemes, murder, seduction, lifestyle trees, the Learning skill.
- Full trade-network simulation (EU4 nodes). v1 trade = province market value + trade-centre modifiers + strait tolls.
- Culture/religion conversion of pops (static in v1 except via events).
- Playing as a non-ruler character; portraits beyond simple heraldic/initial placeholders.
- Plague, colonisation, multiplayer, a mod loader beyond "edit the YAML".

## 4. Architecture
```
data/            YAML content + map/provinces.png (hand-painted)
tools/           Node build scripts: compile-data, build-map, seed-map
src/sim/         deterministic core, pure TS, no DOM; runs in a Web Worker and in Node (tests)
src/worker/      worker entry, clock loop, message protocol
src/bridge/      main-thread client: sends commands, receives snapshots / query answers
src/render/      PixiJS map (shader recolouring, camera, picking, overlays)
src/ui/          Preact components + signals (panels, tooltips, treasury)
src/platform/    thin layer: storage (IndexedDB), file export/import; web impl now, Tauri impl later
src/content/     zod schemas shared by tools and game
tests/           Vitest
```

### 4.1 Determinism
- All randomness goes through a seeded PRNG (sfc32); its state is part of the save.
- ESLint bans `Math.random`, `Date`, `performance` and `crypto` in `src/sim/**`, and bans `src/sim` importing anything outside itself.
- Money and most stats are **integers** (gold stored in 1/100 ducat). Percentages are applied with fixed integer rounding rules.
- Transcendental math (`Math.sin`, `Math.exp`, `Math.pow` with non-integer exponents) is banned in sim, because results can differ between JS engines. Use lookup tables or integer formulas.
- Test: run N days twice with one seed → identical state hash.

### 4.2 Worker protocol
- UI → worker: `Command` (setSpeed, pause, player actions).
- Worker → UI: per-tick `TickSummary` (date, player treasury headline, changed owner/controller arrays as transferable typed arrays) and replies to `Query` (e.g. `provinceDetails(id)` returns data plus stat breakdowns).
- The UI never mutates sim state.

### 4.3 Visible odds
Every random roll goes through `roll(chance: Explained<number>)`. The UI shows the chance and its breakdown before the action; the log shows the result ("rolled 37 vs 45% → success").

### 4.4 Daily tick order
commands → movement → battles → sieges → attrition / desertion / supply → character health and deaths → event checks (staggered: realm `id % 30` per day) → on month start: economy settlement, loan payments, pop growth, AI strategy.

Performance budget: daily tick < 5 ms at 500 provinces / 70 realms on a mid-range laptop.

### 4.5 Renderer: PixiJS v8 over Canvas 2D
With a colour bitmap of 4096×3342 px (~13.7M pixels), Canvas 2D would recolour on the CPU per pixel for every map-mode change or conquest (tens of ms, janky) and redraw the whole bitmap on pan/zoom. With WebGL the map is one quad: a fragment shader reads the province-ID texture and a small lookup texture (province index → colour for the current map mode) and draws borders by comparing neighbouring IDs (offset = one screen pixel, from a zoom uniform; `fwidth` is not available on WebGL1-level contexts). A change of ownership updates one texel; pan/zoom is a matrix change. Pixi also handles army markers, siege icons and labels as sprites. Cost: one custom shader (~60 lines).

### 4.6 Map pipeline (colour bitmap)
- `data/map/provinces.png`: RGB, one colour per province, no anti-aliasing.
- `data/map/definitions.yaml`: `color → id, key, name, kind (land | sea | wasteland | lake)`.
- `data/map/water.yaml`: historical water carved out of the modern coastline (the Zuiderzee before its reclamation).
- `data/map/straits.yaml`: extra adjacencies: straits and the caravan routes linking the Egyptian oases.
- `data/scenario/1302.yaml`: `enabled: false` switches the realms off while the province map is under construction (provinces-only view, no owners required); the realm data stays in the file. Realms (rank, government, colour, capital, overlord, scripted flag) with the provinces each owns, start-date occupations and explicitly unclaimed land. `tools/build-data` validates it against the built map (every land province owned exactly once or listed as unclaimed, capitals inside the realm, no loops of overlords, no water owned, warnings for look-alike neighbour colours) and writes `public/generated/scenario.json`.
- `data/map/projection.yaml`: equirectangular, standard parallel 45°N, bounds; converts city lat/lon to pixels.
- `tools/build-map` (runs in `npm run build`, also on Vercel): checks every pixel colour is defined, warns on non-contiguous and tiny provinces; computes pixel count, bbox, centroid, coastal flag, adjacency with shared border length; writes `public/generated/province-ids.png` (ID in R+G, 16-bit) and `public/generated/map.json`.
- `tools/seed-map` (one-off starter): rasterises a public-domain coastline (Natural Earth 1:50m land) and grows land and sea provinces from seed points in `data/map/seeds.yaml` (historical towns, lat/lon) with a noise-weighted multi-source growth (Dial's algorithm), so provinces stay contiguous, never jump water and get irregular borders. A seed may carry a radius in km: desert-edge provinces (Maghreb, Nile valley, Syrian and Arabian fringe) stop there and the open desert is filled by wasteland seeds, keeping those provinces coastal or riverine; wasteland grows at half speed so settled provinces always fill their radius. North Africa, Egypt, Sinai and the Hejaz follow a CK3-style county layout: Morocco down to Ifni (no Sijilmasa/Ziz), Algeria to Bou Saâda, Tunisia to the Souf and Qashtiliya, coastal Libya, the Nile to Aswan plus the western oases to Selima, Sinai as land, and the Hejaz down to Mecca. The output is a **starter** bitmap to repaint by hand (GIMP/Aseprite pencil tool, anti-aliasing off, no colour profile).
- District snapping: `tools/fetch-boundaries` (one-off) downloads simplified ADM2 district boundaries from geoBoundaries for every country on the map into `tools/vendor/` (git-ignored). `seed-map` then snaps provinces to them: a district holding one seed joins that seed's province, a seedless district joins the province already covering most of it, districts with several seeds keep the grown borders, mostly-desert districts are skipped so desert-edge provinces stay small, and districts more than 1.5x the size of the province they would join are skipped (coarse units such as German Regierungsbezirke). The fetch tool picks the finest district level per country with units of at least 30 km² and files of at most 20 MB, never coarser than ADM2. Stranded fragments are merged into the neighbour they border most. Borders therefore follow real rivers, ridges and valleys.
- Licence: because several district sources are ODbL or share-alike, the map data in `data/map/` is published under ODbL; sources are credited in `data/map/ATTRIBUTION.md` and in-game. Game code is not affected.
- Picking: the decoded ID map is kept as a `Uint16Array` on the main thread; hover/click is one array read.

## 5. Core systems

### 5.1 Stats and modifiers (the backbone)
- `StatDef` (data): key such as `province.tax_efficiency`, `realm.levy_size`, `character.warcraft`; base value, min/max, display format.
- `Modifier`: `{ defKey, source: {kind, id, label}, target: {kind, id}, effects: [{stat, op: 'add' | 'pct', value}], startDay, endDay | null, stacking: 'stack' | 'replace' | 'max' }`.
- One formula everywhere: `value = clamp((base + Σadd) × (1 + Σpct / 100))`.
- Scope inheritance: a province stat sees province modifiers + owner-realm modifiers targeting `province.*` + overlord modifiers where defined.
- `explain(stat, target)` returns `{ value, base, lines: [{label, op, value}] }`. The tooltip renders this for **every** number. **If a number cannot be explained by `explain`, it is a bug.**
- Character skills and traits become realm modifiers through roles, e.g. "Treasurer: Statecraft 12 → +6% tax efficiency".
- Computed on demand with a per-tick cache; adding/removing a modifier marks targets dirty.
- **Conditions/effects mini-DSL** (YAML, typed, validated by zod). Conditions: `stat_gte`, `has_modifier`, `faith_is`, `treasury_gte`, … Effects: `add_gold`, `add_modifier`, `add_prestige`, … Shared by decisions, laws, buildings and events.

### 5.2 Economy and treasury
- Currency: **ducat** (Venetian gold ducat, first struck 1284), stored as integer hundredths.
- Monthly income: land tax (peasants × development × tax law × tax efficiency), urban tax (burghers), trade (market value + trade-centre modifiers + strait tolls), tithe share (clergy; depends on church-relations law and piety), demesne, vassal dues, tribute received, loot.
- Monthly expenses: army wages (levies cheap but with limited service; professionals and mercenaries paid monthly), garrisons, fort maintenance, court and administration (scales with realm size, reduced by Statecraft), councillor salaries, loan interest, tribute paid. One-off: buildings, bribes, alms, engineers, law changes.
- **Treasury screen**: last-month and projected-month ledger by category (every line explained), balance, debt, credit rating, upcoming payments.
- Treasury below zero: unpaid troops (morale loss, desertion, mercenaries leave or defect), prestige loss, forced-loan events.
- **Loans**: banking houses are entities (Bardi, Peruzzi, Frescobaldi, Spini of Florence; Genoese and Venetian lenders; the Templars; Jewish moneylenders as local lenders). Each has capital, base rate, risk appetite and an opinion of you. Terms depend on credit rating (income, existing debt, default history, prestige) and ruler Eminence. Optional collateral: pledge a province's revenues (a modifier on that province). **Default**: credit rating crash, the house refuses further loans, prestige loss, pledged revenues seized, the house may fund your rivals or claimants. An over-exposed house can itself collapse (Bardi/Peruzzi-style event chain).
- **Buildings**: data-defined, cost gold + days, build speed from Statecraft, grant modifiers (market → trade; chapel → piety via a visible modifier).
- **Pops** (lighter than Victoria): per province, groups of `(stratum, culture, faith, size)`. Strata: nobles, clergy, burghers, peasants, nomads (Turkoman pastoralists). Pops drive tax base, trade, levies, tithes and supply limit. Satisfaction comes from modifiers (faith match, tax level, devastation, war); low satisfaction → unrest → revolt. Slow monthly growth or decline.

### 5.3 Characters, skills, succession
- Skills 0–20: base from parents (average ± seeded variance) + education + traits + modifiers (age, health).
- Education: from age 6 the heir gets a focus (Eminence / Statecraft / Warcraft); at 16 an outcome tier is rolled from guardian skill + focus (odds shown).
- Traits: data-defined modifier bundles; some congenital (inheritance chance).
- Roles: ruler, heir, consort, councillors (Chancellor → Eminence, Treasurer → Statecraft, Marshal → Warcraft, Chaplain → clergy/piety), generals. Councillors draw a salary.
- Death: health declines with age; daily hazard from age, health and traits; commanders can die in battle.
- **Succession laws**: primogeniture (agnatic / agnatic-cognatic), elective (HRE electors; Hungary's magnates in practice), Turkic open succession (strongest son; the beylik may split), republic (Venice, Genoa: elected by council; Eminence matters), theocracy (Papal States, Teutonic Order: elected from members).
- **Regency**: ruler under 16 → regent (relative or councillor). Regency modifiers: legitimacy penalty; the regent may embezzle gold (odds visible).
- **Claimants**: characters hold claims. On a weak succession, a claimant with enough backing (vassal opinion, gold, prestige) forms a faction, which can turn into a succession war.
- **Legitimacy** 0–100, modifier-driven (law fit, age, prestige tier, same dynasty). Affects vassal opinion, levy size and claim strength. Secondary to gold.

### 5.4 Prestige and Piety
- Stored on the **Realm** as the standing of the ruling house. Kept in full when the same dynasty succeeds; a dynasty change (usurpation, foreign heir) applies a visible loss modifier. *(Open question: keep on the Realm, or move to the Dynasty?)*
- One value each; tiers from the current value. Prestige: Disgraced < Obscure < Known < Respected < Renowned < Illustrious < Legendary. Piety tier names per faith. Tier effects are modifiers in data.
- A few actions spend them (pressing a weak claim costs prestige; calling a holy war costs piety), which can drop your tier. This tension is intentional.
- Gains — prestige: victories, sieges won, marriages to higher-tier realms, great buildings, tournaments, titles. Piety: defending/spreading the faith, holy wars, endowing religious buildings, pilgrimage, almsgiving (gold).
- Losses: defeats, unpaid troops, broken truces/alliances, fighting co-religionists, seizing church land.
- **No flat per-month gain or decay.** Passive gains exist only as sourced modifiers.
- Faith-specific tables in data, e.g.: Sunni Turkic beyliks gain piety *and* prestige from ghaza raids on Christian lands; Orthodox from monastery endowments; Catholic from crusade vows and papal favour; Lithuanian pagans from raids and sacred groves. Jewish and Miaphysite communities exist as minority pops (Cilician Armenia and Coptic pops are Miaphysite; there is no Jewish realm).
- **Excommunication** (Catholic): low piety + conflict with the Papacy → modifier (tithes stop, vassals may revolt, rivals gain a holy-war reason). Orthodox anathema is weaker. Islamic legitimacy: investiture by the Abbasid shadow caliph in Cairo (costs gold, via the Mamluks).

### 5.5 Armies and war
- Unit types: levies (raised from pops; cheap, limited feudal service, after which they cost gold or opinion), professionals / men-at-arms (monthly wages), mercenary companies (e.g. the Catalan Company, historically hired by Byzantium in 1303), engineers, nomad horse archers.
- Movement on the adjacency graph; travel days from centroid distance × terrain; straits allowed.
- Supply limit per province (pops, development, winter, devastation); over the limit → attrition.
- Battles: strength = Σ(men × unit factor) × commander Warcraft × terrain; resolved over a few days with seeded casualties; an estimated outcome is shown before engaging.
- Occupation: a hostile army in an unfortified province occupies it after N days; fortified → siege. **Control ≠ ownership.**
- War: attackers/defenders, casus belli (claim, holy war, conquest, independence, rebellion, ghaza raid), war score (occupation weighted by province value, battles, war-goal ticking), war exhaustion.
- Peace terms cost war score: cede provinces, **gold indemnity**, tribute, release vassal, white peace. Raids yield loot gold.

### 5.6 Sieges
- `Fort { level 0–5, garrison, maxGarrison, supplyDays, coastal }`.
- Daily: progress += f(besieger siege strength vs fort level, commander Warcraft, engineers, modifiers). Garrison supplies fall (slower if coastal: simplified sea resupply). A daily siege-event roll with visible odds: disease in camp, wall breach, sally, supplies run out, traitor opens a gate.
- Player options:
  - **Starve**: wait.
  - **Assault**: success odds and expected casualties shown; faster, bloody.
  - **Hire engineers**: gold → faster progress.
  - **Bribe garrison**: gold cost and odds shown; odds depend on bribe vs defender treasury, whether the garrison is paid, ruler Eminence, fort level.
- Besiegers suffer attrition and disease; unpaid troops desert daily.
- A completed siege gives control, war score and prestige.

### 5.7 Diplomacy and vassals
- Realm-to-realm opinion (modifier-driven), alliances, royal marriages, truces, tribute, vassalage.
- Vassal contract: levy and tax obligations, opinion, factions (independence, claimant, lower obligations). Gold bribes grant temporary opinion modifiers; Eminence scales their effect.
- HRE in v1: members carry an "Imperial Estate" modifier; the Emperor (King of the Romans, Albert I) has an elector list. No deep imperial mechanics in v1.

### 5.8 Events
- Data-defined: trigger conditions; scheduling via on-actions (`on_ruler_death`, `on_siege_start`, monthly pulse per realm) or fixed historical dates with conditions; options with effects and AI weights; odds shown.
- Historical hooks near the start: Peace of Caltabellotta (31 Aug 1302), fall of Ruad (autumn 1302), Battle of Marj al-Saffar (1303), Catalan Company to Byzantium (1303), Anagni and death of Boniface VIII (1303), expulsion of the Jews from France (1306), arrest of the Templars (1307), Papacy moves to Avignon (1309).

### 5.9 Laws
`Law { category (succession, taxation, levy obligation, crown authority, church relations), options with modifiers + requirements, change cost: gold + cooldown + opinion/legitimacy effects }`.

### 5.10 AI
Utility-based, monthly per realm: budget (army / buildings / debt), war target choice, army moves (BFS to targets), siege choice (starve vs assault heuristic). Diplomacy uses the same odds formulas the player sees. Scripted neighbours follow data timelines.

## 6. Data model
All ids are integers; state is plain JSON-serialisable objects in arrays.

```ts
Realm     { id, key, name, color, rank, government, capital: ProvinceId, rulerId, heirId,
            councillors: Record<Role, CharId>, dynastyId, faithId, cultureId, overlordId | null,
            treasury: int, prestige: int, piety: int, laws: Record<LawCategory, LawOptionKey>,
            loans: LoanId[], creditHistory, warIds, modifiers: ModId[] }
Province  { id, key, name, kind, terrain, ownerId, controllerId, development: int,
            buildings: BuildingKey[], pops: Pop[], fort: Fort | null, devastation: int, coastal,
            adjacency: { id, border }[], modifiers }
Fort      { level, garrison, maxGarrison, supplyDays, coastal }
Pop       { stratum, cultureId, faithId, size: int, satisfaction: int }
Character { id, name, dynastyId, birthDay, deathDay | null, sex, cultureId, faithId, motherId, fatherId,
            baseSkills: { eminence, statecraft, warcraft }, education: { focus, tier } | null,
            traits: TraitKey[], health: int, claims: TitleClaim[], realmId, roles: Role[], modifiers }
Dynasty   { id, key, name, founderId, members: CharId[] }
Faith     { id, key, name, family, headOfFaith: CharId | RealmId | null, holySites: ProvinceId[],
            prestigeSources, pietySources, pietyTiers, doctrines }              // data-only
Army      { id, ownerId, commanderId | null, location, path: ProvinceId[], moveProgress,
            regiments: { type, men, morale }[], unpaidMonths, mercenaryCompanyId | null }
Siege     { id, provinceId, besiegers: ArmyId[], progress: int /* 0..10000 */, startDay, garrison,
            supplyDays, breach: boolean, engineers: int, log: SiegeLogEntry[] }
War       { id, attackers: RealmId[], defenders: RealmId[], casusBelli, goal, warScore: int,
            startDay, exhaustion }
Loan      { id, lenderId: BankId, borrowerId, principal, rate, startDay, dueDay,
            pledgedProvince | null, status }
BankingHouse { id, key, name, capital, baseRate, riskAppetite, opinionOf: Record<RealmId, int>, solvent }
Modifier  { id, defKey, source, target, effects, startDay, endDay | null, stacking }
Event     { key, scope, trigger, schedule, options: { key, effects, aiWeight }[] }  // data-only; instances queued
Law       { key, category, options: { key, modifiers, requirements, changeCost }[] } // data-only
GameState { saveVersion, seed, rng, day, playerRealmId, realms, provinces, characters, dynasties,
            armies, sieges, wars, loans, banks, modifiers, eventQueue, log }
```

Saves: `GameState` serialised to JSON, gzipped (CompressionStream), stored in IndexedDB and exportable as a file. `saveVersion` from day one; loading runs a `migrate(fromVersion)` chain. Migrations receive the compiled scenario, so a save that predates a field can be filled from start-date data (v1 → v2 adds realms and province ownership).

## 7. Starting situation 1302 — and where I am guessing
**Confident**: Andronikos II Palaiologos (Byzantium, broke, after Bapheus), Osman I (Ottoman beylik), Ghazan (Ilkhanate), Tokhta (Golden Horde), al-Nasir Muhammad (Mamluks; real power with Baybars al-Jashnakir and Salar), Philip IV (France, after Courtrai on 11 July 1302), Edward I (England), Albert I (King of the Romans), Wenceslaus II (Bohemia and Poland), Hungary in a succession crisis after Andrew III's death (1301), Boniface VIII (Papacy), James II (Aragon), Frederick III (Sicily), Charles II (Naples), Ferdinand IV under regent María de Molina (Castile), Denis (Portugal), Pietro Gradenigo (Venice), Stefan Milutin (Serbia), Theodore Svetoslav (Bulgaria), Henry II (Cyprus), Vytenis (Lithuania).

**Guessing / simplifying**: borders and rulers of the smaller Anatolian beyliks (Karesi, Saruhan, Aydın, Menteshe, Germiyan, Hamid, Eshref, Candar, Karaman — some were founded or expanded a few years after 1302); the Cilician Armenian ruler arrangement (Leo III / Hethum II); Greek successor states (Epirus, Thessaly); Scotland's guardianship; every population figure; every income figure (balanced for play, not historically sourced); fort levels; the HRE prince list (minor princes merged into larger realms to stay within ~70 realms). Guessed data is marked `# GUESS` in YAML.

## 8. Bigger than they look
- **Map content**: the starter map is generated from seed towns; hand-repainting ~970 provinces into historical shapes is weeks of work, separate from code.
- **AI** for war, sieges and budgeting: the largest single risk; v1 AI will be simple and exploitable.
- **UI**: "every number explainable" means nested tooltips everywhere — many components.
- **Balance**: a money-centric economy with loans and mercenaries can spiral; needs a headless "run 100 years, dump stats" tool.
- **Succession and claimant wars**: many edge cases (minors, no heirs, elective deadlocks, split inheritance).
- **Events DSL**: easily grows into a programming language; keep it small and typed.
- **Determinism across browsers**: floats and transcendental math; enforced by lint and tests.
