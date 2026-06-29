// Builds throwaway project folders for the e2e button-gating suite. Uses
// plain `git` only (no `datalad`/`git-annex` binaries) so these fixtures
// work the same in CI runners that don't have DataLad installed as they do
// on a contributor's machine that does — the app's own dataset-detection
// fallback (presence of .datalad/config) takes over either way, see
// DataLadAdapter#probeDataLadDataset.
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function git(args, cwd) {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

async function initRepo(dir) {
  await mkdir(dir, { recursive: true })
  git(['init', '-q'], dir)
  git(['config', 'user.email', 'e2e@example.org'], dir)
  git(['config', 'user.name', 'E2E Test'], dir)
  git(['commit', '--allow-empty', '-q', '-m', 'init'], dir)
  return dir
}

export async function createTempRoot() {
  return mkdtemp(join(tmpdir(), 'dlad-e2e-'))
}

/** Plain git repo, no remote, one untracked file ready to be saved. */
export async function createPlainGitRepo(root) {
  const dir = join(root, 'plain-git')
  await initRepo(dir)
  await writeFile(join(dir, 'README.md'), '# Untracked\n')
  return dir
}

/** Plain git repo with an `origin` remote tracked by the current branch. */
export async function createGitRepoWithRemote(root) {
  const bareDir = join(root, 'bare-remote.git')
  await mkdir(bareDir, { recursive: true })
  git(['init', '-q', '--bare'], bareDir)

  const dir = join(root, 'git-with-remote')
  await initRepo(dir)
  git(['remote', 'add', 'origin', bareDir], dir)
  git(['push', '-q', '-u', 'origin', 'HEAD:main'], dir)
  return dir
}

/**
 * A "DataLad dataset" the app can classify without a real `datalad` binary:
 * the adapter falls back to checking for .datalad/config when the `datalad
 * status` probe is unavailable or inconclusive.
 */
export async function createDatasetFixture(root) {
  const dir = join(root, 'dataset')
  await initRepo(dir)
  await mkdir(join(dir, '.datalad'), { recursive: true })
  await writeFile(join(dir, '.datalad', 'config'), '[datalad "dataset"]\n\tid = e2e-fixture\n')
  git(['add', '.datalad'], dir)
  git(['commit', '-q', '-m', 'add datalad metadata'], dir)
  return dir
}

/** A dataset fixture that also registers one subdataset via .gitmodules. */
export async function createSuperdatasetFixture(root) {
  const dir = await createDatasetFixture(join(root, 'super-parent'))
  await writeFile(
    join(dir, '.gitmodules'),
    '[submodule "child"]\n\tpath = child\n\turl = ./child\n'
  )
  await mkdir(join(dir, 'child'), { recursive: true })
  git(['add', '.gitmodules'], dir)
  git(['commit', '-q', '-m', 'register child dataset'], dir)
  return dir
}
