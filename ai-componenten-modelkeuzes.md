# Mila — AI-componenten: aanpak en modelkeuzes

Naslagdocument voor de AI-onderdelen die in [mila-datamodel-spec.md](mila-datamodel-spec.md) als zwarte doos worden behandeld. Per onderdeel: wat het is, welke schemavelden het vult, welke ruwe data het leest, de aanbevolen aanpak, en een Hugging Face-alternatief als dat zinvol is.

## Algemeen kader

- Deze AI-componenten draaien in de **nightly batch**, niet in de frontend.
- Volgorde in de batch: `standaard_betaaldag` → `risicoscore` → `priority_score` (zie het spec-document voor afhankelijkheden).
- Elke AI-uitkomst levert vier velden in het schema: `score` (0–5 of 0–2), `label` (string), `confidence` (0–1) en `explanation` (één leesbare zin).
- Default-positie: zo deterministisch mogelijk. Een statistische test of een regelboom heeft de voorkeur boven een ML-model, behalve waar het probleem dat echt vraagt.
- Hugging Face is sterk in NLP, vision en (recenter) generieke timeseries en tabulaire foundation models. Voor de meeste hieronder is HF **niet** de eerste keuze.

## Quick reference

| AI-onderdeel | Schema-velden | Aanbevolen aanpak | HF-alternatief | Wanneer HF overwegen |
|---|---|---|---|---|
| **Trend** | `risicoscore.param_trend_score / _label / _confidence / _explanation` | Mann-Kendall trend-test of `ruptures` library op DSO-per-maand reeks | `amazon/chronos-bolt-small` (zero-shot timeseries forecasting) | Bijna nooit — statistische test is hier beter |
| **Volatiliteit** | `risicoscore.param_volatiliteit_score / _label / _confidence / _explanation` | Coefficient of variation + autocorrelatie op "dagen vroeg/laat" reeks | Geen passende HF-keuze | n.v.t. |
| **Wanbetaler-voorspelling** | `risicoscore.param_wanbetaler_score / _predicted_days / _type / _confidence / _explanation` | XGBoost of LightGBM op eigen feature-set | `Prior-Labs/TabPFN-v2-clf` (binair) + `Prior-Labs/TabPFN-v2-reg` (dagen) | TabPFN als snelle baseline zonder eigen training; XGBoost voor productie |
| **Effect-classificatie** | `priority_score.impact_effect_type / impact_effect_explanation` | Regels in Python (~40–50 regels) op `taak.type` + context | `facebook/bart-large-mnli` (zero-shot) of klein instruction-LLM | Pas als regelboom onhanteerbaar groot wordt |
| **Standaard betaaldag pattern** *(verwant, niet expliciet "AI" in spec)* | `standaard_betaaldag.pattern_type / _value / _percentage / confidence_label` | Deterministische clustering met toleranties (±2d wekelijks, ±3d maandelijks) | n.v.t. | Nooit |
| **Uitleg-zinnen** *(transversaal: alle `_explanation`-velden)* | `param_*_explanation`, `impact_effect_explanation` | Templates met ingevulde getallen | `microsoft/Phi-3.5-mini-instruct` of `Qwen/Qwen2.5-3B-Instruct`, strikt JSON-format afdwingen | Als templates te schraal voelen — let op hallucinatierisico |

## Detail per onderdeel

### 1. Trend

**Wat het is:** detecteren of het betaalgedrag van een debiteur structureel verbetert, stabiel is of verslechtert, op basis van DSO-ontwikkeling over tijd.

**Schema-output (in `risicoscore`):**
- `param_trend_score` — INT 0–5 (0 = sterk verbeterend, 5 = sterk verslechterend)
- `param_trend_label` — bv. `'sterk_verslechterend'`, `'licht_verslechterend'`, `'stabiel'`, `'licht_verbeterend'`, `'sterk_verbeterend'`
- `param_trend_confidence` — DECIMAL 0–1
- `param_trend_explanation` — één regel, bv. *"DSO is gestegen van 38d naar 56d over de afgelopen 6 maanden (Mann-Kendall p=0.02)."*

