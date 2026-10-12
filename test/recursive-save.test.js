import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// LF endings, so slicing on "\n}\n" also works on a Windows (CRLF) checkout.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const html = read('src/gui/renderer/index.html')
const app = read('src/gui/renderer/app.js')
const fnBody = (name) => {
  const rest = app.slice(app.indexOf(name))
  return rest.slice(0, rest.indexOf('\n}\n'))
}

test('the nested-dataset picker is gone from the page', () => {
  assert.doesNotMatch(html, /dataset-select|refresh-datasets|Project Data Folder|pick which one Save applies to/)
})

test('nothing in the renderer reads the removed picker elements', () => {
  assert.doesNotMatch(app, /datasetSelect|datasetSelectField|refreshDatasetsButton/)
})

test('the active folder is the project root, while the dataset list still feeds the ignore-rules scope', () => {
  const body = fnBody('async function refreshDatasetList')
  assert.match(body, /state\.datasets = datasets/)
  assert.match(body, /renderIgnoreRulesScope\(\)/)
  assert.match(body, /const nextPath = projectPath/)
  assert.doesNotMatch(body, /hasActivePath|datasets\[0\]|dataset\.relativePath === '\.'/)
})

test('a ticked file inside a nested dataset survives a status refresh', () => {
  const body = fnBody('function syncSelectedChangedPaths')
  assert.match(body, /const availablePaths = collectChangedPaths\(files\)/)
  assert.match(app, /import \{[^}]*collectChangedPaths[^}]*\} from '\.\/save-gating\.js'/)
})
