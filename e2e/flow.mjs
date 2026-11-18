// End-to-end flow with accessibility checks.
//   KAWKIT_URL=http://localhost:4173/kawkit/ node flow.mjs
// Guest sample, sign-up, upload, priors, run, results, optimise, download; axe on every page. The test user asks for its own deletion at the end; the worker's clean-up removes it.
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
  await page.evaluate(axeSource)
  const violations = await page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] })
    return r.violations.map((v) => `${v.id}: ${v.nodes.length} node(s), e.g. ${v.nodes[0].html.slice(0, 120)}`)
  })
  ok(`axe: ${label}`, violations.length === 0, violations.join(' | '))
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${label.replace(/\W+/g, '-')}.png`, fullPage: true })
}
const go = (hash) => page.goto(`${BASE}#${hash}`)

try {
  // ---------------------------------------------------------------- guest
  await page.goto(BASE)
  await page.getByRole('heading', { level: 1 }).waitFor()
  await page.waitForTimeout(1500) // let the entrance animations finish before measuring contrast
  await axe('home')
  ok('landing page lists six features', (await page.locator('.feature').count()) === 6)

  let t = Date.now()
  await go('/sample')
  await page.getByRole('heading', { name: 'Convergence check' }).waitFor()
  ok('guest sample loads in under 3 seconds', Date.now() - t < 3000, `${Date.now() - t} ms`)
  await axe('sample fit')
  await page.getByRole('button', { name: 'Take the 1-minute tour' }).click()
  await page.getByRole('region', { name: 'Guided tour' }).waitFor()
  for (let i = 0; i < 4; i++) await page.getByRole('region', { name: 'Guided tour' }).getByRole('button', { name: 'Next' }).click()
  ok('the guided tour reaches its last step and highlights the optimiser tab', (await page.locator('.tour-target').count()) === 1 && (await page.getByRole('link', { name: 'Try it on your data' }).count()) === 1)
  await axe('sample tour')
  await page.keyboard.press('Escape')
  ok('Esc closes the tour', (await page.getByRole('region', { name: 'Guided tour' }).count()) === 0)

  // glossary: a dotted term explains itself and hands over to Neon
  await page.getByRole('tab', { name: 'Fit' }).click()
  await page.getByRole('button', { name: 'R-hat', exact: true }).first().click()
  await page.getByText('A check that the model’s separate calculations agree').waitFor()
  await axe('glossary popover open')
  await page.getByRole('button', { name: 'Tell me more in Neon →' }).click()
  const neonAsk = page.getByRole('dialog', { name: /Neon/ })
  await neonAsk.getByText(/converge/i).first().waitFor({ timeout: 15000 })
  ok('a glossary term opens Neon with the full answer', true)
  await page.keyboard.press('Escape')
  await neonAsk.waitFor({ state: 'detached' })

  // the sample page invites guests to move the budget without an account
  await page.getByRole('button', { name: 'Try moving the budget' }).click()
  await page.getByRole('heading', { name: 'Try your own split' }).waitFor()
  ok('"Try moving the budget" opens the planner for a guest', true)
  await page.getByRole('tab', { name: 'Fit' }).click()

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
  // scenario planner and target mode
  await page.getByRole('button', { name: 'Reset to defaults' }).click()
  await page.getByRole('button', { name: 'Cut everything 20%' }).click()
  await page.getByText('Expected change in weekly revenue', { exact: true }).waitFor()
  ok('scenario planner shows the effect of a typed split', (await page.locator('section[aria-labelledby="scn-h"]').getByText(/less spend overall/).count()) === 1)
  await page.getByLabel('Extra weekly revenue wanted').fill('20000')
  await page.getByRole('button', { name: 'Find the budget' }).click()
  await page.getByText('Weekly budget needed').waitFor()
  ok('target mode finds a budget for a reachable target', true)
  await page.getByLabel('Extra weekly revenue wanted').fill('9000000')
  await page.getByRole('button', { name: 'Find the budget' }).click()
  await page.getByText('Out of reach within these limits.').waitFor()
  ok('target mode says when a target is out of reach', true)
  await axe('sample planners')

  // drag a slider: with the total fixed, the other channels give way
  await page.getByRole('tab', { name: 'Optimise budget' }).click()
  const slider = page.getByLabel(/^Drag .* weekly spend$/).first()
  const lastBefore = await page.getByLabel(/^Drag .* weekly spend$/).last().inputValue()
  const max = Number(await slider.getAttribute('max'))
  await slider.fill(String(Math.round(max * 0.9)))
  const lastAfter = await page.getByLabel(/^Drag .* weekly spend$/).last().inputValue()
  ok('dragging one channel moves money out of the others while the total stays fixed', lastBefore !== lastAfter && (await page.getByText('Change a number to see what happens.').count()) === 0)
  await axe('sample sliders')

  // the response curve explorer
  await page.getByRole('tab', { name: 'Response curves' }).click()
  const tryBox = page.getByLabel(/^Try a weekly spend/).first()
  await tryBox.fill(String(Math.round(Number(await tryBox.getAttribute('max')) * 0.8)))
  await page.getByText(/Expect about/).first().waitFor()
  ok('the response curve explorer reports revenue at a chosen spend', true)
  await axe('sample curve explorer')
  await page.getByRole('tab', { name: 'Optimise budget' }).click()

  const dl = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download recommended split (CSV)' }).click()
  ok('recommended split downloads as CSV', (await (await dl).suggestedFilename()).endsWith('.csv'))

  // plain-language summary and the printable report
  await go('/sample')
  await page.getByText('What to do.').waitFor()
  await page.getByRole('tab', { name: 'Channels' }).click()
  ok('what to test next names a channel', (await page.getByText(/Run an experiment on \w+ first\./).count()) === 1)
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
    ok(`real example "${k}" shows the outside-factors test and baseline drivers`, (await page.getByRole('table', { name: /Error on unseen weeks/ }).count()) === 3 && (await page.getByRole('heading', { name: /baseline drivers/ }).count()) === 1)
    await axe(`real example ${k}`)
  }
  await page.getByRole('button', { name: 'Made-up data', exact: true }).click()
  await page.getByText('the true ROIs are known').waitFor()
  ok('switching back to the made-up example works', true)

  // breakdown example: items inside channels, with known truth, and the two-level optimiser
  await go('/sample?example=breakdown')
  await page.getByRole('tab', { name: 'Breakdown' }).click()
  await page.getByRole('heading', { name: /Social, broken down by Platform/ }).waitFor({ timeout: 20000 })
  ok('the breakdown example lists items with their ROI ranges and separability', (await page.getByRole('heading', { name: /Search, broken down by Term/ }).count()) === 1 && (await page.getByRole('heading', { name: /Display, broken down by Platform and Region/ }).count()) === 1 && (await page.getByText('The data can’t tell these items apart.').count()) >= 1)
  ok('the summary speaks about channels, not items', (await page.locator('.summary').first().innerText()).includes('Move budget') && !/Search \/ brand/.test(await page.locator('.summary').first().innerText()))
  await axe('sample breakdown tab')
  await page.getByRole('tab', { name: 'Optimise budget' }).click()
  await page.getByRole('radio', { name: /Also re-split inside channels/ }).check()
  await page.getByText(/cannot tell its items apart/).waitFor({ timeout: 10000 })
  ok('re-splitting is held back where the data cannot tell items apart', (await page.getByText(/Where it comes from/).count()) === 1)
  await page.getByRole('radio', { name: /Between channels only/ }).check()
  ok('between-channels mode has no within-channel gain', (await page.getByText(/from re-splitting inside them/).count()) === 0)
  await axe('sample breakdown optimiser')
  await page.getByRole('tab', { name: 'Fit' }).click()
  await go('/sample')

  // ---------------------------------------------------------------- lessons page, and the free data check
  await go('/lessons')
  await page.getByRole('heading', { name: 'What five real brands taught this model' }).waitFor()
  await page.getByRole('table', { name: /model against a simple forecast, per brand/ }).waitFor()
  ok('lessons page shows the per-brand accuracy table', (await page.getByRole('row').count()) === 6)
  await axe('lessons')

  // jump bar and shortcut list
  await page.keyboard.press('Control+k')
  await page.getByRole('dialog', { name: /Jump to/ }).waitFor()
  await page.getByRole('combobox', { name: 'Jump to' }).fill('check my')
  await page.keyboard.press('Enter')
  await page.getByRole('heading', { name: 'Check your data' }).waitFor()
  ok('Ctrl+K jumps to a page from the keyboard', true)
  await page.keyboard.press('?')
  await page.getByRole('dialog', { name: 'Keyboard shortcuts' }).waitFor()
  await axe('shortcuts dialog')
  await page.keyboard.press('Escape')
  ok('? opens the shortcut list and Esc closes it', (await page.getByRole('dialog', { name: 'Keyboard shortcuts' }).count()) === 0)

  // Beat the model
  await go('/play')
  await page.getByRole('heading', { name: /^Split .* a week across/ }).waitFor({ timeout: 20000 })
  await axe('play')
  await page.getByRole('button', { name: 'Lock it in' }).click()
  await page.getByText('You captured').waitFor()
  ok('the game scores a split against the model', (await page.getByText('Your score').count()) === 1)
  await axe('play result')

  // ---------------------------------------------------------------- Neon, the help chat
  const launcher = page.locator('.neon-launcher')
  await launcher.click()
  const neon = page.getByRole('dialog', { name: /Neon/ })
  await neon.waitFor()
  await neon.getByRole('button', { name: 'Clear the conversation' }).click()
  await neon.getByRole('button', { name: 'Browse all topics' }).first().waitFor()
  ok('Neon opens with suggested questions', true)
  await neon.getByLabel('Ask Neon a question').fill('how much data do i need')
  await neon.getByRole('button', { name: 'Send' }).click()
  await neon.getByText(/weeks/).first().waitFor()
  ok('Neon answers a data question', (await neon.getByRole('group', { name: /Related questions|Or did you mean/ }).count()) >= 1)
  await neon.getByLabel('Ask Neon a question').fill('recipe for chocolate cake')
  await neon.getByRole('button', { name: 'Send' }).click()
  await neon.getByText(/don’t have an answer|not certain/).first().waitFor()
  ok('Neon admits when it has no answer', true)
  await neon.getByRole('button', { name: 'Browse all topics' }).last().click()
  await neon.getByRole('button', { name: 'Reading results' }).last().waitFor()
  ok('Neon topic browser lists categories', true)
  await axe('Neon open')
  await page.keyboard.press('Escape')
  await neon.waitFor({ state: 'detached' })
  ok('Esc closes Neon and returns focus to the launcher', await launcher.evaluate((el) => el === document.activeElement))

  await go('/check')
  await page.getByRole('heading', { name: 'Check your data' }).waitFor()
  await page.getByRole('button', { name: 'Use the sample dataset' }).click()
  await page.getByText('Ready to run').waitFor()
  ok('a visitor can check data without an account', (await page.getByRole('button', { name: 'Sign in to run the model on this data' }).count()) === 1 && (await page.getByLabel('Country').count()) === 0)
  await axe('data check (guest)')
  await page.getByRole('button', { name: 'Sign in to run the model on this data' }).click()
  await page.getByRole('heading', { name: 'Sign in' }).waitFor()
  ok('the data check hands over to sign-in', true)
  const kept = await page.evaluate(() => sessionStorage.getItem('kawkit-pending-data'))
  ok('checked data is kept in the browser for after sign-in', !!kept && kept.includes('spend_tv'))
  await page.evaluate(() => sessionStorage.removeItem('kawkit-pending-data'))

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
  await page.getByRole('heading', { name: 'Let’s get your first model cooking' }).waitFor({ timeout: 20000 })
  ok('the empty My runs page welcomes a new user with three steps', (await page.getByRole('heading', { name: 'Let’s get your first model cooking' }).count()) === 1 && (await page.getByRole('link', { name: 'Try a real brand' }).count()) === 1)
  await axe('my runs (empty)')

  // ---------------------------------------------------------------- bad file, then the sample
  await go('/new')
  await page.getByRole('heading', { name: 'Bring in your data' }).waitFor()
  await page.getByLabel('Choose a CSV file').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('date,revenue,spend_tv\n2024-01-01,100,5\nnot-a-date,abc,-3\n') })
  await page.getByText('Date is not YYYY-MM-DD in row 3').waitFor()
  ok('bad file is rejected with row numbers', (await page.getByRole('button', { name: 'Continue' }).count()) === 0)
  await axe('new run (errors)')
  // one-click repairs: day-first dates and blank spend are fixed in the browser copy
  {
    const rows = ['date,revenue,spend_tv,spend_search']
    for (let i = 0; i < 60; i++) {
      const d = new Date(Date.UTC(2023, 0, 2 + 7 * i))
      rows.push(`${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()},${50000 + 700 * (i % 9)},${i === 7 ? '' : 1000 + 300 * (i % 5)},${800 + 90 * (i % 7)}`)
    }
    await page.getByLabel('Choose a CSV file').setInputFiles({ name: 'dmy.csv', mimeType: 'text/csv', buffer: Buffer.from(rows.join('\n')) })
    await page.getByRole('button', { name: 'Convert the dates' }).waitFor()
    await axe('new run (fixable errors)')
    await page.getByRole('button', { name: 'Convert the dates' }).click()
    await page.getByRole('button', { name: 'Treat blank spend and control cells as 0' }).click()
    await page.getByRole('heading', { name: /dmy.csv looks good/ }).waitFor()
    ok('two one-click fixes turn a rejected file into a runnable one', true)
  }
  await page.getByRole('button', { name: 'Home decor brand' }).click()
  await page.getByRole('heading', { name: /Home decor brand \(real example\).csv looks good/ }).waitFor({ timeout: 20000 })
  ok('"No data yet?" loads a real brand that passes the checks', true)

  // ---------------------------------------------------------------- breakdown file: preview checks, then a real run
  {
    const { readFileSync } = await import('node:fs')
    const dir = new URL('../web/public/sample/', import.meta.url)
    await page.getByLabel('Choose a CSV file').setInputFiles({ name: 'bd-main.csv', mimeType: 'text/csv', buffer: readFileSync(new URL('breakdown-main.csv', dir)) })
    await page.getByRole('heading', { name: /bd-main.csv looks good/ }).waitFor({ timeout: 20000 })
    await page.getByRole('heading', { name: 'Break channels down (optional)' }).waitFor()
    await page.getByLabel('Choose a breakdown CSV file').setInputFiles({ name: 'bd-long.csv', mimeType: 'text/csv', buffer: readFileSync(new URL('breakdown-long.csv', dir)) })
    await page.getByRole('group', { name: 'Break Social down by' }).getByLabel('Platform').check()
    await page.getByRole('group', { name: 'Break Search down by' }).getByLabel('Term').check()
    await page.getByRole('group', { name: 'Break Display down by' }).getByLabel('Platform').check()
    await page.getByRole('group', { name: 'Break Display down by' }).getByLabel('Region').check()
    await page.getByText(/^3 items:/).waitFor()
    ok('the breakdown preview shows items and rates how separable they are', (await page.getByText('The mix barely changes: the model will not be able to separate these').count()) === 1 && (await page.getByText('Items move independently: the model can tell them apart').count()) >= 1 && (await page.getByText(/combined additively/).count()) === 1)
    await axe('new run (breakdown)')
    // a breakdown that does not add up is rejected in plain words
    const longText = readFileSync(new URL('breakdown-long.csv', dir), 'utf8').split('\n').map((l, i) => (i && l.includes(',social,') ? l.replace(/,(\d+)$/, (_, n) => `,${Number(n) * 2}`) : l)).join('\n')
    await page.getByRole('button', { name: 'Remove this file' }).click()
    await page.getByLabel('Choose a breakdown CSV file').setInputFiles({ name: 'bd-double.csv', mimeType: 'text/csv', buffer: Buffer.from(longText) })
    await page.getByRole('group', { name: 'Break Social down by' }).getByLabel('Platform').check()
    await page.getByText(/adds up to .* more than social's total/).waitFor()
    ok('a breakdown that adds up to too much is explained and stops the run', await page.getByRole('button', { name: 'Continue' }).count() === 1)
    await page.getByRole('button', { name: 'Remove this file' }).click()
    await page.getByLabel('Choose a breakdown CSV file').setInputFiles({ name: 'bd-long.csv', mimeType: 'text/csv', buffer: readFileSync(new URL('breakdown-long.csv', dir)) })
    await page.getByRole('group', { name: 'Break Social down by' }).getByLabel('Platform').check()
    await page.getByRole('group', { name: 'Break Display down by' }).getByLabel('Platform').check()
    await page.getByRole('group', { name: 'Break Display down by' }).getByLabel('Region').check()
    await page.getByText(/^3 items:/).waitFor()
    await go('/new')
    await page.getByRole('heading', { name: 'Bring in your data' }).waitFor()
  }

  // ---------------------------------------------------------------- connectors
  // a spreadsheet with its own column names and day-first dates goes through the column mapper
  const messy = ['Week commencing,Sales,TV cost,Paid Search Spend,Promo running,Notes']
  for (let i = 0; i < 60; i++) {
    const d = new Date(Date.UTC(2023, 0, 2 + 7 * i))
    messy.push(`${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()},${50000 + 700 * (i % 9)},${1000 + 300 * (i % 5)},${800 + 90 * (i % 7)},${i % 8 === 0 ? 1 : 0},ok`)
  }
  await page.getByLabel('Choose a CSV file').setInputFiles({ name: 'my-export.csv', mimeType: 'text/csv', buffer: Buffer.from(messy.join('\n')) })
  await page.getByRole('heading', { name: 'Tell us which column is which' }).waitFor()
  ok('column mapper guesses the roles', (await page.getByLabel('What is column Sales').inputValue()) === 'revenue' && (await page.getByLabel('What is column TV cost').inputValue()) === 'spend' && (await page.getByLabel('What is column Notes').inputValue()) === 'ignore')
  await axe('new run (column mapper)')
  await page.getByRole('button', { name: 'Use these columns' }).click()
  await page.getByRole('heading', { name: /looks good/ }).waitFor()
  ok('mapped file passes the checks with dates converted', (await page.getByText('2023-01-02 to 2024-02-19').count()) === 1)

  // the event library adds baseline columns worked out from the dates
  await page.getByRole('button', { name: 'Add selected to my data' }).click()
  await page.getByText(/Added to the baseline: black friday week/).waitFor()
  ok('event library adds calendar events to the baseline', (await page.getByText('Promo running, Black friday, Cyber week, Pre christmas, Christmas newyear, Easter').count()) === 1)
  await axe('new run (event library)')

  // the economy connector fetches real figures through the server-side function
  await page.getByLabel('Country').selectOption('UK')
  await page.getByLabel(/^Unemployment rate/).check()
  await page.getByLabel(/^Consumer confidence/).check()
  await page.getByRole('button', { name: 'Fetch and add to my data' }).click()
  await page.getByText(/Added to the baseline for the United Kingdom: unemployment rate, consumer confidence/).waitFor({ timeout: 30000 })
  ok('economy connector fetches and adds indicators', (await page.getByText(/Easter, Unemployment, Consumer confidence/).count()) === 1)
  await axe('new run (economy connector)')

  // import from a link (the sheet itself is stubbed: no real Google Sheet is contacted)
  const sampleCsv = await (await page.request.get(`${BASE}sample/sample.csv`)).text()
  await page.route('https://docs.google.com/spreadsheets/d/TESTSHEET/**', (route) => route.fulfill({ status: 200, contentType: 'text/csv', headers: { 'access-control-allow-origin': '*' }, body: sampleCsv }))
  await page.getByLabel(/Or import from a link/).fill('https://docs.google.com/spreadsheets/d/TESTSHEET/edit#gid=0')
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await page.getByRole('heading', { name: 'Google Sheet.csv looks good' }).waitFor()
  ok('import from a Google Sheets link loads the data', true)
  await page.unroute('https://docs.google.com/spreadsheets/d/TESTSHEET/**')

  await page.getByRole('button', { name: 'Use the sample dataset' }).click()
  await page.getByRole('heading', { name: /Sample dataset.csv looks good/ }).waitFor()
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
  if ((await page.getByRole('heading', { name: 'Fitting the model' }).count()) === 1) ok('the waiting screen names the stages and gives a tip', (await page.getByRole('list', { name: 'Stages' }).count()) === 1 && (await page.getByText('While you wait').count()) === 1)
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
  {
    const d = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Excel workbook (everything)' }).click()
    const dl = await d
    ok('download: Excel workbook', dl.suggestedFilename().endsWith('.xlsx'))
    const { createRequire } = await import('node:module')
    const { unzipSync, strFromU8 } = createRequire(import.meta.url)('../web/node_modules/fflate')
    const { readFileSync } = await import('node:fs')
    const zip = unzipSync(new Uint8Array(readFileSync(await dl.path())))
    ok('the workbook has a channels sheet with real numbers', strFromU8(zip['xl/workbook.xml']).includes('Channels') && /<v>\d/.test(strFromU8(zip['xl/worksheets/sheet2.xml'])))
  }
  for (const name of ['Channel results', 'Weekly fit and contributions', 'Recommended split (default limits)', 'Posterior summary']) {
    const d = page.waitForEvent('download')
    await page.getByRole('button', { name }).click()
    ok(`download: ${name}`, (await (await d).suggestedFilename()).endsWith('.csv'))
  }

  // ---------------------------------------------------------------- saved scenarios
  await page.getByRole('tab', { name: 'Optimise budget' }).click()
  await page.getByRole('button', { name: 'Cut everything 20%' }).click()
  await page.getByLabel('Name for the split above').fill('Cut 20 percent')
  await page.getByRole('button', { name: 'Save scenario' }).click()
  await page.getByRole('row', { name: /Cut 20 percent/ }).waitFor({ timeout: 20000 })
  ok('a scenario is saved and shown with its expected change', true)
  await axe('saved scenarios')
  await page.reload()
  await page.getByRole('tab', { name: 'Optimise budget' }).click()
  await page.getByRole('row', { name: /Cut 20 percent/ }).waitFor({ timeout: 20000 })
  ok('the saved scenario is still there after a reload', true)
  await page.getByRole('button', { name: 'Delete Cut 20 percent' }).click()
  await page.getByText('No saved scenarios yet').waitFor()
  ok('a saved scenario can be deleted', true)

  // ---------------------------------------------------------------- notes and tags
  await page.getByRole('button', { name: 'Add notes' }).click()
  await page.getByLabel('Note (up to 500 characters)').fill('With the Black Friday dummy')
  await page.getByLabel(/Tags, separated by commas/).fill('client-a, q3, client-a')
  await page.getByRole('button', { name: 'Save notes' }).click()
  await page.getByRole('region', { name: 'Notes on this run' }).waitFor({ timeout: 20000 })
  ok('a confirmation toast appears when notes are saved', (await page.locator('.toast', { hasText: 'Notes saved' }).count()) >= 1)
  const tagCounts = [await page.locator('.badge', { hasText: 'client-a' }).count(), await page.locator('.badge', { hasText: 'q3' }).count()]
  ok('notes and de-duplicated tags are saved on the run', tagCounts.join() === '1,1', `counts ${tagCounts.join(',')}`)
  await go('/runs')
  await page.getByText('With the Black Friday dummy').waitFor()
  ok('notes and tags show on My runs', (await page.locator('.badge', { hasText: 'q3' }).count()) === 1)
  await axe('my runs with notes')
  await page.getByRole('link', { name: 'E2E sample run' }).click()
  await page.getByRole('heading', { name: 'Convergence check' }).waitFor({ timeout: 20000 })

  // ---------------------------------------------------------------- share link
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  const shareLink = await page.getByLabel('Share link').inputValue({ timeout: 20000 })
  ok('a share link is created for the finished run', /#\/shared\/[0-9a-f-]{36}$/.test(shareLink))
  await axe('run with share panel')
  const visitor = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const guest = await visitor.newPage()
  await guest.goto(shareLink)
  await guest.getByRole('heading', { name: 'E2E sample run' }).waitFor({ timeout: 20000 })
  await guest.getByRole('heading', { name: 'Convergence check' }).waitFor()
  await guest.getByRole('tab', { name: 'Optimise budget' }).click()
  ok('someone who is not signed in can open the shared result', (await guest.getByText('available to the person who ran this model').count()) === 1)
  await page.getByRole('button', { name: 'Stop sharing' }).click()
  await page.getByRole('button', { name: 'Share', exact: true }).waitFor()
  await guest.reload()
  await guest.getByRole('heading', { name: 'This link no longer works' }).waitFor({ timeout: 20000 })
  ok('the link stops working once sharing is stopped', true)
  await visitor.close()

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

  // ---------------------------------------------------------------- a real run with a breakdown (last, so it does not change the checks above)
  {
    const { readFileSync } = await import('node:fs')
    const dir = new URL('../web/public/sample/', import.meta.url)
    await go('/new')
    await page.getByLabel('Choose a CSV file').setInputFiles({ name: 'bd-main.csv', mimeType: 'text/csv', buffer: readFileSync(new URL('breakdown-main.csv', dir)) })
    await page.getByRole('heading', { name: /bd-main.csv looks good/ }).waitFor({ timeout: 20000 })
    await page.getByLabel('Choose a breakdown CSV file').setInputFiles({ name: 'bd-long.csv', mimeType: 'text/csv', buffer: readFileSync(new URL('breakdown-long.csv', dir)) })
    await page.getByRole('group', { name: 'Break Social down by' }).getByLabel('Platform').check()
    await page.getByRole('group', { name: 'Break Display down by' }).getByLabel('Platform').check()
    await page.getByRole('group', { name: 'Break Display down by' }).getByLabel('Region').check()
    await page.getByText(/^3 items:/).waitFor()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByLabel('Run name').fill('E2E breakdown run')
    await page.getByRole('button', { name: 'Submit run' }).click()
    await page.getByRole('heading', { name: /E2E breakdown run/ }).waitFor({ timeout: 30000 })
    ok('a run with a breakdown is submitted', (await page.getByText(/broken down: Social by platform; Display by platform and region/).count()) === 1)
    // an up-to-date worker returns the Breakdown tab; an older one runs without it and the page says so
    await page.getByRole('tab', { name: 'Fit' }).waitFor({ timeout: 420000 })
    const hasTab = (await page.getByRole('tab', { name: 'Breakdown' }).count()) === 1
    const hasNotice = (await page.getByText('This run was fitted without its breakdown.').count()) === 1
    ok('the breakdown run finishes with a Breakdown tab, or says the server is out of date', hasTab !== hasNotice, hasTab ? 'worker is current' : 'worker is older')
    if (hasTab) {
      await page.getByRole('tab', { name: 'Breakdown' }).click()
      await page.getByRole('heading', { name: /Social, broken down by Platform/ }).waitFor()
      await axe('run breakdown tab')
    }
  }

  // ---------------------------------------------------------------- phone width
  await page.setViewportSize({ width: 360, height: 780 })
  for (const hash of ['/', '/sample', '/runs', '/new']) {
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
  ok('no theme switch in the header', (await page.getByRole('button', { name: /theme/i }).count()) === 0)
  ok('no uncaught page errors', consoleErrors.length === 0, consoleErrors.join(' | '))
} catch (e) {
  ok(`flow stopped: ${String(e).split("\n")[0]}`, false)
  console.log(String(e.stack).split("\n").filter((l) => l.includes("flow.mjs")).join("\n"))
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/failure.png`, fullPage: true })
} finally {
  await browser.close()
}
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`)
process.exit(failed.length ? 1 : 0)
