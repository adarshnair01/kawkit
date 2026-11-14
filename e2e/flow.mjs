// End-to-end flow with accessibility checks.
//   KAWKIT_URL=http://localhost:4173/kawkit/ node flow.mjs
// Guest sample, sign-up, upload, priors, run, results, optimise, download; axe on every page in
// light and dark. The test user asks for its own deletion at the end; the worker's clean-up removes it.
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'

const require = createRequire(import.meta.url)
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')
const BASE = process.env.KAWKIT_URL ?? 'http://localhost:4173/kawkit/'
const SHOTS = process.env.KAWKIT_SHOTS
const results = []
const ok = (name, pass, detail = '') => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

const browser = await chromium.launch({
  executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined,
  proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined,
})
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })
const page = await context.newPage()
const consoleErrors = []
page.on('pageerror', (e) => consoleErrors.push(e.message))

async function axe(label) {
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme)
    await page.waitForTimeout(150)
    await page.evaluate(axeSource)
    const violations = await page.evaluate(async () => {
      const r = await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] })
      return r.violations.map((v) => `${v.id}: ${v.nodes.length} node(s), e.g. ${v.nodes[0].html.slice(0, 120)}`)
    })
    ok(`axe: ${label} (${theme})`, violations.length === 0, violations.join(' | '))
  }
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'))
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${label.replace(/\W+/g, '-')}.png`, fullPage: true })
}
const go = (hash) => page.goto(`${BASE}#${hash}`)

