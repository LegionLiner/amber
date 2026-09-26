/// <reference lib="webworker" />
import { analyzeChannels, type AnalysisResult } from './analysis'
import { synthPcm } from './tone'

/**
 * Анализ в отдельном потоке: интерфейс не подтормаживает, пока считаются громкость и волна.
 * Декодирование mp3 остаётся в основном потоке (в воркере нет OfflineAudioContext), сюда приходят
 * готовые отсчёты. Демо-треки синтезируются прямо здесь.
 */
export type AnalysisJobInput =
  { kind: 'pcm'; channels: Float32Array[]; sampleRate: number } | { kind: 'demo'; seed: number; durationMs: number }

export type AnalysisJob = AnalysisJobInput & { id: number }

export interface AnalysisReply {
  id: number
  result?: AnalysisResult
  error?: string
}

self.onmessage = (e: MessageEvent<AnalysisJob>) => {
  const job = e.data
  try {
    let result: AnalysisResult
    if (job.kind === 'demo') {
      const { pcm, sr } = synthPcm(job.seed, job.durationMs)
      const f = new Float32Array(pcm.length)
      for (let i = 0; i < pcm.length; i++) f[i] = pcm[i]! / 32768
      result = analyzeChannels([f], sr)
    } else {
      result = analyzeChannels(job.channels, job.sampleRate)
    }
    ;(self as unknown as Worker).postMessage({ id: job.id, result } satisfies AnalysisReply)
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id: job.id, error: String(err) } satisfies AnalysisReply)
  }
}
