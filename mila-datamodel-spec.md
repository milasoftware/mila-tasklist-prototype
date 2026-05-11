# Mila datamodel — specificatie

Geconsolideerd datamodel voor drie samenhangende modules: **risicoscore**, **prioritering taken**, en **standaard betaaldag**. Bedoeld als input voor een coding LLM/agent om migrations, ORM-modellen of een API-laag te genereren.

## Context

- Alle berekende scores (risicoscore, standaard betaaldag, priority score) worden **elke nacht herrekend** in batch.
- Drie modules delen dezelfde operationele data; alleen de uitkomsttabellen zijn module-specifiek.
- AI-componenten (trend, volatiliteit, wanbetaler-voorspelling, effect-classificatie) leveren altijd `score + label + confidence + explanation` terug. Deze velden worden opgeslagen in de relevante uitkomsttabellen.
- Geldbedragen: `DECIMAL(15,2)` in EUR. Percentages: `DECIMAL(5,2)` (waarde 0–100).
- Alle PK's zijn `UUID`. Alle tabellen hebben `created_at` en `updated_at` (`TIMESTAMP WITH TIME ZONE`, default `now()`).

## Naamgevingsconventies

- Tabelnamen: snake_case, enkelvoud (`debiteur`, niet `debiteuren`).
- Foreign keys: `{tabel}_id`.
- Enums worden als `VARCHAR` met `CHECK` constraint uitgevoerd voor portabiliteit; pas aan naar native enums waar de doel-DB dat ondersteunt.
- Soft delete buiten scope; gebruik `actief BOOLEAN` waar relevant.

---

## SQL DDL

