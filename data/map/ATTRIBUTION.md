# Map data: sources and licence

The files in `data/map/` (`provinces.png`, `definitions.yaml`, `seeds.yaml`, `straits.yaml`, `projection.yaml`) are a
derived database built by `tools/seed-map.ts` and are made available under the
[Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/) (ODbL), because several of the boundary
sources below are ODbL or share-alike. The game code is not covered by this; only the map data is.

## Sources

- **Coastlines:** [Natural Earth](https://www.naturalearthdata.com/) 1:50m land, public domain.
- **World provinces outside Europe and the Middle East:** Natural Earth 1:10m populated places (seed towns), admin-1 states and provinces (borders where geoBoundaries has no data), geography regions (deserts and mountain ranges), lakes and land, all public domain.
- **Rivers:** [Natural Earth](https://www.naturalearthdata.com/) 1:10m rivers and lake centerlines, public domain.
- **District boundaries:** [geoBoundaries](https://www.geoboundaries.org/) gbOpen (Runfola et al. 2020, *geoBoundaries: A global
  database of political administrative boundaries*, PLoS ONE 15(4): e0231866), simplified geometries. Province borders
  are snapped to these districts. Per-country source, level and licence are listed in `boundary-sources.json`;
  OpenStreetMap-derived files are © OpenStreetMap contributors (ODbL).

### District licences by country

- **CC0 1.0 Universal (CC0 1.0) Public Domain Dedication:** PRT (ADM2), NLD (ADM2), SWE (ADM2), ISR (ADM2)
- **Creative Commons Attribution 2.5 Generic:** ALB (ADM2)
- **Creative Commons Attribution 3.0 Intergovernmental Organisations (CC BY 3.0 IGO):** MDA (ADM1), ARM (ADM2), IRQ (ADM2), SYR (ADM2), EGY (ADM2), SDN (ADM2)
- **Creative Commons Attribution 3.0 License:** ITA (ADM2), BLR (ADM2)
- **Creative Commons Attribution 4.0 (CC BY 4.0):** IRL (ADM2), PSE (ADM2)
- **Creative Commons Attribution 4.0 International (CC BY 4.0):** NOR (ADM2), LVA (ADM2), MKD (ADM2), GRC (ADM2), ROU (ADM2)
- **Creative Commons Attribution-ShareAlike 2.0:** AUT (ADM2), HRV (ADM2), XKX (ADM2), SAU (ADM2)
- **Creative Commons Attribution-ShareAlike 3.0 Unported:** CYP (ADM2), AZE (ADM2), TKM (ADM2)
- **Data license Germany - Attribution - Version 2.0:** DEU (ADM2)
- **Etalab Open License 2.0:** FRA (ADM2)
- **Federal Office of Topography swisstopo License:** CHE (ADM2)
- **National Institute of Statistics (INE) Data License:** ESP (ADM2)
- **Open Data Commons Open Database License 1.0:** MCO (ADM2), BEL (ADM2), LUX (ADM2), FIN (ADM2), EST (ADM2), LTU (ADM2), POL (ADM2), SVK (ADM2), LIE (ADM1), SMR (ADM1), SVN (ADM2), SRB (ADM2), MNE (ADM1), RUS (ADM2), HUN (ADM2), TUR (ADM2), IRN (ADM2), KWT (ADM2), TUN (ADM2), MAR (ADM2), KAZ (ADM2)
- **Open Government Licence v3.0:** GBR (ADM2)
- **Public Domain:** AND (ADM1), DNK (ADM2), CZE (ADM2), MLT (ADM1), BIH (ADM2), BGR (ADM2), UKR (ADM2), GEO (ADM2), LBN (ADM2), JOR (ADM2), LBY (ADM1), DZA (ADM2)

The Isle of Man and Gibraltar have no geoBoundaries data; their borders come from seed growth only.