**Input:** `factuur.vervaldatum`, `betaling.betaaldatum` → afgeleide reeks: gemiddelde DSO per maand over de laatste 6–12 maanden per `debiteur_id`.

**Aanbevolen aanpak:** Mann-Kendall trend-test (via `pymannkendall`) of change-point detection met `ruptures`.
- Bereken DSO per maand → reeks van ~12 floats.
- Mann-Kendall geeft `tau` (richting/sterkte) en `p` (significantie).
- Map `tau` op score 0–5; `confidence = 1 - p` (geclamp naar 0–1).
- Tien regels Python, volledig uitlegbaar.

**Hugging Face-alternatief:** `amazon/chronos-bolt-small` of `amazon/chronos-t5-small` — zero-shot foundation model voor timeseries forecasting. Forecast komende 1–3 maanden DSO; vergelijk met huidige observatie; afwijking boven drempel = trendsignaal. Werkt, maar overkill voor dit probleem en moeilijker uit te leggen.

**Caveats:**
- Minimaal ~6 datapunten nodig; daaronder `confidence_label = 'geen'` of `param_trend_score = NULL`.
- Schoolvakanties / zomerdip kunnen valse trends veroorzaken — overweeg seizoencorrectie of trailing 12-maands venster.

---

### 2. Volatiliteit

**Wat het is:** classificeren hoe voorspelbaar het betaalgedrag is. Twee debiteuren met dezelfde gemiddelde DSO kunnen heel verschillend zijn: één betaalt elke keer ~30 dagen na vervaldatum (regelmatig), de ander wisselt tussen 5 en 90 dagen (volatiel).

**Schema-output (in `risicoscore`):**
- `param_volatiliteit_score` — INT 0–5 (0 = zeer regelmatig, 5 = zeer volatiel)
- `param_volatiliteit_label` — bv. `'regelmatig'`, `'matig_volatiel'`, `'piek_patroon'`, `'zeer_volatiel'`
- `param_volatiliteit_confidence` — DECIMAL 0–1
- `param_volatiliteit_explanation` — bv. *"Betaalafwijking varieert tussen -5 en +47 dagen (CV=0.82)."*

**Input:** `factuur.vervaldatum`, `betaling.betaaldatum` per debiteur → lijst van "dagen vroeg/laat" per factuur.

**Aanbevolen aanpak:**
- **Coefficient of variation (CV)**: `std / mean` op de reeks van afwijkingen. Robuust en interpreteerbaar.
- Optioneel autocorrelatie lag-1 om "piek-patroon" (wisselend extreem) te scheiden van "consistent matig laat".
- Map CV op score 0–5 met empirische drempels op de dummy data.

**Hugging Face-alternatief:** geen passende — dit is een eenvoudige statistische maat, geen modelprobleem.

**Caveats:**
- Volatiliteit is **niet** trend. Een debiteur kan stabiel laat zijn (lage volatiliteit, hoog DSO). Beide moeten apart bijdragen aan `score_betaalgedrag`.
- Minimaal ~5 betalingen voor betrouwbare CV.

---

### 3. Wanbetaler-voorspelling

**Wat het is:** voorspellen of (en hoeveel dagen) een nieuwe of openstaande factuur te laat betaald gaat worden, gegeven de history van de debiteur.

**Schema-output (in `risicoscore`):**
- `param_wanbetaler_score` — INT 0–5 (kans op wanbetaling, 0 = laag, 5 = hoog)
- `param_wanbetaler_predicted_days` — INT, voorspelde dagen vertraging na vervaldatum
- `param_wanbetaler_type` — enum-achtig: bv. `'incidenteel_laat'`, `'chronisch_laat'`, `'wanbetaler'`, `'betrouwbaar'`
- `param_wanbetaler_confidence` — DECIMAL 0–1
- `param_wanbetaler_explanation` — bv. *"Op basis van 18 maanden historie en 3 disputen voorspelt het model 23 dagen vertraging."*

