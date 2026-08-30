#!/usr/bin/env node
/**
 * Turns a captured store page into a small fixture for the parser tests.
 *
 * Usage: node scripts/make-store-fixture.js <captured.html> [output.html]
 *
 * Keeps three listing cards and the pagination, drops the editorial preview
 * text (the parser never reads it) and refuses to write anything that still
 * carries account data.
 */
const fs = require('fs')
const path = require('path')
const cheerio = require('cheerio')

const args = process.argv.slice(2)
const gameMode = args.includes('--game')
const positional = args.filter((arg) => !arg.startsWith('--'))
const source = positional[0]
const output = positional[1] || path.join(__dirname, 'fixtures', gameMode ? 'game-real.html' : 'listing-real.html')

if (!source) {
  console.error('usage: node scripts/make-store-fixture.js [--game] <captured.html> [output.html]')
  process.exit(2)
}

// Captures may carry the source URL on the first line.
const captured = fs.readFileSync(source, 'utf8').replace(/^link:\S+\s*/, '')
const $ = cheerio.load(captured)

const RISKY = [
  [/dle_login_hash|user_hash/i, 'login hash'],
  [/\/user\//i, 'user link'],
  [/do=logout|do=pm|newpm/i, 'account action'],
  [/[\w.+-]+@[\w-]+\.[a-z]{2,}/i, 'e-mail'],
  [/<script/i, 'script tag']
]

if (gameMode) {
  writeGameFixture()
  process.exit(0)
}

const cards = $('div.article, article.article, .short-story')
  .slice(0, 3)
  .map((_i, card) => {
    const $card = $(card)
    $card.find('.preview-text').text('(preview text removed from the fixture)')
    return $.html(card)
  })
  .get()

if (cards.length === 0) {
  console.error('no listing cards found in', source)
  process.exit(1)
}

// Just the link: `closest('div')` walks up to the container that holds the
// whole listing, which would drag every card back into the fixture.
const nextHref = $('a[href*="/page/2/"]').first().attr('href')
const pagination = nextHref ? `<div class="bottom-nav"><a href="${nextHref}" class="pnext">next</a></div>` : ''
const doc = `<!doctype html>
<!--
  Listing cards captured from the real store, trimmed for the parser tests.
  Regenerate with: node scripts/make-store-fixture.js <captured.html>
  Contains catalogue markup only - no account data.
-->
<html lang="ru">
<head><meta charset="utf-8"><title>online-fix</title></head>
<body>
<div id="dle-content">
${cards.join('\n')}
</div>
${pagination}
</body>
</html>
`

const found = RISKY.filter(([pattern]) => pattern.test(doc)).map(([, label]) => label)
if (found.length > 0) {
  console.error('refusing to write: fixture still contains', found.join(', '))
  process.exit(1)
}

fs.writeFileSync(output, doc, 'utf8')
console.log(`wrote ${output} (${(doc.length / 1024).toFixed(1)} KB, ${cards.length} cards)`)

/**
 * A game page fixture keeps only what the parser reads: the heading, the
 * labelled lines, the download buttons and the trailer. The editorial prose and
 * everything around the article are left out on purpose.
 */
function writeGameFixture() {
  const heading = cleanText($('h1').first().text())
  const content = cleanText($('.full-story-content, article, #dle-content').first().text())

  const labelled = ['Версия игры', 'Релиз игры']
    .map((label) => {
      const value = new RegExp(`${label}\\s*:?\\s*v?([0-9][0-9A-Za-z._/\\-]*)`, 'i').exec(content)?.[1]
      return value ? `      <div><b>${label}:</b>${value}</div>` : ''
    })
    .filter(Boolean)

  const buttons = $('a[href]')
    .filter((_i, el) => /uploads\.online-fix\.me/i.test(String($(el).attr('href') || '')))
    .slice(0, 2)
    .map((_i, el) => `      <a class="${$(el).attr('class') || ''}" href="${$(el).attr('href')}">${cleanText($(el).text())}</a>`)
    .get()

  const ogImage = $('meta[property="og:image"]').attr('content') || ''
  const iframe = $('iframe[src*="youtube"], iframe[data-src*="youtube"]').first()
  const videoSrc = iframe.attr('src') || iframe.attr('data-src') || ''
  const canonical = $('link[rel="canonical"]').attr('href') || ''

  const doc = `<!doctype html>
<!--
  Structure of a real game page, reduced to what the parser reads.
  Regenerate with: node scripts/make-store-fixture.js --game <captured.html>
-->
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>${heading}</title>
  ${canonical ? `<link rel="canonical" href="${canonical}">` : ''}
  ${ogImage ? `<meta property="og:image" content="${ogImage}">` : ''}
</head>
<body>
  <div id="dle-content">
    <article>
      <h1>${heading}</h1>
      <div class="full-story-content">
${labelled.join('\n')}
        <div>(article text removed from the fixture)</div>
${buttons.join('\n')}
        ${videoSrc ? `<iframe src="${videoSrc}"></iframe>` : ''}
      </div>
    </article>
  </div>
</body>
</html>
`

  const risky = RISKY.filter(([pattern]) => pattern.test(doc)).map(([, label]) => label)
  if (risky.length > 0) {
    console.error('refusing to write: fixture still contains', risky.join(', '))
    process.exit(1)
  }

  fs.writeFileSync(output, doc, 'utf8')
  console.log(`wrote ${output} (${(doc.length / 1024).toFixed(1)} KB, game page)`)
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}
