import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { joinProjectPath } from '../src/gui/renderer/project-path.js'

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
