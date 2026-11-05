/// <reference lib="webworker" />
import { TrackAnalyzer, analyzeChannels, type AnalysisResult } from './analysis'
import { synthPcm } from './tone'
import { $t } from '@/i18n'

/**
 * Анализ в отдельном потоке: интерфейс не подтормаживает, пока считаются громкость и волна.
 * Декодирование остаётся в основном потоке (в воркере нет OfflineAudioContext), сюда звук приходит
 * кусками: start → push, push… → finish. На каждое сообщение — ответ, чтобы основной поток не
 * присылал новые куски быстрее, чем они считаются (иначе очередь сообщений съела бы память).
 * Демо-треки синтезируются прямо здесь.
 */
export type AnalysisMsg =
  | { kind: 'start'; sampleRate: number; channels: number }
  | { kind: 'push'; channels: Float32Array[] }
  | { kind: 'finish' }
  | { kind: 'demo'; seed: number; durationMs: number }

export type AnalysisJob = AnalysisMsg & { id: number }

export interface AnalysisReply {
  id: number
  ok?: boolean
  result?: AnalysisResult
  error?: string
}

const open = new Map<number, TrackAnalyzer>()

self.onmessage = (e: MessageEvent<AnalysisJob>) => {
  const job = e.data
  const reply = (r: Omit<AnalysisReply, 'id'>) =>
    (self as unknown as Worker).postMessage({ id: job.id, ...r } satisfies AnalysisReply)
  try {
    switch (job.kind) {
      case 'demo': {
        const { pcm, sr } = synthPcm(job.seed, job.durationMs)
        const f = new Float32Array(pcm.length)
        for (let i = 0; i < pcm.length; i++) f[i] = pcm[i]! / 32768
        reply({ result: analyzeChannels([f], sr) })
        break
      }
      case 'start':
        open.set(job.id, new TrackAnalyzer(job.sampleRate, Math.min(2, job.channels)))
        reply({ ok: true })
        break
      case 'push':
        open.get(job.id)?.push(job.channels)
        reply({ ok: true })
        break
      case 'finish': {
        const a = open.get(job.id)
        open.delete(job.id)
        if (!a) throw new Error($t('анализ не начат'))
        reply({ result: a.finish() })
        break
      }
    }
  } catch (err) {
    open.delete(job.id)
    reply({ error: String(err) })
  }
}
