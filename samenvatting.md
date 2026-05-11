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

- **Hoeveel levert dit op**: het bedrag dat nog openstaat, in verhouding tot het totaal. Grotere posten krijgen een hogere score. *(Methode: percentielen — we kijken in welke 20%-band van openstaande bedragen deze valt.)*
- **Hoe dringend**: hoeveel dagen de factuur al vervallen is. *(Methode: vaste drempels op dagen-vervallen.)*
- **Hoe risicovol** is opgebouwd uit vier sub-signalen:
  - *Hoe deze klant normaal betaalt* — gemiddeld aantal dagen te laat over alle eerdere facturen. *(Methode: DSO-berekening — Days Sales Outstanding.)*
  - *Gaat het beter of slechter* — we kijken naar de maandelijkse betaalduur over het afgelopen jaar en testen of die langzaam stijgt of daalt. *(Methode: Mann-Kendall trend-test, een statistische test die monotone trends in tijdreeksen detecteert.)*
  - *Hoe voorspelbaar* — hoeveel de tijd tussen opeenvolgende betalingen varieert. Sommige klanten betalen altijd in een vast ritme, anderen sparen alles op en betalen ineens. *(Methode: variatiecoëfficiënt — een maat voor relatieve spreiding.)*
  - *Hoe belangrijk deze klant is* — welk deel van onze totale jaaromzet bij deze klant zit.
- **Hoeveel sneller kan ze betalen**: het verschil tussen wat is afgesproken en wat in de praktijk gebeurt. Plus een herkend patroon waar mogelijk ("betaalt meestal op vrijdag", "altijd rond einde maand"). *(Methode: clustering op betaaldata — we proberen drie patroontypes: maandelijks rond een vaste dag, wekelijks op een vaste weekdag, of in een vast aantal dagen tussendoor.)*

Bij elke schatting (trend, voorspelbaarheid, betaalpatroon) staat een zekerheidstempel: **zeker / redelijk zeker / te weinig data**. Bij "te weinig data" telt dat signaal niet mee in de eindscore.

## Wat we nog niet tonen

- **Voorspelling of een klant gaat wanbetalen.** Vraagt om een echt vooruitkijkend rekenmodel dat we nog moeten bouwen — kan niet in de browser, vereist een klein achterliggend script.
- **Uitgebreidere uitleg per onderdeel.** Nu staan er standaardzinnetjes ("betaalt steeds later — duidelijke verslechtering over 11 maanden"). Een AI-model zou daar contextrijkere uitleg van kunnen maken.
- **Disputen tussen ons en klanten.** Zit niet in de aangeleverde Covebo-data.
- **Kredietverzekering-informatie.** Zit ook niet in de aangeleverde data.

**Wat dat laatste praktisch betekent voor de risico-score.** Het oorspronkelijke ontwerp van Mila bouwt de risico-score op uit vijf bouwstenen, elk met een eigen gewicht:

| Bouwsteen | Gewicht | Status nu |
|---|---|---|
| Hoe deze klant betaalt (historie + trend + voorspelbaarheid) | 30% | ✅ Gevuld |
| Hoe ze er nu voor staan (openstaand bedrag, vervallen posten) | 25% | ✅ Gevuld |
| Disputen | 10% | ❌ Geen data |
| Kredietverzekering | 25% | ❌ Geen data |
| Hoe belangrijk deze klant is voor ons | 10% | ✅ Gevuld |

Drie van de vijf zijn dus gevuld; samen goed voor 65% van de oorspronkelijk bedoelde score. Om te voorkomen dat de risico-score daardoor structureel te laag uitvalt, herverdelen we die 65% naar 100% — alsof disputen en krediet niet in het ontwerp zaten. Het cijfer is daarmee bruikbaar, maar mist twee signalen die in een complete situatie wel zouden meedoen.

## Volgende stappen

1. **Klein achterliggend rekenmodel opzetten** — voorwaarde voor de twee volgende punten.
2. **Voorspelling van wanbetaling toevoegen.** Twee varianten waar we tussen kunnen kiezen:
    - *Een bestaand statistisch model voor tabeldata (~halve dag).* AI-model dat speciaal is getraind om patronen in bedrijfsdata te herkennen (TabPFN is een bekende). We geven het Covebo's historie als referentiemateriaal mee; het kan dan zonder eigen training inschatten welke klanten op eerdere wanbetalers lijken. Beperkingen op hoeveelheid data tegelijk, en je bent afhankelijk van een externe partij die het model host.
    - *Een eigen model trainen op Covebo-data (~1 dag, productieklaar).* We trainen zelf een model (XGBoost — industriestandaard in credit scoring) op Covebo's historische klanten met hun betaalgedrag. Precies afgestemd op Covebo's klantbestand, maar 1 jaar historie en ~1.000 actieve klanten is aan de magere kant — twee à drie jaar zou robuuster zijn.
