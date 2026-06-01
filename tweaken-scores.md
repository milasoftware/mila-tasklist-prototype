# Tweaken scores

Branch: `Tweaken-scores` · Basis: `main` @ `8c8b3de`

Levend overzicht van aanpassingen in deze branch (scores, UX en robuustheid).
Elke tweak wordt **na implementatie** toegevoegd volgens onderstaand vast format,
zodat we de inhoudelijke rationale + meetbare impact bij elkaar houden.

**Commits op remote (boven `main`):**
| Hash | Onderwerp |
|---|---|
| `1becc3c` | Docs: commit-referenties in dit bestand |
| `ced3248` | Implementatie: afwijking-score, toast/upload, UI-robustheid |

**Tweaks in deze branch (nieuwste eerst):**
4. Prioriteit: herweging 30/20/40/10 + gladde risico-floor
3. Nieuwe sub-score *Hoeveel afwijking van betaalgedrag?*
2. Robuustheid detail-view voor geüploade datasets
1. Toast-pattern voor upload- en preprocess-feedback

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

### 4. Prioriteit: herweging 30/20/40/10 + gladde risico-floor

**Aanleiding** — Een hoog-risico debiteur kon onder een lager-risico maar
grote/veilige post blijven hangen. Voorbeeld: D018924 (sterk afwijkend
betaalgedrag) zakte met de oude weging onder D018843. De "afwijking"-score (#3)
tilde het risico wel op, maar in de prioriteit woog risico te licht (20%) en
impact te zwaar (40%), waardoor het signaal verwaterde.

**Wijziging** — Twee aanpassingen samen ("model D"):
1. **Herweging** van de gewogen prioriteit: impact `40 → 30%`, urgentie
   `30 → 20%`, risico `20 → 40%`, potentieel blijft `10%`. Bij ontbrekend
   potentieel worden de overige naar rato opgehoogd (33,3/22,2/44,4%).
2. **Gladde risico-floor**: `priority = max(gewogen, risico − 0,5)`. Een hoge
   risico-score kan zo niet meer wegzakken. Continu (geen trap), zodat de
   volgorde binnen de hoog-risico-groep het risico zelf blijft volgen en er geen
   stapeling op één waarde ontstaat. Demping naar 1,0 (verwachte betaaldatum)
   gaat hier nog steeds vóór.

**Bestanden**
- `scripts/preprocess/build-data.mjs` — nieuwe gewichten + floor (`priority_gewogen`, `priority_floor`, `priority_floor_actief`)
- `src/preprocess/build-data.ts` — idem voor de upload-flow
- `src/data.ts` — `priority_gewogen` / `priority_floor` / `priority_floor_actief` op `Task`; gewichten-comment bijgewerkt
- `src/detail/data-derivations.ts` — `derivePriorityWeights()` fallback naar 30/20/40/10
- `src/detail/DetailView.tsx` — breakdown toont gewogen totaal + ondergrens-regel + uitleg (in ring-tooltip én "Zo komt deze prioriteit tot stand")
- `src/data.generated.json` — geregenereerd

**Parameters / drempelwaarden**
| Parameter | Oud | Nieuw |
|---|---|---|
| Gewicht impact | 40% | 30% |
| Gewicht urgentie | 30% | 20% |
| Gewicht risico | 20% | 40% |
| Gewicht potentieel | 10% | 10% |
| Risico-floor | geen | `max(gewogen, risico − 0,5)` |

**Impact op de dataset** (dummy, 188 taken)
- Prioriteit-bucket vóór ↔ na: 4.0–5.0 `16 → 10`, 3.0–3.9 `50 → 56`, 2.0–2.9 `87 → 65`, 1.0–1.9 `35 → 57`. Impact-zware/veilige posten zakken; risico-zware posten stijgen.
- Risico-floor actief op **57/188** taken; bij **41** daarvan (niet gedempt) tilt de floor de prioriteit op met gemiddeld **+0,25** (max **+0,65**).
- Voorbeeld-cases:
  - D000372 — risico 3,58, gewogen 2,43 → prioriteit **3,08** (floor tilt +0,65).
  - D000803 — risico 3,58, gewogen 2,43 → prioriteit **3,08**.
  - D000117 — risico 4,44, gewogen 3,88 → floor 3,94 bepaalt de prioriteit.

**Commit** — `298a32c` Prioriteit: herweging 30/20/40/10 + gladde risico-floor

---

### 3. Nieuwe sub-score "Hoeveel afwijking van betaalgedrag?"

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

---

### 2. Robuustheid detail-view voor geüploade datasets

**Aanleiding** — Na upload van Effect-data crashte de detail-pagina (wit scherm).
Twee oorzaken: (1) geüploade JSON levert `null` voor ontbrekende numerieke velden,
terwijl de UI `undefined` verwachtte — `fmtEUR(null)` gooide een exception;
(2) datasets die vóór de `priority_weights`-tweak zijn gegenereerd misten dat veld,
waardoor `task.priority_weights.genormaliseerd` crashte.

**Wijziging** — Formatters en checks zijn defensief gemaakt: `fmtEUR`, `fmtNL` en
`fmtDM` geven `—` bij `null`, `undefined` of `NaN`. In `DetailView` en `tooltips`
is `!== undefined` vervangen door `!= null`, zodat JSON-null ook wordt afgevangen.
`derivePriorityWeights()` leidt ontbrekende gewichten af uit `potentieel.score`
(originele 40/30/20/10 of genormaliseerd 44,4/33,3/22,2).

**Bestanden**
- `src/detail/format.ts` — defensieve formatters + uitleg in comment
- `src/detail/data-derivations.ts` — nieuwe `derivePriorityWeights()` helper
- `src/detail/DetailView.tsx` — `derivePriorityWeights` i.p.v. directe `priority_weights`; `!= null` checks op impact/urgentie/risico-velden
- `src/detail/tooltips.tsx` — `!= null` checks op bedragen, percentages en pattern-metadata

**Parameters / drempelwaarden**
| Parameter | Oud | Nieuw |
|---|---|---|
| Ontbrekend numeriek veld in UI | crash | toon `—` |
| Ontbrekend `priority_weights` | crash | afleiden uit potentieel |
| Null-check in UI | `!== undefined` | `!= null` (vangt ook JSON `null`) |

**Impact op de dataset**
- Geen score-wijziging — puur UI/compatibiliteit.
- Detail-view opent weer voor geüploade Effect-selectiedata (66 taken) en oudere opgeslagen datasets in `localStorage`.
- Voorbeeld: taak met `impact.bedrag: null` of zonder `priority_weights` degradeert per veld i.p.v. wit scherm.

**Commit** — `ced3248` Risico: nieuwe sub-score 'afwijking van betaalgedrag' + max-regel

---

### 1. Toast-pattern voor upload- en preprocess-feedback

**Aanleiding** — Bij mislukte of trage uploads kreeg de gebruiker geen duidelijke
feedback (alleen stil falen of bevroren tab). Grote bestanden (>25 MB) liepen vast
zonder waarschuwing; `QuotaExceededError` bij `localStorage` was niet te herkennen.

**Wijziging** — Lichtgewicht toast-systeem zonder externe dependencies:
`ToastProvider` + `useToast()` met varianten info/success/warning/error, sticky
errors en optionele actie-knop. `DataUploadButton` toont per fouttype een passende
toast (parse, structuur, quota, build) en een vooraf-waarschuwing bij grote uploads.
Bij quota-fout wordt `node scripts/preprocess.mjs` als workaround genoemd.

**Bestanden**
- `src/toast.tsx` — nieuw: `ToastProvider`, `useToast`, `ToastViewport`, varianten + auto-dismiss
- `src/App.tsx` — `ToastProvider` rond lijst- en detail-view
- `src/list/DataUploadButton.tsx` — toast i.p.v. inline status; `ParseError`, `StructureError`, `QuotaError`, `BuildError`; drempel 25 MB

**Parameters / drempelwaarden**
| Parameter | Oud | Nieuw |
|---|---|---|
| Upload-feedback | inline status / geen | toast per scenario |
| Grote upload-waarschuwing | geen | bij totaal > 25 MB |
| Error auto-dismiss | n.v.t. | info 5s, success 4s; warning/error sticky |
| Quota-fout | onduidelijk | toast + tip lokale preprocess |

**Impact op de dataset**
- Geen score-wijziging — alleen UX rond upload/preprocess.
- Gebruiker ziet nu expliciet: verwerken bezig, succes + reload, of concrete fout
  (ongeldige JSON, verkeerde bestandsstructuur, dataset te groot, build-fout).

**Commit** — `ced3248` Risico: nieuwe sub-score 'afwijking van betaalgedrag' + max-regel

---

<!--
Voeg hier nieuwe tweaks toe (nieuwste bovenaan), bv:

### 1. Pattern-drempel verlagen voor meer voorspellingen

**Aanleiding** — 78 van de 188 taken hadden geen verwachte betaaldatum,
  voornamelijk doordat de gestaffelde drempel (≥10 hits ≥40%, ≥4 hits ≥50%,
  ≥3 hits 100%) te streng bleek voor klanten die wel een licht patroon laten zien.

**Wijziging** — Drempel verlaagd naar ...

...
-->
