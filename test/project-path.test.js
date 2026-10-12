import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { joinProjectPath, existingFolderProblem } from '../src/gui/renderer/project-path.js'

const read = (p) => readFileSync(new URL(`../src/gui/renderer/${p}`, import.meta.url), 'utf8')

test('joins location and name with the separator the location uses', () => {
  assert.deepEqual(joinProjectPath('/Users/karl/work', 'my-study'), { path: '/Users/karl/work/my-study' })
  assert.deepEqual(joinProjectPath('/Users/karl/work/', ' my study '), { path: '/Users/karl/work/my study' })
  assert.deepEqual(joinProjectPath('C:\\Users\\karl', 'study'), { path: 'C:\\Users\\karl\\study' })
  assert.deepEqual(joinProjectPath('/', 'study'), { path: '/study' })
})

test('a missing location or name is an error, never a path', () => {
  assert.match(joinProjectPath('', 'study').error, /location/i)
  assert.match(joinProjectPath('/a', '  ').error, /name/i)
})

test('a name cannot escape the location', () => {
  for (const name of ['..', '.', 'a/b', 'a\\b', '../x']) {
    assert.match(joinProjectPath('/a', name).error, /name/i, name)
  }
})

test('Create Project has Location and Project name fields, and the click handler uses the joined path', () => {
  const html = read('index.html')
  assert.match(html, /id="create-project-name"/)
  assert.match(html, /id="create-project-target"/)
  const app = read('app.js')
  const handler = app.slice(app.indexOf("elements.createProjectButton.addEventListener('click'"))
  assert.match(handler.slice(0, 600), /joinProjectPath\(/)
})

test('an existing non-empty folder blocks creation, unless a new project may adopt it as BIDS', () => {
  const missing = { exists: false, isEmpty: true, bidsLikely: false }
  const empty = { exists: true, isEmpty: true, bidsLikely: false }
  const full = { exists: true, isEmpty: false, bidsLikely: false }
  const bids = { exists: true, isEmpty: false, bidsLikely: true }
  for (const remote of [false, true]) {
    assert.equal(existingFolderProblem(missing, { remote }), '', 'missing is fine')
    assert.equal(existingFolderProblem(empty, { remote }), '', 'empty is fine')
    assert.match(existingFolderProblem(full, { remote }), /already exists/i)
  }
  assert.equal(existingFolderProblem(bids, { remote: false }), '', 'BIDS folder is adopted in place')
  assert.match(existingFolderProblem(bids, { remote: true }), /already exists/i)
  assert.equal(existingFolderProblem(null, { remote: false }), '', 'no information yet: let DataLad decide')
})

test('Create Project refuses an existing non-empty folder before running DataLad, and warns while typing', () => {
  const app = read('app.js')
  const handler = app.slice(app.indexOf("elements.createProjectButton.addEventListener('click'"))
  const check = handler.indexOf('await checkCreateProjectBidsCandidate(')
  const problem = handler.indexOf('existingFolderProblem(')
  const run = handler.indexOf('await runCreate')
  assert.ok(check !== -1 && problem > check && run > problem, 'inspect, then refuse, then run')
  const live = app.slice(app.indexOf('async function onCreateProjectTargetChanged'), app.indexOf('wireFolderPicker(elements.pickCreateProjectPathButton'))
  assert.match(live, /existingFolderProblem\(/)
})
