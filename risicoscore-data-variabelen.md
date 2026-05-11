# Risicoscore debiteur — gronddata en variabelen

Dit document beschrijft welke gronddata structureel binnen moet komen om de risicoscore per debiteur te kunnen berekenen, en welke afgeleide variabelen daaruit volgen. De berekening:

```
risicoscore = som van (categoriescore × categorieweging)
categoriescore = gemiddelde van parameterscores (elk 0–5)
categorieweging = instelling per klant (samen 100%)
```

Vijf categorieën: betaalgedrag, huidige stand, disputen, kredietverzekering, omzetconcentratie.

## 1. Gronddata

### Per factuur
De ruggengraat van de risicoberekening. Zowel openstaande als historische facturen.

- Factuurnummer (id)
- Debiteur-id
- Factuurdatum
- Vervaldatum
- Afgesproken betaaltermijn in dagen
- Factuurbedrag (origineel)
- Openstaand bedrag
- Betaaldatum (leeg als nog niet betaald)
- Status — open / betaald / gedeeltelijk / in dispuut / afgeschreven
- Gedeeltelijke betalingen (bedrag + datum)

### Per debiteur
Stamgegevens die in meerdere parameters terugkomen.

- Debiteur-id
- Naam
- Administratie / locatie (voor scope-bepaling totale AR)
- Standaard betaaltermijn (afgesproken contract)
- Actief ja/nee

### Per dispuut
Eigen entiteit met eigen levenscyclus.

- Dispuut-id
- Gekoppelde factuur(en)
- Datum geopend
- Datum gesloten (leeg als open)
- Status — open / opgelost / afgewezen
- Bedrag onder dispuut

### Omzet/exposure-historie per debiteur
Nodig voor de AI-component variabiliteit binnen betaalgedrag.

- Per periode (maand): omzet (facturatie), openstaande positie (AR), aantal facturen
- Voldoende historie om patroon te herkennen (minimaal 6 maanden, liefst 12+)

### Betalingsregelingen
Komen terug in zowel trend als wanbetaler-voorspelling.

- Debiteur-id
- Datum afgesproken
- Afgesproken termijnen en bedragen
- Status — actief / nagekomen / niet nagekomen / afgesloten

### Kredietverzekering (optioneel — alleen bij actieve module)

- Polisnummer / verzekeraar
- Per debiteur: gedekt bedrag, dekkingsstatus, datum laatste wijziging
- Totale exposure debiteur (= openstaand bedrag)
- Totaal verzekerd bedrag op polisniveau (hele AR)
- Externe kredietscore + bron + schaal (bv. Coface 0–10, Graydon 0–100)
- Richting van de schaal — is hoog goed of slecht?

### Configuratie per klant

- **Categoriewegingen** (betaalgedrag / huidige stand / disputen / krediet / omzetconcentratie — sommen tot 100%)
- **Scope van "totale AR"** — geconsolideerd, per administratie, of per locatie
- **Kredietmodule actief ja/nee** (zo niet → weging krediet = 0, andere wegingen schalen op)

## 2. Afgeleide variabelen

### Categorie 1: Betaalgedrag (gemiddelde van 4 parameters)

**DSO vs betaaltermijn** (regelgebaseerd)
- Gemiddelde betaaldagen per debiteur
- Delta = gemiddelde betaaldagen − afgesproken betaaltermijn
- Score 0–5 op basis van delta-bandbreedtes (≤0, 1–5, 5–15, 16–30, 31–60, >60)

**Trend betaalgedrag** (AI)
- Tijdreeks van betaaldagen per maand
- DSO laatste 3 maanden vs DSO vorige 3 maanden
- Aantal dagen te laat per factuur
- Trend in vervallen bedrag
- Aantal openstaande posten
- Lopende betalingsregelingen
- Open disputen
- → AI levert: trend_score (0–5), trend_label, confidence, explanation

**Variabiliteit / onzekerheid** (AI)
- Gemiddelde omzet laatste 6 maanden
- Gemiddelde omzet daarvoor
- % groei/daling
- Standaarddeviatie van omzet/exposure
- Max/min verhouding
- → AI levert: volatility_score (0–5), trend, volatility_type, confidence, explanation

**Voorspelling wanbetaler** (AI)
- Gemiddelde betaaldagen
- Afwijking t.o.v. betaaltermijn
- Trend laatste maanden
- Spreiding/onzekerheid in betaalgedrag
- % vervallen posten
- Leeftijd oudste post
- Disputen
- Status betalingsregelingen
- Omzetontwikkeling
- → AI levert: predicted_payment_days, payment_type, default_risk_score (0–5), confidence, explanation

### Categorie 2: Huidige stand (gemiddelde van 2 parameters)