**Input (features per debiteur):** gemiddelde DSO laatste 12 maanden, max DSO, # disputen open, # disputen historisch, exposure (`SUM(factuur.openstaand_bedrag)`), sector, leeftijd relatie, dagen sinds laatste contact, kredietverzekeringsstatus, etc. Labels uit historische `betaling`: "betaald > X dagen na vervaldatum?" (binair) of "aantal dagen vertraging" (regressie).

**Aanbevolen aanpak (productie):** XGBoost (`xgboost`) of LightGBM (`lightgbm`).
- Twee modellen: één classifier (wel/niet wanbetaler) + één regressor (verwachte dagen vertraging).
- Trainen op de eigen historie, calibreer kansen met Platt-scaling of isotonic.
- Feature-importance van XGBoost geeft direct input voor de explanation-zin.

**Hugging Face-alternatief (snelle baseline):**
- `Prior-Labs/TabPFN-v2-clf` — pretrained tabulaire classifier, werkt zonder finetuning op kleine datasets (≤10k rows, ≤500 features). Goede manier om binnen een dag een baseline te hebben voordat je investeert in eigen training.
- `Prior-Labs/TabPFN-v2-reg` — regressie-variant voor `predicted_days`.

**Caveats:**
- **Cold-start probleem:** nieuwe debiteur zonder historie heeft geen features. Levert dan `confidence < 0.3` of `score = NULL`.
- TabPFN heeft beperkingen op datasetomvang; voor ≥10k rows of veel features is XGBoost beter.
- Wanbetaler-labels moeten een duidelijke definitie krijgen (bv. "betaling > 30 dagen na vervaldatum"). Vastleggen vóór training.

---

### 4. Effect-classificatie

**Wat het is:** elk taak krijgt een `effect_type` dat aangeeft wat de actie *doet* voor cashflow: directe cash, versnelling van toekomstige cash, bescherming tegen verlies, monitoring of administratief. Dit voedt de `impact_effect_score` in `priority_score`.

**Schema-output (in `priority_score`):**
- `impact_effect_type` — enum: `'directe_cash'`, `'versnelling'`, `'bescherming'`, `'monitoring'`, `'administratief'`
- `impact_effect_score` — INT 0–2 (afgeleid uit `effect_type`: directe_cash=2, versnelling=1, bescherming=1, monitoring=0, administratief=0)
- `impact_effect_explanation` — één regel, bv. *"Belactie op vervallen factuur — directe toezegging mogelijk."*

**Input:** `taak.type` + context: factuur status, dispuut open?, recent kredietevent?, bedrag-categorie, debiteur-status.

**Aanbevolen aanpak:** regelboom in Python. Pseudo:
```
if taak.type == 'bel_actie' and factuur.status == 'open' and dagen_vervallen > 0: 'directe_cash'
elif taak.type == 'kredietactie' and recent_event_in('limiet_verlaagd', dagen=7): 'bescherming'
elif taak.type == 'monitoring': 'monitoring'
elif taak.type == 'administratief': 'administratief'
elif taak.type == 'dispuut_oplossen': 'directe_cash' if factuur_blijft_openstaan else 'bescherming'
... etc
```
Naar verwachting 30–50 regels logica. Volledig deterministisch en uitlegbaar.

**Hugging Face-alternatieven:**
- `facebook/bart-large-mnli` — zero-shot text classification. Geef de taakbeschrijving + 5 labels, krijg waarschijnlijkheden terug. Eén regel code via `transformers.pipeline("zero-shot-classification")`.
- Klein instruction-LLM (`microsoft/Phi-3.5-mini-instruct`, `Qwen/Qwen2.5-3B-Instruct`) met strikt prompt-format.

**Caveats:**
- Met slechts 5 labels is een regelboom bijna altijd voldoende. AI alleen overwegen als de context-regels onhanteerbaar groot worden.
- Bij gebruik van LLM: dwing JSON-output af + valideer dat het label binnen de enum valt.

---

### 5. Standaard betaaldag — pattern recognition

**Wat het is:** vinden of een debiteur een herkenbaar betaalpatroon heeft (elke maandag, einde van de maand, om de 14 dagen), zodat de werkelijke betaaldag voorspelbaar wordt en de afwijking t.o.v. de afgesproken termijn berekend kan worden.

