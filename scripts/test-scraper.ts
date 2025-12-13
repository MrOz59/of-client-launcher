import { readFileSync } from 'fs'
import path from 'path'

let extractVersionFromHtml: (html: string) => string | null
try {
  // prefer built dist if available
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  extractVersionFromHtml = require('../dist/main/scraper').extractVersionFromHtml
} catch (e) {
  // fallback to source, ts-node will compile
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  extractVersionFromHtml = require('../src/main/scraper').extractVersionFromHtml
}

const sampleHtmlPath = path.join(__dirname, 'fixtures', 'sample-game-page.html')
let html = ''
try {
  html = readFileSync(sampleHtmlPath, 'utf-8')
} catch (e) {
  // fallback: small snippet
  html = '<html><body><div>Версия игры: 1.0.266</div></body></html>'
}

const v = extractVersionFromHtml(html)
console.log('Extracted version:', v)