```sql
-- =====================================================
-- 1. STAMDATA
-- =====================================================

-- Eindklant van Mila (de organisatie die het systeem gebruikt)
CREATE TABLE klant (
  id UUID PRIMARY KEY,
  naam VARCHAR(255) NOT NULL,
  kredietmodule_actief BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Configuratie per klant: wegingen en scope-instellingen
CREATE TABLE klant_config (
  klant_id UUID PRIMARY KEY REFERENCES klant(id) ON DELETE CASCADE,

  -- Categoriewegingen risicoscore (sommen tot 100, percentages 0-100)
  weging_betaalgedrag DECIMAL(5,2) NOT NULL DEFAULT 30,
  weging_huidige_stand DECIMAL(5,2) NOT NULL DEFAULT 25,
  weging_disputen DECIMAL(5,2) NOT NULL DEFAULT 10,
  weging_krediet DECIMAL(5,2) NOT NULL DEFAULT 25,
  weging_omzetconcentratie DECIMAL(5,2) NOT NULL DEFAULT 10,

  -- Componentwegingen prioritering (0-1, sommen tot 1.0)
  prio_weging_impact DECIMAL(3,2) NOT NULL DEFAULT 0.4,
  prio_weging_urgentie DECIMAL(3,2) NOT NULL DEFAULT 0.3,
  prio_weging_risico DECIMAL(3,2) NOT NULL DEFAULT 0.2,
  prio_weging_potentieel DECIMAL(3,2) NOT NULL DEFAULT 0.1,

  -- Scope voor "totale AR" berekening
  ar_scope VARCHAR(20) NOT NULL DEFAULT 'administratie'
    CHECK (ar_scope IN ('geconsolideerd', 'administratie', 'locatie')),

  -- Recency-weging voor standaard betaaldag (in maanden, 0 = geen weging)
  recency_boost_maanden INT NOT NULL DEFAULT 3,
  recency_boost_factor DECIMAL(3,1) NOT NULL DEFAULT 2.0,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT wegingen_sommeren_100 CHECK (
    weging_betaalgedrag + weging_huidige_stand + weging_disputen
    + weging_krediet + weging_omzetconcentratie = 100
  )
);

-- Bedrijfsentiteit / administratie binnen een klant
CREATE TABLE administratie (
  id UUID PRIMARY KEY,
  klant_id UUID NOT NULL REFERENCES klant(id) ON DELETE CASCADE,
  naam VARCHAR(255) NOT NULL,
  locatie VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_administratie_klant ON administratie(klant_id);

-- Debiteur (eindafnemer van de klant)
CREATE TABLE debiteur (
  id UUID PRIMARY KEY,
  administratie_id UUID NOT NULL REFERENCES administratie(id) ON DELETE CASCADE,
  naam VARCHAR(255) NOT NULL,
  standaard_betaaltermijn INT NOT NULL,  -- in dagen, contractueel
  actief BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_debiteur_administratie ON debiteur(administratie_id);

-- =====================================================
-- 2. OPERATIONELE DATA
-- =====================================================

-- Factuur uitgegeven aan debiteur
CREATE TABLE factuur (
  id UUID PRIMARY KEY,
  debiteur_id UUID NOT NULL REFERENCES debiteur(id) ON DELETE CASCADE,
  factuurnummer VARCHAR(100) NOT NULL,
  factuurdatum DATE NOT NULL,
  vervaldatum DATE NOT NULL,
  betaaltermijn_dagen INT NOT NULL,  -- afgesproken termijn op deze factuur
  factuurbedrag DECIMAL(15,2) NOT NULL,
  openstaand_bedrag DECIMAL(15,2) NOT NULL,  -- daalt bij (gedeeltelijke) betaling
  status VARCHAR(20) NOT NULL
    CHECK (status IN ('open', 'gedeeltelijk', 'betaald', 'in_dispuut', 'afgeschreven')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_factuur_debiteur ON factuur(debiteur_id);
CREATE INDEX idx_factuur_status ON factuur(status);
CREATE INDEX idx_factuur_vervaldatum ON factuur(vervaldatum);

-- Betaling op een factuur (kan gedeeltelijk zijn)
CREATE TABLE betaling (
  id UUID PRIMARY KEY,
  factuur_id UUID NOT NULL REFERENCES factuur(id) ON DELETE CASCADE,
  betaaldatum DATE NOT NULL,
  bedrag DECIMAL(15,2) NOT NULL,
  is_gedeeltelijk BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_betaling_factuur ON betaling(factuur_id);
CREATE INDEX idx_betaling_datum ON betaling(betaaldatum);

-- Dispuut op een of meerdere facturen
CREATE TABLE dispuut (
  id UUID PRIMARY KEY,
  debiteur_id UUID NOT NULL REFERENCES debiteur(id) ON DELETE CASCADE,
  factuur_id UUID REFERENCES factuur(id) ON DELETE SET NULL,
  datum_geopend DATE NOT NULL,
  datum_gesloten DATE,
  status VARCHAR(20) NOT NULL
    CHECK (status IN ('open', 'opgelost', 'afgewezen')),
  bedrag DECIMAL(15,2) NOT NULL,
  beschrijving TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dispuut_debiteur ON dispuut(debiteur_id);
CREATE INDEX idx_dispuut_status ON dispuut(status);

-- Operationele taak die geprioriteerd moet worden
CREATE TABLE taak (
  id UUID PRIMARY KEY,
  debiteur_id UUID NOT NULL REFERENCES debiteur(id) ON DELETE CASCADE,
  factuur_id UUID REFERENCES factuur(id) ON DELETE SET NULL,
  type VARCHAR(30) NOT NULL
    CHECK (type IN (
      'bel_actie', 'herinnering', 'dispuut_oplossen',
      'kredietactie', 'monitoring', 'administratief', 'escalatie'
    )),
  deadline DATE,
  aangemaakt_op TIMESTAMPTZ NOT NULL DEFAULT now(),
  status VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_behandeling', 'afgerond', 'geannuleerd')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_taak_debiteur ON taak(debiteur_id);
CREATE INDEX idx_taak_status ON taak(status);

-- Maandelijkse omzet/exposure-historie per debiteur (voor AI volatiliteit)
CREATE TABLE omzet_historie (
  id UUID PRIMARY KEY,
  debiteur_id UUID NOT NULL REFERENCES debiteur(id) ON DELETE CASCADE,
  periode DATE NOT NULL,  -- eerste dag van de maand
  omzet DECIMAL(15,2) NOT NULL,
  openstaande_positie DECIMAL(15,2) NOT NULL,
  aantal_facturen INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (debiteur_id, periode)
);

CREATE INDEX idx_omzet_debiteur_periode ON omzet_historie(debiteur_id, periode);

-- Betalingsregeling tussen klant en debiteur
CREATE TABLE betalingsregeling (
  id UUID PRIMARY KEY,
  debiteur_id UUID NOT NULL REFERENCES debiteur(id) ON DELETE CASCADE,
  datum_afgesproken DATE NOT NULL,
  status VARCHAR(20) NOT NULL
    CHECK (status IN ('actief', 'nagekomen', 'niet_nagekomen', 'afgesloten')),
  termijnen JSONB NOT NULL,  -- [{ datum, bedrag, betaald_op }, ...]
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_regeling_debiteur ON betalingsregeling(debiteur_id);

-- =====================================================
-- 3. KREDIETVERZEKERING (optioneel; alleen als kredietmodule_actief=TRUE)
-- =====================================================

-- Dekking per debiteur (één-op-één)
CREATE TABLE krediet_dekking (
  id UUID PRIMARY KEY,
  debiteur_id UUID NOT NULL UNIQUE REFERENCES debiteur(id) ON DELETE CASCADE,
  gedekt_bedrag DECIMAL(15,2) NOT NULL DEFAULT 0,
  dekkingsstatus VARCHAR(20) NOT NULL
    CHECK (dekkingsstatus IN ('actief', 'beperkt', 'ingetrokken', 'geen')),
  laatste_wijziging DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Kredietevents (intrekking, verlaging, overschrijding)
CREATE TABLE krediet_event (
  id UUID PRIMARY KEY,
  dekking_id UUID NOT NULL REFERENCES krediet_dekking(id) ON DELETE CASCADE,
  type VARCHAR(30) NOT NULL
    CHECK (type IN (
      'limiet_ingetrokken', 'limiet_verlaagd', 'limiet_verhoogd',
      'limiet_overschreden', 'overschrijding_voorspeld'
    )),
  datum DATE NOT NULL,
  bedrag DECIMAL(15,2),
  beschrijving TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_event_dekking ON krediet_event(dekking_id);
CREATE INDEX idx_event_datum ON krediet_event(datum);

-- Externe kredietscore per dekking (genormaliseerd naar 0-5)
CREATE TABLE externe_score (
  id UUID PRIMARY KEY,
  dekking_id UUID NOT NULL REFERENCES krediet_dekking(id) ON DELETE CASCADE,
  bron VARCHAR(50) NOT NULL,  -- 'coface', 'graydon', 'creditsafe', etc.
  ruwe_score DECIMAL(8,2) NOT NULL,
  min_schaal DECIMAL(8,2) NOT NULL,
  max_schaal DECIMAL(8,2) NOT NULL,
  richting VARCHAR(20) NOT NULL
    CHECK (richting IN ('hoog_is_goed', 'hoog_is_slecht')),
  mila_score INT NOT NULL CHECK (mila_score BETWEEN 0 AND 5),
  opgehaald_op DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_externe_score_dekking ON externe_score(dekking_id);

-- =====================================================
-- 4. BEREKENDE UITKOMSTEN (één rij per debiteur/taak; nightly refresh)
-- =====================================================

-- Standaard betaaldag per debiteur
CREATE TABLE standaard_betaaldag (
  debiteur_id UUID PRIMARY KEY REFERENCES debiteur(id) ON DELETE CASCADE,

  pattern_type VARCHAR(20) NOT NULL
    CHECK (pattern_type IN ('wekelijks', 'maandelijks', 'interval', 'geen')),
  pattern_value VARCHAR(50),  -- 'maandag', 'einde_maand', 'elke_14_dagen', NULL bij 'geen'
  pattern_percentage DECIMAL(5,2),  -- 0-100, NULL bij 'geen'
  confidence_label VARCHAR(10) NOT NULL
    CHECK (confidence_label IN ('hoog', 'middel', 'geen')),
  data_points_used INT NOT NULL,

  laatst_berekend TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Risicoscore per debiteur (vijf gewogen categorieën)
CREATE TABLE risicoscore (
  debiteur_id UUID PRIMARY KEY REFERENCES debiteur(id) ON DELETE CASCADE,

  totaalscore DECIMAL(3,2) NOT NULL CHECK (totaalscore BETWEEN 0 AND 5),

  -- Categoriescores (0-5, gemiddelde van onderliggende parameters)
  score_betaalgedrag DECIMAL(3,2) NOT NULL,
  score_huidige_stand DECIMAL(3,2) NOT NULL,
  score_disputen DECIMAL(3,2) NOT NULL,
  score_krediet DECIMAL(3,2),  -- NULL als kredietmodule niet actief
  score_omzetconcentratie DECIMAL(3,2) NOT NULL,

  -- Parameterdetails betaalgedrag (voor uitlegbaarheid)
  param_dso_score INT NOT NULL CHECK (param_dso_score BETWEEN 0 AND 5),
  param_trend_score INT CHECK (param_trend_score BETWEEN 0 AND 5),
  param_trend_label VARCHAR(50),
  param_trend_confidence DECIMAL(3,2),
  param_trend_explanation TEXT,
  param_volatiliteit_score INT CHECK (param_volatiliteit_score BETWEEN 0 AND 5),
  param_volatiliteit_label VARCHAR(50),
  param_volatiliteit_confidence DECIMAL(3,2),
  param_volatiliteit_explanation TEXT,
  param_wanbetaler_score INT CHECK (param_wanbetaler_score BETWEEN 0 AND 5),
  param_wanbetaler_predicted_days INT,
  param_wanbetaler_type VARCHAR(50),
  param_wanbetaler_confidence DECIMAL(3,2),
  param_wanbetaler_explanation TEXT,

  -- Parameterdetails huidige stand
  param_pct_vervallen_score INT NOT NULL CHECK (param_pct_vervallen_score BETWEEN 0 AND 5),
  param_oudste_post_score INT NOT NULL CHECK (param_oudste_post_score BETWEEN 0 AND 5),

  -- Parameterdetails disputen
  param_pct_disputen_score INT NOT NULL CHECK (param_pct_disputen_score BETWEEN 0 AND 5),

  -- Parameterdetails krediet (NULL als module niet actief)
  param_dekkingsgraad_score INT CHECK (param_dekkingsgraad_score BETWEEN 0 AND 5),
  param_impact_business_score INT CHECK (param_impact_business_score BETWEEN 0 AND 5),
  param_externe_score INT CHECK (param_externe_score BETWEEN 0 AND 5),

  -- Parameterdetails omzetconcentratie
  param_aandeel_ar_score INT NOT NULL CHECK (param_aandeel_ar_score BETWEEN 0 AND 5),

  laatst_berekend TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Priority score per taak
CREATE TABLE priority_score (
  taak_id UUID PRIMARY KEY REFERENCES taak(id) ON DELETE CASCADE,

  priority DECIMAL(3,2) NOT NULL,  -- 0-5, gewogen totaal

  -- Componentscores (0-5)
  impact DECIMAL(3,2) NOT NULL,
  urgentie INT NOT NULL CHECK (urgentie BETWEEN 1 AND 5),
  risico DECIMAL(3,2) NOT NULL,  -- overgenomen uit risicoscore.totaalscore
  potentieel INT NOT NULL CHECK (potentieel BETWEEN 0 AND 5),

  -- Impact-subscores
  impact_bedrag_score INT NOT NULL CHECK (impact_bedrag_score BETWEEN 0 AND 5),
  impact_effect_score INT NOT NULL CHECK (impact_effect_score BETWEEN 0 AND 2),
  impact_effect_type VARCHAR(30)
    CHECK (impact_effect_type IN (
      'directe_cash', 'versnelling', 'bescherming',
      'monitoring', 'administratief'
    )),
  impact_effect_explanation TEXT,

  laatst_berekend TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_priority_priority ON priority_score(priority DESC);

-- =====================================================
-- 5. AUDIT/SNAPSHOTS (optioneel maar aanbevolen)
-- =====================================================

-- Historische snapshots van risicoscores voor trendweergave
CREATE TABLE risicoscore_snapshot (
  id UUID PRIMARY KEY,
  debiteur_id UUID NOT NULL REFERENCES debiteur(id) ON DELETE CASCADE,
  snapshot_datum DATE NOT NULL,
  totaalscore DECIMAL(3,2) NOT NULL,
  score_betaalgedrag DECIMAL(3,2) NOT NULL,
  score_huidige_stand DECIMAL(3,2) NOT NULL,
  score_disputen DECIMAL(3,2) NOT NULL,
  score_krediet DECIMAL(3,2),
  score_omzetconcentratie DECIMAL(3,2) NOT NULL,

  UNIQUE (debiteur_id, snapshot_datum)
);

CREATE INDEX idx_snapshot_debiteur_datum ON risicoscore_snapshot(debiteur_id, snapshot_datum);
```