**Schema-output (in `standaard_betaaldag`):**
- `pattern_type` — enum: `'wekelijks'`, `'maandelijks'`, `'interval'`, `'geen'`
- `pattern_value` — string: bv. `'maandag'`, `'einde_maand'`, `'elke_14_dagen'`
- `pattern_percentage` — DECIMAL 0–100, % betalingen dat aan het patroon voldoet
- `confidence_label` — enum: `'hoog'` (≥70%), `'middel'` (40–70%), `'geen'` (<40%)
- `data_points_used` — INT, aantal betalingen meegenomen

**Input:** `betaling.betaaldatum` per debiteur, met recency-weging (`klant_config.recency_boost_maanden` × `recency_boost_factor`).

**Aanbevolen aanpak:** deterministische clustering met toleranties.
1. Voor `wekelijks`: groepeer betalingen op weekdag, met tolerantie ±2 dagen. Bereken percentage per weekdag.
2. Voor `maandelijks`: zelfde voor dag-van-de-maand of "einde maand"-bucket, tolerantie ±3 dagen.
3. Voor `interval`: bereken intervallen tussen opeenvolgende betalingen, kijk of er een dominant interval is (±2 dagen tolerantie).
4. Kies het patroon met hoogste percentage. Mapping percentage → `confidence_label`.

Toleranties zijn gespecificeerd in [mila-datamodel-spec.md](mila-datamodel-spec.md) onder open punten.

**Hugging Face-alternatief:** geen — pure data-analyse, geen ML-probleem.

**Caveats:**
- Minimaal ~5–8 betalingen nodig, anders `confidence_label = 'geen'`.
- Recency-weging belangrijk: oude betalingen mogen niet recente verschuivingen maskeren.

---

### 6. Uitleg-zinnen (transversaal)

**Wat het is:** elke AI-uitkomst krijgt een `_explanation`-veld met één leesbare zin die de gebruiker in het detailpaneel ziet.

**Schema-output:** alle `param_*_explanation`-velden in `risicoscore` + `impact_effect_explanation` in `priority_score`.

**Input:** de gevonden statistiek + relevante context (bedragen, perioden, namen).

**Aanbevolen aanpak:** templates met ingevulde getallen.
```python
# voorbeeld:
f"DSO is gestegen van {dso_start}d naar {dso_eind}d over de afgelopen {maanden} maanden "
f"(Mann-Kendall p={p:.2f})."
```
Voor 4 AI-componenten + 1 effect-classificatie zijn dat ~10 templates per uitkomstvariant. Compleet voorspelbaar.

**Hugging Face-alternatief:** klein instruction-LLM voor rijkere zinnen — `microsoft/Phi-3.5-mini-instruct` of `Qwen/Qwen2.5-3B-Instruct`. Pas als templates te schraal voelen.

**Caveats — kritisch:**
- LLM-uitleg moet **strikt** alleen feiten uit de input bevatten. Hallucinatie hier ondermijnt direct het vertrouwen in Mila.
- Dwing JSON-output af, valideer numerieke waarden tegen de input voor publicatie.
- Houd een fallback-template klaar: bij format-fout of onbruikbare LLM-output → terugvallen op template-zin.

---

## Aanbevolen volgorde van implementatie

Voor de eerste testklant:

1. **Standaard betaaldag pattern** — deterministisch, direct te bouwen, voedt `potentieel`.
2. **Risicoscore zonder AI-parameters** — alleen DSO, % vervallen, oudste post, % disputen, dekkingsgraad, aandeel AR. Dit is al een werkbare risicoscore.
3. **Priority score** — gewogen combinatie + effect-classificatie via regelboom.
4. **AI-componenten** een voor een toevoegen, in deze volgorde:
   - Trend (Mann-Kendall) — laagste implementatiekost, hoogste uitlegbaarheid.
   - Volatiliteit (CV) — idem.
   - Wanbetaler (TabPFN baseline → eigen XGBoost) — hoogste waarde, hoogste kost.
5. **Uitleg-zinnen** beginnen als templates; LLM pas als gewenste rijkheid niet via templates haalbaar is.
