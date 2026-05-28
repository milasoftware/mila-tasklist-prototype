import type React from 'react'
import { meta, type Confidence, type PatternInfo, type Task } from '../data'
import { fmtEUR, fmtNL } from './format'
import { ScoreTooltip } from './components'

// ----- tooltip-builders per score-type --------------------------------------
//
// Eén helper per ScoreRing op de detail-pagina. Drempels komen 1-op-1
// uit scripts/preprocess.mjs zodat de tooltips altijd de échte
// rekenregels weergeven.

export function tooltipImpact(score: number, bedrag: number | undefined): React.ReactNode {
  const t = meta.bedrag_buckets.thresholds
  return (
    <ScoreTooltip
      title="Hoeveel levert dit op"
      description={`Score op basis van het openstaande bedrag, vergeleken met alle ${meta.total_taken_gegenereerd} taken in vijf even grote groepen (kwintielen).`}
      thresholds={[
        { score: 1, label: `< ${fmtEUR(t[0])}` },
        { score: 2, label: `${fmtEUR(t[0])} – ${fmtEUR(t[1])}` },
        { score: 3, label: `${fmtEUR(t[1])} – ${fmtEUR(t[2])}` },
        { score: 4, label: `${fmtEUR(t[2])} – ${fmtEUR(t[3])}` },
        { score: 5, label: `≥ ${fmtEUR(t[3])}` },
      ]}
      activeScore={score}
      current={bedrag !== undefined ? `Deze taak: ${fmtEUR(bedrag)} → score ${score}` : undefined}
    />
  )
}

export function tooltipUrgentie(score: number, dagenVervallen: number | undefined): React.ReactNode {
  return (
    <ScoreTooltip
      title="Hoe dringend"
      description="Score op basis van het aantal dagen dat de oudste factuur in deze taak vervallen is."
      thresholds={[
        { score: 1, label: 'vandaag of nog niet vervallen' },
        { score: 2, label: '1 – 13 dagen vervallen' },
        { score: 3, label: '14 – 29 dagen vervallen' },
        { score: 4, label: '30 – 59 dagen vervallen' },
        { score: 5, label: '60+ dagen vervallen' },
      ]}
      activeScore={score}
      current={
        dagenVervallen !== undefined
          ? `Oudste factuur ${dagenVervallen}d vervallen → score ${score}`
          : undefined
      }
    />
  )
}

export function tooltipPotentieel(
  score: number | null,
  dsoImpact: number | null | undefined,
  beinvloedbareDagen: number | null | undefined,
  totalOpen: number | undefined,
): React.ReactNode {
  const pb = meta.potentieel_buckets
  const respijt = pb?.haalbaarheidsdrempel_dagen ?? 7
  const popN = pb?.populatie_debiteuren ?? 0
  const t = pb?.thresholds ?? [0, 0, 0, 0]
  const fmtED = (n: number) =>
    `${Math.round(n).toLocaleString('nl-NL')} euro-dagen`
  const currentTxt =
    score === null
      ? 'Geen betaalhistorie — werkelijke termijn niet te bepalen, score is onbekend.'
      : dsoImpact != null && beinvloedbareDagen != null && totalOpen !== undefined
        ? `${beinvloedbareDagen}d beïnvloedbaar × ${fmtEUR(totalOpen)} = ${fmtED(dsoImpact)} → score ${score}`
        : undefined
  return (
    <ScoreTooltip
      title="Hoeveel sneller kan deze klant betalen"
      description={`DSO-winst die vrijspeelt als deze klant op afspraak gaat betalen: beïnvloedbare termijn (mediaan vertraging boven ${respijt} dagen respijt) × openstaand bedrag. Vergeleken met alle ${popN} debiteuren met vervallen saldo, verdeeld in vier kwartielen op DSO-impact > 0.`}
      thresholds={[
        { score: 1, label: `0 euro-dagen (binnen ${respijt}d marge — geen DSO-winst)` },
        { score: 2, label: `< ${fmtED(t[1])}` },
        { score: 3, label: `${fmtED(t[1])} – ${fmtED(t[2])}` },
        { score: 4, label: `${fmtED(t[2])} – ${fmtED(t[3])}` },
        { score: 5, label: `≥ ${fmtED(t[3])}` },
      ]}
      activeScore={score}
      current={currentTxt}
    />
  )
}

