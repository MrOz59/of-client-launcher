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

const source = process.argv[2]
const output = process.argv[3] || path.join(__dirname, 'fixtures', 'listing-real.html')

if (!source) {
  console.error('usage: node scripts/make-store-fixture.js <captured.html> [output.html]')
  process.exit(2)
}

const $ = cheerio.load(fs.readFileSync(source, 'utf8'))

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

const RISKY = [
  [/dle_login_hash|user_hash/i, 'login hash'],
  [/\/user\//i, 'user link'],
  [/do=logout|do=pm|newpm/i, 'account action'],
  [/[\w.+-]+@[\w-]+\.[a-z]{2,}/i, 'e-mail'],
  [/<script/i, 'script tag']
]

const found = RISKY.filter(([pattern]) => pattern.test(doc)).map(([, label]) => label)
if (found.length > 0) {
  console.error('refusing to write: fixture still contains', found.join(', '))
  process.exit(1)
}

fs.writeFileSync(output, doc, 'utf8')
console.log(`wrote ${output} (${(doc.length / 1024).toFixed(1)} KB, ${cards.length} cards)`)
