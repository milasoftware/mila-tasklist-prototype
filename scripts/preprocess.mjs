// Preprocess dummy export → src/data.generated.json
//
// Leest twee geanonimiseerde JSON-bestanden, berekent deterministische
// risicoscore + priority + standaard betaaldag-achtige metrics, en schrijft
// twee dingen weg:
//   1. tasks[]  — top-N geprioriteerde taken in de huidige Task-shape (pad A)
//   2. debiteuren[] / facturen[] / betalingen[]  — relationele entiteiten
//      voor de eventuele uitbreiding naar pad B
//
// Disputen + krediet zijn niet aanwezig in de ruwe data; die categorieën
// worden uitgesloten van de risicoberekening en met `null` weggeschreven.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(__dirname, '..')

const DEB_FILE = path.join(REPO, 'src/deb_data/jaarhistorie_deb_geanonimiseerd.json')
const POSTS_FILE = path.join(REPO, 'src/deb_data/jaarhistorie_posten_VNOM_geanonimiseerd.json')
const OUT_FILE = path.join(REPO, 'src/data.generated.json')

const SNAPSHOT = '2026-05-11' // laatste factuurdatum in de dataset
const TOP_N = Infinity // alle gegenereerde taken meenemen

// Tijdvenster voor de recent-betaalgedrag-metingen (DSO-mediaan +
// voorspelbaarheid/volatiliteit). Aligneert met de rest van de AI-componenten
// die op ~12 maanden historie werken en zorgt dat een verbeterende debiteur
// niet eeuwig blijft hangen op oud betaalgedrag. Trend (Mann-Kendall) gebruikt
// bewust wel de volledige historie omdat een trendsignaal lengte nodig heeft.
const BETAALGEDRAG_WINDOW_DAYS = 365

// Haalbaarheidsdrempel voor "Hoeveel sneller kan deze klant betalen?".
// Onder deze marge gaan we ervan uit dat structurele afwijking voortkomt
// uit proceskenmerken (wekelijkse betaalrun, intern goedkeuringstraject)
// die met bellen niet wegtegaan zijn — dus géén realistisch DSO-potentieel.
// Pas wanneer een klant méér dan dit aantal dagen structureel te laat is,
// rekenen we het verschil mee als beïnvloedbare termijn.
const DSO_HAALBAARHEIDSDREMPEL_DAGEN = 7

// ----- helpers ---------------------------------------------------------------

const today = new Date(SNAPSHOT)
const oneDay = 86400000

const num = (s) => (s === undefined || s === null || s === '' ? 0 : parseFloat(String(s).replace(',', '.')))
const daysBetween = (later, earlier) => Math.floor((new Date(later) - new Date(earlier)) / oneDay)
const round = (n, dec = 2) => {
  const f = Math.pow(10, dec)
  return Math.round(n * f) / f
}
const formatEUR = (n) =>
  '€' + n.toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

// ----- statistische helpers (fase 1 AI-componenten) --------------------------

// Abramowitz & Stegun-benadering van de fout-functie, voor normaal-CDF
function erf(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911
  const sign = x < 0 ? -1 : 1
  x = Math.abs(x)
  const t = 1 / (1 + p * x)
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)
  return sign * y
}
const normalCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2))

// Mann-Kendall trend-test (non-parametrisch). Detecteert of een monotone
// trend bestaat. Geeft tau (-1..1, sterkte+richting) en p-value (significantie).
// Voor onze use case: positief tau betekent stijgende DSO = verslechterend
// betaalgedrag.
function mannKendall(values) {
  const n = values.length
  if (n < 4) return { tau: 0, pValue: 1, n }
  let S = 0
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      S += Math.sign(values[j] - values[i])
    }
  }
  const variance = (n * (n - 1) * (2 * n + 5)) / 18
  const z = S === 0 ? 0 : (S - Math.sign(S)) / Math.sqrt(variance)
  const pValue = 2 * (1 - normalCdf(Math.abs(z)))
  const tau = S / ((n * (n - 1)) / 2)
  return { tau, pValue, n }
}

// Coefficient of variation — eenvoudige maat voor relatieve spreiding.
// Lage CV = regelmatig, hoge CV = grillig.
function coefficientOfVariation(values) {
  if (values.length < 2) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  if (mean === 0) return 0
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance) / Math.abs(mean)
}

// Standaard betaaldag pattern recognition v3.
//
// Bron: fysieke betalingen (records met Invoicetype/Documenttype in
//   {Betaling, Terugbetaling, leeg}). Géén interne reconciliaties uit
//   Factuur.payments — dat zijn boekhoudacties (creditnota's wegstrepen
//   op kasdagen) en geen klantgedrag.
// Venster: laatste 12 maanden vóór snapshot.
// Beslisregel: toon één dag als
//   (a) ≥4 betalingen op de dominante dag EN ≥50% van alle betalingen, OF
//   (b) ≥3 betalingen die ALLE op dezelfde dag vielen (100% fit).
//   Anders: "geen standaard betaaldag".
// Twee patroon-types worden geprobeerd; winnaar = hoogste fit:
//   - vaste weekdag (mode op dag-van-de-week)
//   - vaste dag van de maand (±1 dag marge — écht rond die dag)
// Het interval-type uit v2 is geschrapt: het levert geen concrete dag op
// die je in de UI kunt tonen of in de herinneringsflow kunt verschuiven.
//
// Feestdag-correctie: betalingen die binnenkwamen na een aaneengesloten
// reeks non-werkdagen (feestdag of weekend) worden teruggeschoven naar de
// laatste werkdag vóór die reeks — alleen als er géén werkdag tussen zat.
// Daardoor wordt een vrijdag-klant die maandag na Pasen betaalt alsnog
// als vrijdag-betaler herkend. Feestdag-set = unie van TARGET + NL + BE.
//
// Patroon-verschuiving: we berekenen het patroon over de oude 9 maanden
// (maand 12 t/m 4) én over de laatste 3 maanden apart. Als beide tot een
// dag komen en die dagen verschillen, schakelen we automatisch over op
// het nieuwe patroon en loggen dat in de audit-log.
const STANDAARD_BETAALDAG_VENSTER_MAANDEN = 12
const STANDAARD_BETAALDAG_NIEUW_VENSTER_DAGEN = 90 // = 3 mnd
const STANDAARD_BETAALDAG_MIN_HITS = 4
const STANDAARD_BETAALDAG_MIN_FIT = 0.5
const STANDAARD_BETAALDAG_PERFECT_MIN_HITS = 3 // bij 100% fit mag n lager

// ----- feestdag-helpers -----------------------------------------------------

// Westerse paas-zondag voor een gegeven jaar — Anonymus Gregoriaans
// (Meeus-Jones). Geeft Date in UTC. Alle andere variabele feestdagen
// (Goede Vrijdag, Paasmaandag, Hemelvaart, Pinkstermaandag) zijn een
// vaste offset hier vandaan.
function paasZondag(year) {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(year, month - 1, day))
}

const isoDate = (date) => date.toISOString().slice(0, 10)
const addDays = (date, n) => new Date(date.getTime() + n * oneDay)

// Bouwt een Set met ISO-datums (YYYY-MM-DD) van alle bank-/bedrijfssluiting-
// dagen in de gegeven jaren. Unie van:
//   - TARGET2/SEPA banksluitingsdagen (Goede Vrijdag, Paasmaandag, 1 mei,
//     1 jan, 25 + 26 dec)
//   - NL nationale feestdagen (incl. Koningsdag, Hemelvaart, Tweede
//     Pinksterdag, Tweede Paasdag)
//   - BE nationale feestdagen (incl. nationale feestdag 21 jul,
//     O.L.V. Hemelvaart 15 aug, Allerheiligen, Wapenstilstand)
function bouwFeestdagSet(jaren) {
  const set = new Set()
  for (const y of jaren) {
    const paas = paasZondag(y)
    const goedeVrijdag = addDays(paas, -2)
    const paasmaandag = addDays(paas, 1)
    const hemelvaart = addDays(paas, 39)
    const pinksterMaandag = addDays(paas, 50)
    const vaste = [
      [1, 1], // Nieuwjaarsdag (NL/BE/TARGET)
      [5, 1], // Dag v.d. Arbeid (BE/TARGET) — geen NL feestdag
      [4, 27], // Koningsdag (NL) — als zo: 26
      [7, 21], // Nationale feestdag (BE)
      [8, 15], // O.L.V. Hemelvaart (BE)
      [11, 1], // Allerheiligen (BE)
      [11, 11], // Wapenstilstand (BE)
      [12, 25], // Eerste Kerstdag (NL/BE/TARGET)
      [12, 26], // Tweede Kerstdag (NL/TARGET)
    ]
    for (const [m, d] of vaste) {
      let dt = new Date(Date.UTC(y, m - 1, d))
      // Koningsdag valt op 26 april als 27 april op zondag valt.
      if (m === 4 && d === 27 && dt.getUTCDay() === 0) dt = addDays(dt, -1)
      set.add(isoDate(dt))
    }
    set.add(isoDate(goedeVrijdag))
    set.add(isoDate(paas))
    set.add(isoDate(paasmaandag))
    set.add(isoDate(hemelvaart))
    set.add(isoDate(pinksterMaandag))
  }
  return set
}

