# Mila — AI-roadmap

Status van de voorspellings- en patroon-componenten. Aanvinken naarmate werk klaar is. Geen verzonnen taken — alles hier is besproken in eerdere sessies en past binnen het datamodel.

---

## Fase 1 — Statistische componenten ✅ AF

Berekend uit dummy historie tijdens `npm run preprocess`. Geen externe infra nodig.

- [x] **Trend-detectie** — Mann-Kendall over maandelijkse DSO-tijdreeks per debiteur. Output: score, label (sterk verslechterend/stabiel/verbeterend), tau, p-value.
- [x] **Volatiliteit** — coefficient of variation op intervallen tussen unieke betaaldata. Output: score, label (regelmatig/wisselend/grillig), CV.
- [x] **Standaard betaaldag pattern recognition** — clustering op betaaldata, kiest beste fit uit maandelijks / einde-maand / wekelijks / interval.
- [x] **Confidence-labels** voor alle drie — `zeker` / `redelijk zeker` / `te weinig data`. Componenten met confidence `geen` worden uitgesloten van de aggregatie.

---

## Fase 2 — Serverless basis (1–2 dagen)

Voorwaarde voor alle volgende AI-werk: ergens een functie kunnen draaien voor API-calls die de browser niet kan doen (secrets, externe API's).

- [ ] **Vercel Functions opzetten** (of vergelijkbaar — Cloudflare Workers, Netlify Functions). `/api/`-folder, één testfunctie die "pong" returnt.
- [ ] **`ANTHROPIC_API_KEY` in env-secrets** zetten en client-side veilig houden.
- [ ] **Frontend → serverless flow** demonstreren: knop in detailpaneel die de functie aanroept, response toont. Validatie dat cold-starts acceptabel zijn (~500ms–2s).

### Eerste echte feature na infra: rijke uitleg

- [ ] **`/api/explain`** — neemt component-data in (bv. trend-uitkomst + DSO-historie) en geeft één paragraaf uitleg terug via Claude. Strikt JSON-format afdwingen tegen hallucinaties.
- [ ] **Hallucinatie-validatie** — checken dat genoemde getallen daadwerkelijk in de input zaten. Bij mismatch: terugvallen op template-tekst.
- [ ] **UI-knop** in elk componentblok: "Toelichting opvragen" → genereert + cached uitleg per (taak, component).

### Optioneel in Fase 2

- [ ] **Effect-classificatie via LLM** — vervangt de huidige regels-op-taaktype door contextuele beoordeling (kredietevent recent? dispuut open?). Marginaal beter dan regels — niet kritiek.

---

## Fase 3 — Wanbetaler-voorspelling (afhankelijk van pad-keuze)

Kies één pad. Beide vereisen serverless (Fase 2). De LLM-proxy-variant (Claude als soft-prediction) is bewust uitgesloten — geen echte ML, niet gekalibreerd op de dummy data.

- [ ] **Pad A: TabPFN-v2** via HF Inference Endpoint (~half dag)
  - In-context learning op de dummy historie als training-set.
  - Geen eigen training-pipeline nodig.
  - Limiet ~10k rows / beperkt aantal features.
- [ ] **Pad B: XGBoost** lokaal getraind, gebundled in serverless (~1 dag, productieklaar)
  - Train op dummy historie, exporteer als `model.json`.
  - Standaard credit-scoring stack.
  - **Caveat:** 1 jaar historie + 1.000 actieve debiteuren is mager voor productie-grade training. Pad A is dan een zinvolle tussenstap totdat er meer data is.

Output velden (beide paden gelijk):
- `wanbetaler_score` (0–5)
- `predicted_days_late` (geschatte vertraging)
- `wanbetaler_type` (categorisch label)
- `confidence` (`hoog` / `middel` / `geen`)
- `explanation` (template-gegenereerd; LLM-uitleg via /api/explain in Fase 2)

---

## Buiten huidige scope — wachten op extra data

Geen AI ter wereld kan iets met data die er niet is. Aanvullend nodig:

- [ ] **Dispuut-data** uit een ander systeem aanleveren? Risico-categorie `disputen` (10% weging) blijft anders permanent leeg.
- [ ] **Kredietverzekering-data** (limits, events, externe scores). Risico-categorie `krediet` (25% weging) blijft anders leeg.
- [ ] **Betalingsregelingen** — input voor wanbetaler-AI, niet in huidige export.
- [ ] **Contractueel afgesproken betaaltermijn per debiteur** — nu afgeleid uit `Duedate - Invoicedate`, maar expliciet veld zou robuuster zijn.

---

## Productie-features (later, niet AI maar wel nodig)

- [ ] **Nightly batch scheduling** — `npm run preprocess` automatisch laten draaien (cronjob / GitHub Action / Vercel cron).
- [ ] **Risicoscore-snapshots over tijd** — voor "waarom is deze score sinds gisteren veranderd?".
- [ ] **`klant_config`-tabel implementeren** — wegingen per klant configureerbaar i.p.v. hardcoded.
- [ ] **Data-validatie + foutafhandeling** in preprocess — nu slikt het script corrupte records.
- [ ] **AR-scope-keuze** (geconsolideerd / administratie / locatie) — relevant zodra er meerdere administraties zijn.

---

## Mogelijke UX-uitbreidingen die AI-werk versterken

- [ ] **Mini-grafiekje DSO-over-tijd** in detailpaneel — directe visuele bevestiging van wat Mann-Kendall meet.
- [ ] **Patroon-visualisatie** — dot-plot van betalingen op dag-van-maand of dag-van-week as.
- [ ] **Trend-indicator op de lijstrij** — pijltje omhoog/omlaag bij elk debiteur-item zonder dat je hoeft door te klikken.
- [ ] **"Waarom is deze score veranderd?"-link** zodra snapshots bestaan.
