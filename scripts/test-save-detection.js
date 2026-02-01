const path = require('path');
const fs = require('fs');

// Simular a função getFolderStats
const SAVE_EXTENSIONS = [
  '.sav', '.save', '.savegame',
  '.dat', '.bin',
  '.json', '.xml',
  '.profile', '.player',
  '.slot', '.slot0', '.slot1', '.slot2',
  '.progress', '.checkpoint'
];

function isSaveFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (SAVE_EXTENSIONS.includes(ext)) return true;
  if (/^(save|slot|profile|auto)[_-]?\d+/i.test(filename)) return true;
  return false;
}

function scanDir(dirPath, depth = 0, maxDepth = 3) {
  if (depth > maxDepth) return [];
  const results = [];
  
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        results.push(...scanDir(fullPath, depth + 1, maxDepth));
      } else {
        try {
          const stat = fs.statSync(fullPath);
          results.push({
            file: fullPath,
            isSave: isSaveFile(entry.name),
            size: stat.size,
            mtime: stat.mtime
          });
        } catch {}
      }
    }
  } catch {}
  return results;
}

// Paths to check
const prefix = process.env.HOME + '/.local/share/of-launcher/prefixes/game_17921__rt_6645d812/pfx';
const paths = [
  path.join(prefix, 'drive_c/users/Public/Documents/OnlineFix/17921/Saves'),
  path.join(prefix, 'drive_c/users/steamuser/AppData/Local/SpeciesUnknown/Saved/SaveGames'),
  path.join(prefix, 'drive_c/users/steamuser/AppData/Local'),
  path.join(prefix, 'drive_c/users/Public/Documents/OnlineFix')
];

for (const p of paths) {
  console.log('\n=== ' + p + ' ===');
  if (!fs.existsSync(p)) {
    console.log('  [NOT FOUND]');
    continue;
  }
  
  const files = scanDir(p);
  const saveFiles = files.filter(f => f.isSave);
  const totalSize = files.reduce((acc, f) => acc + f.size, 0);
  const lastMod = files.reduce((latest, f) => f.mtime > latest ? f.mtime : latest, new Date(0));
  
  console.log('  Total files:', files.length);
  console.log('  Save files:', saveFiles.length);
  console.log('  Total size:', (totalSize / 1024).toFixed(1), 'KB');
  console.log('  Last modified:', lastMod.toISOString());
  
  // Show most recent files
  const recent = files.sort((a, b) => b.mtime - a.mtime).slice(0, 5);
  console.log('  Recent files:');
  for (const f of recent) {
    const rel = f.file.replace(p + '/', '');
    console.log('    -', rel, '(' + (f.size/1024).toFixed(1) + 'KB)', f.mtime.toISOString());
  }
}