// Set met alle feestdagen die we tegen kunnen komen in de dataset
// (historie + snapshot-jaar). Wordt eenmalig opgebouwd.
const FEESTDAGEN = bouwFeestdagSet([
  today.getUTCFullYear() - 2,
  today.getUTCFullYear() - 1,
  today.getUTCFullYear(),
  today.getUTCFullYear() + 1,
])

// Voor een betaaldatum: geeft de werkdag direct vóór de non-werkdag-reeks
// die er direct aan voorafging — of null als er geen non-werkdag-reeks
// vóór deze datum lag (= geen feestdag/weekend tussen voorgaande werkdag
// en deze datum). Conceptueel: "de laatste dag waarop de klant zou kunnen
// hebben betalen als ze had gewild voordat het systeem stilstond".
//
// Voorbeelden:
//   - vrijdag na Hemelvaartsdag → woensdag (do = Hemelvaart, wo = werkdag)
//   - dinsdag na Pasen → donderdag (ma=Paasma, zo+za=weekend, vr=Goede Vrijdag, do=werkdag)
//   - maandag na een normaal weekend → vrijdag (zo+za=weekend, vr=werkdag)
//   - donderdag na een gewone woensdag → null (geen non-werkdag tussen)
//
// Max 7 dagen terug; meer is een te lange klantvakantie en geen
// systeem-effect, dus dan corrigeren we niet.
function werkdagVoorReeks(isoDatum) {
  let cursor = new Date(isoDatum)
  let nonWerkdagen = 0
  for (let i = 0; i < 7; i++) {
    const vorige = addDays(cursor, -1)
    const dow = vorige.getUTCDay()
    const isWeekend = dow === 0 || dow === 6
    const isFeestdag = FEESTDAGEN.has(isoDate(vorige))
    if (!isWeekend && !isFeestdag) {
      // Vorige is een werkdag. Als er een reeks non-werkdagen direct
      // voorafging aan onze input, geef die werkdag terug. Anders null.
      return nonWerkdagen > 0 ? isoDate(vorige) : null
    }
    nonWerkdagen++
    cursor = vorige
  }
  return null
}

// ----- pattern-detectie -----------------------------------------------------

// Berekent de beste week- en maanddag-fit over een set datums, plus
// hoeveelheid hits en totale n. Past beslisregel toe en geeft één
// gekozen "dag" terug — of null als geen drempel wordt gehaald.
function bepaalDagUitDatums(uniqueDates) {
  const n = uniqueDates.length
  if (n === 0) return null

  const dowLabels = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag']

  // Weekdag-fit
  const dowCount = new Array(7).fill(0)
  for (const d of uniqueDates) dowCount[new Date(d).getUTCDay()]++
  let bestDow = 0
  for (let i = 1; i < 7; i++) if (dowCount[i] > dowCount[bestDow]) bestDow = i
  const weekHits = dowCount[bestDow]
  const weekFit = weekHits / n

  // Maanddag-fit (±1 marge)
  let bestMonthDay = 1
  let bestMonthHits = 0
  for (let center = 1; center <= 31; center++) {
    let hits = 0
    for (const d of uniqueDates) {
      const day = new Date(d).getUTCDate()
      if (Math.min(Math.abs(day - center), 30 - Math.abs(day - center)) <= 1) hits++
    }
    if (hits > bestMonthHits) {
      bestMonthHits = hits
      bestMonthDay = center
    }
  }
  const monthFit = bestMonthHits / n

  // Beste van de twee (= hoogste fit)
  const weekCand = {
    type: 'wekelijks',
    waarde: `elke ${dowLabels[bestDow]}`,
    dag_index: bestDow,
    dag_label: dowLabels[bestDow],
    hits: weekHits,
    fit: weekFit,
  }
  const monthCand = {
    type: 'maanddag',
    waarde: `rond de ${bestMonthDay}e van de maand`,
    dag_index: bestMonthDay,
    dag_label: `de ${bestMonthDay}e`,
    hits: bestMonthHits,
    fit: monthFit,
  }
  const best = weekFit >= monthFit ? weekCand : monthCand

  // Beslisregel
  const rule_a = best.hits >= STANDAARD_BETAALDAG_MIN_HITS && best.fit >= STANDAARD_BETAALDAG_MIN_FIT
  const rule_b = best.hits >= STANDAARD_BETAALDAG_PERFECT_MIN_HITS && best.fit === 1
  if (!rule_a && !rule_b) return { ...best, n, passes: false }
  return { ...best, n, passes: true }
}

function detectPattern(paymentDates) {
  const baseMeta = {
    bron: 'fysieke_betalingen',
    venster_maanden: STANDAARD_BETAALDAG_VENSTER_MAANDEN,
    nieuw_venster_dagen: STANDAARD_BETAALDAG_NIEUW_VENSTER_DAGEN,
    min_hits: STANDAARD_BETAALDAG_MIN_HITS,
    min_fit_pct: Math.round(STANDAARD_BETAALDAG_MIN_FIT * 100),
    perfect_min_hits: STANDAARD_BETAALDAG_PERFECT_MIN_HITS,
    feestdag_correctie: true,
  }

  // Filter op 12-mnd venster (geen correctie hier — die past selectief
  // verderop op basis van de rauwe dominante dag).
  const windowCutoff = today.getTime() - STANDAARD_BETAALDAG_VENSTER_MAANDEN * 30.44 * oneDay
  const inWindowRaw = [
    ...new Set(paymentDates.filter((d) => new Date(d).getTime() >= windowCutoff)),
  ].sort()
  const nTotaal = inWindowRaw.length

  if (nTotaal === 0) {
    return {
      pattern_type: 'geen',
      pattern_value: null,
      fit_pct: 0,
      hits: 0,
      payments_observed: 0,
      confidence: 'geen',
      ...baseMeta,
      explanation: `Geen fysieke betalingen in de laatste ${STANDAARD_BETAALDAG_VENSTER_MAANDEN} maanden.`,
    }
  }

  // Twee-passes feestdag-correctie: bepaal eerst de dominante dag op
  // rauwe data, schuif daarna alleen betalingen waarvan de "werkdag voor
  // de non-werkdag-reeks" overeenkomt met die dominante dag. Anders zou
  // een dinsdag-betaler haar dinsdag-na-Pasen onterecht naar donderdag
  // herclassificeerd zien.
  const correctieFor = (rawDates) => {
    const pass1 = bepaalDagUitDatums(rawDates)
    if (!pass1?.passes) {
      // Geen dominante dag → geen correctie zinvol. Pass 3 = pass 1.
      return { dag: pass1, n_gecorrigeerd: 0 }
    }
    let n_gecorrigeerd = 0
    const gecorrigeerd = rawDates.map((d) => {
      const werkdag = werkdagVoorReeks(d)
      if (werkdag === null) return d
      // Match-check tegen pass1-dag
      let matches = false
      if (pass1.type === 'wekelijks') {
        matches = new Date(werkdag).getUTCDay() === pass1.dag_index
      } else if (pass1.type === 'maanddag') {
        const wDay = new Date(werkdag).getUTCDate()
        const center = pass1.dag_index
        matches = Math.min(Math.abs(wDay - center), 30 - Math.abs(wDay - center)) <= 1
      }
      if (!matches) return d
      n_gecorrigeerd++
      return werkdag
    })
    // Pass 3: dedupliceer opnieuw (correcties kunnen dupes opleveren) en bepaal definitieve dag
    const uniekGecorrigeerd = [...new Set(gecorrigeerd)].sort()
    return { dag: bepaalDagUitDatums(uniekGecorrigeerd), n_gecorrigeerd }
  }

  // Splits in oud (maand 12 t/m 4) en nieuw (laatste 3 mnd) venster.
  const recencyCutoff = today.getTime() - STANDAARD_BETAALDAG_NIEUW_VENSTER_DAGEN * oneDay
  const oudRaw = inWindowRaw.filter((d) => new Date(d).getTime() < recencyCutoff)
  const nieuwRaw = inWindowRaw.filter((d) => new Date(d).getTime() >= recencyCutoff)

  const { dag: dagFull, n_gecorrigeerd: nGecorrigeerd } = correctieFor(inWindowRaw)
  const { dag: dagOud } = correctieFor(oudRaw)
  const { dag: dagNieuw } = correctieFor(nieuwRaw)

  // Patroon-verschuiving: beide periodes hebben zelfstandig een dag, maar
  // op verschillende dagen. Schakel automatisch over op het nieuwe patroon.
  const isShift =
    dagOud?.passes &&
    dagNieuw?.passes &&
    (dagOud.type !== dagNieuw.type ||
      dagOud.dag_index !== dagNieuw.dag_index)

  const actief = isShift ? dagNieuw : dagFull

  const verschuiving = isShift
    ? {
        van_type: dagOud.type,
        van_waarde: dagOud.waarde,
        van_fit_pct: Math.round(dagOud.fit * 100),
        van_hits: dagOud.hits,
        van_n: dagOud.n,
        naar_type: dagNieuw.type,
        naar_waarde: dagNieuw.waarde,
        naar_fit_pct: Math.round(dagNieuw.fit * 100),
        naar_hits: dagNieuw.hits,
        naar_n: dagNieuw.n,
        sinds_dagen: STANDAARD_BETAALDAG_NIEUW_VENSTER_DAGEN,
      }
    : null

  const fullMeta = {
    payments_observed: actief?.n ?? nTotaal,
    payments_observed_totaal: nTotaal,
    feestdag_correcties_toegepast: nGecorrigeerd,
    ...baseMeta,
    verschuiving,
  }

  if (!actief || !actief.passes) {
    const reden =
      nTotaal < STANDAARD_BETAALDAG_MIN_HITS
        ? `Te weinig betalingen (${nTotaal}) — minimaal ${STANDAARD_BETAALDAG_MIN_HITS} hits op één dag nodig.`
        : `Sterkste optie (${actief?.waarde ?? 'n.v.t.'}) haalt ${actief ? actief.hits : 0} hits op ${actief ? Math.round(actief.fit * 100) : 0}% — onvoldoende voor een betrouwbare dag.`
    return {
      pattern_type: 'geen',
      pattern_value: null,
      fit_pct: actief ? Math.round(actief.fit * 100) : 0,
      hits: actief?.hits ?? 0,
      confidence: 'geen',
      ...fullMeta,
      explanation: `Geen standaard betaaldag. ${reden}`,
    }
  }

  const baseExplanation = `${actief.waarde} — ${actief.hits} van ${actief.n} betalingen (${Math.round(actief.fit * 100)}%) volgen dit patroon.`
  const shiftSuffix = isShift
    ? ` Patroon is recent gewijzigd (was ${dagOud.waarde}, nu ${dagNieuw.waarde}); flow gebruikt het nieuwe patroon.`
    : ''

  return {
    pattern_type: actief.type,
    pattern_value: actief.waarde,
    fit_pct: Math.round(actief.fit * 100),
    hits: actief.hits,
    confidence: 'hoog',
    ...fullMeta,
    explanation: baseExplanation + shiftSuffix,
  }
}

