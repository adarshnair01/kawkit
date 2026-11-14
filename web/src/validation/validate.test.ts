import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { DataSummary } from '../api/types'
import { parseCsv } from './csv'
import { parseDate, parseNumber, validateCsv } from './validate'

interface Case {
  name: string
  csv: string
  errors: string[]
  error_rows: number[][] | null
  warnings_include: string[]
  warnings_exclude: string[]
  weeks: number | null
  channels: string[] | null
  controls: string[] | null
  cadence: string | null
  python: { errors: { code: string; message: string; rows: number[] }[]; summary: DataSummary | null }
}

// the same cases the worker's pytest suite runs, with the worker's own output for comparison
const cases: Case[] = JSON.parse(readFileSync(new URL('../../../worker/tests/fixtures/validation_cases.json', import.meta.url), 'utf8'))

describe('shared validation cases', () => {
  for (const c of cases) {
    it(c.name, () => {
      const v = validateCsv(c.csv)
      expect(v.errors.map((e) => e.code).sort()).toEqual(c.errors)
      if (c.error_rows) expect(v.errors.map((e) => e.rows)).toEqual(c.error_rows)
      const codes = v.warnings.map((w) => w.code)
      for (const code of c.warnings_include) expect(codes).toContain(code)
      for (const code of c.warnings_exclude) expect(codes).not.toContain(code)
      if (c.weeks !== null) expect(v.summary?.weeks).toBe(c.weeks)
      if (c.channels) expect(v.dataset?.channels).toEqual(c.channels)
      if (c.controls) expect(v.dataset?.controlNames).toEqual(c.controls)
      if (c.cadence) expect(v.summary?.cadence).toBe(c.cadence)

      // parity with the server: same messages, same warnings, same numbers
      expect(v.errors.map((e) => e.message)).toEqual(c.python.errors.map((e) => e.message))
      const py = c.python.summary && 'weeks' in c.python.summary ? c.python.summary : null
      expect(v.summary === null).toBe(py === null)
      if (py && v.summary) {
        expect(v.summary.warnings.map((w) => w.message)).toEqual(py.warnings.map((w) => w.message))
        expect([v.summary.start, v.summary.end, v.summary.input_rows]).toEqual([py.start, py.end, py.input_rows])
        expect(v.summary.revenue_total).toBeCloseTo(py.revenue_total, 4)
        v.summary.channels.forEach((ch, i) => {
          const p = py.channels[i]
          expect(ch.name).toBe(p.name)
          for (const k of ['total', 'mean', 'max', 'active_share', 'cv', 'seasonal_share'] as const) expect(ch[k]).toBeCloseTo(p[k], 6)
        })
      }
    })
  }
})

describe('parsing', () => {
  it('parses quoted cells, escaped quotes and CRLF', () => {
    expect(parseCsv('a,b\r\n"1,2","say ""hi"""\r\n')).toEqual([['a', 'b'], ['1,2', 'say "hi"']])
    expect(parseCsv('﻿a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']])
  })
  it('strips currency symbols and rejects text', () => {
    expect(parseNumber(' $1,234.50 ')).toBe(1234.5)
    expect(parseNumber('₹ 12,00,000')).toBe(1200000)
    for (const bad of ['', 'abc', '1.2.3', '--5', 'NaN', 'Infinity', '=1+1']) expect(parseNumber(bad)).toBeNull()
  })
  it('is strict about dates', () => {
    expect(parseDate('2024-02-29')).not.toBeNull()
    for (const bad of ['2023-02-29', '2024-13-01', '24-01-01', '2024/01/01', '2024-1-1']) expect(parseDate(bad)).toBeNull()
  })
  it('enforces the size limit', () => {
    expect(validateCsv('date,revenue,spend_a\n', 11 * 1024 * 1024).errors[0].code).toBe('file_too_large')
  })
})
