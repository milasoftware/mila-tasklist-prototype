// @ts-nocheck
import { oneDay } from './utils'

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

export const isoDate = (date) => date.toISOString().slice(0, 10)
export const addDays = (date, n) => new Date(date.getTime() + n * oneDay)

function bouwFeestdagSet(jaren) {
  const set = new Set()
  for (const y of jaren) {
    const paas = paasZondag(y)
    const goedeVrijdag = addDays(paas, -2)
    const paasmaandag = addDays(paas, 1)
    const hemelvaart = addDays(paas, 39)
    const pinksterMaandag = addDays(paas, 50)
    const vaste = [
      [1, 1],
      [5, 1],
      [4, 27],
      [7, 21],
      [8, 15],
      [11, 1],
      [11, 11],
      [12, 25],
      [12, 26],
    ]
    for (const [m, d] of vaste) {
      let dt = new Date(Date.UTC(y, m - 1, d))
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

export function createCalendar(snapshot) {
  const today = new Date(snapshot)
  const feestdagen = bouwFeestdagSet([
    today.getUTCFullYear() - 2,
    today.getUTCFullYear() - 1,
    today.getUTCFullYear(),
    today.getUTCFullYear() + 1,
  ])

  function werkdagVoorReeks(isoDatum) {
    let cursor = new Date(isoDatum)
    let nonWerkdagen = 0
    for (let i = 0; i < 7; i++) {
      const vorige = addDays(cursor, -1)
      const dow = vorige.getUTCDay()
      const isWeekend = dow === 0 || dow === 6
      const isFeestdag = feestdagen.has(isoDate(vorige))
      if (!isWeekend && !isFeestdag) {
        return nonWerkdagen > 0 ? isoDate(vorige) : null
      }
      nonWerkdagen++
      cursor = vorige
    }
    return null
  }

  function isWerkdag(isoDatum) {
    const d = new Date(isoDatum)
    const dow = d.getUTCDay()
    if (dow === 0 || dow === 6) return false
    return !feestdagen.has(isoDate(d))
  }

  function werkdagenTussen(vanIso, totIso) {
    if (vanIso === totIso) return 0
    const vanT = new Date(vanIso).getTime()
    const totT = new Date(totIso).getTime()
    const sign = totT > vanT ? 1 : -1
    const start = sign > 0 ? vanT : totT
    const end = sign > 0 ? totT : vanT
    let count = 0
    let cursor = start + oneDay
    while (cursor <= end) {
      if (isWerkdag(isoDate(new Date(cursor)))) count++
      cursor += oneDay
    }
    return sign * count
  }

  function volgendeStandaardBetaaldag(vanafIso, pattern) {
    if (!pattern || pattern.pattern_type === 'geen' || pattern.pattern_type == null) return null
    const vanaf = new Date(vanafIso)
    if (pattern.pattern_type === 'wekelijks') {
      const diff = (pattern.dag_index - vanaf.getUTCDay() + 7) % 7
      return isoDate(addDays(vanaf, diff))
    }
    if (pattern.pattern_type === 'maanddag') {
      const center = pattern.dag_index
      for (let i = 0; i < 62; i++) {
        const cand = addDays(vanaf, i)
        const day = cand.getUTCDate()
        const dist = Math.min(Math.abs(day - center), 30 - Math.abs(day - center))
        if (dist <= 1) return isoDate(cand)
      }
    }
    return null
  }

  function voorspelBetaaldatum({ oudsteVervaldatumIso, medianDsoDagen, pattern }) {
    if (!oudsteVervaldatumIso) return null
    if (medianDsoDagen === null || medianDsoDagen === undefined) return null
    if (!pattern || pattern.pattern_type === 'geen' || pattern.pattern_type == null) return null
    const rawTarget = isoDate(addDays(new Date(oudsteVervaldatumIso), medianDsoDagen))
    const betaaldatum = volgendeStandaardBetaaldag(rawTarget, pattern)
    if (!betaaldatum) return null
    return { betaaldatum, raw_target: rawTarget, basis: 'vervaldatum + mediaan_dso + pattern' }
  }

  return { feestdagen, werkdagVoorReeks, isWerkdag, werkdagenTussen, volgendeStandaardBetaaldag, voorspelBetaaldatum }
}