// Verzamelt alle betaaldata voor één debiteur uit z'n factuur-historie.
function collectPaymentDates(facturenList) {
  const dates = []
  for (const f of facturenList) {
    for (const p of f.payments || []) if (p.date) dates.push(p.date)
  }
  return dates
}

// Berekent intervallen tussen opeenvolgende unieke betaaldata (in dagen).
// Dedupliceert eerst, want deelbetalingen op dezelfde dag zijn één betaalmoment.
// Optioneel filter sinceMs (ms-epoch) houdt alleen betaaldata vanaf die datum.
function paymentIntervals(facturenList, sinceMs = null) {
  let dates = [...new Set(collectPaymentDates(facturenList))].sort()
  if (sinceMs !== null) {
    dates = dates.filter((d) => new Date(d).getTime() >= sinceMs)
  }
  const intervals = []
  for (let i = 1; i < dates.length; i++) intervals.push(daysBetween(dates[i], dates[i - 1]))
  return intervals
}

// Minimum aantal facturen per maand om die maand mee te tellen in de
// DSO-trendlijn. Onder deze drempel is één enkele factuur (vaak een
// dispuut of incidentele kwijtschelding) zo dominant dat het maandcijfer
// niets meer zegt over het structurele betaalgedrag. In productie worden
// disputen apart gelabeld en gefilterd; tot die tijd vangt deze drempel
// het scenario af.
const TREND_MIN_FACTUREN_PER_MAAND = 3

// Bouwt een maandelijkse DSO-tijdreeks. Per maand wordt de mediaan
// dagen-te-laat genomen (robuust tegen één extreem late betaling die
// het gemiddelde scheef zou trekken). Maanden met minder dan
// TREND_MIN_FACTUREN_PER_MAAND betaalde facturen worden overgeslagen
// zodat eenmalige uitschieters niet als trend gelezen worden.
// Retourneert ook de samples per maand zodat verbruikers (UI, audit)
// kunnen tonen waarop het cijfer is gebaseerd.
function monthlyDsoSeries(paidFacturen) {
  const byMonth = new Map()
  for (const f of paidFacturen) {
    if (!f.Duedate || !f.payments?.length) continue
    const lastPay = f.payments.reduce((max, p) => (p.date > max ? p.date : max), '')
    if (!lastPay) continue
    const daysLate = daysBetween(lastPay, f.Duedate)
    const month = lastPay.slice(0, 7) // 'YYYY-MM'
    if (!byMonth.has(month)) byMonth.set(month, [])
    byMonth.get(month).push(daysLate)
  }
  const alleMaanden = [...byMonth.keys()].sort()
  const maandenGenoegFacturen = alleMaanden.filter(
    (m) => byMonth.get(m).length >= TREND_MIN_FACTUREN_PER_MAAND,
  )
  const median = (arr) => {
    const s = [...arr].sort((a, b) => a - b)
    const mid = Math.floor(s.length / 2)
    return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid]
  }
  return {
    months: maandenGenoegFacturen,
    values: maandenGenoegFacturen.map((m) => median(byMonth.get(m))),
    counts: maandenGenoegFacturen.map((m) => byMonth.get(m).length),
    maanden_overgeslagen: alleMaanden.length - maandenGenoegFacturen.length,
    min_facturen_per_maand: TREND_MIN_FACTUREN_PER_MAAND,
    methode: 'mediaan_per_maand',
  }
}

// ----- inladen ---------------------------------------------------------------

console.log('Inlezen bestanden...')
const debData = JSON.parse(fs.readFileSync(DEB_FILE, 'utf8'))
const postsData = JSON.parse(fs.readFileSync(POSTS_FILE, 'utf8'))

const debByNr = new Map(debData.debtors.map((d) => [d.Debtornumber, d]))

// Splits posts: alleen records met type 'Factuur' zijn echte facturen.
// (Type 'Betaling' / 'Terugbetaling' zijn losse boekstukken; betalingen zelf
//  zitten al genest in factuur.payments.)
const allFacturen = postsData.invoices.filter((i) => i['Invoicetype/Documenttype'] === 'Factuur')

// ----- aggregaties globaal ---------------------------------------------------

// Open posten: zowel facturen met restbedrag (> 0) als creditnota's die nog
// niet zijn verrekend (< 0). Beide tellen mee voor het netto openstaand
// saldo en kunnen als ze vervallen zijn in een taak terechtkomen.
const openFacturenAll = allFacturen.filter((f) => num(f['Balance amount']) !== 0)
const totalOpenAR = openFacturenAll.reduce((s, f) => s + num(f['Balance amount']), 0)
// Netto-jaaromzet: ex BTW, creditnota's netto afgetrokken (geen Math.max meer).
// Per factuur: Invoice amount − VAT amount invoice. Geldt voor zowel totaal als
// per-debiteur omzet, zodat het aandeel onderling sluit.
const yearlyOmzetTotal = allFacturen.reduce(
  (s, f) => s + (num(f['Invoice amount']) - num(f['VAT amount invoice'])),
  0,
)

console.log(`  ${allFacturen.length} facturen, ${openFacturenAll.length} open`)
console.log(`  Totale openstaande AR: ${formatEUR(totalOpenAR)}`)
console.log(`  Netto jaar-omzet (ex BTW): ${formatEUR(yearlyOmzetTotal)}`)

// ----- per debiteur ----------------------------------------------------------

const byDeb = new Map()
for (const f of allFacturen) {
  const k = f.Debtornumber
  if (!byDeb.has(k)) byDeb.set(k, { facturen: [], openFacturen: [] })
  const e = byDeb.get(k)
  e.facturen.push(f)
  if (num(f['Balance amount']) !== 0) e.openFacturen.push(f)
}

// Fysieke betaaldata per debiteur — uit records met Invoicetype/Documenttype
// in {Betaling, Terugbetaling, leeg}. Dit zijn de echte cashbewegingen, los
// van interne reconciliaties (creditnota's wegstrepen tegen facturen op
// boekhouddagen). Gebruikt door detectPattern voor de standaard-betaaldag.
const fysiekeBetaaldataByDeb = new Map()
for (const i of postsData.invoices) {
  const docType = i['Invoicetype/Documenttype']
  if (docType === 'Factuur') continue
  const nr = i.Debtornumber
  for (const p of i.payments || []) {
    if (!p.date) continue
    if (!fysiekeBetaaldataByDeb.has(nr)) fysiekeBetaaldataByDeb.set(nr, [])
    fysiekeBetaaldataByDeb.get(nr).push(p.date)
  }
}

