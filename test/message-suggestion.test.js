import test from 'node:test'
import assert from 'node:assert/strict'
import { suggestMessage } from '../src/gui/renderer/message-suggestion.js'

const f = (path, status = 'modified') => ({ path, status })

test('no files: no suggestion', () => {
  assert.equal(suggestMessage([]), '')
})

test('one file: verb by status and the file name only', () => {
  assert.equal(suggestMessage([f('participants.tsv')]), 'Update participants.tsv')
  assert.equal(suggestMessage([f('notes.md', 'untracked')]), 'Add notes.md')
  assert.equal(suggestMessage([f('sub-01/anat/old.csv', 'deleted')]), 'Delete old.csv')
  assert.equal(suggestMessage([f('a/b/new name.txt', 'renamed')]), 'Rename new name.txt')
})

test('two or three files: first name and a count of the rest', () => {
  assert.equal(suggestMessage([f('participants.tsv'), f('a.txt'), f('b.txt')]), 'Update participants.tsv and 2 more')
  assert.equal(suggestMessage([f('a.txt'), f('b.txt')]), 'Update a.txt and 1 more')
})

test('four or more files: a plain count', () => {
  assert.equal(suggestMessage([1, 2, 3, 4, 5].map((n) => f(`f${n}.txt`))), 'Update 5 files')
})

test('the verb is shared only when every file has the same kind of change', () => {
  assert.equal(suggestMessage([f('a.txt', 'untracked'), f('b.txt', 'added')]), 'Add a.txt and 1 more')
  assert.equal(suggestMessage([f('a.txt', 'untracked'), f('b.txt', 'modified')]), 'Update a.txt and 1 more')
  assert.equal(suggestMessage([1, 2, 3, 4].map((n) => f(`n${n}.txt`, 'untracked'))), 'Add 4 files')
})

test('unicode names and backslash paths use the last segment', () => {
  assert.equal(suggestMessage([f('Daten\\Größe ä.csv')]), 'Update Größe ä.csv')
})