export function risicoBullets(task: Task): string[] {
  const r = task.risico
  const bullets: string[] = []

  if (r.betaalgedrag_breakdown) {
    const dsoBlock = r.betaalgedrag_breakdown.dso
    if (dsoBlock.from_overdue) {
      const ou = dsoBlock.oudste_dagen_vervallen ?? 0
      bullets.push(`Geen betaalhistorie — oudste vervallen post is ${ou} dagen oud.`)
    } else {
      const dso = dsoBlock.median_days_late
      if (dso < 0) bullets.push(`Betaalt gemiddeld ${Math.abs(dso)} dagen vóór de vervaldatum.`)
      else if (dso === 0) bullets.push('Betaalt gemiddeld op de vervaldatum.')
      else bullets.push(`Betaalt gemiddeld ${dso} dagen na de vervaldatum.`)
    }

    const trend = r.betaalgedrag_breakdown.trend
    if (trend.score != null) {
      if (trend.story === 'hersteld na piek') {
        bullets.push('Betaalgedrag is hersteld — terug op het oude niveau na een eerdere piek.')
      } else if (
        trend.story === 'structureel verslechterend' ||
        trend.story === 'structureel verhoogd' ||
        trend.score >= 4
      ) {
        bullets.push('Betaalgedrag verslechtert — betaalt structureel later dan eerder.')
      } else if (trend.story === 'herstellend, nog niet op niveau') {
        bullets.push('Betaalgedrag herstelt — recent verbetering, maar nog niet terug bij uitgangspunt.')
      } else if (trend.story === 'structureel verbeterend') {
        bullets.push('Betaalgedrag verbetert — betaalt structureel sneller dan eerder.')
      } else if (trend.story === 'recent kantelpunt') {
        bullets.push('Betaalgedrag is recent omgeslagen — eerder stabiel, nu duidelijk later.')
      }
    }

    const vol = r.betaalgedrag_breakdown.volatiliteit
    if (vol.confidence !== 'geen' && vol.score != null && vol.score >= 4) {
      bullets.push('Betaalt grillig — moeilijk te voorspellen wanneer betaald wordt.')
    }
  }

  if (r.huidige_stand_pct_vervallen !== undefined && r.huidige_stand_pct_vervallen > 0) {
    const pct = Math.round(r.huidige_stand_pct_vervallen)
    const oudste = r.huidige_stand_oudste_dagen
    bullets.push(
      `${pct}% van openstaand bedrag is vervallen${oudste ? ` (oudste post ${oudste} dagen)` : ''}.`,
    )
  }

  if (r.krediet != null) {
    const pct = Math.round(r.krediet_onverzekerd_pct ?? 0)
    const bedrag = r.krediet_onverzekerd_bedrag ?? 0
    if (r.krediet >= 4) {
      bullets.push(`Kredietrisico hoog — ${pct}% onverzekerd (${fmtEUR(bedrag)}).`)
    } else if (r.krediet >= 3) {
      bullets.push(`Kredietrisico gemiddeld — ${pct}% onverzekerd.`)
    } else if (r.krediet >= 2) {
      bullets.push(`Kredietrisico beperkt — ${pct}% onverzekerd.`)
    } else {
      bullets.push('Kredietrisico laag — openstaand bedrag binnen de limiet.')
    }
  }

  if (r.omzetconcentratie != null) {
    const pct = r.omzetconcentratie_pct
    const pctTxt = pct != null ? ` (${pct.toFixed(1)}% van jaaromzet)` : ''
    if (r.omzetconcentratie >= 5) bullets.push(`Zeer belangrijke klant — top 20% in netto-omzet${pctTxt}.`)
    else if (r.omzetconcentratie >= 4) bullets.push(`Belangrijke klant qua omzet${pctTxt}.`)
    else if (r.omzetconcentratie <= 2) bullets.push(`Beperkte omzetbijdrage${pctTxt}.`)
  }

  return bullets
}

