// @ts-nocheck
export function potentieelScoreFor(dsoImpact, { p25, p50, p75 }) {
  if (dsoImpact <= 0) return 1
  if (dsoImpact < p25) return 2
  if (dsoImpact < p50) return 3
  if (dsoImpact < p75) return 4
  return 5
}

export function urgentieScore(daysOverdue) {
  if (daysOverdue >= 60) return 5
  if (daysOverdue >= 30) return 4
  if (daysOverdue >= 14) return 3
  if (daysOverdue >= 1) return 2
  return 1
}

export function impactBedragScore(amount, { p20, p40, p60, p80 }) {
  if (amount >= p80) return 5
  if (amount >= p60) return 4
  if (amount >= p40) return 3
  if (amount >= p20) return 2
  return 1
}