try {
  // ---------------------------------------------------------------- guest
  await page.goto(BASE)
  await page.getByRole('heading', { level: 1 }).waitFor()
  await axe('home')

  let t = Date.now()
  await go('/sample')
  await page.getByRole('heading', { name: 'Convergence check' }).waitFor()
  ok('guest sample loads in under 3 seconds', Date.now() - t < 3000, `${Date.now() - t} ms`)
  await axe('sample fit')

  // keyboard only: move through the tabs with arrow keys
  await page.getByRole('tab', { name: 'Fit' }).focus()
  for (const [name, check] of [
    ['Channels', 'Return on spend (ROI) per channel'],
    ['Prior vs posterior', 'Tv'],
    ['Response curves', 'Tv: response curve'],
    ['Optimise budget', 'Recommendation'],
  ]) {
    await page.keyboard.press('ArrowRight')
    await page.getByRole('heading', { name: check, exact: true }).first().waitFor()
    ok(`keyboard: arrow key opens "${name}"`, (await page.getByRole('tab', { name }).getAttribute('aria-selected')) === 'true')
    await axe(`sample ${name}`)
  }

  // optimiser: change the budget, the recommendation updates without a server
  const before = await page.getByRole('region', { name: 'Recommendation' }).innerText()
  t = Date.now()
  await page.getByLabel('Weekly budget').fill('220000')
  await page.waitForFunction((b) => document.querySelector('[aria-labelledby="opt-result"]').innerText !== b, before)
  ok('optimiser re-runs in under 2 seconds', Date.now() - t < 2000, `${Date.now() - t} ms`)
  await page.getByLabel('Weekly budget').fill('5')
  await page.getByText('below the sum of the channel minimums').waitFor()
  ok('impossible budget is explained', true)
  await page.getByLabel('Weekly budget').fill('400000')
  await page.getByLabel('Email maximum weekly spend').fill('400000')
  await page.getByText('Beyond your data').waitFor()
  ok('extrapolation is flagged', true)
  await page.getByRole('button', { name: /Show table for Current vs recommended/ }).click()
  ok('table view for the optimiser chart', (await page.getByRole('table', { name: /Current and recommended weekly spend/ }).count()) === 1)
  const dl = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download recommended split (CSV)' }).click()
  ok('recommended split downloads as CSV', (await (await dl).suggestedFilename()).endsWith('.csv'))

  // plain-language summary and the printable report
  await go('/sample')
  await page.getByText('What to do.').waitFor()
  ok('plain-language summary is shown', (await page.getByText('How far to trust it.').count()) === 1)
  await page.getByRole('button', { name: 'Open printable report' }).click()
  await page.getByRole('heading', { name: 'Recommended budget split' }).waitFor()
  ok('printable report shows every section', (await page.getByRole('heading', { name: 'Response curves' }).count()) === 1 && (await page.getByRole('tab').count()) === 0)
  await axe('report')
  await page.getByRole('button', { name: 'Back to the interactive view' }).click()
  await page.getByRole('tab', { name: 'Fit' }).click()
  ok('held-out weeks chart is shown', (await page.getByRole('heading', { name: /Can you trust it/ }).count()) === 1)

  // real-data examples: five brands, each with its caveats and attribution
  for (const k of ['home', 'beauty', 'apparel', 'food', 'health']) {
    await go(`/sample?example=${k}`)
    await page.getByText('Read this one with more care').waitFor()
    await page.getByRole('heading', { name: 'Convergence check' }).waitFor()
    ok(`real example "${k}" loads with caveats and attribution`, (await page.getByRole('link', { name: 'CC BY 4.0' }).count()) === 1)
    await page.locator('summary', { hasText: 'Outside factors' }).click()
    ok(`real example "${k}" shows the outside-factors test and baseline drivers`, (await page.getByRole('table', { name: /Error on unseen weeks/ }).count()) === 1 && (await page.getByRole('heading', { name: /baseline drivers/ }).count()) === 1)
    await axe(`real example ${k}`)
  }
  await page.getByRole('button', { name: 'Made-up data' }).click()
  await page.getByText('the true ROIs are known').waitFor()
  ok('switching back to the made-up example works', true)

  await go('/methodology')
  await page.getByRole('heading', { name: 'Glossary' }).waitFor()
  await axe('methodology')

  // ---------------------------------------------------------------- sign up
  await go('/runs')
  await page.getByRole('heading', { name: 'Sign in' }).waitFor()
  ok('signed-out visitors are sent to sign in', true)
  await axe('sign in')
  const userEmail = `e2e-${Date.now()}@kawkit-tests.example.com`
  await page.getByRole('button', { name: 'Create account' }).first().click()
  await page.getByLabel('Email').fill(userEmail)
  await page.getByLabel(/Password/).fill('correct-horse-battery')
  await page.keyboard.press('Enter')
  await page.getByRole('heading', { name: 'My runs' }).waitFor({ timeout: 20000 })
  ok('account created and signed in', true)
  await axe('my runs (empty)')

  // ---------------------------------------------------------------- bad file, then the sample
  await go('/new')
  await page.getByRole('heading', { name: 'Upload your data' }).waitFor()
  await page.getByLabel('Choose a CSV file').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('date,revenue,spend_tv\n2024-01-01,100,5\nnot-a-date,abc,-3\n') })
  await page.getByText('Date is not YYYY-MM-DD in row 3').waitFor()
  ok('bad file is rejected with row numbers', (await page.getByRole('button', { name: 'Continue' }).count()) === 0)
  await axe('new run (errors)')
  await page.getByRole('button', { name: 'Use the sample dataset' }).click()
  await page.getByRole('heading', { name: /looks good/ }).waitFor()
  ok('sample dataset passes the checks', true)
  await axe('new run (summary)')
  await page.getByRole('button', { name: 'Continue' }).click()

  // ---------------------------------------------------------------- priors and submit
  await page.locator('#lo-tv').fill('900')
  await page.locator('#hi-tv').fill('2000')
  await page.getByText('which is impossible').waitFor()
  ok('impossible priors block the run', await page.getByRole('button', { name: 'Submit run' }).isDisabled())
  await page.locator('#lo-tv').fill('0.8')
  await page.locator('#hi-tv').fill('2.0')
  await page.locator('#wk-tv').fill('4')
  await page.locator('#nt-tv').fill('Geo test, Q2 2025')
  await page.getByLabel('Run name').fill('E2E sample run')
  await axe('new run (priors)')
  await page.getByRole('button', { name: 'Submit run' }).click()
  await page.getByRole('heading', { name: /Waiting in the queue|Fitting the model/ }).waitFor({ timeout: 30000 })
  ok('run submitted and status shown', true)
  await axe('run status')

  t = Date.now()
  await page.getByRole('heading', { name: 'Convergence check' }).waitFor({ timeout: 600000 })
  ok('run finishes and results appear without a reload', true, `${Math.round((Date.now() - t) / 1000)} s`)
  await axe('results')
  await page.getByRole('tab', { name: 'Prior vs posterior' }).click()
  await page.getByText('Source: Geo test, Q2 2025.').waitFor()
  ok('the user prior and its source note are shown', true)
  await page.getByRole('tab', { name: 'Optimise budget' }).click()
  await page.getByRole('heading', { name: 'Recommendation' }).waitFor({ timeout: 20000 })
  ok('optimiser loads the posterior draws from private storage', true)
  await page.getByRole('tab', { name: 'Download' }).click()
  for (const name of ['Channel results', 'Weekly fit and contributions', 'Recommended split (default limits)', 'Posterior summary']) {
    const d = page.waitForEvent('download')
    await page.getByRole('button', { name }).click()
    ok(`download: ${name}`, (await (await d).suggestedFilename()).endsWith('.csv'))
  }

  // reload: still signed in, run is kept
  await page.reload()
  await go('/runs')
  await page.getByRole('link', { name: 'E2E sample run' }).waitFor({ timeout: 20000 })
  ok('still signed in after a reload; the run is in My runs', true)
  await axe('my runs')
  await go('/compare')
  await page.getByText('You need two finished runs').waitFor()
  await axe('compare (one run)')
  await go('/account')
  await page.getByRole('heading', { name: 'Delete my account' }).waitFor()
  await axe('account')

  // ---------------------------------------------------------------- phone width
  await page.setViewportSize({ width: 360, height: 780 })
  for (const hash of ['/', '/sample', '/runs', '/new', '/methodology']) {
    await go(hash)
    await page.waitForTimeout(700)
    const w = await page.evaluate(() => document.documentElement.scrollWidth)
    ok(`no sideways scroll at 360 px: ${hash}`, w <= 360, `${w}px`)
  }
  await page.setViewportSize({ width: 1280, height: 900 })

  // ---------------------------------------------------------------- delete the account
  await go('/account')
  await page.getByLabel('Type DELETE to confirm').fill('DELETE')
  await page.getByRole('button', { name: 'Delete my account and all my data' }).click()
  await page.getByRole('heading', { name: 'Sign in' }).waitFor({ timeout: 20000 })
  ok('account deletion requested and signed out', true)
  ok('no uncaught page errors', consoleErrors.length === 0, consoleErrors.join(' | '))
} catch (e) {
  ok(`flow stopped: ${String(e).split('\n')[0]}`, false)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/failure.png`, fullPage: true })
} finally {
  await browser.close()
}
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`)
process.exit(failed.length ? 1 : 0)
