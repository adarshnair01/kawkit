import type { BreakdownChannel, BreakdownResults, ChannelResult } from '../api/types'
import { ChartFrame } from '../charts/ChartFrame'
import { IntervalBars, type IntervalRow } from '../charts/IntervalBars'
import { fmtPct, fmtRange, fmtRoi, palette, title } from '../lib/format'
import { Term } from './Term'

const SEP = {
  yes: { cls: 'badge-ok', text: 'Yes' },
  partly: { cls: 'badge-warn', text: 'Partly' },
  no: { cls: 'badge-bad', text: 'No' },
} as const

const itemLabel = (name: string) => name.split(' / ').slice(1).join(' / ') || name

function ChannelSection({ b, channel, index }: { b: BreakdownChannel; channel: ChannelResult | undefined; index: number }) {
  const rows: IntervalRow[] = [
    ...(channel ? [{ label: `${title(b.name)} (whole channel)`, ...channel.roi, color: palette(index), hollow: true }] : []),
    ...b.items.map((it) => ({ label: itemLabel(it.name), median: it.roi.median, low: it.roi.low, high: it.roi.high, color: palette(index), detail: `${fmtPct(it.roi.p_above_channel)} chance above the channel average` })),
  ]
  const unseparated = b.items.filter((i) => i.separable === 'no')
  return (
    <section className="card grid gap-3" aria-labelledby={`bd-${b.name}`}>
      <div>
        <h3 id={`bd-${b.name}`}>{title(b.name)}, broken down by {b.dims.map(title).join(' and ')}</h3>
        {unseparated.length === b.items.length ? (
          <p className="notice notice-warn mt-1">The data can’t tell these items apart. Their ranges overlap almost completely, so treat them as equal until you can test them separately. The channel as a whole is still well measured.</p>
        ) : unseparated.length > 0 ? (
          <p className="text-sm muted mt-1">The data separates some of these items but not {unseparated.map((i) => itemLabel(i.name)).join(', ')}. Read those ranges as “close to the channel average, but we can’t say”.</p>
        ) : (
          <p className="text-sm muted mt-1">The data was able to tell these items apart. Ranges are 90% credible ranges for <Term k="roi">ROI</Term>.</p>
        )}
      </div>
      <ChartFrame
        title={`ROI by item in ${title(b.name)}`}
        note="Dot = median, bar = 90% range. The hollow bar is the whole channel."
        table={{
          caption: `ROI by item for ${b.name}`,
          header: ['Item', 'Share of spend', 'Share of the channel’s revenue', 'ROI (median)', 'ROI 90% range', 'Chance above channel average', 'Can the data tell it apart?'],
          rows: b.items.map((it) => [itemLabel(it.name), fmtPct(it.spend_share), `${fmtPct(it.contribution_share.median)} (${fmtPct(it.contribution_share.low)} to ${fmtPct(it.contribution_share.high)})`, fmtRoi(it.roi.median), fmtRange(it.roi.low, it.roi.high), fmtPct(it.roi.p_above_channel), SEP[it.separable].text]),
        }}
      >
        <IntervalBars ariaLabel={`ROI per item of ${b.name} with 90% ranges`} rows={rows} fmt={fmtRoi} reference={{ value: 1, label: 'break-even (1.0)' }} xLabel="ROI (revenue per unit of spend)" />
      </ChartFrame>
      <div className="overflow-x-auto">
        <table className="data num">
          <caption className="sr-only">Items of {b.name}</caption>
          <thead><tr><th scope="col">Item</th><th scope="col">Spend share</th><th scope="col">ROI</th><th scope="col">Chance above channel average</th><th scope="col">Can the data tell it apart?</th></tr></thead>
          <tbody>
            {b.items.map((it) => (
              <tr key={it.name}>
                <th scope="row" style={{ fontWeight: 500, whiteSpace: 'normal' }}>{itemLabel(it.name)}</th>
                <td>{fmtPct(it.spend_share)}</td>
                <td>{fmtRoi(it.roi.median)} <span className="muted">({fmtRange(it.roi.low, it.roi.high)})</span></td>
                <td>{fmtPct(it.roi.p_above_channel)}</td>
                <td><span className={`badge ${SEP[it.separable].cls}`}>{SEP[it.separable].text}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {b.effects.length > 0 && (
        <div>
          <h4 className="font-semibold">Effect of each {b.dims.join(' / ')} value</h4>
          <p className="text-sm muted">How much better or worse than a typical item in the channel. 1.0× means typical; 1.5× means 50% more return per unit of spend.</p>
          <div className="overflow-x-auto mt-1">
            <table className="data num">
              <caption className="sr-only">Effect of each value of {b.dims.join(' and ')} on {b.name}</caption>
              <thead><tr><th scope="col">Breakdown</th><th scope="col">Value</th><th scope="col">Effect</th><th scope="col">90% range</th></tr></thead>
              <tbody>
                {b.effects.map((e) => (
                  <tr key={`${e.dim}-${e.level}`}><th scope="row" style={{ fontWeight: 500 }}>{title(e.dim)}</th><td>{e.level}</td><td>{e.effect.median.toFixed(2)}×</td><td>{e.effect.low.toFixed(2)}× to {e.effect.high.toFixed(2)}×</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}

export function BreakdownView({ breakdown, channels }: { breakdown: BreakdownResults; channels: ChannelResult[] }) {
  const channelOnly = breakdown.channel_only ?? []
  return (
    <div className="grid gap-4">
      <div className="notice">
        <strong>How to read this.</strong> Each channel is split into items (platforms, campaigns…). The model estimates every item together with its channel, and pulls items toward the channel average unless the data insists. That is why items the data can’t separate come back close together with wide ranges. A breakdown shows where the return <em>came from</em> in the past, not a promise that moving money will repeat it.
        {breakdown.range_widen !== 1 && <> Item ranges are widened by {breakdown.range_widen.toFixed(2)}× because tests on made-up data showed them slightly too narrow.</>}
      </div>
      {breakdown.warnings && breakdown.warnings.length > 0 && (
        <div className="notice notice-warn"><ul className="list-disc pl-5">{breakdown.warnings.map((w) => <li key={w.message}>{w.message}</li>)}</ul></div>
      )}
      {breakdown.channels.map((b) => {
        const i = channels.findIndex((c) => c.name === b.name)
        return <ChannelSection key={b.name} b={b} channel={channels[i]} index={Math.max(i, 0)} />
      })}
      {channelOnly.length > 0 && (
        <section className="card" aria-labelledby="bd-cmp-h">
          <h3 id="bd-cmp-h">Did the breakdown change the channel answers?</h3>
          <p className="text-sm muted mt-0.5">The same data fitted without the breakdown. Large differences mean the breakdown told the model something the channel totals did not.</p>
          <div className="overflow-x-auto mt-2">
            <table className="data num">
              <caption className="sr-only">Channel ROI with and without the breakdown</caption>
              <thead><tr><th scope="col">Channel</th><th scope="col">With the breakdown</th><th scope="col">Without it</th></tr></thead>
              <tbody>
                {channels.map((c) => {
                  const o = channelOnly.find((x) => x.name === c.name)
                  return (
                    <tr key={c.name}>
                      <th scope="row" style={{ fontWeight: 500 }}>{title(c.name)}</th>
                      <td>{fmtRoi(c.roi.median)} <span className="muted">({fmtRange(c.roi.low, c.roi.high)})</span></td>
                      <td>{o ? <>{fmtRoi(o.roi.median)} <span className="muted">({fmtRange(o.roi.low, o.roi.high)})</span></> : '–'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
