import { lstat } from 'node:fs/promises'
import { join } from 'node:path'

export const PRISM_MARKER = 'project.json'
export const BIDS_MARKER = 'dataset_description.json'
const MAX_LISTED_ERRORS = 10
const DEFAULT_TIMEOUT_MS = 300000

// lstat, not access: an annexed marker file whose content isn't fetched is a dangling symlink,
// and the project is still a PRISM/BIDS project (the validator then fails closed on the missing file).
const hasFile = (projectPath, name) => lstat(join(projectPath, name)).then(() => true, () => false)
export const isPrismProject = (projectPath) => hasFile(projectPath, PRISM_MARKER)
export const isBidsProject = (projectPath) => hasFile(projectPath, BIDS_MARKER)

// A save from a subfolder commits the whole repo, so the gate always works on the repo root.
// Exit 128 = not a git repository: nothing can be committed, so there is nothing to gate.
async function repoRoot({ runner, projectPath }) {
  const result = await runner.run('git', ['-C', projectPath, 'rev-parse', '--show-toplevel'])
  if (result.exitCode === 0) return result.stdout.trim()
  if (result.exitCode === 128) return null
  throw new Error(`git could not find the project: ${result.stderr || `exit ${result.exitCode}`}`)
}

// `git cat-file -e HEAD:project.json` exits 128 when the file is not in HEAD or there is no HEAD
// yet: this save introduces project.json, so validation starts with the next one.
export async function isConversionSave({ runner, projectPath }) {
  const result = await runner.run('git', ['-C', projectPath, 'cat-file', '-e', `HEAD:${PRISM_MARKER}`])
  if (result.exitCode === 0) return false
  if (result.exitCode === 128) return true
  throw new Error(`git could not check ${PRISM_MARKER}: ${result.stderr || `exit ${result.exitCode}`}`)
}

const oneLine = (entry) => {
  if (typeof entry === 'string') return entry
  const where = entry?.file_path ?? entry?.path ?? entry?.file
  const what = (entry?.message ?? entry?.description)?.replace(/\s+/g, ' ').trim()
  if (where && what) return `${where}: ${what}`
  return what ?? JSON.stringify(entry)
}

// prism-validator >= 1.20 `--format json`: { valid, issues: [{ code, severity, message, file_path }], summary: { errors } }.
// Warnings never block. PRISM902 means the BIDS check could not run: the data was never judged.
export function interpretReport(stdout) {
  let report
  try {
    report = JSON.parse(stdout)
  } catch {
    return { verdict: 'unknown', reason: 'The validator did not return a readable report.' }
  }
  if (typeof report?.valid !== 'boolean') {
    return { verdict: 'unknown', reason: 'The validator report has no verdict.' }
  }
  const issues = Array.isArray(report.issues) ? report.issues : []
  if (issues.some((issue) => issue?.code === 'PRISM902')) {
    return { verdict: 'unknown', reason: 'The BIDS validator could not run.' }
  }
  const errors = issues.filter((issue) => issue?.severity === 'ERROR')
  const total = Math.max(report.summary?.errors ?? 0, errors.length)
  if (report.valid && total === 0) return { verdict: 'valid' }
  return { verdict: 'invalid', errorCount: total, errors: errors.slice(0, MAX_LISTED_ERRORS).map(oneLine) }
}

const blocked = (code, title, message, extra = {}) => ({
  allow: false,
  result: {
    ok: false,
    commandName: 'save',
    exitCode: 1,
    stdout: '',
    stderr: '',
    failed: true,
    warnings: [],
    userError: { code, title, message, technicalDetails: '', ...extra }
  }
})

const unchecked = (technicalDetails, label = 'PRISM') =>
  blocked('PRISM_UNCHECKED', `${label} check could not run`, "Couldn't check your data, so nothing was saved. Try again.", { technicalDetails })

export async function gateSave({ runner, projectPath, validatorBin, checkValidator, signal, onOutput, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  let root
  let prism
  try {
    root = await repoRoot({ runner, projectPath })
    if (!root) return { allow: true, saveAll: false }
    prism = await isPrismProject(root)
    if (!prism && !(await isBidsProject(root))) return { allow: true, saveAll: false }

    // The save that introduces project.json is exempt, but it must really commit it: save everything,
    // and refuse while git ignores the file (it could then never enter HEAD and the exemption would never end).
    // A BIDS project has no such exemption: it is validated from its first save.
    if (prism && (await isConversionSave({ runner, projectPath: root }))) {
      const ignored = await runner.run('git', ['-C', root, 'check-ignore', '-q', PRISM_MARKER])
      if (ignored.exitCode === 0) throw new Error(`${PRISM_MARKER} is ignored by git. Remove it from .gitignore so it can be saved.`)
      return { allow: true, saveAll: true }
    }
  } catch (error) {
    return unchecked(String(error.message), prism === false ? 'BIDS' : 'PRISM')
  }
  const label = prism ? 'PRISM' : 'BIDS'

  if (!(await checkValidator())) {
    return blocked(
      'PRISM_VALIDATOR_MISSING',
      `${label} validator needed`,
      `The ${label} check needs a one-time install. Open Setup and click Install under PRISM Validator.`
    )
  }

  // The validator carries the BIDS validator since 1.20: PRISM projects get both checks, BIDS-only projects just BIDS.
  const args = prism ? [root, '--bids', '--format', 'json'] : [root, '--no-prism', '--bids', '--format', 'json']
  const run = await runner.run(validatorBin, args, { signal, onOutput, timeoutMs })
  if (run.cancelled) return unchecked('Cancelled.', label)

  // The validator exits non-zero for invalid data, so the report (not the exit code) decides.
  const report = interpretReport(run.stdout)
  if (report.verdict === 'valid') return { allow: true, saveAll: true }
  if (report.verdict === 'invalid') {
    const count = report.errorCount
    const problems = count > 0 ? ` (${count} problem${count === 1 ? '' : 's'})` : ''
    return blocked(
      'PRISM_INVALID',
      `${label} check failed`,
      `Your data doesn't pass the ${label} check yet${problems}. Fix them and save again.`,
      { items: report.errors }
    )
  }
  return unchecked([report.reason, run.stderr].filter(Boolean).join('\n'), label)
}
