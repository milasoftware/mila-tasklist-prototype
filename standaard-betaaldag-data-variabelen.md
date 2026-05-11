# Standaard betaaldag debiteur — gronddata en variabelen

Dit document beschrijft welke gronddata structureel binnen moet komen om per debiteur een standaard betaaldag (of "geen standaard betaaldag") te kunnen bepalen, en welke afgeleide variabelen daaruit volgen.

De aanpak: drie parallelle analyses op de betaalhistorie (dag van de week, dag van de maand, interval tussen betalingen). Het patroon met het hoogste percentage wint, mits ≥70% van de betalingen binnen dat patroon valt.

## 1. Gronddata

### Per betaling (uit factuurhistorie)
De ruggengraat van de analyse. Eén record per betaalde factuur.

- Factuur-id
- Debiteur-id
- Factuurdatum
- Betaaldatum
- Bedrag (betaald)
- Gedeeltelijke betalingen (datum + bedrag) — voor debiteuren die in meerdere stappen betalen

### Per debiteur
- Debiteur-id
- Naam
- Actief ja/nee

### Historie-eisen

- **Periode**: 6 tot 12 maanden historie
- **Minimum aantal betalingen**: 8 tot 10
- Onder dit minimum → geen betrouwbaar patroon mogelijk → uitkomst "geen standaard betaaldag"

### Configuratie

- **Recency-weging** — hoe zwaar tellen recente betalingen vs oudere? (bv. laatste 3 maanden weegfactor 2, oudere data factor 1)
- **Drempel patroonherkenning** — default 70% (sterk patroon), 40–70% (zwak patroon), <40% (geen patroon)

## 2. Afgeleide variabelen

### Basisafleidingen per betaling

- **Dag van de week** — maandag t/m zondag (afgeleid uit betaaldatum)
- **Dag van de maand** — 1 t/m 31 (afgeleid uit betaaldatum)
- **Interval** — verschil in dagen met vorige betaling van dezelfde debiteur

### Analyse 1: dag van de week

- Aantal betalingen per weekdag (gewogen op recency)
- Dominante weekdag = weekdag met hoogste aantal
- Percentage = aantal op dominante dag / totaal aantal betalingen
- Score: ≥70% sterk / 40–70% zwak / <40% geen patroon

### Analyse 2: dag van de maand

- Groepering in periodes:
  - begin (1–5)
  - midden (10–20)
  - einde (25–31)
- Aantal betalingen per periode (gewogen op recency)
- Dominante periode = periode met hoogste aantal
- Percentage = aantal in dominante periode / totaal aantal betalingen
- Score: ≥70% sterk / 40–70% zwak / <40% geen patroon

### Analyse 3: interval tussen betalingen

- Lijst van intervallen tussen opeenvolgende betalingen
- Clustering naar standaardpatronen:
  - 7 ± n dagen → wekelijks
  - 14 ± n dagen → tweewekelijks
  - 30–35 dagen → maandelijks
  - andere consistente waarde → custom interval
- Dominant interval = cluster met meeste matches
- Percentage = aantal in dominant cluster / totaal aantal intervallen
- Score: ≥70% sterk / 40–70% zwak / <40% geen patroon

### Eindbepaling

Vergelijk de drie analyses op hun percentages. Het patroon met het **hoogste percentage** wint, mits dit ≥70% is. Anders → "geen standaard betaaldag".

**Output**:
- `pattern_type` — wekelijks / maandelijks / interval / geen
- `pattern_value` — bv. "maandag", "einde maand", "elke 14 dagen"
- `pattern_percentage` — bv. 78%
- `confidence_label` — hoog (≥70%) / middel (40–70%) / geen (<40%)
- `data_points_used` — aantal betalingen waarop de analyse is gebaseerd

## 3. Minimale dataset

Tot het minimum teruggebracht:

- Eén tabel met **betaalde facturen** (factuurdatum, betaaldatum, bedrag, debiteur)
- Eén tabel met **debiteuren**
- Eventueel een tabel met **gedeeltelijke betalingen** als die niet al in de factuurtabel zitten

Dit is volledig dekkend met de gronddata die ook de risicoscore en prioritering nodig hebben — er is geen extra data nodig die niet al elders in het systeem zit.

## 4. Aandachtspunten

### Recency-weging vroeg vastleggen
De documentatie noemt dat recente data zwaarder weegt, maar geeft geen concrete formule. Dit moet vóór implementatie vastgelegd worden, want het beïnvloedt direct welke percentages eruit komen. Mogelijke richtingen:
- Lineair (laatste 3 maanden ×2, oudere data ×1)
- Exponentieel (gewicht halveert elke X maanden)
- Strikte cutoff (alleen laatste 6 maanden tellen mee)

### Conflict tussen patronen
Niet expliciet beschreven in de documentatie: wat als zowel "elke maandag" (75%) als "rond de 28e" (72%) boven de drempel komen? Voorgestelde regel: hoogste percentage wint. Vastleggen voor consistentie.

### Tolerantie binnen interval-clusters
Een betaling op dag 13 vs dag 14 vs dag 15 hoort allemaal bij "tweewekelijks". Wat is de bandbreedte rond elk standaardinterval? Voorstel: ±2 dagen voor wekelijks/tweewekelijks, ±3 dagen voor maandelijks. Vastleggen.

### Onder minimum aantal betalingen
Bij <8 betalingen kun je geen betrouwbaar patroon vaststellen. Vastleggen of het systeem dan:
- Niets teruggeeft (`null`)
- Een expliciete waarde "onvoldoende data" teruggeeft (zodat downstream-modules erop kunnen filteren)

### Nieuwe debiteuren
Voor net aangelegde debiteuren is er per definitie geen patroon. Bepaal of er een fallback komt (bv. "afgesproken betaaltermijn" als proxy) of dat downstream-modules met een lege standaard betaaldag moeten kunnen omgaan.

### Koppeling met andere modules
De standaard betaaldag is logischerwijs input voor:
- **AI-trendmodel** binnen de risicoscore — afwijkingen t.o.v. de standaard zijn een signaal van veranderend gedrag
- **Urgentie-bepaling** binnen de prioritering — als een klant standaard op dag 28 betaalt en het is dag 30, is dat anders urgent dan bij een onvoorspelbare betaler

Vastleggen hoe deze koppeling werkt zodra de drie modules samenkomen in één datamodel.