**% vervallen**
- Totaal vervallen bedrag per debiteur
- Totaal openstaand bedrag per debiteur
- % vervallen = vervallen / openstaand
- Score 0–5 op basis van % (0%, 1–10%, 11–25%, 26–50%, 51–75%, >75%)

**Leeftijd oudste post**
- Per openstaande factuur: dagen vervallen = vandaag − vervaldatum
- Max van die waardes per debiteur
- Score 0–5 op basis van dagen (0, 1–15, 16–30, 31–60, 61–90, >90)

### Categorie 3: Disputen

**% disputen t.o.v. facturen**
- Aantal facturen met dispuut
- Totaal aantal facturen
- % disputen = disputen / totaal
- Score 0–5 op basis van % (<1%, 1–5%, 5–10%, 10–20%, 20–30%, >30%)

### Categorie 4: Kredietverzekering (gemiddelde van 3 parameters — alleen bij actieve module)

**Dekkingsgraad debiteur**
- Dekkingsgraad = gedekt bedrag / totale exposure debiteur
- Score 0–5 op basis van % (100%, 75–100%, 50–75%, 25–50%, 0–25%, 0%)

**Impact business (ongedekt bedrag)**
- Ongedekt bedrag = totale exposure debiteur − gedekt bedrag
- % ongedekt = ongedekt bedrag / totale AR (hele polis)
- Score 0–5 op basis van % (≤0%, 0–1%, 2–5%, 6–10%, 11–20%, >20%)

**Externe kredietscore** (genormaliseerd)
- Ruwe score + min + max + richting van de schaal
- Genormaliseerd = (score − min) / (max − min) als hoog = slecht
- Genormaliseerd = 1 − ((score − min) / (max − min)) als hoog = goed
- Mila-score = afronden naar boven (genormaliseerd × 5)

### Categorie 5: Omzetconcentratie

**Aandeel in totale AR**
- Aandeel = openstaand bedrag debiteur / totale AR
- Score 0–5 op basis van % (<1%, 1–5%, 6–10%, 11–20%, 21–40%, >40%)

### Aggregaten op portefeuilleniveau
Nodig als noemer voor relatieve berekeningen.

- **Totale AR** (op gekozen scope: geconsolideerd / per administratie / per locatie)
- **Totaal verzekerd bedrag** op polisniveau

## 3. Minimale dataset

Tot het minimum teruggebracht:

- Eén tabel met openstaande en historische **facturen**
- Eén tabel met **debiteuren**
- Eén tabel met **disputen**
- Eén tabel met **omzet/exposure-historie per maand per debiteur**
- Eén tabel met **betalingsregelingen**
- Optioneel: tabel met **kredietverzekeringsdata** (dekking, kredietevents, externe scores)

Daaruit kan al het overige afgeleid worden.

## 4. Aandachtspunten

### Scope van "totale AR" vroeg vastleggen
Raakt twee parameters direct: omzetconcentratie en % ongedekt (impact business). De documentatie bevat hier al een open vraag over: *moet dit op basis van totale AR per administratie of locatie?*  Inconsistente toepassing leidt tot inconsistente scores tussen vergelijkbare klanten.

### Kredietmodule niet actief = weging 0
Als een klant geen actieve kredietmodule heeft, is de weging voor de categorie kredietverzekering automatisch 0. De andere categorieën schalen dan op naar 100%.

### Hard vs AI
- **Hard berekenen**: DSO, % vervallen, leeftijd oudste post, % disputen, dekkingsgraad, % ongedekt, omzetconcentratie, normalisatie externe kredietscore.
- **AI inzetten**: trend, variabiliteit, wanbetaler-voorspelling — uitsluitend voor patroonherkenning op vaste input, met gestructureerde output (score + label + uitleg).

### AI-componenten valideren
Alle AI-uitwerkingen in de risicoscore-documentatie zijn afkomstig van GPT en moeten nog door een AI-expert gecontroleerd worden voordat ze productie ingaan.

### Externe kredietscore — mapping per leverancier
Per kredietinformatiebureau moet vooraf vastgelegd worden:
- Welke schaal gebruiken ze (0–10, 0–100, anders)?
- Welke richting heeft de schaal (hoog = goed of hoog = slecht)?

Zonder deze mapping kun je geen genormaliseerde Mila-score berekenen.

### Historie-eis voor AI-componenten
De drie AI-parameters binnen betaalgedrag hebben voldoende historie nodig om patronen te kunnen herkennen. Bij nieuwe debiteuren met weinig historie moet besloten worden: een lagere confidence accepteren, een fallback-score gebruiken, of de AI-parameters tijdelijk niet meewegen.