export function tooltipRisico(task: Task): React.ReactNode {
  const bg = task.risico.betaalgedrag
  const hs = task.risico.huidige_stand
  const kr = task.risico.krediet
  const oc = task.risico.omzetconcentratie
  const hasKrediet = kr != null
  const noemer = 30 + 25 + (hasKrediet ? 25 : 0) + 10
  const bullets = risicoBullets(task)
  return (
    <ScoreTooltip
      title="Hoe risicovol"
      description={`Gewogen gemiddelde van ${hasKrediet ? 'vier' : 'drie'} deelscores. Disputen ontbreekt in de dummy data en telt niet mee — de score is genormaliseerd over de wél beschikbare metrics.`}
      composition={
        <div className="space-y-3 mb-2">
          {bullets.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-white/50 mb-1">
                Samenvatting
              </p>
              <ul className="space-y-0.5 text-[11px] text-white/85">
                {bullets.map((b, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span className="text-white/40">•</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <p className="text-[10px] uppercase tracking-wide text-white/50 mb-1">
              Opbouw score
            </p>
            <table className="w-full text-[11px] tabular-nums">
              <tbody className="text-white/80">
                <tr>
                  <td className="pr-2 py-0.5">Betaalgedrag</td>
                  <td className="text-right pr-1">{fmtNL(bg, 1)}</td>
                  <td className="text-white/50 pl-1">× 30/{noemer}</td>
                </tr>
                <tr>
                  <td className="pr-2 py-0.5">Huidige stand</td>
                  <td className="text-right pr-1">{fmtNL(hs, 1)}</td>
                  <td className="text-white/50 pl-1">× 25/{noemer}</td>
                </tr>
                {hasKrediet && (
                  <tr>
                    <td className="pr-2 py-0.5">Kredietrisico</td>
                    <td className="text-right pr-1">{fmtNL(kr, 1)}</td>
                    <td className="text-white/50 pl-1">× 25/{noemer}</td>
                  </tr>
                )}
                <tr>
                  <td className="pr-2 py-0.5">Omzetconcentratie</td>
                  <td className="text-right pr-1">{fmtNL(oc, 0)}</td>
                  <td className="text-white/50 pl-1">× 10/{noemer}</td>
                </tr>
                <tr className="border-t border-white/20">
                  <td className="font-medium pt-1">Risico-score</td>
                  <td className="text-right font-semibold pt-1 pr-1">
                    {fmtNL(task.risico.score, 2)}
                  </td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      }
    />
  )
}

export function tooltipDso(
  score: number,
  days: number,
  count: number,
  fromOverdue?: boolean,
  oudsteVervallen?: number,
): React.ReactNode {
  const ouLabel = oudsteVervallen ?? 0
  const fallbackThresholds = [
    { score: 2, label: '1 – 5 dagen vervallen (grace period)' },
    { score: 5, label: '> 5 dagen vervallen (rood vlaggetje)' },
  ]
  const normalThresholds = [
    { score: 1, label: 'op tijd of eerder' },
    { score: 2, label: '1 – 7 dagen te laat' },
    { score: 3, label: '8 – 21 dagen te laat' },
    { score: 4, label: '22 – 45 dagen te laat' },
    { score: 5, label: '45+ dagen te laat' },
  ]
  return (
    <ScoreTooltip
      title="Hoeveel dagen meestal te laat"
      description={
        fromOverdue
          ? 'Deze klant heeft geen betalingen gedaan in de afgelopen 12 maanden. We vallen daarom terug op de leeftijd van de oudste vervallen post — een grace period van 5 dagen, daarna direct rood.'
          : 'Mediaan van het aantal dagen dat over de vervaldatum heen wordt gegaan op facturen die in de afgelopen 12 maanden volledig zijn betaald (DSO na vervaldatum). Mediaan i.p.v. gemiddelde — robuuster tegen uitschieters.'
      }
      thresholds={fromOverdue ? fallbackThresholds : normalThresholds}
      activeScore={score}
      current={
        fromOverdue
          ? `Geen betaalhistorie — oudste vervallen post ${ouLabel}d → score ${score}`
          : `Mediaan ${days}d te laat over ${count} facturen betaald in de afgelopen 12 maanden → score ${score}`
      }
    />
  )
}

export function tooltipTrend(
  score: number | null,
  driftDagen: number | null,
  baselineDagen: number | null,
  currentDagen: number | null,
  momentumDelta: number | null,
  slope: number,
  story:
    | 'hersteld na piek'
    | 'herstellend, nog niet op niveau'
    | 'structureel verbeterend'
    | 'structureel verslechterend'
    | 'structureel verhoogd'
    | 'recent kantelpunt'
    | null,
  monthsObserved: number,
): React.ReactNode {
  const fmtDelta = (d: number) => `${d >= 0 ? '+' : ''}${Math.round(d)}d`
  const fmtSlope = (s: number) => `${s >= 0 ? '+' : ''}${s.toFixed(1)}d/mnd`
  return (
    <ScoreTooltip
      title="Gaat het beter of slechter"
      description="Drift = huidige stand (mediaan laatste 2 mnd) minus uitgangspunt (mediaan eerste 3 mnd) op de maandelijkse mediaan-DSO. Vangt structurele verslechtering: een klant die van 6d naar 18d is gegroeid telt zwaar, ook als de laatste paar maanden lokaal stabiel zijn. Momentum (laatste 3 vs voorgaande 3) en Theil-Sen slope dienen als context voor het story-label. Asymmetrisch — alleen verslechtering verhoogt het risico."
      thresholds={[
        { score: 1, label: 'drift < +3d (stabiel of verbeterend)' },
        { score: 2, label: '+3 t/m +6d (lichte verslechtering)' },
        { score: 3, label: '+7 t/m +9d (duidelijke verslechtering)' },
        { score: 4, label: '+10 t/m +19d (sterke verslechtering)' },
        { score: 5, label: '≥ +20d (acute verslechtering)' },
      ]}
      activeScore={score}
      current={
        driftDagen === null
          ? `Te weinig data (${monthsObserved} maanden, minimaal 5 nodig) → geen score`
          : `van ${baselineDagen}d → ${currentDagen}d (drift ${fmtDelta(driftDagen)}), ` +
            `momentum ${momentumDelta === null ? '—' : fmtDelta(momentumDelta)}, ` +
            `slope ${fmtSlope(slope)} over ${monthsObserved} mnd → score ${score}` +
            (story ? ` (${story})` : '')
      }
    />
  )
}

export function tooltipVolatiliteit(
  score: number | null,
  cv: number,
  intervalsObserved: number,
  confidence: Confidence,
): React.ReactNode {
  return (
    <ScoreTooltip
      title="Hoe voorspelbaar"
      description="Coefficient of variation (CV) op de tijd tussen opeenvolgende betalingen in de afgelopen 12 maanden. Lage CV = regelmatig, hoge CV = grillig."
      thresholds={[
        { score: 1, label: 'CV < 0,3 (zeer regelmatig)' },
        { score: 2, label: '0,3 ≤ CV < 0,6 (regelmatig)' },
        { score: 3, label: '0,6 ≤ CV < 1,0 (wisselend)' },
        { score: 4, label: '1,0 ≤ CV < 1,5 (onregelmatig)' },
        { score: 5, label: 'CV ≥ 1,5 (zeer grillig)' },
      ]}
      activeScore={score}
      current={
        confidence === 'geen'
          ? `Te weinig data (${intervalsObserved} betaalintervallen) → geen score`
          : `CV=${cv} over ${intervalsObserved} betaalintervallen → score ${score}`
      }
    />
  )
}

export function tooltipHuidigeStand(
  score: number,
  pctVervallen: number | undefined,
  oudsteDagen: number | undefined,
  pctScore: number | undefined,
  oudsteScore: number | undefined,
): React.ReactNode {
  const pctSchaal = [
    { score: 1, label: '0 – 10%' },
    { score: 2, label: '11 – 25%' },
    { score: 3, label: '26 – 50%' },
    { score: 4, label: '51 – 75%' },
    { score: 5, label: '> 75%' },
  ]
  const oudsteSchaal = [
    { score: 1, label: '0 – 15 dagen' },
    { score: 2, label: '16 – 30 dagen' },
    { score: 3, label: '31 – 60 dagen' },
    { score: 4, label: '61 – 90 dagen' },
    { score: 5, label: '> 90 dagen' },
  ]
  return (
    <ScoreTooltip
      title="Hoe staan we er nu voor"
      description="Gemiddelde van twee parameters: % vervallen (hoe groot het probleem nu is) + leeftijd oudste post (hoe lang het al sleept)."
      composition={
        <div className="space-y-3 mb-2">
          <table className="w-full text-[11px] tabular-nums">
            <tbody className="text-white/80">
              <tr>
                <td className="pr-2 py-0.5">% vervallen</td>
                <td className="text-right pr-1">
                  {pctVervallen !== undefined ? `${Math.round(pctVervallen)}%` : '—'}
                </td>
                <td className="text-white/50 pl-2 text-right">
                  → score {pctScore ?? '—'}
                </td>
              </tr>
              <tr>
                <td className="pr-2 py-0.5">Oudste post</td>
                <td className="text-right pr-1">
                  {oudsteDagen !== undefined ? `${oudsteDagen}d` : '—'}
                </td>
                <td className="text-white/50 pl-2 text-right">
                  → score {oudsteScore ?? '—'}
                </td>
              </tr>
              <tr className="border-t border-white/20">
                <td className="font-medium pt-1">Huidige stand</td>
                <td className="text-right font-semibold pt-1 pr-1">{fmtNL(score, 1)}</td>
                <td className="text-white/50 pl-2 text-right pt-1">(gemiddelde)</td>
              </tr>
            </tbody>
          </table>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-white/50 mb-1">
              Schaal % vervallen
            </p>
            <table className="w-full text-[11px]">
              <tbody>
                {pctSchaal.map((t) => {
                  const active = t.score === pctScore
                  return (
                    <tr key={t.score} className={active ? 'text-white' : 'text-white/60'}>
                      <td className="pr-2 py-0.5 w-5 tabular-nums">{t.score}</td>
                      <td className={`py-0.5 ${active ? 'font-medium' : ''}`}>{t.label}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-white/50 mb-1">
              Schaal leeftijd oudste post
            </p>
            <table className="w-full text-[11px]">
              <tbody>
                {oudsteSchaal.map((t) => {
                  const active = t.score === oudsteScore
                  return (
                    <tr key={t.score} className={active ? 'text-white' : 'text-white/60'}>
                      <td className="pr-2 py-0.5 w-5 tabular-nums">{t.score}</td>
                      <td className={`py-0.5 ${active ? 'font-medium' : ''}`}>{t.label}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      }
    />
  )
}

export function tooltipOmzetconcentratie(
  score: number,
  pctOmzet: number | undefined,
  debiteurOmzet: number | undefined,
): React.ReactNode {
  const p = meta.omzet_percentielen
  const totaal = meta.jaaromzet_totaal
  // Drempel-formattering: percentage van netto jaaromzet voor het label,
  // bedrag (€) als secundair label. Bij ontbreken van percentielen valt de
  // tooltip terug op een leeg overzicht.
  const fmtPct = (eur: number) => (totaal > 0 ? `${((eur / totaal) * 100).toFixed(3)}%` : '—')
  const thresholds = p
    ? [
        { score: 1, label: `< ${fmtPct(p.p20)} (< ${fmtEUR(p.p20)} netto)` },
        { score: 2, label: `${fmtPct(p.p20)} – ${fmtPct(p.p40)} (${fmtEUR(p.p20)} – ${fmtEUR(p.p40)})` },
        { score: 3, label: `${fmtPct(p.p40)} – ${fmtPct(p.p60)} (${fmtEUR(p.p40)} – ${fmtEUR(p.p60)})` },
        { score: 4, label: `${fmtPct(p.p60)} – ${fmtPct(p.p80)} (${fmtEUR(p.p60)} – ${fmtEUR(p.p80)})` },
        { score: 5, label: `≥ ${fmtPct(p.p80)} (≥ ${fmtEUR(p.p80)} netto)` },
      ]
    : []
  const populatieN = meta.omzet_populatie_debiteuren
  const scopeLabel = meta.omzet_scope === 'salesarea' ? 'sales area' : 'administratie'
  const populatieRegel = populatieN
    ? `Top 20% van ${populatieN} debiteuren in deze ${scopeLabel} (op netto omzet, ex BTW).`
    : `Quintielen binnen deze ${scopeLabel} (netto omzet, ex BTW).`
  const currentRegel =
    debiteurOmzet !== undefined && pctOmzet !== undefined
      ? `${fmtEUR(debiteurOmzet)} netto · ${pctOmzet.toFixed(2)}% van netto jaaromzet → score ${score}`
      : pctOmzet !== undefined
        ? `${pctOmzet.toFixed(2)}% van netto jaaromzet → score ${score}`
        : undefined
  return (
    <ScoreTooltip
      title="Hoe belangrijk is deze klant"
      description={`Aandeel van deze klant in onze totale netto jaaromzet (ex BTW). De schaal verdeelt alle debiteuren met omzet in vijf even grote groepen (quintielen). ${populatieRegel}`}
      thresholds={thresholds}
      activeScore={score}
      current={currentRegel}
    />
  )
}

export function tooltipKrediet(
  score: number,
  onverzekerdPct: number | undefined,
  onverzekerdBedrag: number | undefined,
  pctScore: number | null | undefined,
  impactScore: number | null | undefined,
): React.ReactNode {
  const pctSchaal = [
    { score: 1, label: '0% (volledig binnen limiet)' },
    { score: 2, label: '1 – 25%' },
    { score: 3, label: '26 – 50%' },
    { score: 4, label: '51 – 75%' },
    { score: 5, label: '> 75% onverzekerd' },
  ]
  const p = meta.krediet_percentielen
  const impactSchaal = p
    ? [
        { score: 1, label: `< ${fmtEUR(p.p20)} onverzekerd` },
        { score: 2, label: `${fmtEUR(p.p20)} – ${fmtEUR(p.p40)}` },
        { score: 3, label: `${fmtEUR(p.p40)} – ${fmtEUR(p.p60)}` },
        { score: 4, label: `${fmtEUR(p.p60)} – ${fmtEUR(p.p80)}` },
        { score: 5, label: `≥ ${fmtEUR(p.p80)} (top 20% blootstelling)` },
      ]
    : []
  const populatieN = meta.krediet_populatie_debiteuren
  return (
    <ScoreTooltip
      title="Hoe is het kredietrisico"
      description="Gemiddelde van twee parameters: % onverzekerd (welk deel van het openstaande bedrag valt boven de kredietlimiet) + impact in euro (hoe groot het onverzekerd bedrag is t.o.v. andere debiteuren)."
      composition={
        <div className="space-y-3 mb-2">
          <table className="w-full text-[11px] tabular-nums">
            <tbody className="text-white/80">
              <tr>
                <td className="pr-2 py-0.5">% onverzekerd</td>
                <td className="text-right pr-1">
                  {onverzekerdPct !== undefined ? `${onverzekerdPct.toFixed(0)}%` : '—'}
                </td>
                <td className="text-white/50 pl-2 text-right">→ score {pctScore ?? '—'}</td>
              </tr>
              <tr>
                <td className="pr-2 py-0.5">Impact (€)</td>
                <td className="text-right pr-1">
                  {onverzekerdBedrag !== undefined ? fmtEUR(onverzekerdBedrag) : '—'}
                </td>
                <td className="text-white/50 pl-2 text-right">→ score {impactScore ?? '—'}</td>
              </tr>
              <tr className="border-t border-white/20">
                <td className="font-medium pt-1">Kredietrisico</td>
                <td className="text-right font-semibold pt-1 pr-1">{fmtNL(score, 1)}</td>
                <td className="text-white/50 pl-2 text-right pt-1">(gemiddelde)</td>
              </tr>
            </tbody>
          </table>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-white/50 mb-1">
              Schaal % onverzekerd
            </p>
            <table className="w-full text-[11px]">
              <tbody>
                {pctSchaal.map((t) => {
                  const active = t.score === pctScore
                  return (
                    <tr key={t.score} className={active ? 'text-white' : 'text-white/60'}>
                      <td className="pr-2 py-0.5 w-5 tabular-nums">{t.score}</td>
                      <td className={`py-0.5 ${active ? 'font-medium' : ''}`}>{t.label}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-white/50 mb-1">
              Schaal impact (€){populatieN ? ` — quintielen over ${populatieN} debiteuren` : ''}
            </p>
            <table className="w-full text-[11px]">
              <tbody>
                {impactSchaal.map((t) => {
                  const active = t.score === impactScore
                  return (
                    <tr key={t.score} className={active ? 'text-white' : 'text-white/60'}>
                      <td className="pr-2 py-0.5 w-5 tabular-nums">{t.score}</td>
                      <td className={`py-0.5 ${active ? 'font-medium' : ''}`}>{t.label}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      }
      activeScore={score}
    />
  )
}

// Tooltip voor de standaard-betaaldag stat. Toont hoe het patroon is
// bepaald (bron, venster, beslisregel, feestdag-correctie) en bij een
// patroon-verschuiving expliciet welk oud→nieuw is gedetecteerd.
export function tooltipStandaardBetaaldag(p: PatternInfo): React.ReactNode {
  const hasPattern = p.pattern_type !== 'geen' && p.pattern_value
  const typeLabel: Record<PatternInfo['pattern_type'], string> = {
    wekelijks: 'vaste weekdag',
    maanddag: 'vaste dag van de maand',
    geen: 'geen',
  }
  return (
    <div className="text-xs">
      <p className="font-medium text-white text-[12px] mb-1">Standaard betaaldag</p>
      <p className="text-white/70 text-[11px] leading-snug mb-2">
        Het ritme waarop deze klant fysiek betaalt. Wordt ook gebruikt door de herinneringsflow:
        valt een herinnering op deze dag, dan schuift hij één dag op (nooit geskipt).
      </p>
      <div className="space-y-1 text-[11px] text-white/80">
        <div className="flex justify-between gap-3">
          <span className="text-white/50">Patroon-type</span>
          <span>{typeLabel[p.pattern_type]}</span>
        </div>
        {hasPattern && (
          <div className="flex justify-between gap-3">
            <span className="text-white/50">Sterkte</span>
            <span>
              {p.hits ?? 0} hits op {p.fit_pct}%
            </span>
          </div>
        )}
        <div className="flex justify-between gap-3">
          <span className="text-white/50">Op basis van</span>
          <span>{p.payments_observed} betaaldagen</span>
        </div>
        {p.venster_maanden !== undefined && (
          <div className="flex justify-between gap-3">
            <span className="text-white/50">Venster</span>
            <span>laatste {p.venster_maanden} mnd</span>
          </div>
        )}
        {p.min_hits !== undefined && p.min_fit_pct !== undefined && (
          <div className="flex justify-between gap-3">
            <span className="text-white/50">Beslisregel</span>
            <span className="text-right">
              {p.high_volume_hits !== undefined && p.high_volume_fit_pct !== undefined ? (
                <>
                  ≥{p.high_volume_hits} hits + ≥{p.high_volume_fit_pct}%
                  <br />
                  óf ≥{p.min_hits} hits + ≥{p.min_fit_pct}%
                  <br />
                  óf {p.perfect_min_hits ?? 3}× 100%
                </>
              ) : (
                <>
                  ≥{p.min_hits} hits + ≥{p.min_fit_pct}% (of {p.perfect_min_hits ?? 3}× 100%)
                </>
              )}
            </span>
          </div>
        )}
        {p.feestdag_correctie && (
          <div className="flex justify-between gap-3">
            <span className="text-white/50">Correctie</span>
            <span>feestdagen NL/BE/TARGET</span>
          </div>
        )}
      </div>
      {p.verschuiving && (
        <div className="mt-2 pt-2 border-t border-white/20 bg-amber-500/10 -mx-3 -mb-3 px-3 pb-3 rounded-b-md">
          <p className="text-amber-200 font-medium text-[11px] mb-1">⚠ Patroon recent gewijzigd</p>
          <p className="text-white/80 text-[11px] leading-snug">
            Was <span className="font-medium">{p.verschuiving.van_waarde}</span> ({p.verschuiving.van_fit_pct}% over {p.verschuiving.van_n} betalingen), is nu <span className="font-medium">{p.verschuiving.naar_waarde}</span> ({p.verschuiving.naar_fit_pct}% over {p.verschuiving.naar_n} betalingen in de laatste {Math.round(p.verschuiving.sinds_dagen / 30)} mnd). Flow stuurt op het nieuwe patroon.
          </p>
        </div>
      )}
      <p className="text-white/80 text-[11px] leading-snug pt-2 mt-2 border-t border-white/20">
        {p.explanation}
      </p>
    </div>
  )
}
