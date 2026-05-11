# Wanbetaler-voorspelling — implementatieplan

Concreet stappenplan om wanbetaler-voorspelling toe te voegen aan Mila, met expliciete verdeling van wat ik en jij doen. Stack: Supabase Edge Functions + HuggingFace Inference API.

---

## Variant-keuze

Twee opties stonden open (Pad A = TabPFN, Pad B = eigen XGBoost). **Aanraden: beginnen met Pad A.**

Reden: TabPFN levert in een dag een werkende eerste versie zonder dat we een training-pipeline hoeven op te zetten. Pad B is grondiger maar:
- Vereist 2–3× zoveel werk
- 1 jaar historie van Covebo is mager voor robuuste training (eerder besproken)
- We kunnen later naadloos overstappen: de architectuur (Edge Function als inference-endpoint) blijft hetzelfde, alleen de interne implementatie verandert

---

## Architectuur

```
Browser (Mila)
    │
    │  POST /functions/v1/wanbetaler
    │  Body: { debiteur_id, features: {...} }
    ▼
Supabase Edge Function
    │
    │  POST HuggingFace Inference API
    │  Bearer ${HF_TOKEN}
    │  Body: TabPFN-input (Covebo-historie + huidige klant)
    ▼
HuggingFace (Prior-Labs/TabPFN-v2-clf)
    │
    │  Response: predicted_class + probability
    ▼
Edge Function transformeert naar:
    { wanbetaler_score: 0-5,
      predicted_days_late,
      type,
      confidence,
      explanation }
    │
    ▼
Browser updatet detailpaneel
```

---

## Wat jij doet (~30 minuten setup + één beslissing)

1. **Supabase project aanmaken** (nieuw of bestaand). Free tier volstaat.
2. **HuggingFace account + read-token genereren** (gratis). Token nodig om TabPFN-endpoint aan te roepen.
3. **Beslissing: wat noemen we een "wanbetaler" voor Covebo?** Dit bepaalt de trainingslabels. Twee voorstellen — kies één of geef een eigen definitie:
    - *Definitie A (mild):* een debiteur is wanbetaler als zijn gemiddelde DSO in het afgelopen jaar > 30 dagen was.
    - *Definitie B (strikt):* een debiteur is wanbetaler als hij momenteel ≥1 factuur heeft die >60 dagen vervallen is, of in het afgelopen jaar een afschrijving had.
    - Definitie A geeft meer voorbeelden (waarschijnlijk 15–25% van debiteuren), Definitie B is selectiever (waarschijnlijk 5–10%) maar voelt productmatig zuiverder.
4. **Supabase CLI installeren** (`brew install supabase/tap/supabase`) — nodig om Edge Functions lokaal te kunnen testen en deployen.
5. **Env-secrets configureren** in Supabase dashboard: `HF_TOKEN`. Eén waarde, één keer.
6. **Eindreview**: na elke stap die ik oplever, kort kijken of het zinvol aanvoelt voordat we doorgaan.

---

## Wat ik doe (~1 dag werk, opgesplitst in stappen)

### Stap 1 — Feature-extractie uitbreiden in `preprocess.mjs`

Per debiteur extra velden produceren die we als features naar TabPFN sturen:
- avgDaysLate (al berekend)
- pctOverdue, oldestDays (al berekend)
- pctOmzet (al berekend)
- intervals_observed, cv (al berekend)
- Mann-Kendall tau + p_value (al berekend)
- pattern_type one-hot (nieuw, maar triviaal)
- aantal facturen, gemiddeld factuurbedrag, jaaromzet (nieuw, eenvoudig)
- **`is_wanbetaler` label** volgens de gekozen definitie (nieuw — bepaalt welke definitie we gebruiken)

Output: extra veld `debiteur_features` in `data.generated.json` per debiteur.

### Stap 2 — Supabase Edge Function

`supabase/functions/wanbetaler/index.ts`:
- Accepteert POST met `{ debiteur_id, features }`
- Vraagt de bijbehorende Covebo-historie op (uit een meegeleverde JSON of uit Supabase storage)
- Stuurt training-rijen + query-rij naar HF Inference API
- Transformeert response naar Mila's score-schema
- Geeft confidence-label terug op basis van geldige predictie + aantal training-voorbeelden

### Stap 3 — Frontend client

Kleine helper `fetchWanbetaler(taskId)` die de Edge Function aanroept en de response cached per (debiteur_id, snapshot_datum).

### Stap 4 — UI in detailpaneel

Onder "Hoe risicovol is deze klant" → onder Betaalgedrag-breakdown een vierde sub-rij:
- *Risico op wanbetaling* — met score, confidence-pill, voorspelde dagen vertraging, en uitleg
- Knop "Bereken voorspelling" als de waarde nog niet is opgehaald (lazy loading vermijdt API-calls voor taken die niemand opent)
- Geladen state + foutafhandeling (fallback: "Voorspelling niet beschikbaar")

### Stap 5 — Aggregaat-update

De huidige `betaalgedrag`-aggregaat bevat DSO + trend + volatiliteit. Wanbetaler-score toevoegen aan dat gemiddelde, mits confidence ≠ `geen`. Bestaande disclaimer "Wanbetaler-voorspelling nog niet beschikbaar (Fase 3)" verwijderen.

---

## Volgorde en afhankelijkheden

| # | Wie | Stap | Wachten op |
|---|---|---|---|
| 1 | Jij | Supabase project + HF token aanmaken | — |
| 2 | Jij | Definitie wanbetaler kiezen | — |
| 3 | Ik | Feature-extractie + label in preprocess | #2 |
| 4 | Ik | Edge Function code schrijven (lokaal testbaar) | — (parallel) |
| 5 | Jij | Supabase CLI installeren, project linken, `HF_TOKEN` als secret | #1 |
| 6 | Ik | Edge Function deployen via CLI | #5 |
| 7 | Ik | Frontend integratie + UI | #3, #6 |
| 8 | Samen | Testen op handvol debiteuren + tunen | #7 |

#3 en #4 kunnen parallel. Globaal verwacht ik dit kost één werkdag mijn kant + die 30 minuten van jou verspreid over een paar momenten.

---

## Risico's en open vragen

- **HuggingFace rate limits.** Free tier heeft beperkte requests/minuut. Voor 50 taken op één pagina-load → cachen per debiteur is voldoende. Bij echte deploy: pricing checken.
- **TabPFN limieten.** Max ~10k training-rijen meegeven. We hebben er ~1.000 (één per actieve debiteur) dus past royaal.
- **1 jaar historie blijft mager.** Voorspelling is een baseline, geen productie-grade signaal. Eerlijk communiceren via confidence-label.
- **Cold start van Edge Function** ~500ms–2s eerste keer. Daarna snel.
- **Wat als HF stuk is?** UI valt terug op "Voorspelling niet beschikbaar"; de andere risico-categorieën blijven intact.

---

## Upgrade-pad naar Pad B (later)

Zodra TabPFN draait en we waarde zien, kunnen we Pad B (eigen XGBoost) overwegen:
- Frontend en UI ongewijzigd
- Edge Function-interne implementatie verandert: in plaats van HF aanroepen, een gebundeld `model.json` laden en lokaal inferen
- Training-pipeline opzetten als losse Python notebook of GitHub Action
- Voorwaarde: meer historie (2–3 jaar) of meer klanten dan alleen Covebo

Geen weggegooid werk — alleen de inference-laag verandert.
