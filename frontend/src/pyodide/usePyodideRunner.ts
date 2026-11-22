import { useCallback, useEffect, useRef, useState } from 'react'

export type RunnerStatus = 'loading' | 'ready' | 'running'
export interface RunIO { stdout: string; stderr: string }
interface Handlers {
  onOut: (s: string) => void
  onErr: (s: string) => void
  onInput: (prompt: string) => void
}

export function usePyodideRunner(handlers: Handlers) {
  const [status, setStatus] = useState<RunnerStatus>('loading')
  const workerRef = useRef<Worker | null>(null)
  const sabRef = useRef<SharedArrayBuffer | null>(null)
  const i32Ref = useRef<Int32Array | null>(null)
  const bufRef = useRef<Uint8Array | null>(null)
  const resolveRef = useRef<((io: RunIO) => void) | null>(null)
  const ioRef = useRef<RunIO>({ stdout: '', stderr: '' })
  const timerRef = useRef<number | null>(null)
  const hRef = useRef(handlers); hRef.current = handlers

  const finish = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    setStatus('ready')
    const r = resolveRef.current; resolveRef.current = null
    r?.({ ...ioRef.current })
  }

  const spawn = useCallback(() => {
    const w = new Worker('/pyodide.worker.js')
    workerRef.current = w
    setStatus('loading')
    w.onmessage = (e) => {
      const m = e.data
      if (m.type === 'ready') setStatus('ready')
      else if (m.type === 'stdout') { ioRef.current.stdout += m.text + '\n'; hRef.current.onOut(m.text + '\n') }
      else if (m.type === 'stderr') { ioRef.current.stderr += m.text + '\n'; hRef.current.onErr(m.text + '\n') }
      else if (m.type === 'input') hRef.current.onInput(m.prompt ?? '')
      else if (m.type === 'done') finish()
      else if (m.type === 'error') { ioRef.current.stderr += m.text + '\n'; hRef.current.onErr(m.text + '\n'); finish() }
    }
    const sab = (self as any).crossOriginIsolated ? new SharedArrayBuffer(16 + 4096) : null
    sabRef.current = sab
    if (sab) { i32Ref.current = new Int32Array(sab, 0, 4); bufRef.current = new Uint8Array(sab, 16, 4096) }
    w.postMessage({ type: 'init', sab })
  }, [])

  useEffect(() => { spawn(); return () => { workerRef.current?.terminate() } }, [spawn])

  const stop = useCallback((msg?: string) => {
    workerRef.current?.terminate(); workerRef.current = null
    if (msg) { ioRef.current.stderr += msg + '\n'; hRef.current.onErr(msg + '\n') }
    spawn()          // чистый воркер для следующего запуска
    finish()
  }, [spawn])

  const run = useCallback((code: string, testCode = ''): Promise<RunIO> => {
    if (status === 'running') return Promise.resolve({ ...ioRef.current })
    ioRef.current = { stdout: '', stderr: '' }
    setStatus('running')
    return new Promise<RunIO>((res) => {
      resolveRef.current = res
      timerRef.current = window.setTimeout(
        () => stop('ExecutionTimeoutError: Превышено время ожидания (10 с)'), 10000)
      workerRef.current?.postMessage({ type: 'run', code, testCode })
    })
  }, [status, stop])

  const replyInput = useCallback((text: string) => {
    if (sabRef.current && i32Ref.current && bufRef.current) {
      const bytes = new TextEncoder().encode(text)
      bufRef.current.set(bytes.subarray(0, 4096))
      i32Ref.current[1] = Math.min(bytes.length, 4096)
      Atomics.store(i32Ref.current, 0, 1)
      Atomics.notify(i32Ref.current, 0)
    } else {
      workerRef.current?.postMessage({ type: 'input_reply', text })
    }
  }, [])

  return { status, run, stop, replyInput }
}