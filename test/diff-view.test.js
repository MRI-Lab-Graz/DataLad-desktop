import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DIFF_DEFAULT_LINES,
  DIFF_MAX_LINES,
  parseUnifiedDiff,
  separatorFor,
  cellChanges,
  formatBytes,
  renderDiffHtml
} from '../src/gui/renderer/diff-view.js'

const patch = ['@@ -1,3 +1,3 @@', ' id\tage', '-sub-01\t24', '+sub-01\t25', ' sub-02\t31', '\\ No newline at end of file'].join('\n')

test('limits are 500 by default and 20000 at most', () => {
  assert.equal(DIFF_DEFAULT_LINES, 500)
  assert.equal(DIFF_MAX_LINES, 20000)
})

test('parseUnifiedDiff turns a patch into typed lines and drops the no-newline marker', () => {
  assert.deepEqual(parseUnifiedDiff(patch), [
    { type: 'hunk', text: '@@ -1,3 +1,3 @@' },
    { type: 'context', text: 'id\tage' },
    { type: 'del', text: 'sub-01\t24' },
    { type: 'add', text: 'sub-01\t25' },
    { type: 'context', text: 'sub-02\t31' }
  ])
})

test('parseUnifiedDiff keeps lines that themselves start with plus or minus, and empty context lines', () => {
  assert.deepEqual(parseUnifiedDiff('@@ -1,2 +1,2 @@\n-+x\n++y\n \n'), [
    { type: 'hunk', text: '@@ -1,2 +1,2 @@' },
    { type: 'del', text: '+x' },
    { type: 'add', text: '+y' },
    { type: 'context', text: '' }
  ])
})

test('separatorFor picks tab for tsv/tab, comma for csv, nothing otherwise', () => {
  assert.equal(separatorFor('data/participants.tsv'), '\t')
  assert.equal(separatorFor('a.TAB'), '\t')
  assert.equal(separatorFor('results.csv'), ',')
  assert.equal(separatorFor('notes.md'), null)
  assert.equal(separatorFor('csv'), null)
})

test('cellChanges marks only the cells that differ', () => {
  assert.deepEqual(cellChanges('sub-01\t24\tf', 'sub-01\t25\tf', '\t'), {
    old: [{ text: 'sub-01', changed: false }, { text: '24', changed: true }, { text: 'f', changed: false }],
    new: [{ text: 'sub-01', changed: false }, { text: '25', changed: true }, { text: 'f', changed: false }]
  })
})

test('cellChanges gives up (null) on unequal cell counts or quoted fields', () => {
  assert.equal(cellChanges('a,b', 'a,b,c', ','), null)
  assert.equal(cellChanges('a,"b,c"', 'a,"b,d"', ','), null)
})

test('formatBytes uses B, KB, MB, GB with one decimal', () => {
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(2048), '2.0 KB')
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB')
  assert.equal(formatBytes(3 * 1024 ** 3), '3.0 GB')
})

const text = (over = {}) => ({ kind: 'text', status: 'modified', patch, totalLines: 5, truncated: false, oldSize: null, newSize: null, ...over })

test('renderDiffHtml shows added, removed and context rows, with cell highlight for a tsv', () => {
  const html = renderDiffHtml(text(), { path: 'participants.tsv', requestedMax: 500 })
  assert.match(html, /diff-line diff-hunk/)
  assert.match(html, /diff-line diff-del/)
  assert.match(html, /diff-line diff-add/)
  assert.match(html, /<span class="diff-cell-changed">24<\/span>/)
  assert.match(html, /<span class="diff-cell-changed">25<\/span>/)
  assert.doesNotMatch(html, /<span class="diff-cell-changed">sub-01<\/span>/)
})

test('renderDiffHtml uses plain rows (no cell highlight) for other files', () => {
  const html = renderDiffHtml(text(), { path: 'notes.md', requestedMax: 500 })
  assert.doesNotMatch(html, /diff-cell-changed/)
  assert.match(html, /sub-01\t25/)
})

test('renderDiffHtml pairs removed and added lines by position inside a run', () => {
  const run = '@@ -1,2 +1,3 @@\n-a,1\n-b,2\n+a,9\n+b,2\n+c,3'
  const html = renderDiffHtml(text({ patch: run, totalLines: 6 }), { path: 'x.csv', requestedMax: 500 })
  assert.equal([...html.matchAll(/diff-cell-changed/g)].length, 2) // 1 -> 9 on both sides; b,2 is unchanged; c,3 is unpaired
})

test('renderDiffHtml escapes file content', () => {
  const html = renderDiffHtml(text({ patch: '@@ -1 +1 @@\n-<img src=x onerror=alert(1)>\n+<b>"&"</b>' }), { path: 'a.html', requestedMax: 500 })
  assert.doesNotMatch(html, /<img|<b>/)
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
})

test('renderDiffHtml escapes cell text too', () => {
  const html = renderDiffHtml(text({ patch: '@@ -1 +1 @@\n-<a>\t1\n+<a>\t2' }), { path: 'x.tsv', requestedMax: 500 })
  assert.doesNotMatch(html, /<a>/)
  assert.match(html, /&lt;a&gt;/)
})

test('renderDiffHtml says so when nothing changed', () => {
  assert.match(renderDiffHtml({ kind: 'unchanged', status: 'modified' }, { path: 'a.txt', requestedMax: 500 }), /No changes/)
})

test('renderDiffHtml describes a data file with sizes when known, and without when not', () => {
  const html = renderDiffHtml({ kind: 'binary', status: 'modified', oldSize: 2048, newSize: 5 * 1024 * 1024 }, { path: 'scan.nii.gz', requestedMax: 500 })
  assert.match(html, /Data file changed/)
  assert.match(html, /2\.0 KB/)
  assert.match(html, /5\.0 MB/)
  const unknown = renderDiffHtml({ kind: 'binary', status: 'added', oldSize: null, newSize: null }, { path: 'scan.nii.gz', requestedMax: 500 })
  assert.match(unknown, /Data file added/)
  assert.doesNotMatch(unknown, / B| KB| MB/)
})

test('renderDiffHtml offers the rest when cut at the default, and says it stops when cut at the maximum', () => {
  const cut = renderDiffHtml(text({ truncated: true, totalLines: 1200 }), { path: 'a.txt', requestedMax: 500 })
  assert.match(cut, /Showing 5 of 1200 lines/)
  assert.match(cut, /diff-more-button/)
  const stop = renderDiffHtml(text({ truncated: true, totalLines: 30000 }), { path: 'a.txt', requestedMax: 20000 })
  assert.doesNotMatch(stop, /diff-more-button/)
  assert.match(stop, /The rest is not shown/)
})
