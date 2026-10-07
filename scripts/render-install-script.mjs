import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// Fills the version and the app zip's SHA-256 into scripts/windows/install.ps1 for a release. Both end up inside
// single-quoted PowerShell strings, so they are validated, not escaped.
export function renderInstallScript(template, { version, zipSha256 }) {
  if (!/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(version)) {
    throw new Error(`Invalid version: "${version}"`)
  }
  if (!/^[0-9A-Fa-f]{64}$/.test(zipSha256)) {
    throw new Error(`Invalid SHA-256: "${zipSha256}"`)
  }
  for (const placeholder of ['__VERSION__', '__ZIP_SHA256__']) {
    if (!template.includes(placeholder)) {
      throw new Error(`The template has no ${placeholder} placeholder`)
    }
  }
  return template.split('__VERSION__').join(version).split('__ZIP_SHA256__').join(zipSha256.toUpperCase())
}

const sha256OfFile = (path) =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(path).on('data', (chunk) => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest('hex')))
  })

async function main([version, zipPath, outPath, templatePath]) {
  if (!version || !zipPath || !outPath) {
    throw new Error('Usage: node scripts/render-install-script.mjs <version> <zip> <out> [template]')
  }
  const template = await readFile(templatePath ?? new URL('./windows/install.ps1', import.meta.url), 'utf8')
  await writeFile(outPath, renderInstallScript(template, { version, zipSha256: await sha256OfFile(zipPath) }))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2))
}
