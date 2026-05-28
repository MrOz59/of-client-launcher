const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

// Create dist-preload directory
const distDir = path.join(__dirname, 'dist-preload')
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true })
}

// Compile preload scripts
console.log('Compiling preload scripts...')
execSync('npx tsc src/main/preload.ts src/main/storeWebviewPreload.ts --outDir dist-preload --module commonjs --target es2020 --esModuleInterop --skipLibCheck', {
  stdio: 'inherit'
})

console.log('Preload scripts compiled successfully!')
