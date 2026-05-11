# Mila — Data-upload specificatie

Welke ruwe data moet er in een upload-bestand staan zodat de nightly batch de risicoscore, priority en standaard betaaldag kan berekenen.

## Principe

Alleen **ruwe operationele data** uploaden. Scores (risicoscore, priority, standaard betaaldag) en AI-uitkomsten (trend, volatiliteit, wanbetaler) worden door Mila zelf berekend — die horen *niet* in het uploadbestand.

---

## Stamdata (rarely changes — eenmalig of bij wijziging)

### `debiteur` — kern-stamdata

| Veld | Type | Verplicht | Opmerking |
|---|---|---|---|
| `debiteur_id` | string | ja | Extern referentienummer, uniek |
| `administratie_id` of `administratie_naam` | string | ja | Welke administratie/locatie |
| `naam` | string | ja | |
| `standaard_betaaltermijn` | int (dagen) | ja | Contractueel afgesproken |
| `actief` | boolean | nee | Default `true` |

### `administratie` — als meerdere administraties

| Veld | Type | Verplicht |
|---|---|---|
| `administratie_id` | string | ja |
| `naam` | string | ja |
| `locatie` | string | nee |

---

## Operationeel (frequent — wat je periodiek upload)

### `factuur` — verplicht

| Veld | Type | Verplicht | Opmerking |
|---|---|---|---|
| `factuurnummer` | string | ja | Uniek per debiteur |
| `debiteur_id` | string | ja | |
| `factuurdatum` | date | ja | |
| `vervaldatum` | date | ja | |
| `betaaltermijn_dagen` | int | ja | Afgesproken op deze factuur — kan afwijken van standaard |
| `factuurbedrag` | decimal | ja | EUR |
| `openstaand_bedrag` | decimal | ja | = factuurbedrag bij nieuwe; daalt bij betaling |
| `status` | enum | ja | `open` / `gedeeltelijk` / `betaald` / `in_dispuut` / `afgeschreven` |

### `betaling` — verplicht

| Veld | Type | Verplicht | Opmerking |
|---|---|---|---|
| `factuurnummer` of `factuur_id` | string | ja | Waar hoort betaling bij |
| `betaaldatum` | date | ja | |
| `bedrag` | decimal | ja | EUR |
| `is_gedeeltelijk` | boolean | nee | Af te leiden |

### `dispuut` — verplicht voor risico-categorie disputen

| Veld | Type | Verplicht | Opmerking |
|---|---|---|---|
| `debiteur_id` | string | ja | |
| `factuurnummer` | string | nee | Dispuut hoeft niet aan factuur gekoppeld |
| `datum_geopend` | date | ja | |
| `datum_gesloten` | date | nee | Leeg = open |
| `status` | enum | ja | `open` / `opgelost` / `afgewezen` |
| `bedrag` | decimal | ja | EUR |
| `beschrijving` | text | nee | |

---

## Optioneel maar nodig voor AI / standaard betaaldag

### `omzet_historie` — maandelijkse aggregaten per debiteur

| Veld | Type | Verplicht | Opmerking |
|---|---|---|---|
| `debiteur_id` | string | ja | |
| `periode` | date | ja | Eerste dag van de maand |
| `omzet` | decimal | ja | EUR |
| `openstaande_positie` | decimal | ja | EUR |
| `aantal_facturen` | int | ja | |

> Kan ook afgeleid worden uit factuur+betaling als die historisch ver genoeg teruggaat — vraag is of je dat liever vooraf aanlevert of laat berekenen.

### `betalingsregeling` — alleen als van toepassing

| Veld | Type | Verplicht | Opmerking |
|---|---|---|---|
| `debiteur_id` | string | ja | |
| `datum_afgesproken` | date | ja | |
| `status` | enum | ja | `actief` / `nagekomen` / `niet_nagekomen` / `afgesloten` |
| `termijnen` | list | ja | `[{datum, bedrag, betaald_op}, ...]` |

---

## Conditioneel — alleen als kredietmodule actief

### `krediet_dekking` (één per debiteur)

| Veld | Type | Verplicht | Opmerking |
|---|---|---|---|
| `debiteur_id` | string | ja | |
| `gedekt_bedrag` | decimal | ja | EUR |
| `dekkingsstatus` | enum | ja | `actief` / `beperkt` / `ingetrokken` / `geen` |
| `laatste_wijziging` | date | ja | |

### `krediet_event` (events op dekking)

| Veld | Type | Verplicht | Opmerking |
|---|---|---|---|
| `debiteur_id` | string | ja | |
| `type` | enum | ja | `limiet_ingetrokken` / `_verlaagd` / `_verhoogd` / `_overschreden` / `overschrijding_voorspeld` |
| `datum` | date | ja | |
| `bedrag` | decimal | nee | EUR |
| `beschrijving` | text | nee | |

### `externe_score` (kredietbureau-scores)

| Veld | Type | Verplicht | Opmerking |
|---|---|---|---|
| `debiteur_id` | string | ja | |
| `bron` | string | ja | `coface` / `graydon` / `creditsafe` / ... |
| `ruwe_score` | decimal | ja | Onbewerkte bureau-score |
| `min_schaal` | decimal | ja | Onderkant schaal van bureau |
| `max_schaal` | decimal | ja | Bovenkant schaal van bureau |
| `richting` | enum | ja | `hoog_is_goed` / `hoog_is_slecht` |
| `opgehaald_op` | date | ja | |

> Mila normaliseert zelf naar 0–5 — alleen ruwe score aanleveren.

---

## Open vragen om te beslissen vóór upload-feature

1. **Taken** — worden die geüpload of door Mila gegenereerd uit regels (factuur 14d vervallen → bel-taak)? In het schema bestaat `taak` als losse tabel, dus beide kan, maar dit moet vastgelegd worden.
2. **Historiediepte bij onboarding** — voor AI-trend / volatiliteit / wanbetaler en voor standaard betaaldag is minimaal ~6–12 maanden factuur+betaling-historie nodig. Vastleggen wat verwacht wordt bij eerste upload.
3. **Bestandsformaat** — CSV per tabel, één Excel met meerdere tabbladen, of JSON? Bepaalt parser-werk en validatie.
4. **Update-strategie** — full reload (alles vervangen) of delta (alleen nieuwe/gewijzigde records)? Heeft consequenties voor `factuur.openstaand_bedrag` en dispuut-statuswijzigingen.
