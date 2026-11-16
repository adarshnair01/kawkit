/** Import from a link: a Google Sheet shared by link, or any address that serves a CSV file. */

export interface LinkTarget {
  url: string
  kind: 'google_sheet' | 'csv'
}

/** Turn what the user pasted into an address that returns CSV. */
export function resolveLink(input: string): LinkTarget | null {
  let u: URL
  try {
    u = new URL(input.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:') return null
  if (u.hostname === 'docs.google.com' && u.pathname.startsWith('/spreadsheets/')) {
    // "Publish to the web" links already serve CSV when asked to
    const published = u.pathname.match(/^\/spreadsheets\/d\/e\/([^/]+)\//)
    if (published) {
      const gid = u.searchParams.get('gid')
      return { kind: 'google_sheet', url: `https://docs.google.com/spreadsheets/d/e/${published[1]}/pub?output=csv${gid ? `&gid=${gid}` : ''}` }
    }
    const id = u.pathname.match(/^\/spreadsheets\/d\/([^/]+)/)?.[1]
    if (!id) return null
    const gid = u.searchParams.get('gid') ?? u.hash.match(/gid=(\d+)/)?.[1]
    return { kind: 'google_sheet', url: `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv${gid ? `&gid=${gid}` : ''}` }
  }
  return { kind: 'csv', url: u.toString() }
}

export class LinkError extends Error {}

const MAX_BYTES = 10 * 1024 * 1024

export async function fetchLink(target: LinkTarget, fetcher: typeof fetch = fetch): Promise<string> {
  let res: Response
  try {
    res = await fetcher(target.url, { credentials: 'omit', redirect: 'follow' })
  } catch {
    throw new LinkError(
      target.kind === 'google_sheet'
        ? 'The sheet could not be read. Share it so that anyone with the link can view it (Share, then General access), then try again.'
        : 'That address could not be read from the browser. It may not allow other sites to fetch it; download the file and upload it instead.',
    )
  }
  if (!res.ok)
    throw new LinkError(
      target.kind === 'google_sheet' && (res.status === 401 || res.status === 403 || res.status === 404)
        ? 'The sheet is private or the link is wrong. Share it so that anyone with the link can view it, then try again.'
        : `The address answered with an error (${res.status}).`,
    )
  const text = await res.text()
  if (text.length > MAX_BYTES) throw new LinkError('The file is larger than 10 MB.')
  if (/^\s*<(!doctype|html)/i.test(text))
    throw new LinkError(
      target.kind === 'google_sheet'
        ? 'Google returned a sign-in page instead of data. Share the sheet so that anyone with the link can view it, then try again.'
        : 'That address returned a web page, not a CSV file.',
    )
  return text
}
