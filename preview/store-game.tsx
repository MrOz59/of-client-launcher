/**
 * Renders the store's game page on its own, with the site and Steam mocked, so
 * the comment thread and the requirements table can be looked at without
 * launching the launcher and signing in. Not part of the app build.
 *
 * `#comments` opens that tab; `?guest=1` drops the comment form the way the
 * site does for a signed-out reader; `?empty=1` shows a thread with nothing in
 * it yet.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider } from '../src/renderer/i18n'
import { ToastProvider } from '../src/renderer/components/ToastHost'
import StoreGameDialog from '../src/renderer/components/StoreGameDialog'
import '../src/renderer/App.css'

const guest = location.search.includes('guest')
const empty = location.search.includes('empty')

const item = {
  id: '18237',
  url: 'https://online-fix.me/games/adventures/18237-tainted-grail-the-fall-of-avalon-po-seti.html',
  title: 'Tainted Grail The Fall of Avalon',
  imageUrl: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1466060/header.jpg',
  publishedAt: '2026-09-10T18:10:24+03:00'
}

const comments = [
  {
    id: '407695',
    author: 'FeldOtto55',
    authorUrl: 'https://online-fix.me/user/FeldOtto55/',
    dateText: 'Вчера, 18:28',
    date: '2026-09-10T15:28:00.000Z',
    number: 21,
    body: [{ kind: 'text', segments: [{ kind: 'text', text: 'Do you need to download the modification for it as well,\nor is that included in the torrent already?' }] }]
  },
  {
    id: '407696',
    author: '0xdeadc0de',
    authorColor: '#843232',
    dateText: 'Вчера, 18:37',
    date: '2026-09-10T15:37:00.000Z',
    number: 22,
    body: [{
      kind: 'text',
      segments: [
        { kind: 'mention', name: 'FeldOtto55' },
        { kind: 'text', text: ', already included. Patch notes are here: ' },
        { kind: 'link', text: 'My Webpage', url: 'https://example.com/patchnotes' }
      ]
    }]
  },
  {
    id: '407727',
    author: 'ffdf11213',
    dateText: 'Сегодня, 07:13',
    date: '2026-09-11T04:13:00.000Z',
    number: 23,
    body: [
      { kind: 'quote', title: 'FeldOtto55', segments: [{ kind: 'text', text: 'is that included in the torrent already?' }] },
      { kind: 'text', segments: [{ kind: 'text', text: "The game font looks weird or isn't showing up at all" }] }
    ]
  }
]

const requirementRows = (tier: 'minimum' | 'recommended') => [
  { value: 'Requires a 64-bit processor and operating system' },
  { label: 'OS', value: tier === 'minimum' ? 'Windows 10 64-bit' : 'Windows 10/11 (64-bit)' },
  { label: 'Processor', value: tier === 'minimum' ? 'i5 8th gen or AMD equivalent' : 'i7 13th gen' },
  { label: 'Memory', value: tier === 'minimum' ? '12 GB RAM' : '16 GB RAM' },
  { label: 'Graphics', value: tier === 'minimum' ? 'GTX 1060 6GB or AMD equivalent' : 'RTX 2070 Super' },
  { label: 'DirectX', value: 'Version 11' },
  { label: 'Storage', value: '31 GB available space' },
  { label: 'Additional Notes', value: tier === 'minimum' ? 'Low settings, 30 FPS, Full HD, SSD strongly recommended' : 'Ultra settings, 60 FPS, Full HD, SSD strongly recommended' }
]

;(window as any).electronAPI = {
  storeGame: async () => ({
    success: true,
    game: {
      url: item.url,
      title: item.title,
      version: '1.25',
      releaseDate: '23.05.2025',
      torrentUrl: 'https://uploads.online-fix.me:2053/torrents/Tainted%20Grail/',
      instructions: ['Запускаем Steam, заходим в свой профиль.', 'Запускаем игру через Fall of Avalon.exe.']
    }
  }),
  storeGameMetadata: async () => ({
    success: true,
    metadata: {
      source: 'steam',
      steamAppId: '1466060',
      name: 'Tainted Grail: The Fall of Avalon',
      description: 'Dive into a dark reimagining of Arthurian legends in this first-person, open-world RPG.',
      headerImage: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1466060/header.jpg',
      genres: ['RPG', 'Adventure', 'Open World'],
      developers: ['Awaken Realms'],
      releaseDate: '23 May, 2025',
      requirements: { minimum: requirementRows('minimum'), recommended: requirementRows('recommended') }
    }
  }),
  storeTranslateInstructions: async () => ({ success: true, translated: false }),
  storeGameComments: async () => ({
    success: true,
    thread: {
      url: item.url,
      page: empty ? 1 : 2,
      pageCount: empty ? 1 : 2,
      total: empty ? 0 : 23,
      comments: empty ? [] : comments,
      canPost: !guest,
      author: 'MrOz'
    }
  }),
  storePostComment: async () => ({ success: true }),
  startTorrentDownload: async () => ({ success: true }),
  openExternal: async () => ({ success: true })
}

document.body.style.background = '#0b0d12'

// The tab is internal state, so the harness clicks it by id (the label is
// translated, the id is not): #comments opens the thread.
if (location.hash) {
  const wanted = location.hash.slice(1).toLowerCase()
  setTimeout(() => {
    document.getElementById(`store-detail-tab-${wanted}`)?.click()
  }, 400)
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <ToastProvider>
        <StoreGameDialog item={item as any} onClose={() => {}} />
      </ToastProvider>
    </I18nProvider>
  </React.StrictMode>
)
