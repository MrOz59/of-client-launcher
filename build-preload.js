const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

// Create dist-preload directory
const distDir = path.join(__dirname, 'dist-preload')
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true })
}

// Compile preload.ts
console.log('Compiling preload.ts...')
execSync('npx tsc src/main/preload.ts --outDir dist-preload --module commonjs --target es2020 --esModuleInterop --skipLibCheck', {
  stdio: 'inherit'
})

console.log('Preload compiled successfully!')