// Netto-omzet per debiteur (ex BTW, creditnota's netto). Voor de
// omzetconcentratie-score gebruiken we percentielen over deze populatie
// (alle debiteuren met omzet > 0 in deze administratie), zodat de schaal
// zichzelf kalibreert naar de feitelijke verdeling.
const netOmzetPerDeb = new Map()
for (const [k, e] of byDeb.entries()) {
  const netOmzet = e.facturen.reduce(
    (s, f) => s + (num(f['Invoice amount']) - num(f['VAT amount invoice'])),
    0,
  )
  netOmzetPerDeb.set(k, netOmzet)
}
const omzetPopulatie = [...netOmzetPerDeb.values()].filter((v) => v > 0).sort((a, b) => a - b)
function percentile(arr, p) {
  if (arr.length === 0) return 0
  const idx = Math.floor((p / 100) * (arr.length - 1))
  return arr[idx]
}
const OMZET_P20 = percentile(omzetPopulatie, 20)
const OMZET_P40 = percentile(omzetPopulatie, 40)
const OMZET_P60 = percentile(omzetPopulatie, 60)
const OMZET_P80 = percentile(omzetPopulatie, 80)
console.log(
  `  Omzet-percentielen netto (P20/P40/P60/P80): ${formatEUR(OMZET_P20)} / ${formatEUR(OMZET_P40)} / ${formatEUR(OMZET_P60)} / ${formatEUR(OMZET_P80)}`,
)

// Aantal debiteuren per quintiel (voor de PercentilesBar-visualisatie in
// de UI, parallel aan bedrag_buckets).
const omzetBucketCounts = [0, 0, 0, 0, 0]
for (const v of omzetPopulatie) {
  if (v < OMZET_P20) omzetBucketCounts[0]++
  else if (v < OMZET_P40) omzetBucketCounts[1]++
  else if (v < OMZET_P60) omzetBucketCounts[2]++
  else if (v < OMZET_P80) omzetBucketCounts[3]++
  else omzetBucketCounts[4]++
}
const omzetBuckets = {
  thresholds: [
    round(OMZET_P20, 2),
    round(OMZET_P40, 2),
    round(OMZET_P60, 2),
    round(OMZET_P80, 2),
  ],
  counts: omzetBucketCounts,
  min: round(omzetPopulatie[0] ?? 0, 2),
  max: round(omzetPopulatie[omzetPopulatie.length - 1] ?? 0, 2),
}

// Krediet (onverzekerd) per debiteur. Bron: CreditInformationCreditlimit
// als gedekt/veilig deel; onverzekerd = max(0, openstaand - limiet). Voor
// debiteuren zonder openstaand bedrag blijft de krediet-score null (n.v.t.).
// Percentielen worden bepaald over de populatie met onverzekerd > 0, zodat
// "impact bij wanbetaling" een zelf-kalibrerende quintiel-score wordt.
const onverzekerdPerDeb = new Map()
for (const [k, e] of byDeb.entries()) {
  const openstaand = e.openFacturen.reduce((s, f) => s + num(f['Balance amount']), 0)
  const debInfo = debByNr.get(k)
  const limiet = debInfo ? num(debInfo.CreditInformationCreditlimit) : 0
  const onverzekerd = openstaand > 0 ? Math.max(0, openstaand - limiet) : 0
  onverzekerdPerDeb.set(k, { openstaand, limiet, onverzekerd })
}
const kredietPopulatie = [...onverzekerdPerDeb.values()]
  .filter((v) => v.onverzekerd > 0)
  .map((v) => v.onverzekerd)
  .sort((a, b) => a - b)
const KRED_P20 = percentile(kredietPopulatie, 20)
const KRED_P40 = percentile(kredietPopulatie, 40)
const KRED_P60 = percentile(kredietPopulatie, 60)
const KRED_P80 = percentile(kredietPopulatie, 80)
console.log(
  `  Krediet-percentielen onverzekerd (P20/P40/P60/P80): ${formatEUR(KRED_P20)} / ${formatEUR(KRED_P40)} / ${formatEUR(KRED_P60)} / ${formatEUR(KRED_P80)}`,
)
const kredietBucketCounts = [0, 0, 0, 0, 0]
for (const v of kredietPopulatie) {
  if (v < KRED_P20) kredietBucketCounts[0]++
  else if (v < KRED_P40) kredietBucketCounts[1]++
  else if (v < KRED_P60) kredietBucketCounts[2]++
  else if (v < KRED_P80) kredietBucketCounts[3]++
  else kredietBucketCounts[4]++
}
const kredietBuckets = {
  thresholds: [
    round(KRED_P20, 2),
    round(KRED_P40, 2),
    round(KRED_P60, 2),
    round(KRED_P80, 2),
  ],
  counts: kredietBucketCounts,
  min: round(kredietPopulatie[0] ?? 0, 2),
  max: round(kredietPopulatie[kredietPopulatie.length - 1] ?? 0, 2),
}

// ----- potentieel-populatie (DSO-impact in euro-dagen) ---------------------
//
// "Hoeveel sneller kan deze klant betalen?" meet de hoeveelheid DSO-winst
// die je vrijspeelt als deze klant op afspraak gaat betalen, in euro-dagen
// (= beïnvloedbare termijn × openstaand bedrag).
//
// Populatie = alle debiteuren met vervallen debet-saldo (= de takenlijst).
// Klanten zonder vervallen debet komen niet in de takenlijst en hebben dus
// geen potentieel-score nodig.
//
// Hybride scoring: dsoImpact = 0 → score 1 (geen actie zinvol — betaalt
// al binnen de haalbaarheidsdrempel). dsoImpact > 0 → kwartielen P25/P50/P75
// over die deelpopulatie → score 2/3/4/5. Score 5 vangt de echte
// cash-conversion-cycle-winst.

