/* eslint-disable no-console */
const fs = require('fs')
const path = require('path')

function patchNodeModulesCollector() {
  const filePath = path.join(
    __dirname,
    '..',
    'node_modules',
    'app-builder-lib',
    'out',
    'node-module-collector',
    'nodeModulesCollector.js'
  )

  if (!fs.existsSync(filePath)) {
    console.warn('[patch-electron-builder] Skipping: file not found:', filePath)
    return
  }

  const original = fs.readFileSync(filePath, 'utf8')
  if (original.includes('OF_PATCH_REDIRECT_STDOUT')) {
    console.log('[patch-electron-builder] Already patched:', filePath)
    return
  }

  const re =
    /const dependencies = await \(0, builder_util_1\.exec\)\(command, args, \{\s*cwd: this\.rootDir,\s*shell: (true|false),\s*\}\);\s*return this\.parseDependenciesTree\(dependencies\);/m

  const replacement = [
    '// OF_PATCH_REDIRECT_STDOUT: npm/yarn output can be empty when captured via pipes in some environments; redirect to a file instead.',
    'const tmpFile = path.join(this.rootDir, `.electron-builder-deps-${process.pid}-${Date.now()}.json`);',
    'const listCmd = [command, ...args].join(\" \");',
    'const redirectCmd = `${listCmd} > ${JSON.stringify(tmpFile)} || true`;',
    'await (0, builder_util_1.exec)(\"bash\", [\"-lc\", redirectCmd], { cwd: this.rootDir, shell: false });',
    'const dependencies = fs.readFileSync(tmpFile, \"utf8\");',
    'try { fs.unlinkSync(tmpFile); } catch (_e) {}',
    'return this.parseDependenciesTree(dependencies);'
  ].join('\n        ')

  const replaced = original.replace(re, replacement)
  if (replaced === original) {
    console.warn('[patch-electron-builder] Pattern not found, skipping:', filePath)
    return
  }

  fs.writeFileSync(filePath, replaced, 'utf8')
  console.log('[patch-electron-builder] Patched:', filePath)
}

try {
  patchNodeModulesCollector()
} catch (err) {
  console.warn('[patch-electron-builder] Failed:', err)
}