---

## Tabeloverzicht — bron en doel per tabel

| Tabel | Bron-module | Doel |
|---|---|---|
| `klant`, `klant_config` | gedeeld | Stamdata + configuratie van wegingen en scope |
| `administratie`, `debiteur` | gedeeld | Hiërarchische structuur waarbinnen scope wordt bepaald |
| `factuur`, `betaling` | gedeeld | Kern van alle berekeningen — input voor alle drie de modules |
| `dispuut` | risicoscore + prioritering | % disputen-parameter; type taak |
| `taak` | prioritering | Wat geprioriteerd moet worden |
| `omzet_historie` | risicoscore (AI volatiliteit) | Maandelijkse aggregaten voor patroonherkenning |
| `betalingsregeling` | risicoscore (AI trend + wanbetaler) | Signaal voor verslechterend gedrag |
| `krediet_dekking`, `krediet_event`, `externe_score` | risicoscore (categorie krediet) | Alleen relevant bij actieve kredietmodule |
| `standaard_betaaldag` | standaard betaaldag | Uitkomst nightly batch — input voor risicoscore en urgentie |
| `risicoscore` | risicoscore | Uitkomst nightly batch — input voor `priority_score.risico` |
| `priority_score` | prioritering | Uitkomst nightly batch — voedt sortering van takenlijst |
| `risicoscore_snapshot` | dashboards/trendweergave | Historie voor over-tijd-grafieken |

