import { parentPort, workerData } from 'worker_threads'
import { processUpdateExtraction } from './downloadManager.js'

const { installPath, gameUrl } = workerData as { installPath: string; gameUrl: string }

async function run() {
  try {
    const res = await processUpdateExtraction(installPath, gameUrl, (percent) => {
      parentPort?.postMessage({ type: 'progress', percent })
    })
    parentPort?.postMessage({ type: 'done', result: res })
  } catch (err: any) {
    parentPort?.postMessage({ type: 'error', error: err?.message || String(err) })
  }
}

run()
