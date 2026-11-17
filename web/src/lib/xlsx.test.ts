import { unzipSync, strFromU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import { buildXlsx, colName } from './xlsx'

describe('xlsx writer', () => {
  it('names columns like a spreadsheet', () => {
    expect([0, 25, 26, 27, 701, 702].map(colName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA'])
  })
  it('writes a readable workbook with numbers, text and escaped characters', () => {
    const zip = unzipSync(buildXlsx([{ name: 'Channels', rows: [['Channel', 'ROI'], ['Tv & <radio>', 2.5], [null, 'x'], ['n', Number.NaN]] }]))
    expect(Object.keys(zip)).toContain('xl/worksheets/sheet1.xml')
    const sheet = strFromU8(zip['xl/worksheets/sheet1.xml'])
    expect(sheet).toContain('Tv &amp; &lt;radio&gt;')
    expect(sheet).toContain('<c r="B2"><v>2.5</v></c>')
    expect(sheet).toContain('<c r="B3" t="inlineStr">')
    expect(sheet).not.toContain('NaN')
    expect(strFromU8(zip['xl/workbook.xml'])).toContain('name="Channels"')
  })
  it('cleans sheet names Excel would reject', () => {
    const zip = unzipSync(buildXlsx([{ name: 'a/b:c?'.repeat(10), rows: [] }]))
    const wb = strFromU8(zip['xl/workbook.xml'])
    expect(wb).not.toMatch(/name="[^"]*[\\/?*[\]:]/)
  })
})