---

## Berekeningsvolgorde nightly batch

De drie uitkomsttabellen hangen volgordelijk samen. Een coding agent moet de batch in deze volgorde uitvoeren:

1. **`standaard_betaaldag`** — analyseer betaalpatronen per debiteur op basis van `factuur` + `betaling`. Geen afhankelijkheden van andere uitkomsttabellen.
2. **`risicoscore`** — bereken vijf categoriescores per debiteur. Gebruikt `factuur`, `betaling`, `dispuut`, `omzet_historie`, `betalingsregeling`, `krediet_*`, en optioneel `standaard_betaaldag` voor afwijkingsdetectie binnen het AI-trendmodel.
3. **`priority_score`** — bereken per open taak. Neemt `risicoscore.totaalscore` over voor de risico-component. Gebruikt `factuur`, `dispuut`, `taak`, en `klant_config.prio_weging_*` voor de gewogen totaalscore.

---

## Open punten die nog vastgelegd moeten worden

Deze punten staan nu als configuratiekolommen of `CHECK`-defaults in het schema, maar moeten met het team beslecht worden voordat productie:

1. **`klant_config.ar_scope`** — default `administratie`. Toetsen bij pilot-klanten of `geconsolideerd` of `locatie` betere defaults zijn voor specifieke klantgroepen.
2. **Recency-weging standaard betaaldag** — nu vastgelegd als `recency_boost_maanden=3`, `recency_boost_factor=2.0` in `klant_config`. Implementatie: betalingen binnen `recency_boost_maanden` × factor zwaarder wegen in patroonberekening.
3. **AI-componenten valideren** — alle `param_*_explanation`-velden voor trend/volatiliteit/wanbetaler komen uit AI. Output-schema valideren vóór productie. AI-prompts en modelversie buiten scope van dit datamodel houden (logging via aparte tabel).
4. **Tolerantie binnen interval-clusters (standaard betaaldag)** — niet in schema; implementeren in batch-logica. Voorstel: ±2 dagen wekelijks/tweewekelijks, ±3 dagen maandelijks.
5. **Audit historie** — `risicoscore_snapshot` is opgenomen; vergelijkbare snapshot-tabellen voor `priority_score` en `standaard_betaaldag` toevoegen als trends per taak/patroon over tijd nodig zijn.

---

## Aanbevolen vervolgacties voor de coding agent

1. Genereer migrations vanuit deze DDL (Flyway, Liquibase, Prisma migrate, Alembic — afhankelijk van stack).
2. Genereer ORM-modellen met type-safe relaties.
3. Genereer een seed-script met realistische voorbeelddata voor één klant met twee administraties, ~10 debiteuren, ~50 facturen, ~200 betalingen — zodat de drie nightly batches op echte data getest kunnen worden.
4. Schrijf de drie batch-jobs als pure functies die `(debiteur_id, snapshot_datum) → uitkomstrij` produceren, idempotent en parallelliseerbaar per debiteur.
5. Bouw integratietests die per bekende debiteur-situatie verifiëren dat de uitkomstscores matchen met de voorbeelden uit de risicoscore- en prioriteringsdocumentatie.