const median = (vals) => {
  if (!vals.length) return null
  const sorted = [...vals].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

// Pre-bereken per debiteur de termDiff + dsoImpact, om de drempels te
// kunnen leggen vóórdat debiteurScores per taak wordt aangeroepen.
const potentieelPerDeb = new Map()
for (const [k, e] of byDeb.entries()) {
  const totalOpenNet = e.openFacturen.reduce((s, f) => s + num(f['Balance amount']), 0)
  if (totalOpenNet <= 0) continue
  const hasOverdueDebet = e.openFacturen.some(
    (f) => f.Duedate && new Date(f.Duedate) < today && num(f['Balance amount']) > 0,
  )
  const agreedTerms = e.facturen
    .filter((f) => f.Invoicedate && f.Duedate)
    .map((f) => daysBetween(f.Duedate, f.Invoicedate))
    .filter((d) => d >= 0 && d <= 365)
  const paidFacs = e.facturen.filter(
    (f) =>
      f.payments &&
      f.payments.length > 0 &&
      num(f['Balance amount']) === 0 &&
      f.Duedate &&
      f.Invoicedate,
  )
  const actualTerms = paidFacs
    .map((f) => {
      const lastPay = f.payments.reduce((max, p) => (p.date > max ? p.date : max), '')
      return daysBetween(lastPay, f.Invoicedate)
    })
    .filter((d) => d >= 0 && d <= 730)
  const medianAgreed = agreedTerms.length ? Math.round(median(agreedTerms)) : 30
  const medianActual = actualTerms.length ? Math.round(median(actualTerms)) : medianAgreed
  const termDiff = medianActual - medianAgreed
  const beinvloedbareDagen = Math.max(0, termDiff - DSO_HAALBAARHEIDSDREMPEL_DAGEN)
  const dsoImpact = beinvloedbareDagen * totalOpenNet
  potentieelPerDeb.set(k, {
    medianAgreed,
    medianActual,
    termDiff,
    totalOpenNet,
    hasOverdueDebet,
    beinvloedbareDagen,
    dsoImpact,
    paidCount: paidFacs.length,
  })
}

// Kwartielen op dsoImpact > 0, alleen over debiteuren met vervallen debet
// (= populatie B / de takenlijst). Anderen zijn niet relevant voor scoring.
const potentieelPopulatie = [...potentieelPerDeb.values()]
  .filter((d) => d.hasOverdueDebet && d.dsoImpact > 0)
  .map((d) => d.dsoImpact)
  .sort((a, b) => a - b)

function quartile(arr, q) {
  if (arr.length === 0) return 0
  return arr[Math.floor(q * (arr.length - 1))]
}
const POT_P25 = quartile(potentieelPopulatie, 0.25)
const POT_P50 = quartile(potentieelPopulatie, 0.5)
const POT_P75 = quartile(potentieelPopulatie, 0.75)
console.log(
  `  Potentieel-drempels DSO-impact (P25/P50/P75): ${Math.round(POT_P25).toLocaleString('nl-NL')} / ${Math.round(POT_P50).toLocaleString('nl-NL')} / ${Math.round(POT_P75).toLocaleString('nl-NL')} euro-dagen`,
)

// Score-toekenning en bucket-counts (populatie B = alleen vervallen-debet).
function potentieelScoreFor(dsoImpact) {
  if (dsoImpact <= 0) return 1
  if (dsoImpact < POT_P25) return 2
  if (dsoImpact < POT_P50) return 3
  if (dsoImpact < POT_P75) return 4
  return 5
}
const potBucketCounts = [0, 0, 0, 0, 0]
let potPopulatieB = 0
let potGeenHistorie = 0
for (const d of potentieelPerDeb.values()) {
  if (!d.hasOverdueDebet) continue
  // Debiteuren zonder enkele volledig betaalde factuur tellen niet mee in
  // de buckets — we kunnen ze niet eerlijk indelen op DSO-impact want we
  // weten hun werkelijke betaaltermijn niet.
  if (d.paidCount === 0) {
    potGeenHistorie++
    continue
  }
  potPopulatieB++
  potBucketCounts[potentieelScoreFor(d.dsoImpact) - 1]++
}
const potentieelBuckets = {
  thresholds: [0, round(POT_P25, 0), round(POT_P50, 0), round(POT_P75, 0)],
  counts: potBucketCounts,
  min: round(potentieelPopulatie[0] ?? 0, 0),
  max: round(potentieelPopulatie[potentieelPopulatie.length - 1] ?? 0, 0),
  populatie_debiteuren: potPopulatieB,
  geen_betaalhistorie: potGeenHistorie,
  haalbaarheidsdrempel_dagen: DSO_HAALBAARHEIDSDREMPEL_DAGEN,
}

function debiteurScores(debNr) {
  const e = byDeb.get(debNr)
  if (!e) return null

  // Vervallen posten — pre-bereken oudste-vervallen-dagen omdat de DSO-score
  // hierop terugvalt wanneer er geen betaalhistorie beschikbaar is.
  const totalOpen = e.openFacturen.reduce((s, f) => s + num(f['Balance amount']), 0)
  const overdue = e.openFacturen.filter((f) => f.Duedate && new Date(f.Duedate) < today)
  const overdueSum = overdue.reduce((s, f) => s + num(f['Balance amount']), 0)
  const pctOverdue = totalOpen > 0 ? overdueSum / totalOpen : 0
  // Oudste-vervallen-leeftijd alleen over vervallen DEBET-posten (Balance > 0).
  // Vervallen creditnota's mogen deze leeftijd niet bepalen — het is geld dat
  // wij terug moeten geven, geen schuld die binnengehaald moet worden.
  let oldestDays = 0
  for (const f of overdue) {
    if (num(f['Balance amount']) <= 0) continue
    const d = daysBetween(today, f.Duedate)
    if (d > oldestDays) oldestDays = d
  }

  // DSO — mediaan dagen-te-laat op volledig betaalde facturen.
  // Alle betaalde facturen blijven beschikbaar voor andere berekeningen
  // (trend, omzet, termijnen). Voor de DSO-mediaan zelf kijken we alleen
  // naar facturen die in het 12-maands venster zijn afgerond, zodat oud
  // gedrag een verbeterende debiteur niet eeuwig achtervolgt.
  const paid = e.facturen.filter(
    (f) => f.payments && f.payments.length > 0 && num(f['Balance amount']) === 0 && f.Duedate,
  )
  const recentWindowStartMs =
    new Date(SNAPSHOT).getTime() - BETAALGEDRAG_WINDOW_DAYS * 86400000
  const dsoVals = []
  for (const f of paid) {
    const lastPay = f.payments.reduce((max, p) => (p.date > max ? p.date : max), '')
    if (!lastPay) continue
    if (new Date(lastPay).getTime() < recentWindowStartMs) continue
    dsoVals.push(daysBetween(lastPay, f.Duedate))
  }
  // Mediaan i.p.v. gemiddelde: robuuster tegen uitschieters (één factuur die
  // 500 dagen later betaald werd trekt het gemiddelde scheef).
  let medianDaysLate = 0
  if (dsoVals.length) {
    const sortedVals = [...dsoVals].sort((a, b) => a - b)
    const mid = Math.floor(sortedVals.length / 2)
    medianDaysLate =
      sortedVals.length % 2 === 0 ? (sortedVals[mid - 1] + sortedVals[mid]) / 2 : sortedVals[mid]
  }

  // DSO-score met edge-case-regel:
  // Wanneer er geen betaalhistorie is in het 12-maands venster (dsoVals leeg)
  // en er staat tenminste één vervallen post open, zou de gewone mediaan
  // (default 0) ten onrechte score 1 ("op tijd") opleveren. We vallen terug
  // op de leeftijd van de oudste vervallen post: ≤ 5 dagen geeft een
  // grace-period score 2, > 5 dagen springt direct naar 5 (rood vlaggetje).
  let dsoScore
  let dsoFromOverdue = false
  if (dsoVals.length === 0 && oldestDays > 0) {
    dsoScore = oldestDays <= 5 ? 2 : 5
    dsoFromOverdue = true
  } else if (medianDaysLate <= 0) dsoScore = 1
  else if (medianDaysLate <= 7) dsoScore = 2
  else if (medianDaysLate <= 21) dsoScore = 3
  else if (medianDaysLate <= 45) dsoScore = 4
  else dsoScore = 5

  // ---- AI-sub-parameter: trend (Mann-Kendall over maandelijkse DSO) -------
  const monthly = monthlyDsoSeries(paid)
  const mk = mannKendall(monthly.values)
  let trendConfidence = 'geen'
  if (mk.n >= 9 && mk.pValue < 0.05) trendConfidence = 'hoog'
  else if (mk.n >= 6 && mk.pValue < 0.15) trendConfidence = 'middel'

  let trendScore = null,
    trendLabel = 'onbekend',
    trendExplanation = ''
  if (trendConfidence === 'geen') {
    trendExplanation =
      mk.n < 6
        ? `Te weinig maanden met betaalactiviteit (${mk.n}) voor trendanalyse.`
        : `Geen significante trend gevonden (p=${round(mk.pValue, 2)} over ${mk.n} maanden).`
    trendLabel = mk.n < 6 ? 'onbekend' : 'stabiel'
  } else {
    // Positief tau = stijgende DSO = verslechterend betaalgedrag
    if (mk.tau >= 0.4) {
      trendScore = 5
      trendLabel = 'sterk verslechterend'
    } else if (mk.tau >= 0.2) {
      trendScore = 4
      trendLabel = 'verslechterend'
    } else if (mk.tau > -0.2) {
      trendScore = 3
      trendLabel = 'stabiel'
    } else if (mk.tau > -0.4) {
      trendScore = 2
      trendLabel = 'verbeterend'
    } else {
      trendScore = 1
      trendLabel = 'sterk verbeterend'
    }
    trendExplanation = `${trendLabel} (Kendall τ=${round(mk.tau, 2)}, p=${round(mk.pValue, 2)} over ${mk.n} maanden).`
  }

  // ---- AI-sub-parameter: volatiliteit (CV op betaalintervallen) -----------
  // Beperkt tot de afgelopen 12 maanden, identiek aan de DSO-mediaan: een
  // debiteur die zijn gedrag heeft veranderd mag dat ook terugzien in de
  // score. De VolatilityDotStrip-visualisatie toont dezelfde periode.
  const intervals = paymentIntervals(e.facturen, recentWindowStartMs)
  const cv = coefficientOfVariation(intervals)
  let volatiliteitConfidence
  if (intervals.length >= 10) volatiliteitConfidence = 'hoog'
  else if (intervals.length >= 5) volatiliteitConfidence = 'middel'
  else volatiliteitConfidence = 'geen'

  let volatiliteitScore = null,
    volatiliteitLabel = 'onbekend',
    volatiliteitExplanation = ''
  if (volatiliteitConfidence === 'geen') {
    volatiliteitExplanation = `Te weinig betaalintervallen (${intervals.length}) in de afgelopen 12 maanden om voorspelbaarheid te bepalen.`
  } else {
    if (cv < 0.3) {
      volatiliteitScore = 1
      volatiliteitLabel = 'zeer regelmatig'
    } else if (cv < 0.6) {
      volatiliteitScore = 2
      volatiliteitLabel = 'regelmatig'
    } else if (cv < 1.0) {
      volatiliteitScore = 3
      volatiliteitLabel = 'wisselend'
    } else if (cv < 1.5) {
      volatiliteitScore = 4
      volatiliteitLabel = 'onregelmatig'
    } else {
      volatiliteitScore = 5
      volatiliteitLabel = 'zeer grillig'
    }
    volatiliteitExplanation = `${volatiliteitLabel} (CV=${round(cv, 2)} over ${intervals.length} betaalintervallen in de afgelopen 12 maanden).`
  }

  // ---- AI-sub-parameter: standaard betaaldag pattern ----------------------
  // Op fysieke betalingen (Betaling/Terugbetaling/leeg-records), niet op
  // Factuur.payments — die laatste bevat interne reconciliaties die geen
  // klantgedrag zijn.
  const fysiekeBetaaldata = fysiekeBetaaldataByDeb.get(debNr) ?? []
  const pattern = detectPattern(fysiekeBetaaldata)

  // ---- Aggregaat betaalgedrag --------------------------------------------
  // Gemiddelde van beschikbare sub-scores: DSO altijd, trend + volatiliteit
  // alleen wanneer confidence != 'geen'. Wanbetaler-voorspelling wordt
  // overgeslagen (fase 3).
  const subScores = [dsoScore]
  if (trendScore !== null) subScores.push(trendScore)
  if (volatiliteitScore !== null) subScores.push(volatiliteitScore)
  const betaalgedrag = subScores.reduce((a, b) => a + b, 0) / subScores.length

  // Huidige stand — gemiddelde van twee sub-scores volgens risicoscore-spec:
  //   1. % vervallen (hoe groot is het probleem nu)
  //   2. Leeftijd oudste post (hoe lang sleept het al)
  // totalOpen/overdueSum/pctOverdue/oldestDays zijn al berekend boven (nodig
  // voor de DSO-edge-case op debiteuren zonder betaalhistorie).

  // Sub-score 1: % vervallen → 1-5
  const pctOverduePerc = pctOverdue * 100
  let pctOverdueScore
  if (pctOverduePerc <= 10) pctOverdueScore = 1
  else if (pctOverduePerc <= 25) pctOverdueScore = 2
  else if (pctOverduePerc <= 50) pctOverdueScore = 3
  else if (pctOverduePerc <= 75) pctOverdueScore = 4
  else pctOverdueScore = 5

  // Sub-score 2: leeftijd oudste post → 1-5
  let oldestDaysScore
  if (oldestDays <= 15) oldestDaysScore = 1
  else if (oldestDays <= 30) oldestDaysScore = 2
  else if (oldestDays <= 60) oldestDaysScore = 3
  else if (oldestDays <= 90) oldestDaysScore = 4
  else oldestDaysScore = 5

  const huidigeStand = (pctOverdueScore + oldestDaysScore) / 2

  // Omzetconcentratie — debiteur-aandeel in jaar-omzet (netto, ex BTW).
  // Score is een quintiel binnen de scope-populatie (zelf-kalibrerend).
  const debiteurOmzet = netOmzetPerDeb.get(debNr) ?? 0
  const pctOmzet = yearlyOmzetTotal > 0 ? debiteurOmzet / yearlyOmzetTotal : 0
  let omzetconcentratie
  if (debiteurOmzet < OMZET_P20) omzetconcentratie = 1
  else if (debiteurOmzet < OMZET_P40) omzetconcentratie = 2
  else if (debiteurOmzet < OMZET_P60) omzetconcentratie = 3
  else if (debiteurOmzet < OMZET_P80) omzetconcentratie = 4
  else omzetconcentratie = 5

  // Werkelijke vs afgesproken termijn + DSO-impact zijn al pre-berekend
  // in `potentieelPerDeb` (we hadden de drempels nodig vóórdat we de score
  // per debiteur kunnen toekennen). Hier alleen de score-toekenning.
  // Bij nul historische betalingen kunnen we de werkelijke termijn niet
  // weten; dan vallen alle afgeleide velden op null en is de score zelf
  // ook null (= onbekend). Voorheen werd in dat geval een vals "score 1"
  // gerapporteerd omdat de fallback medianActual = medianAgreed voor een
  // term_diff van 0 zorgde — alsof de klant netjes binnen marge betaalt
  // terwijl we daarover geen enkel bewijs hebben.
  const potData = potentieelPerDeb.get(debNr)
  const heeftBetaalhistorie = !!potData && potData.paidCount > 0
  const medianAgreed = potData?.medianAgreed ?? 30
  const medianActual = heeftBetaalhistorie ? potData.medianActual : null
  const termDiff = heeftBetaalhistorie ? potData.termDiff : null
  const beinvloedbareDagen = heeftBetaalhistorie ? potData.beinvloedbareDagen : null
  const dsoImpact = heeftBetaalhistorie ? potData.dsoImpact : null
  const potentieel = heeftBetaalhistorie ? potentieelScoreFor(dsoImpact) : null

  // Krediet — onverzekerd bedrag (openstaand − CreditInformationCreditlimit).
  // Sub 1: onverzekerd % via vaste drempels (1-5). Sub 2: onverzekerd in €
  // via percentielen over alle debiteuren met onverzekerd > 0. Composiet =
  // gemiddelde van de twee sub-scores, zelfde patroon als huidige_stand.
  // Bij totalOpen = 0 (geen openstaand bedrag) zijn beide sub-scores 1 en
  // dus krediet = 1: er is op dit moment geen kredietrisico.
  const kredietInfo = onverzekerdPerDeb.get(debNr)
  const kredietLimiet = kredietInfo?.limiet ?? 0
  const onverzekerdBedrag = kredietInfo?.onverzekerd ?? 0
  const onverzekerdPct = totalOpen > 0 ? (onverzekerdBedrag / totalOpen) * 100 : 0
  let kredietPctScore
  if (onverzekerdPct === 0) kredietPctScore = 1
  else if (onverzekerdPct <= 25) kredietPctScore = 2
  else if (onverzekerdPct <= 50) kredietPctScore = 3
  else if (onverzekerdPct <= 75) kredietPctScore = 4
  else kredietPctScore = 5
  let kredietImpactScore
  if (onverzekerdBedrag <= 0) kredietImpactScore = 1
  else if (onverzekerdBedrag < KRED_P20) kredietImpactScore = 1
  else if (onverzekerdBedrag < KRED_P40) kredietImpactScore = 2
  else if (onverzekerdBedrag < KRED_P60) kredietImpactScore = 3
  else if (onverzekerdBedrag < KRED_P80) kredietImpactScore = 4
  else kredietImpactScore = 5
  const krediet = (kredietPctScore + kredietImpactScore) / 2

  // Risico — gewogen gemiddelde over beschikbare categorieën.
  // Originele wegingen: betaalgedrag 30, huidige_stand 25, disputen 10,
  // krediet 25, omzetconcentratie 10. Disputen ontbreekt in de dummy data
  // en valt uit de noemer; krediet doet altijd mee (score 1 bij geen
  // openstaand bedrag). Noemer is dus 90.
  const risicoSubs = [
    { val: betaalgedrag, w: 30 },
    { val: huidigeStand, w: 25 },
    { val: krediet, w: 25 },
    { val: omzetconcentratie, w: 10 },
  ].filter((x) => x.val != null)
  const risicoNoemer = risicoSubs.reduce((s, x) => s + x.w, 0)
  const risicoScore = risicoSubs.reduce((s, x) => s + x.val * x.w, 0) / risicoNoemer

  return {
    betaalgedrag: round(betaalgedrag, 2),
    huidigeStand: round(huidigeStand, 2),
    huidigeStandPctScore: pctOverdueScore,
    huidigeStandOudsteScore: oldestDaysScore,
    omzetconcentratie,
    disputen: null,
    krediet: krediet != null ? round(krediet, 2) : null,
    kredietLimiet: round(kredietLimiet, 2),
    kredietOnverzekerdBedrag: round(onverzekerdBedrag, 2),
    kredietOnverzekerdPct: round(onverzekerdPct, 1),
    kredietPctScore,
    kredietImpactScore,
    risicoScore: round(risicoScore, 2),
    medianDaysLate: Math.round(medianDaysLate),
    pctOverdue: round(pctOverdue * 100, 1),
    oldestDays,
    pctOmzet: round(pctOmzet * 100, 2),
    debiteurOmzet: round(debiteurOmzet, 2),
    medianAgreed,
    medianActual,
    beinvloedbareDagen,
    dsoImpact,
    potentieel,
    dsoCount: dsoVals.length,
    paidCount: paid.length,
    totalOpen,
    overdueSum,
    // AI-sub-parameters (fase 1)
    betaalgedrag_breakdown: {
      dso: {
        score: dsoScore,
        median_days_late: Math.round(medianDaysLate),
        invoice_count: dsoVals.length,
        from_overdue: dsoFromOverdue,
        oudste_dagen_vervallen: dsoFromOverdue ? oldestDays : undefined,
      },
      trend: {
        score: trendScore,
        label: trendLabel,
        confidence: trendConfidence,
        tau: round(mk.tau, 2),
        p_value: round(mk.pValue, 3),
        months_observed: mk.n,
        explanation: trendExplanation,
        series: monthly.months.map((m, i) => ({
          month: m,
          dso: Math.round(monthly.values[i]),
          n: monthly.counts[i],
        })),
        methode: monthly.methode,
        min_facturen_per_maand: monthly.min_facturen_per_maand,
        maanden_overgeslagen: monthly.maanden_overgeslagen,
      },
      volatiliteit: {
        score: volatiliteitScore,
        label: volatiliteitLabel,
        confidence: volatiliteitConfidence,
        cv: round(cv, 2),
        intervals_observed: intervals.length,
        explanation: volatiliteitExplanation,
      },
    },
    pattern,
  }
}

// ----- taken genereren -------------------------------------------------------
//
// 1 bel_actie-taak per debiteur met vervallen saldo. Alle vervallen facturen
// (≥1d) van die debiteur worden samengevoegd in één taak. Debiteuren zonder
// vervallen saldo krijgen geen taak.

function urgentieScore(daysOverdue) {
  if (daysOverdue >= 60) return 5
  if (daysOverdue >= 30) return 4
  if (daysOverdue >= 14) return 3
  if (daysOverdue >= 1) return 2
  return 1
}

const overdueByDeb = new Map()
for (const f of openFacturenAll) {
  if (!f.Duedate) continue
  const daysOverdue = daysBetween(today, f.Duedate)
  if (daysOverdue <= 0) continue
  const debNr = f.Debtornumber
  if (!overdueByDeb.has(debNr)) overdueByDeb.set(debNr, [])
  overdueByDeb.get(debNr).push({ f, daysOverdue })
}

// Bouw lijst van (bedrag, taakcontext) — we gebruiken percentielen op deze
// bedragen om impact-buckets te kalibreren op de verdeling in de dummy data i.p.v.
// absolute % van AR.
const taskCandidates = []
for (const [debNr, items] of overdueByDeb.entries()) {
  // Netto-bedrag: openstaande facturen MIN openstaande creditnota's (creditnota's
  // hebben een negatief Balance amount, dus reduce telt ze automatisch goed).
  const totaalBedrag = items.reduce((s, x) => s + num(x.f['Balance amount']), 0)
  // Geen taak als per saldo de creditnota's het vervallen factuurbedrag overstijgen
  // — dan is er netto geen schuld om voor te bellen.
  if (totaalBedrag <= 0) continue
  // Urgentie-leeftijd alleen op vervallen DEBET-posten — een oude vervallen
  // creditnota mag de urgentie niet opdrijven.
  const oudste = items.reduce(
    (max, x) =>
      num(x.f['Balance amount']) > 0 && x.daysOverdue > max ? x.daysOverdue : max,
    0,
  )
  taskCandidates.push({ debNr, items, totaalBedrag, oudste, taskType: 'bel_actie' })
}

// Bedrag-percentielen over alle taakkandidaten
const bedragenSorted = taskCandidates.map((t) => t.totaalBedrag).sort((a, b) => a - b)
const pctValue = (p) =>
  bedragenSorted[Math.min(bedragenSorted.length - 1, Math.floor(bedragenSorted.length * p))] || 0
const P20 = pctValue(0.2)
const P40 = pctValue(0.4)
const P60 = pctValue(0.6)
const P80 = pctValue(0.8)
console.log(
  `Bedrag-percentielen (p20/p40/p60/p80): ${formatEUR(P20)} / ${formatEUR(P40)} / ${formatEUR(P60)} / ${formatEUR(P80)}`,
)

// Rang per taak: 1 = hoogste bedrag, N = laagste. Wordt in UI getoond
// zodat duidelijk is waar deze taak staat ten opzichte van alle andere.
const totalTaskCount = taskCandidates.length
const sortedByBedragDesc = [...taskCandidates].sort((a, b) => b.totaalBedrag - a.totaalBedrag)
const rankByCandidate = new Map()
sortedByBedragDesc.forEach((c, idx) => rankByCandidate.set(c, idx + 1))

// Bucket-info voor de visuele weergave in de UI: drempelwaardes (P20..P80),
// tellingen per bucket, en de min/max van de hele set.
const bucketCounts = [0, 0, 0, 0, 0]
for (const c of taskCandidates) {
  const score = impactBedragScore(c.totaalBedrag) // 1..5
  bucketCounts[score - 1]++
}
const bedragBuckets = {
  thresholds: [round(P20, 2), round(P40, 2), round(P60, 2), round(P80, 2)],
  counts: bucketCounts,
  min: round(bedragenSorted[0] || 0, 2),
  max: round(bedragenSorted[bedragenSorted.length - 1] || 0, 2),
}
function impactBedragScore(amount) {
  if (amount >= P80) return 5
  if (amount >= P60) return 4
  if (amount >= P40) return 3
  if (amount >= P20) return 2
  return 1
}

const tasks = []
for (const c of taskCandidates) {
  const debInfo = debByNr.get(c.debNr)
  const scores = debiteurScores(c.debNr)
  if (!scores) continue

  const bedragScore = impactBedragScore(c.totaalBedrag)
  const effectScore = 2
  const effectType = 'directe_cash'
  const impactScore = bedragScore
  const urgentie = urgentieScore(c.oudste)

  // Potentieel kan null zijn (= geen betaalhistorie, score onbekend).
  // Voor de priority-berekening vallen we dan terug op 3 (neutraal,
  // midden van de 1-5 schaal) zodat een onbekend potentieel een taak
  // niet kunstmatig kleiner of groter maakt.
  const potentieelVoorPriority = scores.potentieel ?? 3
  const priority =
    impactScore * 0.4 + urgentie * 0.3 + scores.risicoScore * 0.2 + potentieelVoorPriority * 0.1

  const factuurCount = c.items.length
  const gerelateerdeFacturen = c.items.map((x) => x.f.Invoicenumber)

  // Totaal openstaand voor deze debiteur (incl. niet-vervallen posten)
  const debTotaalOpen = scores.totalOpen
  const omschrijving = `Vervallen ${formatEUR(c.totaalBedrag)} · totaal open ${formatEUR(debTotaalOpen)}`
  const aanleiding =
    factuurCount === 1
      ? `Factuur ${c.oudste}d vervallen`
      : `${factuurCount} facturen vervallen, oudste ${c.oudste}d`
  const factuurnummerVoorTaak = factuurCount === 1 ? c.items[0].f.Invoicenumber : undefined

  tasks.push({
    id: `t_grp_${c.debNr}`,
    debiteur: debInfo?.Debtorname || c.debNr,
    debiteurnummer: c.debNr,
    type: c.taskType,
    taakomschrijving: omschrijving,
    aanleiding,
    factuurnummer: factuurnummerVoorTaak,
    bedrag: c.totaalBedrag,
    gerelateerde_facturen: gerelateerdeFacturen,
    priority: round(priority, 2),
    impact: {
      score: impactScore,
      bedrag_score: bedragScore,
      effect_score: effectScore,
      effect_type: effectType,
      bedrag: c.totaalBedrag,
      pct_van_ar: round((c.totaalBedrag / totalOpenAR) * 100, 2),
      bedrag_rank: rankByCandidate.get(c),
      bedrag_total_tasks: totalTaskCount,
      explanation:
        factuurCount > 1
          ? `${formatEUR(c.totaalBedrag)} verspreid over ${factuurCount} facturen (${round((c.totaalBedrag / totalOpenAR) * 100, 2)}% van AR) — directe cash bij betaling. Bedrag-score ${bedragScore} (p80=${formatEUR(P80)}), effect-score ${effectScore}.`
          : `${formatEUR(c.totaalBedrag)} (${round((c.totaalBedrag / totalOpenAR) * 100, 2)}% van AR) — directe cash bij betaling. Bedrag-score ${bedragScore}, effect-score ${effectScore}.`,
    },
    urgentie: {
      score: urgentie,
      dagen_vervallen: c.oudste,
      reden:
        factuurCount > 1
          ? `Oudste factuur ${c.oudste}d vervallen — over ${factuurCount} posten.`
          : `Factuur ${c.oudste}d vervallen (vervaldatum ${c.items[0].f.Duedate}).`,
    },
    risico: {
      score: scores.risicoScore,
      betaalgedrag: scores.betaalgedrag,
      huidige_stand: scores.huidigeStand,
      huidige_stand_pct_vervallen: scores.pctOverdue,
      huidige_stand_pct_score: scores.huidigeStandPctScore,
      huidige_stand_oudste_dagen: scores.oldestDays,
      huidige_stand_oudste_score: scores.huidigeStandOudsteScore,
      disputen: null,
      krediet: scores.krediet,
      krediet_limiet: scores.kredietLimiet,
      krediet_openstaand: round(scores.totalOpen, 2),
      krediet_onverzekerd_bedrag: scores.kredietOnverzekerdBedrag,
      krediet_onverzekerd_pct: scores.kredietOnverzekerdPct,
      krediet_pct_score: scores.kredietPctScore,
      krediet_impact_score: scores.kredietImpactScore,
      omzetconcentratie: scores.omzetconcentratie,
      omzetconcentratie_pct: scores.pctOmzet,
      omzetconcentratie_omzet: scores.debiteurOmzet,
      betaalgedrag_breakdown: scores.betaalgedrag_breakdown,
    },
    potentieel: {
      score: scores.potentieel,
      werkelijke_dagen: scores.medianActual,
      afgesproken_dagen: scores.medianAgreed,
      term_diff_dagen:
        scores.medianActual !== null ? scores.medianActual - scores.medianAgreed : null,
      beinvloedbare_dagen: scores.beinvloedbareDagen,
      dso_impact_euro_dagen: scores.dsoImpact !== null ? round(scores.dsoImpact, 0) : null,
      haalbaarheidsdrempel_dagen: DSO_HAALBAARHEIDSDREMPEL_DAGEN,
      reden:
        scores.potentieel === null
          ? `Geen volledig betaalde facturen in historie — werkelijke betaaltermijn is nog onbekend en kan pas worden berekend zodra deze klant minimaal één factuur heeft voldaan.`
          : scores.dsoCount > 0
            ? `Werkelijke termijn ${scores.medianActual}d vs afgesproken ${scores.medianAgreed}d, mediaan over ${scores.dsoCount} volledig betaalde facturen in de afgelopen 12 maanden.`
            : `Werkelijke termijn ${scores.medianActual}d vs afgesproken ${scores.medianAgreed}d, mediaan over ${scores.paidCount} volledig betaalde facturen (geen daarvan in de laatste 12 maanden).`,
      pattern: scores.pattern,
    },
  })
}

tasks.sort((a, b) => b.priority - a.priority)
const topTasks = tasks.slice(0, TOP_N)
const selectionLabel = TOP_N === Infinity ? 'alle' : `top-${TOP_N}`
console.log(`Taken gegenereerd: ${tasks.length}, ${selectionLabel} geselecteerd (${topTasks.length}).`)

// ----- audit-log -------------------------------------------------------------
//
// Twee event-types: patroon-verschuivingen (gedetecteerd door detectPattern)
// en — in productie — herinnering-verschuivingen (per verschoven herinnering
// real-time gelogd). Voor het prototype loggen we alleen de patroon-
// verschuivingen die uit de huidige data zijn afgeleid; herinnering-events
// komen pas binnen wanneer de flow daadwerkelijk een herinnering verplaatst.

const auditLog = []
let auditSeq = 0
const newAuditId = () => `AUDIT-${String(++auditSeq).padStart(6, '0')}`

for (const t of topTasks) {
  const p = t.potentieel.pattern
  if (!p || !p.verschuiving) continue
  const v = p.verschuiving
  auditLog.push({
    id: newAuditId(),
    type: 'patroon_verschoven',
    debiteurnummer: t.debiteurnummer,
    detectie_datum: SNAPSHOT,
    van_patroon: {
      type: v.van_type,
      waarde: v.van_waarde,
      fit_pct: v.van_fit_pct,
      hits: v.van_hits,
      totaal: v.van_n,
    },
    naar_patroon: {
      type: v.naar_type,
      waarde: v.naar_waarde,
      fit_pct: v.naar_fit_pct,
      hits: v.naar_hits,
      totaal: v.naar_n,
    },
    flow_actief_patroon: 'naar',
    venster_nieuw_dagen: v.sinds_dagen,
  })
}
console.log(
  `Audit-log: ${auditLog.length} patroon-verschuivingen gedetecteerd${auditLog.length ? ` (eerste: ${auditLog[0].debiteurnummer} ${auditLog[0].van_patroon.waarde} → ${auditLog[0].naar_patroon.waarde})` : ''}.`,
)

// ----- relationele entiteiten (pad B prep) -----------------------------------

const relevantDebNrs = new Set(topTasks.map((t) => t.debiteurnummer))

// Betaaltermijn niet in bron — deterministisch toegekend (30 of 45 dagen)
// op basis van debiteurnummer-hash, zodat dezelfde debiteur na regeneratie
// dezelfde termijn houdt.
const assignBetaaltermijn = (nr) => {
  let h = 0
  for (let i = 0; i < nr.length; i++) h = (h * 31 + nr.charCodeAt(i)) | 0
  return Math.abs(h) % 2 === 0 ? 30 : 45
}

const debiteuren = []
for (const nr of relevantDebNrs) {
  const d = debByNr.get(nr)
  if (!d) continue
  debiteuren.push({
    id: nr,
    naam: d.Debtorname,
    plaats: d.City,
    accountmanager: d.Accountmanager,
    klanttype: d.CustomerType,
    betaaltermijn: assignBetaaltermijn(nr),
  })
}

const facturenOut = []
const betalingenOut = []
for (const nr of relevantDebNrs) {
  const e = byDeb.get(nr)
  if (!e) continue
  for (const f of e.facturen) {
    const id = f.Invoicenumber
    const bedrag = num(f['Invoice amount'])
    const openstaand = num(f['Balance amount'])
    // Laatste betaaldatum = max van alle payment dates. Bij deelbetalingen
    // is dit het moment waarop het volledige bedrag binnen was. Alleen
    // ingevuld als factuur volledig betaald is.
    const isPaid = openstaand === 0 && (f.payments || []).length > 0
    const betaaldatum = isPaid
      ? f.payments.reduce((max, p) => (p.date > max ? p.date : max), '')
      : null
    facturenOut.push({
      id,
      debiteurnummer: nr,
      factuurdatum: f.Invoicedate,
      vervaldatum: f.Duedate,
      bedrag,
      openstaand,
      status: openstaand === 0 ? 'betaald' : openstaand > 0 ? 'open' : 'credit_nota',
      betaaldatum: betaaldatum || null,
    })
    for (const p of f.payments || []) {
      betalingenOut.push({
        id: p.id,
        factuurnummer: id,
        debiteurnummer: nr,
        datum: p.date,
        bedrag: Math.abs(num(p.amount)),
      })
    }
  }
}

// Losse boekstukken: records met Invoicetype/Documenttype !== 'Factuur'
// (Betaling, Terugbetaling, of leeg ""). Dit zijn standalone betaalboekingen
// die niet zijn gematcht aan een factuur. Voor de detailweergave per debiteur.
const losseBetalingenOut = []
for (const i of postsData.invoices) {
  const docType = i['Invoicetype/Documenttype']
  if (docType === 'Factuur') continue
  const nr = i.Debtornumber
  if (!relevantDebNrs.has(nr)) continue
  for (const p of i.payments || []) {
    losseBetalingenOut.push({
      id: p.id,
      debiteurnummer: nr,
      datum: p.date,
      bedrag: num(p.amount),
      documenttype: docType || '',
    })
  }
}

// ----- output ----------------------------------------------------------------

const out = {
  meta: {
    snapshot_datum: SNAPSHOT,
    bron: 'Dummy data (geanonimiseerd, jaarhistorie 2025-05-11 → 2026-05-11)',
    administratie: postsData.administration?.code || 'ADMIN001',
    total_open_ar: round(totalOpenAR, 2),
    jaaromzet_totaal: round(yearlyOmzetTotal, 2),
    omzet_scope: 'administratie',
    omzet_populatie_debiteuren: omzetPopulatie.length,
    omzet_percentielen: {
      p20: round(OMZET_P20, 2),
      p40: round(OMZET_P40, 2),
      p60: round(OMZET_P60, 2),
      p80: round(OMZET_P80, 2),
    },
    omzet_buckets: omzetBuckets,
    krediet_percentielen: {
      p20: round(KRED_P20, 2),
      p40: round(KRED_P40, 2),
      p60: round(KRED_P60, 2),
      p80: round(KRED_P80, 2),
    },
    krediet_buckets: kredietBuckets,
    krediet_populatie_debiteuren: kredietPopulatie.length,
    potentieel_buckets: potentieelBuckets,
    total_facturen: allFacturen.length,
    total_open_facturen: openFacturenAll.length,
    total_taken_gegenereerd: tasks.length,
    top_n: TOP_N === Infinity ? null : TOP_N,
    taken_in_set: topTasks.length,
    debiteuren_in_set: relevantDebNrs.size,
    facturen_in_set: facturenOut.length,
    betalingen_in_set: betalingenOut.length,
    losse_betalingen_in_set: losseBetalingenOut.length,
    bedrag_buckets: bedragBuckets,
    uitgesloten_categorieen: ['disputen'],
    uitsluitings_reden: 'Disputen ontbreken in de dummy data — risicoberekening genormaliseerd over de overige categorieën (betaalgedrag 30, huidige_stand 25, krediet 25, omzetconcentratie 10 = 90).',
  },
  tasks: topTasks,
  debiteuren,
  facturen: facturenOut,
  betalingen: betalingenOut,
  losseBetalingen: losseBetalingenOut,
  auditLog,
}

fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2))
const sizeKB = Math.round(fs.statSync(OUT_FILE).size / 1024)
console.log(`\nGeschreven naar src/data.generated.json (${sizeKB} KB)`)
console.log(`  ${topTasks.length} taken, ${debiteuren.length} debiteuren, ${facturenOut.length} facturen, ${betalingenOut.length} betalingen, ${losseBetalingenOut.length} losse boekstukken`)
