import { createHash } from 'node:crypto'
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

export const UV = {
  version: '0.12.22',
  targets: {
    'aarch64-apple-darwin': { file: 'uv-aarch64-apple-darwin.tar.gz', sha256: '5d714de09501a59393ceca78f4bc232a50478729640d251907160299b2a93ddd' },
    'x86_64-pc-windows-msvc': { file: 'uv-x86_64-pc-windows-msvc.zip', sha256: 'ea1397797a0ca15f63516dd0f49c2dde9776db9be5861cab152ebe8ad199894d' },
    'x86_64-unknown-linux-gnu': { file: 'uv-x86_64-unknown-linux-gnu.tar.gz', sha256: 'b9980552309f09c15172b8be828555e375097f16deb459795ce7bfd200380f0b' }
  }
}

async function main(target) {
  const pin = UV.targets[target]
  if (!pin) throw new Error(`Unknown target: ${target}`)
  const res = await fetch(`https://github.com/astral-sh/uv/releases/download/${UV.version}/${pin.file}`)
  if (!res.ok) throw new Error(`uv download failed: HTTP ${res.status}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== pin.sha256) throw new Error(`uv checksum mismatch for ${pin.file}: ${actual}`)

  const outDir = fileURLToPath(new URL('../build/uv/', import.meta.url))
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
  const archive = join(outDir, pin.file)
  await writeFile(archive, bytes)
  // tar (bsdtar on Windows 10+) extracts both .tar.gz and .zip.
  const { status } = spawnSync('tar', ['-xf', archive, '-C', outDir], { stdio: 'inherit' })
  if (status !== 0) throw new Error('tar extraction failed')
  // The tarballs nest uv in a folder; the Windows zip is flat.
  const bin = target.includes('windows') ? 'uv.exe' : 'uv'
  const inner = (await readdir(outDir, { withFileTypes: true })).find((d) => d.isDirectory())
  if (inner) await rename(join(outDir, inner.name, bin), join(outDir, `${bin}.new`))
  // Keep only the uv binary (drop archive, uvx, uvw).
  for (const e of await readdir(outDir)) if (e !== `${bin}.new` && e !== bin) await rm(join(outDir, e), { recursive: true, force: true })
  if (inner) await rename(join(outDir, `${bin}.new`), join(outDir, bin))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv[2])
