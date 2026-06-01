# Tweaken scores

Branch: `Tweaken-scores` · Basis: `main` @ `8c8b3de`

Levend overzicht van score-aanpassingen die in deze branch worden doorgevoerd.
Elke tweak wordt **na implementatie** toegevoegd volgens onderstaand vast format,
zodat we de inhoudelijke rationale + meetbare impact bij elkaar houden.

---

## Format per tweak

```
### <korte titel>

**Aanleiding** — Wat klopte niet / wat viel op in de huidige berekening?

**Wijziging** — Wat hebben we precies aangepast (in 1-3 zinnen)?

**Bestanden**
- `path/to/file.ext` — korte uitleg van de wijziging

**Parameters / drempelwaarden**
| Parameter | Oud | Nieuw |
|---|---|---|
| ... | ... | ... |

**Impact op de dataset**
- N debiteuren / taken geraakt
- Verdeling vóór ↔ na (per score-bucket of relevante metric)
- Voorbeeld-cases (1-3 debiteurnummers) waar het effect goed te zien is

**Commit** — `<hash>` <commit message>
```

---

## Aanpassingen

### 1. Nieuwe sub-score "Hoeveel afwijking van betaalgedrag?"

**Aanleiding** — De risico-score verdunde de "historisch nette betaler die nu
fors afwijkt"-situatie weg. Voorbeelden: D103808 (mediaan 0d op betaalde
facturen, maar 71% vervallen) en D013052 (betaalt voorspelbaar rond 41d, maar
inmiddels meerdere posten ver voorbij die norm). Doordat `betaalgedrag` het
gemiddelde was van DSO + trend + voorspelbaarheid, trok een goede historie de
score omlaag terwijl het actuele risico juist opliep.

**Wijziging** — 4e sub-score onder "Hoe is het betaalgedrag": meet hoe ver de
oudste vervallen post voorbij de norm ligt. Anker = 12-maands mediaan-DSO,
**geclampt op 0** (een structurele vroegbetaler krijgt norm "op tijd", niet zijn
eigen voorsprong). Afwijking = `oudste_vervallen_dagen − anker`. De score telt
mee via een **max-regel**: `betaalgedrag = max(gemiddelde(dso, trend, vol),
afwijking)` — mag de score dus alleen omhoog trekken, nooit verdunnen.

**Bestanden**
- `scripts/preprocess/build-data.mjs` — afwijking-berekening + max-regel + breakdown-output (CLI-build)
- `src/preprocess/build-data.ts` — idem voor de upload-flow in de browser
- `src/data.ts` — `afwijking`-veld toegevoegd aan `BetaalgedragBreakdown`
- `src/detail/tooltips.tsx` — `tooltipAfwijking` + samenvattende bullet in `risicoBullets`
- `src/detail/DetailView.tsx` — 4e `MetricCard` in het risico-blok
- `src/data.generated.json` — geregenereerd

**Parameters / drempelwaarden**
| Parameter | Oud | Nieuw |
|---|---|---|
| Anker | n.v.t. | `max(0, 12-maands mediaan-DSO)` |
| Schaal afwijking (dagen voorbij norm) | n.v.t. | ≤0→1, 1-5→2, 6-10→3, 11-20→4, >20→5 |
| Weging in betaalgedrag | gemiddelde dso/trend/vol | `max(gemiddelde, afwijking)` |
| Edge: geen betaalhistorie | n.v.t. | score `null` (telt niet mee) |
| Edge: geen vervallen posten | n.v.t. | score 1 |

**Impact op de dataset** (dummy, 188 taken)
- 176 taken kregen een afwijking-score, 12 `null` (geen 12-mnd historie); bij 82 taken trok de max-regel het betaalgedrag op.
- Risico-bucket-verdeling vóór ↔ na: 1.0–1.9 `15 → 10`, 2.0–2.9 `103 → 86`, 3.0–3.9 `66 → 72`, 4.0–5.0 `4 → 20`.
- Voorbeeld-cases:
  - D000119 — anker 0d, oudste 185d → afw 5, risico 4.86 (terecht hoog).
  - D000190 — anker 0d, oudste 73d → afw 5, risico 3.89.
  - D000977 — vroegbetaler (mediaan −27d), oudste 2d → clamp houdt afw op 2, risico 1.33 (niet onterecht opgeschaald).
- Upload-dataset (66 taken): 3.0–3.9 `5 → 19`, 4.0–5.0 `3 → 6`; clamp voorkomt dat lichte achterstanden bij vroegbetalers ten onrechte naar 4/5 springen.

**Commit** — `ced3248` Risico: nieuwe sub-score 'afwijking van betaalgedrag' + max-regel

<!--
Voeg hier nieuwe tweaks toe (nieuwste bovenaan), bv:

### 1. Pattern-drempel verlagen voor meer voorspellingen

**Aanleiding** — 78 van de 188 taken hadden geen verwachte betaaldatum,
  voornamelijk doordat de gestaffelde drempel (≥10 hits ≥40%, ≥4 hits ≥50%,
  ≥3 hits 100%) te streng bleek voor klanten die wel een licht patroon laten zien.

**Wijziging** — Drempel verlaagd naar ...

...
-->