3. **AI-gegenereerde uitleg per taak.** Maakt de detailpagina rijker zonder dat het rekenmodel hoeft te veranderen.

---

## Appendix — waarom deze twee methodes?

Niet nodig om te lezen voor het grote plaatje. Bedoeld voor wie wil weten waarom de keuze viel op Mann-Kendall en de variatiecoëfficiënt in plaats van iets anders.

### Mann-Kendall trend-test (voor "gaat het beter of slechter")

Wat we willen weten: betaalt deze klant slechter dan vroeger? Per klant hebben we ~12 maandelijkse meetpunten — de gemiddelde betaalduur per maand.

Waarom Mann-Kendall:

- **Werkt met rommelige data.** Betaalduur over de tijd is geen strakke lijn — er zitten uitschieters in (één keer 200 dagen, andere keer netjes op tijd). Veel statistische tests gaan ervan uit dat data netjes rond een gemiddelde verdeeld is met een nette spreiding. Dat klopt hier niet. Mann-Kendall negeert de getallen zelf en kijkt alleen naar de *richting* tussen elk maand-paar: zit de tweede hoger of lager dan de eerste? Daardoor laat één extreem late betaling de test niet kantelen.
- **Detecteert ook niet-lineaire verslechtering.** Een klant kan stapsgewijs erger worden, of langzaam, of in golfjes — als de algemene richting maar consistent omhoog is, pakt Mann-Kendall dat op. Een rechte lijn is niet nodig.
- **Geschikt voor weinig datapunten.** 12 maandwaarden is een kleine reeks. Mann-Kendall is daar specifiek voor ontworpen; veel andere tests vragen meer.
- **Geeft een p-waarde terug.** Daardoor kunnen we eerlijk zeggen "zeker", "redelijk zeker" of "te weinig data" — in plaats van blind een score af te leveren.

Wat we anders hadden kunnen kiezen:
- *Gewoon laatste maand versus eerste maand* — te ruw, gaat voorbij aan de hele middentijd en geeft geen zekerheidsmaat.
- *Lineaire regressie* — gevoelig voor uitschieters, eist een nettere data-verdeling dan we hier hebben.

### Variatiecoëfficiënt (voor "hoe voorspelbaar")

Wat we willen weten: betaalt deze klant in een vast ritme, of grillig? De variatiecoëfficiënt is de spreiding gedeeld door het gemiddelde, berekend over de tijd tussen opeenvolgende betalingen.

Waarom de variatiecoëfficiënt:

- **Schaalvrij — vergelijkbaar tussen klanten met heel verschillende ritmes.** Vergelijk klant A die elke 7 dagen betaalt met spreiding ±2 dagen, en klant B die elke 60 dagen betaalt met spreiding ±15 dagen. In absolute zin spreidt B veel meer, maar *relatief* zijn beide ongeveer even constant. De variatiecoëfficiënt deelt de spreiding door het gemiddelde, dus beide krijgen ongeveer dezelfde uitkomst (~0,25). Een wekelijkse en een maandelijkse betaler kunnen zo allebei "regelmatig" of allebei "grillig" zijn.
- **Eenvoudig uit te leggen.** "Hoeveel wijkt de wachttijd tussen betalingen gemiddeld af, relatief gezien?" — meer is het niet.
- **Stabiele, breed gebruikte drempels.** Onder 0,3 ≈ bijna metronoom, rond 1 ≈ wisselend, boven 1,5 ≈ pieken-en-stiltes. Deze grenzen zijn niet door ons verzonnen; ze zijn algemeen geaccepteerd in domeinen die met variabiliteit werken (kwaliteitscontrole, voorraadbeheer, financiële statistiek).

Wat we anders hadden kunnen kiezen:
- *Alleen de standaardafwijking* — niet over klanten heen vergelijkbaar (een wekelijkse betaler scoort altijd lager dan een maandelijkse, ongeacht regelmaat).
- *Verschil tussen langste en kortste interval* — gedomineerd door één uitschieter.

### Eerlijke kanttekeningen

- **Mann-Kendall heeft datapunten nodig.** Met 1 jaar Covebo-historie komen we voor veel klanten net niet aan de drempel voor "zeker" of zelfs "redelijk zeker" — vandaar dat in onze top-50 vaak "te weinig data" bij trend staat. Twee à drie jaar historie zou hier een groot verschil maken.
- **De variatiecoëfficiënt onderscheidt geen vormen.** Een klant met veel snelle betalingen en één hele late krijgt mogelijk dezelfde uitkomst als een klant met gelijkmatig verspreide intervallen. Voor onze use case is dat acceptabel — beide willen we "wisselend" noemen — maar de variatiecoëfficiënt meet de *grootte* van de spreiding, niet de *vorm* ervan.
