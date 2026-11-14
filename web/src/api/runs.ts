import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import type { DataSummary, Draws, Heartbeat, Priors, Run, RunResult } from './types'

export const MAX_FINISHED = 5
export const OFFLINE_AFTER_MS = 2 * 60 * 1000
/** Rough time one fit takes on the model server, for the estimated wait. */
export const SECONDS_PER_RUN = 120

export function friendlyError(e: unknown): string {
  const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e)
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'Could not reach the service. Check your connection and try again.'
  return msg
}

export async function listRuns(): Promise<Run[]> {
  const { data, error } = await supabase.from('runs').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return data as Run[]
}

export async function getRun(id: string): Promise<Run | null> {
  const { data, error } = await supabase.from('runs').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data as Run | null
}

export async function getResult(runId: string): Promise<RunResult | null> {
  const { data, error } = await supabase.from('run_results').select('*').eq('run_id', runId).maybeSingle()
  if (error) throw error
  return data as RunResult | null
}

export async function getVerdicts(): Promise<Record<string, string>> {
  const { data, error } = await supabase.from('run_results').select('run_id, verdict:diagnostics->>verdict')
  if (error) throw error
  return Object.fromEntries((data as { run_id: string; verdict: string }[]).map((r) => [r.run_id, r.verdict]))
}

export async function getDraws(path: string): Promise<Draws> {
  const { data, error } = await supabase.storage.from('results').download(path)
  if (error) throw error
  return JSON.parse(await data.text()) as Draws
}

export async function downloadUpload(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('uploads').download(path)
  if (error) throw error
  return data.text()
}

export async function submitRun(userId: string, name: string, csv: string, summary: DataSummary, priors: Priors): Promise<string> {
  const id = crypto.randomUUID()
  const path = `${userId}/${id}.csv`
  const up = await supabase.storage.from('uploads').upload(path, new Blob([csv], { type: 'text/csv' }), { contentType: 'text/csv' })
  if (up.error) throw up.error
  const { data, error } = await supabase.rpc('submit_run', { p_name: name, p_upload_path: path, p_summary: summary, p_priors: priors, p_settings: {} })
  if (error) throw error
  return data as string
}

export async function cancelRun(id: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_run', { p_run_id: id })
  if (error) throw error
}

export async function renameRun(id: string, name: string): Promise<void> {
  const { error } = await supabase.rpc('rename_run', { p_run_id: id, p_name: name })
  if (error) throw error
}

export async function queuePosition(id: string): Promise<number | null> {
  const { data, error } = await supabase.rpc('queue_position', { p_run_id: id })
  if (error) throw error
  return data as number | null
}

export async function requestAccountDeletion(): Promise<void> {
  const { error } = await supabase.rpc('request_account_deletion')
  if (error) throw error
}

/** The user's runs, kept live through Realtime with a polling fallback while anything is active. */
export function useRuns(userId: string | undefined) {
  const [runs, setRuns] = useState<Run[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    try {
      setRuns(await listRuns())
      setError(null)
    } catch (e) {
      setError(friendlyError(e))
    }
  }, [])

  useEffect(() => {
    if (!userId) return
    refresh()
    const channel = supabase
      .channel(`runs-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'runs', filter: `user_id=eq.${userId}` }, (payload) => {
        setRuns((prev) => {
          if (!prev) return prev
          if (payload.eventType === 'DELETE') return prev.filter((r) => r.id !== (payload.old as { id: string }).id)
          const row = payload.new as Run
          const known = prev.some((r) => r.id === row.id)
          return known ? prev.map((r) => (r.id === row.id ? { ...r, ...row } : r)) : [row, ...prev]
        })
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId, refresh])

  const active = runs?.some((r) => r.status === 'queued' || r.status === 'running') ?? false
  useEffect(() => {
    if (!active) return
    const t = setInterval(refresh, 6000)
    return () => clearInterval(t)
  }, [active, refresh])

  return { runs, error, refresh }
}

/** Is the model server alive? Offline when the newest heartbeat is over 2 minutes old. */
export function useServerStatus() {
  const [beat, setBeat] = useState<Heartbeat | null | undefined>(undefined)
  const [now, setNow] = useState(() => Date.now())
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    const load = async () => {
      const { data } = await supabase.from('worker_heartbeat').select('*').order('last_seen', { ascending: false }).limit(1)
      if (mounted.current) {
        setBeat((data?.[0] as Heartbeat | undefined) ?? null)
        setNow(Date.now())
      }
    }
    load()
    const t = setInterval(load, 30000)
    return () => {
      mounted.current = false
      clearInterval(t)
    }
  }, [])
  const known = beat !== undefined
  const online = !!beat && now - new Date(beat.last_seen).getTime() < OFFLINE_AFTER_MS
  return { known, online, beat: beat ?? null }
}
