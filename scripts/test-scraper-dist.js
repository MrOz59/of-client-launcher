const fs = require('fs')
const path = require('path')
const cheerio = require('cheerio')
function extractVersionFromHtml(html) {
  const $ = cheerio.load(html)
  const sel = '#dle-content > div > article > div.full-story-content > div:nth-child(3) > div:nth-child(21) > div > b'
  const el = $(sel)
  if (el && el.length > 0) {
    const text = el.text().trim()
    const match = text.match(/([0-9]+\.[0-9]+\.[0-9]+)/)
    if (match) return match[1]
  }
  const text = $('body').text()
  const patterns = [
    /Версия игры:\s*([0-9]+\.[0-9]+\.[0-9]+)/i,
    /Version(?:\s*[:\-])?\s*([0-9]+\.[0-9]+\.[0-9]+)/i,
    /v([0-9]+\.[0-9]+\.[0-9]+)/i,
    /([0-9]+\.[0-9]+\.[0-9]+)/
  ]
  for (const p of patterns) {
    const m = text.match(p)
    if (m) return m[1]
  }
  return null
}
const sampleHtmlPath = path.join(__dirname, 'fixtures', 'sample-game-page.html')
let html = ''
try {
  html = fs.readFileSync(sampleHtmlPath, 'utf-8')
} catch (e) {
  html = '<html><body><div>Версия игры: 1.0.266</div></body></html>'
}
const v = extractVersionFromHtml(html)
console.log('Extracted version:', v)
