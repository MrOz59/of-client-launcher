#!/usr/bin/env node
/**
 * Parser checks for the new store, run against saved fixtures.
 * Capture real pages with `npm run store:capture` inside the app and drop them
 * in scripts/fixtures to catch template changes here instead of in production.
 */
const fs = require('fs')
const path = require('path')
const { parseListing, parseGamePage } = require('../dist/main/store/parser.js')

const BASE = 'https://online-fix.me/'
let failures = 0

function check(condition, label, detail) {
  console.log(`${condition ? '  ok  ' : ' FAIL '} ${label}`)
  if (!condition) {
    failures++
    if (detail !== undefined) console.log('        got:', JSON.stringify(detail))
  }
}

const listingHtml = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample-listing.html'), 'utf8')
const listing = parseListing(listingHtml, BASE)
const byId = Object.fromEntries(listing.items.map((item) => [item.id, item]))

console.log('listing')
check(listing.items.length === 3, 'finds the three catalogue entries', listing.items.map((i) => i.id))
check(!byId['1111'], 'ignores links inside comments')
check(!byId['9999'], 'ignores links inside the menu')
check(byId['1234']?.title === 'Nome Do Jogo', 'reads the title', byId['1234']?.title)
check(
  byId['1234']?.imageUrl === 'https://online-fix.me/uploads/posts/2026-01/1234.jpg',
  'prefers the lazy-loaded cover over the data: placeholder',
  byId['1234']?.imageUrl
)
check(byId['1234']?.publishedAt === '12 января 2026', 'reads the listing date', byId['1234']?.publishedAt)
check(
  byId['5678']?.title === 'Outro Jogo Com Titulo Longo',
  'merges the cover and title links, keeping the fuller title',
  byId['5678']?.title
)
check(byId['5678']?.publishedAt?.startsWith('2026-02-03'), 'reads <time datetime>', byId['5678']?.publishedAt)
check(byId['4242'] && !byId['4242'].imageUrl, 'keeps entries without a cover', byId['4242'])
check(listing.nextPageUrl === 'https://online-fix.me/page/2/', 'finds the next page', listing.nextPageUrl)

console.log('\nlisting captured from the real store')
const realHtml = fs.readFileSync(path.join(__dirname, 'fixtures', 'listing-real.html'), 'utf8')
const real = parseListing(realHtml, 'https://online-fix.me/')

check(real.items.length === 3, 'reads the three captured cards', real.items.length)
check(
  real.items.every((item) => item.title && !/\d{4}/.test(item.title)),
  'titles come from the heading, with no date glued to them',
  real.items.map((i) => i.title)
)
check(real.items.every((item) => item.imageUrl && !item.imageUrl.startsWith('data:')), 'covers come from the lazy-loaded attribute')
check(real.items.every((item) => item.publishedAt), 'every card has a date', real.items.map((i) => i.publishedAt))
check(
  real.items.every((item) => !/\d{6,}/.test(item.publishedAt || '')),
  'the view/comment counters are not mistaken for the date',
  real.items.map((i) => i.publishedAt)
)
check(real.items.some((item) => item.updatedAt), 'picks up the "updated" line when present')
check(real.nextPageUrl === 'https://online-fix.me/page/2/', 'finds the next page', real.nextPageUrl)

console.log('\ngame page')
const gameHtml = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample-game-page.html'), 'utf8')
const details = parseGamePage(gameHtml, 'https://online-fix.me/1234-nome-do-jogo.html')
check(details.version === '1.0.266', 'reads the version from the labelled line', details.version)
check(details.title === 'Test Game', 'reads the title', details.title)

console.log('\ngame page captured from the real store')
const realGame = parseGamePage(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'game-real.html'), 'utf8'),
  'https://online-fix.me/games/officialservers/18211-aliens-fireteam-elite-2-po-seti.html'
)

check(realGame.version === '1.0.0', 'version stops before the next word', realGame.version)
check(realGame.releaseDate === '25.08.2026', 'reads the release date', realGame.releaseDate)
check(
  (realGame.torrentUrl || '').includes('/torrents/'),
  'finds the torrent the download flow can use',
  realGame.torrentUrl
)
check(
  (realGame.directUrl || '').includes('/uploads/') && !(realGame.directUrl || '').includes('/torrents/'),
  'keeps the direct file separate from the torrent',
  realGame.directUrl
)
check((realGame.videoUrl || '').includes('KG55MXH8cME'), 'finds the trailer', realGame.videoUrl)

console.log('\ngame page instructions')
const withSteps = parseGamePage(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'game-instructions.html'), 'utf8'),
  'https://online-fix.me/games/officialservers/1234-nome-do-jogo.html'
)
const steps = withSteps.instructions || []

check(steps[0] === '1. Запускаем Steam, заходим в свой профиль.', 'starts at the launch section, not at the top of the block', steps[0])
check(
  !steps.some((line) => /Пароль един|Смотри FAQ|Скачать|Страница игры/i.test(line)),
  'drops the archive password, the Steam line and the download buttons',
  steps
)
check(!steps.some((line) => /Версия игры/i.test(line)), 'drops the labelled metadata', steps)
check(steps.includes('Подключение:') && steps.includes('Создание сервера:'), 'keeps the short sub-headings', steps)
check(
  steps.some((line) => /Говорим другу/.test(line)),
  'reaches the last step instead of running out of budget',
  steps
)
check(!steps.some((line) => /КООП|МУЛЬТИПЛЕЕР|сетевых режимах/i.test(line)), 'leaves out the network-modes block', steps)
check(!steps.some((line) => /(.{4,})\1/.test(line)), 'no line repeats itself', steps)
check(steps.some((line) => /официальных серверах/.test(line)), 'keeps the notes that follow the modes block', steps)

console.log('\nlaunch executable named by the steps')
const stepsPage = (lines) =>
  `<!doctype html><html><body><div id="dle-content"><article><h1>Jogo</h1>` +
  `<div class="full-story-content"><div>Как запускать:</div>` +
  lines.map((line) => `<div>${line}</div>`).join('') +
  `</div></article></div></body></html>`

const launchExeOf = (lines) => parseGamePage(stepsPage(lines), 'https://online-fix.me/1-x.html').launchExecutable

check(withSteps.launchExecutable === 'ExemploGame.exe', 'reads the binary the steps name', withSteps.launchExecutable)
check(
  launchExeOf(['Не запускайте Cheat.exe перед стартом игры.']) === undefined,
  'ignores a binary the steps warn against',
  launchExeOf(['Не запускайте Cheat.exe перед стартом игры.'])
)
check(
  launchExeOf(['Запускаем setup.exe для установки.', 'Запускаем игру через RealGame.exe.']) === 'RealGame.exe',
  'skips the installer and takes the game binary',
  launchExeOf(['Запускаем setup.exe для установки.', 'Запускаем игру через RealGame.exe.'])
)
check(
  launchExeOf(['Запускаем игру через "My Game.exe" и играем.']) === 'My Game.exe',
  'a quoted name may carry spaces',
  launchExeOf(['Запускаем игру через "My Game.exe" и играем.'])
)
check(
  launchExeOf(['Запускаем Steam, заходим в свой профиль.']) === undefined,
  'no binary named means no hint',
  launchExeOf(['Запускаем Steam, заходим в свой профиль.'])
)

console.log(failures === 0 ? '\nall parser checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
