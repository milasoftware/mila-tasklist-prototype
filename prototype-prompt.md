# Prompt voor coding LLM — Mila prototype

> Kopieer alles onder de scheidingslijn naar de coding LLM. Voeg daarna de dummy data en eventueel de eerder opgestelde documenten toe als bijlage.

---

## Context

Ik bouw een prototype voor **Mila**, een tool voor debiteurenbeheer en cashflow-management. De kern van het systeem is dat operationele taken (zoals "klant bellen", "dispuut oplossen", "herinnering versturen") automatisch worden geprioriteerd op basis van wat op dit moment de meeste waarde levert voor cashflow en DSO.

De prioritering werkt met deze formule, die elke nacht per taak opnieuw wordt berekend:

```
priority = (impact × 0,4) + (urgentie × 0,3) + (risico × 0,2) + (potentieel × 0,1)
```

Elke component scoort 0–5:

- **Impact** — hoeveel cash levert deze actie op? Combinatie van bedrag (relatief t.o.v. totale openstaande vorderingen) en effect-type (directe cash, versnelling, bescherming).
- **Urgentie** — moet dit nu of kan het wachten? Gebaseerd op vervaldatum, dispuutleeftijd, kredietevents, deadlines.
- **Risico** — risicoscore van de debiteur zelf (gewogen score uit vijf categorieën: betaalgedrag, huidige stand, disputen, kredietverzekering, omzetconcentratie).
- **Potentieel** — DSO-verbetering die mogelijk is bij deze klant (verschil tussen werkelijke en afgesproken betaaltermijn).

## Wat ik wil bouwen

Een **werkend webprototype** met dummy data, gericht op één scherm:

**Een geprioriteerde takenlijst** waarin elke taak laat zien:

- Debiteurnaam
- Korte taakomschrijving (type + context, bv. "Bellen — factuur 14 dagen vervallen, €25k")
- Priority score (totaalcijfer 0–5, prominent zichtbaar)
- Korte aanleiding in één regel

Lijst is gesorteerd op priority score, hoogste bovenaan.

**Bij klikken op een taak**: detailweergave (zijpaneel of expand) met de volledige uitleg van waarom deze taak zo geprioriteerd is. Dus per component:

- Impact: waarde + waarom (welk bedrag, welk effect-type, met onderliggende redenering)
- Urgentie: waarde + waarom (welk tijdsignaal triggert dit)
- Risico: waarde + breakdown naar de vijf risicocategorieën
- Potentieel: waarde + waarom (verschil tussen werkelijk en afgesproken betaalgedrag)

Plus de uiteindelijke berekening expliciet zichtbaar, bijvoorbeeld:

```
(5 × 0,4) + (5 × 0,3) + (1 × 0,2) + (1 × 0,1) = 2,0 + 1,5 + 0,2 + 0,1 = 3,8
```

Dit is bewust uitlegbaar — een gebruiker moet kunnen begrijpen waarom een taak bovenaan staat.

## Tech-keuzes

- Frontend: React met TypeScript, Tailwind voor styling
- Geen backend nodig — dummy data wordt als JSON in de frontend geladen
- Geen routing nodig — één scherm met paneel-detail volstaat
- Geen authenticatie, geen state-management library — `useState` is voldoende
- Lichte, neutrale UI; functionaliteit boven mooi (maar leesbaar en strak)

## Wat ik aanlever

1. **Dummy data** als JSON — bevat een lijst taken met per taak: debiteurinfo, factuurinfo (indien van toepassing), de vier componentscores en hun subscores/redeneringen, en de uiteindelijke priority. Schema volgt nog.
2. (Optioneel, op verzoek) — eerder opgestelde documenten over de risicoscore-berekening, prioritering, standaard betaaldag, en het complete datamodel. Vraag erom als je context mist.

## Wat ik van je vraag

1. Begin met **één voorstel voor de schermindeling** in tekst voordat je code schrijft — lijst aan welke kant, detailpaneel rechts of als modal, hoe de breakdown gevisualiseerd wordt (bv. progress bars per component, of getallen + bars).
2. Wacht op mijn akkoord op de schermindeling.
3. Wacht op de dummy data van mij.
4. Bouw dan het prototype als één React-component (of een kleine handvol als dat schoner is). Houd het bestand(en) compact en goed becommentarieerd.
5. Lever code die direct draait — geen `// TODO` of placeholders.

## Wat ik níet wil

- Geen verzonnen velden of berekeningen die niet uit mijn dummy data komen. Als je iets mist, vraag het.
- Geen overengineering: geen Redux, geen routing, geen API-laag, geen testframework.
- Geen mooie maar betekenisloze visualisaties — elke grafiek of bar moet een echt veld uit de data tonen.
- Geen dark mode tenzij ik er specifiek om vraag.

Begin met je voorstel voor de schermindeling. Dummy data en eventuele extra documenten lever ik op je verzoek aan.
