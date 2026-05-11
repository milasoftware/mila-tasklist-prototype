# Mila — wat we nu hebben

Mila helpt bij debiteurenbeheer: het laat per dag zien welke klanten je het eerst moet benaderen, op basis van wat de meeste cashflow oplevert.

## Wat zie je in de app

**Startpagina — een geprioriteerde takenlijst.**

- 50 taken op een rij, hoogste prioriteit bovenaan.
- Per taak: debiteurnaam, soort actie (Bellen / Herinnering / Escalatie), prioriteit van 0 tot 5, en een korte aanleiding.
- Tabs om snel te filteren op type actie.

**Detailpagina (klik op een taak) — uitleg waarom deze taak op deze plek staat.**

- Achtergrondinformatie over de klant: openstaande facturen, totaal openstaand bedrag, hoeveel ervan vervallen is, hoe oud de oudste post is, plus de hele factuurhistorie.
- Vier scores die samen de prioriteit bepalen — elk met eigen uitleg en gewicht:
  - **Hoeveel levert dit op** (40%)
  - **Hoe dringend is dit** (30%)
  - **Hoe risicovol is deze klant** (20%)
  - **Hoeveel sneller kan deze klant betalen** (10%)
- Een schakelaar "Toon technische details" maakt onderliggende formules en getallen zichtbaar voor wie dat wil.

## Waar de scores op gebaseerd zijn

Alles wordt elke nacht opnieuw berekend uit de factuur- en betaalhistorie van de klant. Geen vermoedens — alleen wat in de data zit.

- **Hoeveel levert dit op**: het bedrag dat nog openstaat, in verhouding tot het totaal. Grotere posten krijgen een hogere score.
- **Hoe dringend**: hoeveel dagen de factuur al vervallen is.
- **Hoe risicovol** is opgebouwd uit vier sub-signalen:
  - *Hoe deze klant normaal betaalt* — gemiddeld aantal dagen te laat over alle eerdere facturen.
  - *Gaat het beter of slechter* — we kijken naar de maandelijkse betaalduur over het afgelopen jaar en testen of die langzaam stijgt of daalt.
  - *Hoe voorspelbaar* — hoeveel de tijd tussen opeenvolgende betalingen varieert. Sommige klanten betalen altijd in een vast ritme, anderen sparen alles op en betalen ineens.
  - *Hoe belangrijk deze klant is* — welk deel van onze totale jaaromzet bij deze klant zit.
- **Hoeveel sneller kan ze betalen**: het verschil tussen wat is afgesproken en wat in de praktijk gebeurt. Plus een herkend patroon waar mogelijk ("betaalt meestal op vrijdag", "altijd rond einde maand").

Bij elke schatting (trend, voorspelbaarheid, betaalpatroon) staat een zekerheidstempel: **zeker / redelijk zeker / te weinig data**. Bij "te weinig data" telt dat signaal niet mee in de eindscore.

## Wat we nog niet tonen

- **Voorspelling of een klant gaat wanbetalen.** Vraagt om een echt vooruitkijkend rekenmodel dat we nog moeten bouwen — kan niet in de browser, vereist een klein achterliggend script.
- **Uitgebreidere uitleg per onderdeel.** Nu staan er standaardzinnetjes ("betaalt steeds later — duidelijke verslechtering over 11 maanden"). Een AI-model zou daar contextrijkere uitleg van kunnen maken.
- **Disputen tussen ons en klanten.** Zit niet in de aangeleverde Covebo-data.
- **Kredietverzekering-informatie.** Zit ook niet in de aangeleverde data.

De laatste twee betekenen dat de risico-score nu niet compleet is — twee van de vijf voorziene risico-categorieën zijn momenteel leeg.

## Volgende stappen

1. **Klein achterliggend rekenmodel opzetten** — voorwaarde voor de twee volgende punten. Een paar uur werk.
2. **Voorspelling van wanbetaling toevoegen.** Drie varianten mogelijk, van snel-maar-grof tot grondiger; precieze keuze hangt af van hoeveel waarde we eraan hechten.
3. **AI-gegenereerde uitleg per taak.** Maakt de detailpagina rijker zonder dat het rekenmodel hoeft te veranderen.
4. **Met Covebo afstemmen** over disputen- en kredietverzekering-data. Komt dat uit een ander systeem, of accepteren we dat die categorieën permanent leeg blijven?

Daarna is Mila op AI-vlak compleet voor wat er met deze data mogelijk is.
