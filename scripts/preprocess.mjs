// Preprocess Covebo-export → src/data.generated.json
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

// Standaard betaaldag pattern recognition. Bekijkt drie patroon-types:
// - maandelijks/einde_maand (dag-van-de-maand clustering)
// - wekelijks (dag-van-de-week mode)
// - interval (vast aantal dagen tussen betalingen)
// Geeft beste fit + confidence-label terug.
function detectPattern(paymentDates) {
  // Dedupliceer naar unieke betaaldata. Meerdere deelbetalingen op
  // dezelfde dag tellen als één betaalmoment.
  const sorted = [...new Set(paymentDates)].sort()
  const n = sorted.length
  if (n < 4) {
    return {
      pattern_type: 'geen',
      pattern_value: null,
      fit_pct: 0,
      payments_observed: n,
      confidence: 'geen',
      explanation: `Te weinig unieke betaalmomenten (${n}) om een patroon te detecteren.`,
    }
  }

  // 1) Dag-van-de-maand clustering — probeer elk centerpunt 1..31 met ±3-window
  //    (modulo 30 om wrap-around bij einde maand mee te nemen).
  const days = sorted.map((d) => new Date(d).getUTCDate())
  let bestMonthlyDay = 1
  let bestMonthlyFit = 0
  for (let center = 1; center <= 31; center++) {
    const fit =
      days.filter(
        (d) => Math.min(Math.abs(d - center), 30 - Math.abs(d - center)) <= 3,
      ).length / n
    if (fit > bestMonthlyFit) {
      bestMonthlyFit = fit
      bestMonthlyDay = center
    }
  }

  // 2) Dag-van-de-week mode
  const dowCounts = new Array(7).fill(0)
  for (const d of sorted) dowCounts[new Date(d).getUTCDay()]++
  let bestDow = 0
  for (let i = 1; i < 7; i++) if (dowCounts[i] > dowCounts[bestDow]) bestDow = i
  const weeklyFit = dowCounts[bestDow] / n

  // 3) Interval-patroon — mediaan van gaps + ±2-window
  const intervals = []
  for (let i = 1; i < sorted.length; i++) intervals.push(daysBetween(sorted[i], sorted[i - 1]))
  const sortedIntervals = [...intervals].sort((a, b) => a - b)
  const medianInterval = sortedIntervals[Math.floor(sortedIntervals.length / 2)]
  const intervalFit =
    intervals.length > 0
      ? intervals.filter((iv) => Math.abs(iv - medianInterval) <= 2).length / intervals.length
      : 0

  const isEndMonth = bestMonthlyDay >= 25 || bestMonthlyDay <= 5
  const dowLabel = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'][
    bestDow
  ]

  const candidates = [
    {
      pattern_type: isEndMonth ? 'einde_maand' : 'maandelijks',
      pattern_value: isEndMonth ? 'rond einde/begin van de maand' : `rond dag ${bestMonthlyDay}`,
      fit_pct: bestMonthlyFit,
    },
    { pattern_type: 'wekelijks', pattern_value: dowLabel, fit_pct: weeklyFit },
    { pattern_type: 'interval', pattern_value: `elke ~${medianInterval} dagen`, fit_pct: intervalFit },
  ]
  candidates.sort((a, b) => b.fit_pct - a.fit_pct)
  const best = candidates[0]

  let confidence
  if (best.fit_pct >= 0.8 && n >= 6) confidence = 'hoog'
  else if (best.fit_pct >= 0.5 && n >= 4) confidence = 'middel'
  else confidence = 'geen'

  if (confidence === 'geen') {
    return {
      pattern_type: 'geen',
      pattern_value: null,
      fit_pct: Math.round(best.fit_pct * 100),
      payments_observed: n,
      confidence,
      explanation: `Geen consistent patroon (sterkste optie: ${best.pattern_type} ${Math.round(best.fit_pct * 100)}% over ${n} betalingen).`,
    }
  }

  return {
    pattern_type: best.pattern_type,
    pattern_value: best.pattern_value,
    fit_pct: Math.round(best.fit_pct * 100),
    payments_observed: n,
    confidence,
    explanation: `${best.pattern_value} — ${Math.round(best.fit_pct * 100)}% van ${n} betalingen volgen dit patroon.`,
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

// Bouwt een maandelijkse DSO-tijdreeks: gemiddelde dagen-te-laat van de
// facturen die in die maand zijn betaald.
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
  const months = [...byMonth.keys()].sort()
  return {
    months,
    values: months.map(
      (m) => byMonth.get(m).reduce((a, b) => a + b, 0) / byMonth.get(m).length,
    ),
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

const openFacturenAll = allFacturen.filter((f) => num(f['Balance amount']) > 0)
const totalOpenAR = openFacturenAll.reduce((s, f) => s + num(f['Balance amount']), 0)
const yearlyOmzetTotal = allFacturen.reduce((s, f) => s + Math.max(0, num(f['Invoice amount'])), 0)

console.log(`  ${allFacturen.length} facturen, ${openFacturenAll.length} open`)
console.log(`  Totale openstaande AR: ${formatEUR(totalOpenAR)}`)
console.log(`  Jaar-omzet: ${formatEUR(yearlyOmzetTotal)}`)

// ----- per debiteur ----------------------------------------------------------

const byDeb = new Map()
for (const f of allFacturen) {
  const k = f.Debtornumber
  if (!byDeb.has(k)) byDeb.set(k, { facturen: [], openFacturen: [] })
  const e = byDeb.get(k)
  e.facturen.push(f)
  if (num(f['Balance amount']) > 0) e.openFacturen.push(f)
}

function debiteurScores(debNr) {
  const e = byDeb.get(debNr)
  if (!e) return null

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

  let dsoScore
  if (medianDaysLate <= 0) dsoScore = 1
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
  const paymentDates = collectPaymentDates(e.facturen)
  const pattern = detectPattern(paymentDates)

  // ---- Aggregaat betaalgedrag --------------------------------------------
  // Gemiddelde van beschikbare sub-scores: DSO altijd, trend + volatiliteit
  // alleen wanneer confidence != 'geen'. Wanbetaler-voorspelling wordt
  // overgeslagen (fase 3).
  const subScores = [dsoScore]
  if (trendScore !== null) subScores.push(trendScore)
  if (volatiliteitScore !== null) subScores.push(volatiliteitScore)
  const betaalgedrag = subScores.reduce((a, b) => a + b, 0) / subScores.length

  // Huidige stand — % vervallen van totaal open voor deze debiteur, plus oudste post
  const totalOpen = e.openFacturen.reduce((s, f) => s + num(f['Balance amount']), 0)
  const overdue = e.openFacturen.filter((f) => f.Duedate && new Date(f.Duedate) < today)
  const overdueSum = overdue.reduce((s, f) => s + num(f['Balance amount']), 0)
  const pctOverdue = totalOpen > 0 ? overdueSum / totalOpen : 0
  let oldestDays = 0
  for (const f of overdue) {
    const d = daysBetween(today, f.Duedate)
    if (d > oldestDays) oldestDays = d
  }
  let huidigeStand
  if (pctOverdue < 0.05) huidigeStand = 1
  else if (pctOverdue < 0.25) huidigeStand = 2
  else if (pctOverdue < 0.5) huidigeStand = 3
  else if (pctOverdue < 0.75) huidigeStand = 4
  else huidigeStand = 5

  // Omzetconcentratie — debiteur-aandeel in jaar-omzet
  const debiteurOmzet = e.facturen.reduce((s, f) => s + Math.max(0, num(f['Invoice amount'])), 0)
  const pctOmzet = yearlyOmzetTotal > 0 ? debiteurOmzet / yearlyOmzetTotal : 0
  let omzetconcentratie
  if (pctOmzet < 0.005) omzetconcentratie = 1
  else if (pctOmzet < 0.02) omzetconcentratie = 2
  else if (pctOmzet < 0.05) omzetconcentratie = 3
  else if (pctOmzet < 0.15) omzetconcentratie = 4
  else omzetconcentratie = 5

  // Werkelijke vs afgesproken termijn
  const agreedTerms = e.facturen
    .filter((f) => f.Invoicedate && f.Duedate)
    .map((f) => daysBetween(f.Duedate, f.Invoicedate))
    .filter((d) => d >= 0 && d <= 365)
  const avgAgreed = agreedTerms.length
    ? Math.round(agreedTerms.reduce((a, b) => a + b, 0) / agreedTerms.length)
    : 30
  const actualTerms = paid
    .filter((f) => f.Invoicedate)
    .map((f) => {
      const lastPay = f.payments.reduce((max, p) => (p.date > max ? p.date : max), '')
      return daysBetween(lastPay, f.Invoicedate)
    })
    .filter((d) => d >= 0 && d <= 730)
  const avgActual = actualTerms.length
    ? Math.round(actualTerms.reduce((a, b) => a + b, 0) / actualTerms.length)
    : avgAgreed
  const termDiff = avgActual - avgAgreed
  let potentieel
  if (termDiff <= 0) potentieel = 0
  else if (termDiff <= 10) potentieel = 1
  else if (termDiff <= 30) potentieel = 2
  else if (termDiff <= 60) potentieel = 3
  else if (termDiff <= 90) potentieel = 4
  else potentieel = 5

  // Risico — gewogen gemiddelde over beschikbare categorieën.
  // Originele wegingen: betaalgedrag 30, huidige_stand 25, disputen 10,
  // krediet 25, omzetconcentratie 10. Disputen + krediet ontbreken: skip
  // en normaliseer op basis van (30+25+10)=65.
  const risicoScore = (betaalgedrag * 30 + huidigeStand * 25 + omzetconcentratie * 10) / 65

  return {
    betaalgedrag: round(betaalgedrag, 2),
    huidigeStand,
    omzetconcentratie,
    disputen: null,
    krediet: null,
    risicoScore: round(risicoScore, 2),
    medianDaysLate: Math.round(medianDaysLate),
    pctOverdue: round(pctOverdue * 100, 1),
    oldestDays,
    pctOmzet: round(pctOmzet * 100, 2),
    avgAgreed,
    avgActual,
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
      },
      trend: {
        score: trendScore,
        label: trendLabel,
        confidence: trendConfidence,
        tau: round(mk.tau, 2),
        p_value: round(mk.pValue, 3),
        months_observed: mk.n,
        explanation: trendExplanation,
        series: monthly.months.map((m, i) => ({ month: m, dso: Math.round(monthly.values[i]) })),
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
// Pad B-aanpak: groepering op debiteurniveau voor actieve taken.
// - 1 escalatie- óf bel_actie-taak per debiteur (afhankelijk van zwaarste
//   factuur), met ALLE 14+d vervallen facturen van die debiteur in de
//   onderliggende stack.
// - Herinneringen blijven per factuur (1-13d vervallen) — die zijn routine
//   en niet altijd per debiteur te bundelen.

function urgentieScore(daysOverdue) {
  if (daysOverdue >= 60) return 5
  if (daysOverdue >= 30) return 4
  if (daysOverdue >= 14) return 3
  if (daysOverdue >= 1) return 2
  return 1
}

// Eerst: per debiteur de open vervallen facturen groeperen
const overdueByDeb = new Map()
const herinneringFacturen = []
for (const f of openFacturenAll) {
  if (!f.Duedate) continue
  const daysOverdue = daysBetween(today, f.Duedate)
  if (daysOverdue <= 0) continue
  const debNr = f.Debtornumber
  if (daysOverdue < 14) {
    herinneringFacturen.push({ f, daysOverdue })
  } else {
    if (!overdueByDeb.has(debNr)) overdueByDeb.set(debNr, [])
    overdueByDeb.get(debNr).push({ f, daysOverdue })
  }
}

// Bouw lijst van (bedrag, taakcontext) — we gebruiken percentielen op deze
// bedragen om impact-buckets te kalibreren op Covebo's verdeling i.p.v.
// absolute % van AR.
const taskCandidates = []

// Grouped tasks (escalatie of bel_actie) per debiteur
for (const [debNr, items] of overdueByDeb.entries()) {
  const totaalBedrag = items.reduce((s, x) => s + num(x.f['Balance amount']), 0)
  const oudste = items.reduce((max, x) => (x.daysOverdue > max ? x.daysOverdue : max), 0)
  const taskType = 'bel_actie'
  taskCandidates.push({ kind: 'grouped', debNr, items, totaalBedrag, oudste, taskType })
}

// Per-factuur herinneringen
for (const { f, daysOverdue } of herinneringFacturen) {
  taskCandidates.push({
    kind: 'reminder',
    debNr: f.Debtornumber,
    items: [{ f, daysOverdue }],
    totaalBedrag: num(f['Balance amount']),
    oudste: daysOverdue,
    taskType: 'bel_actie',
  })
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

  const priority =
    impactScore * 0.4 + urgentie * 0.3 + scores.risicoScore * 0.2 + scores.potentieel * 0.1

  const factuurCount = c.items.length
  const gerelateerdeFacturen = c.items.map((x) => x.f.Invoicenumber)

  // Totaal openstaand voor deze debiteur (incl. niet-vervallen posten)
  const debTotaalOpen = scores.totalOpen
  let omschrijving, aanleiding, factuurnummerVoorTaak
  omschrijving =
    debTotaalOpen > c.totaalBedrag + 0.01
      ? `Vervallen ${formatEUR(c.totaalBedrag)} · totaal open ${formatEUR(debTotaalOpen)}`
      : `Totaal openstaand: ${formatEUR(c.totaalBedrag)}`
  if (c.kind === 'grouped') {
    aanleiding =
      factuurCount === 1
        ? `Factuur ${c.oudste}d vervallen`
        : `${factuurCount} facturen vervallen, oudste ${c.oudste}d`
    factuurnummerVoorTaak = undefined // niet één enkele factuur — debiteur-niveau
  } else {
    const f = c.items[0].f
    aanleiding = `Factuur ${c.oudste}d vervallen`
    factuurnummerVoorTaak = f.Invoicenumber
  }

  tasks.push({
    id: c.kind === 'grouped' ? `t_grp_${c.debNr}` : `t_${c.items[0].f.Invoicenumber}`,
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
        c.kind === 'grouped' && factuurCount > 1
          ? `${formatEUR(c.totaalBedrag)} verspreid over ${factuurCount} facturen (${round((c.totaalBedrag / totalOpenAR) * 100, 2)}% van AR) — directe cash bij betaling. Bedrag-score ${bedragScore} (p80=${formatEUR(P80)}), effect-score ${effectScore}.`
          : `${formatEUR(c.totaalBedrag)} (${round((c.totaalBedrag / totalOpenAR) * 100, 2)}% van AR) — directe cash bij betaling. Bedrag-score ${bedragScore}, effect-score ${effectScore}.`,
    },
    urgentie: {
      score: urgentie,
      dagen_vervallen: c.oudste,
      reden:
        c.kind === 'grouped' && factuurCount > 1
          ? `Oudste factuur ${c.oudste}d vervallen — over ${factuurCount} posten.`
          : `Factuur ${c.oudste}d vervallen (vervaldatum ${c.items[0].f.Duedate}).`,
    },
    risico: {
      score: scores.risicoScore,
      betaalgedrag: scores.betaalgedrag,
      huidige_stand: scores.huidigeStand,
      huidige_stand_pct_vervallen: scores.pctOverdue,
      huidige_stand_oudste_dagen: scores.oldestDays,
      disputen: null,
      krediet: null,
      omzetconcentratie: scores.omzetconcentratie,
      omzetconcentratie_pct: scores.pctOmzet,
      betaalgedrag_breakdown: scores.betaalgedrag_breakdown,
    },
    potentieel: {
      score: scores.potentieel,
      werkelijke_dagen: scores.avgActual,
      afgesproken_dagen: scores.avgAgreed,
      reden:
        scores.dsoCount > 0
          ? `Werkelijke termijn ${scores.avgActual}d vs afgesproken ${scores.avgAgreed}d, gemiddeld over ${scores.dsoCount} volledig betaalde facturen.`
          : `Geen volledig betaalde facturen in historie; potentieel afgeleid uit beschikbare data.`,
      pattern: scores.pattern,
    },
  })
}

tasks.sort((a, b) => b.priority - a.priority)
const topTasks = tasks.slice(0, TOP_N)
const selectionLabel = TOP_N === Infinity ? 'alle' : `top-${TOP_N}`
console.log(`Taken gegenereerd: ${tasks.length}, ${selectionLabel} geselecteerd (${topTasks.length}).`)

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
    bron: 'Covebo geanonimiseerde export (jaarhistorie 2025-05-11 → 2026-05-11)',
    administratie: postsData.administration?.code || 'ADMIN001',
    total_open_ar: round(totalOpenAR, 2),
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
    uitgesloten_categorieen: ['disputen', 'krediet'],
    uitsluitings_reden: 'Geen brondata aanwezig in Covebo-export — risicoberekening genormaliseerd over resterende categorieën (betaalgedrag 30, huidige_stand 25, omzetconcentratie 10).',
  },
  tasks: topTasks,
  debiteuren,
  facturen: facturenOut,
  betalingen: betalingenOut,
  losseBetalingen: losseBetalingenOut,
}

fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2))
const sizeKB = Math.round(fs.statSync(OUT_FILE).size / 1024)
console.log(`\nGeschreven naar src/data.generated.json (${sizeKB} KB)`)
console.log(`  ${topTasks.length} taken, ${debiteuren.length} debiteuren, ${facturenOut.length} facturen, ${betalingenOut.length} betalingen, ${losseBetalingenOut.length} losse boekstukken`)
