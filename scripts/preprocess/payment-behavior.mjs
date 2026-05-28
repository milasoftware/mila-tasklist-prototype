import { daysBetween, median, num } from './utils.mjs'

const TREND_MIN_FACTUREN_PER_MAAND = 3

// ----- statistische helpers (fase 1 AI-componenten) --------------------------

// Theil-Sen slope estimator — mediaan van alle pair-wise slopes tussen
// observaties. Robust regression: één outlier-maand verandert de uitkomst
// niet wezenlijk. Geeft een slope-getal in eenheid-per-stap (hier: dagen
// per maand). Voor onze use case: positieve slope = DSO loopt structureel
// op = betaalgedrag verslechtert geleidelijk over de hele meetperiode.
export function theilSenSlope(values) {
  const n = values.length
  if (n < 2) return 0
  const slopes = []
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      slopes.push((values[j] - values[i]) / (j - i))
    }
  }
  slopes.sort((a, b) => a - b)
  const mid = Math.floor(slopes.length / 2)
  return slopes.length % 2 === 0
    ? (slopes[mid - 1] + slopes[mid]) / 2
    : slopes[mid]
}

// Mediaan-helper voor de trend-vensters hieronder.
export function _medOf(arr) {
  const s = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid]
}

// Drift vs. baseline: hoe ver staat het huidige betaalniveau van het
// uitgangspunt aan het begin van de meetperiode? Dit is het primaire
// signaal voor de score — "van 6d naar 18d" is structureel slecht, ook
// als het korte-termijn momentum (laatste 3 vs voorgaande 3) toevallig
// stabiel of dalend is. Korte current-window (2 mnd) zorgt dat recent
// herstel snel zichtbaar wordt: een klant die terug is bij het
// uitgangspunt krijgt geen score-penalty meer.
export function driftVsBaseline(values) {
  const n = values.length
  if (n < 5) return null
  const baseline = _medOf(values.slice(0, 3))
  const current = _medOf(values.slice(-2))
  return current - baseline
}

// Momentum: hoe verschilt het recente gedrag (laatste 3 mnd) van het
// gedrag daarvoor (voorgaande 3 mnd)? Secundair signaal — alleen
// gebruikt voor het story-label (herstellend / kantelpunt / structureel).
export function momentumDelta(values) {
  const n = values.length
  if (n < 5) return null
  const laatste3 = values.slice(-3)
  const voorgaande3 = values.slice(-6, -3)
  if (voorgaande3.length >= 2) return _medOf(laatste3) - _medOf(voorgaande3)
  const half = Math.floor(n / 2)
  return _medOf(values.slice(-half)) - _medOf(values.slice(0, half))
}

// Coefficient of variation — eenvoudige maat voor relatieve spreiding.
// Lage CV = regelmatig, hoge CV = grillig.
export function coefficientOfVariation(values) {
  if (values.length < 2) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  if (mean === 0) return 0
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance) / Math.abs(mean)
}

// Verzamelt alle betaaldata voor één debiteur uit z'n factuur-historie.
export function collectPaymentDates(facturenList) {
  const dates = []
  for (const f of facturenList) {
    for (const p of f.payments || []) if (p.date) dates.push(p.date)
  }
  return dates
}

// Berekent intervallen tussen opeenvolgende unieke betaaldata (in dagen).
// Dedupliceert eerst, want deelbetalingen op dezelfde dag zijn één betaalmoment.
// Optioneel filter sinceMs (ms-epoch) houdt alleen betaaldata vanaf die datum.
export function paymentIntervals(facturenList, sinceMs = null) {
  let dates = [...new Set(collectPaymentDates(facturenList))].sort()
  if (sinceMs !== null) {
    dates = dates.filter((d) => new Date(d).getTime() >= sinceMs)
  }
  const intervals = []
  for (let i = 1; i < dates.length; i++) intervals.push(daysBetween(dates[i], dates[i - 1]))
  return intervals
}

// Bouwt een maandelijkse DSO-tijdreeks. Per maand wordt de mediaan
// dagen-te-laat genomen (robuust tegen één extreem late betaling die
// het gemiddelde scheef zou trekken). Maanden met minder dan
// TREND_MIN_FACTUREN_PER_MAAND betaalde facturen worden overgeslagen
// zodat eenmalige uitschieters niet als trend gelezen worden.
// Retourneert ook de samples per maand zodat verbruikers (UI, audit)
// kunnen tonen waarop het cijfer is gebaseerd.
export function monthlyDsoSeries(paidFacturen) {
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
