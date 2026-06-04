# Tweaken scores

Branch: `Tweaken-scores` · Basis: `main` @ `8c8b3de`

Levend overzicht van aanpassingen in deze branch (scores, UX en robuustheid).
Elke tweak wordt **na implementatie** toegevoegd volgens onderstaand vast format,
zodat we de inhoudelijke rationale + meetbare impact bij elkaar houden.

**Commits in deze branch (boven `main`, nieuwste eerst):**
| Hash | Onderwerp |
|---|---|
| `87c510a` | Detail: blok *Wat nog niet meedoet* bijgewerkt |
| `b1fbd0b` | Prioriteit: afronden op 1 decimaal (half-up) + tie-breaker |
| `02b8e84` | Prioriteit: herweging 30/20/40/10 + gladde risico-floor |
| `ced3248` | Implementatie: afwijking-score, toast/upload, UI-robuustheid |

**Doc-only commits** (alleen `tweaken-scores.md`, niet in tabel hierboven):
`b46cfbb`, `6f6456d`, `20edff4`, `1becc3c`.

**Tweaks in deze branch (nieuwste eerst):**
6. Detail: blok *Wat nog niet meedoet* (betalingsregelingen)
5. Prioriteitsscore afgerond op 1 decimaal (half-up)
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

### 6. Detail: blok *Wat nog niet meedoet* (betalingsregelingen)

**Aanleiding** — Het blok onderaan de detail-view somt op wat nog **niet** in de
scores zit. Twee oudere bullets (wanbetalingsvoorspelling, AI-uitleg) waren niet
meer relevant; wel ontbrak een expliciete noot over **niet nagekomen
betalingsregelingen**, die in de gewenste logica direct score 5 zouden moeten geven.

**Wijziging** — In de lijst *Wat nog niet meedoet* verwijderd:
- *Voorspellen of een klant wanbetaalt*
- *Uitgebreidere uitleg per component*

Toegevoegd:
- **Niet nagekomen betalingsregelingen** · er wordt nog geen rekening gehouden;
  zou direct score 5 zijn.

Behouden: *Slimmere inschatting type opbrengst*.

**Bestanden**
- `src/detail/DetailView.tsx` — `<ul>` in sectie *Wat nog niet meedoet*

**Parameters / drempelwaarden**
| Parameter | Oud | Nieuw |
|---|---|---|
| Lijst *Wat nog niet meedoet* | 3 bullets | 2 bullets (wanbetaling + AI-uitleg weg) |
| Betalingsregelingen | niet genoemd | genoemd als ontbrekend (gewenst: direct 5) |

**Impact op de dataset**
- Geen score-wijziging — alleen transparantie-copy in de UI.
- Gebruiker ziet op de detailpagina welk risico-aspect nog niet in de berekening zit.

**Commit** — `87c510a` Detail: Wat nog niet meedoet bijgewerkt (betalingsregelingen)

---

### 5. Prioriteitsscore afgerond op 1 decimaal (half-up)

**Aanleiding** — De priority werd opgeslagen op 2 decimalen en in het
detailscherm ook zo getoond (bv. `3,83`). Gewenst is één decimaal, met
half-up afronding: vanaf `,x5` omhoog, daaronder omlaag (`3,85 → 3,9`,
`3,84 → 3,8`).

**Wijziging** — De opgeslagen `priority` wordt nu op 1 decimaal afgerond
(`round(priority, 1)`, half-up via `Math.round`). `priority_origineel` blijft
bewust op 2 decimalen en dient als fijnmazige tie-breaker bij het sorteren,
zodat taken met dezelfde 1-decimaal-score toch in een logische volgorde staan.
Alle priority-weergaven (detail-ring, opbouw-tooltip, "Zo komt deze prioriteit
tot stand") tonen 1 decimaal; de lijst deed dat al. De tussenstappen (gewogen
totaal, ondergrens, debug-formule) blijven op 2 decimalen als rekendetail.

**Bestanden**
- `scripts/preprocess/build-data.mjs` — `priority` op 1 decimaal + sort-tie-breaker op `priority_origineel`
- `src/preprocess/build-data.ts` — idem voor de upload-flow
- `src/App.tsx` — lijst-sortering met tie-breaker op `priority_origineel`
- `src/detail/DetailView.tsx` — ring + tooltips + opbouw-totaal op 1 decimaal
- `src/list/ListView.tsx` — "originele priority"-tooltip op 1 decimaal
- `src/data.generated.json` — geregenereerd

**Parameters / drempelwaarden**
| Parameter | Oud | Nieuw |
|---|---|---|
| Decimalen `priority` | 2 | 1 |
| Afrondmethode | n.v.t. (toonde 2) | half-up (`Math.round`) |
| Tie-breaker sortering | geen | `priority_origineel` (2 dec.) |

**Impact op de dataset** (dummy, 188 taken)
- Alle 188 taken hebben nu een priority op 1 decimaal; volgorde blijft aflopend.
- Half-up zichtbaar bij de `,x5`-grens: `priority_origineel 3,95 → priority 4,0`, `3,99 → 4,0`.
  - Voorbeeld-tie: D001035 (orig 3,99), D000922 (3,97), D000906 (3,97), D000997 (3,95) — allen priority `4,0`, gesorteerd op de fijnere `priority_origineel`.

**Commit** — `b1fbd0b` Prioriteit: afronden op 1 decimaal (half-up) + tie-breaker op priority_origineel

---

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

**Commit** — `02b8e84` Prioriteit: herweging 30/20/40/10 + gladde risico-floor

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
(destijds 40/30/20/10 of genormaliseerd 44,4/33,3/22,2 — in tweak #4 gewijzigd
naar 30/20/40/10).

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
Volgende tweak = #7. Plaats die als nieuw blok bovenaan "## Aanpassingen"
(direct onder de heading, dus boven de hoogste bestaande nummer) en werk ook bij:
- de tabel "Commits in deze branch" (implementatie-commits)
- de lijst "Tweaks in deze branch (nieuwste eerst)"
Gebruik het vaste format uit "## Format per tweak".
-->
