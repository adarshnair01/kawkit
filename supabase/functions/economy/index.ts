// Economy connector: monthly economic indicators for a country, from FRED (Federal Reserve Bank of
// St. Louis). Runs server-side so the FRED key stays in Supabase secrets and never reaches the browser.
// Only signed-in users can call it: the caller's token is checked against Supabase Auth, because the
// gateway alone also lets the public key through. Only the series listed here can be read.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// units "pc1" is FRED's "percent change from a year ago"
const SERIES: Record<string, Record<string, { id: string; units?: string; label: string }>> = {
  US: {
    unemployment: { id: 'UNRATE', label: 'Unemployment rate (%)' },
    inflation: { id: 'CPIAUCSL', units: 'pc1', label: 'Inflation: consumer prices, % on a year ago' },
    consumer_confidence: { id: 'UMCSENT', label: 'Consumer sentiment (University of Michigan)' },
    interest_rate: { id: 'FEDFUNDS', label: 'Interest rate: federal funds (%)' },
    retail_growth: { id: 'RSXFS', units: 'pc1', label: 'Retail sales, % on a year ago' },
  },
  UK: {
    unemployment: { id: 'LRHUTTTTGBM156S', label: 'Unemployment rate (%)' },
    inflation: { id: 'GBRCPIALLMINMEI', units: 'pc1', label: 'Inflation: consumer prices, % on a year ago' },
    consumer_confidence: { id: 'CSCICP02GBM460S', label: 'Consumer confidence (OECD balance)' },
    interest_rate: { id: 'IR3TIB01GBM156N', label: 'Interest rate: 3-month interbank (%)' },
    retail_growth: { id: 'GBRSLRTTO01GYSAM', label: 'Retail sales volume, % on a year ago' },
  },
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const DATE = /^\d{4}-\d{2}-\d{2}$/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)
  // signed-in users only, so an anonymous visitor cannot use up the FRED allowance
  const auth = req.headers.get('Authorization') ?? ''
  const who = auth.startsWith('Bearer ')
    ? await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, { headers: { Authorization: auth, apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '' } }).catch(() => null)
    : null
  if (!who || !who.ok) return json({ error: 'Sign in to use the economy connector.' }, 401)

  const key = Deno.env.get('FRED_API_KEY')
  if (!key) return json({ error: 'The economy connector is not set up: the FRED key is missing.' }, 503)

  let body: { country?: string; start?: string; end?: string; indicators?: string[] }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Send JSON.' }, 400)
  }
  const country = String(body.country ?? '').toUpperCase()
  const available = SERIES[country]
  if (!available) return json({ error: `Country must be one of: ${Object.keys(SERIES).join(', ')}.` }, 400)
  if (!DATE.test(body.start ?? '') || !DATE.test(body.end ?? '') || body.start! > body.end!) return json({ error: 'Give start and end as YYYY-MM-DD.' }, 400)
  const wanted = (Array.isArray(body.indicators) && body.indicators.length ? body.indicators : Object.keys(available)).filter((k) => k in available)
  if (!wanted.length) return json({ error: 'No known indicators were asked for.' }, 400)

  const fetched = await Promise.all(
    wanted.map(async (name) => {
      const s = available[name]
      const url = new URL('https://api.stlouisfed.org/fred/series/observations')
      url.search = new URLSearchParams({ series_id: s.id, api_key: key, file_type: 'json', observation_start: body.start!, observation_end: body.end!, frequency: 'm', ...(s.units ? { units: s.units } : {}) }).toString()
      try {
        const r = await fetch(url)
        if (!r.ok) return [name, { label: s.label, series_id: s.id, error: `FRED answered ${r.status}`, observations: [] }] as const
        const data = await r.json()
        const observations = (data.observations ?? [])
          .map((o: { date: string; value: string }) => ({ date: o.date, value: Number(o.value) }))
          .filter((o: { value: number }) => Number.isFinite(o.value))
        return [name, { label: s.label, series_id: s.id, observations }] as const
      } catch {
        return [name, { label: s.label, series_id: s.id, error: 'FRED could not be reached', observations: [] }] as const
      }
    }),
  )
  return json({
    country,
    source: 'FRED, Federal Reserve Bank of St. Louis',
    notice: 'This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.',
    series: Object.fromEntries(fetched),
  })
})
