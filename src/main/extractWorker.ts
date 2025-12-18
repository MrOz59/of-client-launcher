import { parentPort, workerData } from 'worker_threads'
import { processUpdateExtraction } from './extractionUtils.js'

const { installPath, gameUrl, previousExePath } = workerData as {
  installPath: string
  gameUrl: string
  previousExePath?: string | null
}

async function run() {
  try {
    const res = await processUpdateExtraction(
      installPath,
      gameUrl,
      (percent, details) => {
        parentPort?.postMessage({ type: 'progress', percent, etaSeconds: details?.etaSeconds })
      },
      previousExePath
    )
    parentPort?.postMessage({ type: 'done', result: res })
  } catch (err: any) {
    parentPort?.postMessage({ type: 'error', error: err?.message || String(err) })
  }
}

run()
