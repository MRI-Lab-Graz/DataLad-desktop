import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describeSync } from '../src/gui/renderer/sync-cards.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const snap = (extra = {}) => ({ hasUpstream: true, upstream: 'backup/main', ahead: 0, behind: 0, remoteUrl: '/Volumes/USB/study', sourceAccepts: null, ...extra })

test('no remote: nothing to describe', () => {
  for (const health of [null, undefined, { hasUpstream: false }]) {
    const view = describeSync(health)
    assert.equal(view.remoteLine, '')
    assert.equal(view.statusLine, '')
    assert.equal(view.update.countText, '')
    assert.equal(view.publish.countText, '')
  }
})

test('in sync', () => {
  const view = describeSync(snap())
  assert.equal(view.statusLine, 'Everything is in sync.')
  assert.equal(view.update.label, 'Get updates')
  assert.equal(view.update.countText, 'none waiting')
  assert.equal(view.publish.label, 'Send my saves')
  assert.equal(view.publish.countText, 'nothing to send')
})

test('ahead only, with singular and plural', () => {
  assert.equal(describeSync(snap({ ahead: 3 })).statusLine, '3 saves of yours are not there yet · nothing new from others')
  assert.equal(describeSync(snap({ ahead: 1 })).statusLine, '1 save of yours is not there yet · nothing new from others')
  assert.equal(describeSync(snap({ ahead: 3 })).publish.countText, '3 waiting')
  assert.equal(describeSync(snap({ ahead: 3 })).update.countText, 'none waiting')
})

test('behind only, with singular and plural', () => {
  assert.equal(describeSync(snap({ behind: 2 })).statusLine, 'All your saves are there · 2 new saves from others are waiting')
  assert.equal(describeSync(snap({ behind: 1 })).statusLine, 'All your saves are there · 1 new save from others is waiting')
  assert.equal(describeSync(snap({ behind: 2 })).update.countText, '2 waiting')
  assert.equal(describeSync(snap({ behind: 2 })).publish.countText, 'nothing to send')
})

test('both ahead and behind', () => {
  assert.equal(describeSync(snap({ ahead: 2, behind: 1 })).statusLine, '2 saves of yours are not there yet · 1 new save from others is waiting')
})

test('unknown counts say "not checked yet", never "none waiting"', () => {
  const view = describeSync(snap({ ahead: null, behind: null }))
  assert.equal(view.statusLine, 'Not checked yet.')
  assert.equal(view.update.countText, 'not checked yet')
  assert.equal(view.publish.countText, 'not checked yet')
  const half = describeSync(snap({ ahead: 2, behind: null }))
  assert.equal(half.update.countText, 'not checked yet')
  assert.equal(half.publish.countText, '2 waiting')
  assert.match(half.statusLine, /2 saves of yours are not there yet · .*not checked yet/)
  assert.equal(describeSync(snap({ ahead: undefined, behind: undefined })).update.countText, 'not checked yet')
})

test('help text explains each card and keeps the old names once', () => {
  const view = describeSync(snap())
  assert.match(view.update.help, /Bring in saves that others \(or another computer\) added there\. Nothing of yours is changed\./)
  assert.equal(view.update.help.match(/called Update/g).length, 1)
  assert.match(view.publish.help, /Copy the saves you made here to backup, so others can get them\./)
  assert.equal(view.publish.help.match(/called Publish/g).length, 1)
})

test('a folder, an online repository and a missing location read differently', () => {
  assert.equal(describeSync(snap()).remoteLine, 'backup — a folder at /Volumes/USB/study')
  assert.equal(describeSync(snap({ remoteUrl: 'C:\\Users\\Ana\\USB\\study' })).remoteLine, 'backup — a folder at C:\\Users\\Ana\\USB\\study')
  assert.equal(describeSync(snap({ remoteUrl: 'file:///Volumes/USB/study' })).remoteLine, 'backup — a folder at /Volumes/USB/study')
  assert.equal(describeSync(snap({ upstream: 'origin/main', remoteUrl: 'https://gin.g-node.org/me/study' })).remoteLine, 'origin — an online repository: https://gin.g-node.org/me/study')
  assert.equal(describeSync(snap({ upstream: 'origin/main', remoteUrl: 'git@github.com:me/study.git' })).remoteLine, 'origin — an online repository: git@github.com:me/study.git')
  assert.equal(describeSync(snap({ remoteUrl: null })).remoteLine, 'backup')
})

test('file URLs: Windows drive and server paths read as folders, bad escapes never throw', () => {
  assert.equal(describeSync(snap({ remoteUrl: 'file:///C:/Users/Ana/USB' })).remoteLine, 'backup — a folder at C:\\Users\\Ana\\USB')
  assert.equal(describeSync(snap({ remoteUrl: 'file://server/share/x' })).remoteLine, 'backup — a folder at \\\\server\\share\\x')
  assert.equal(describeSync(snap({ remoteUrl: 'file:///100%/x' })).remoteLine, 'backup — a folder at /100%/x')
})

test('credentials in a URL never reach the screen text', () => {
  const view = describeSync(snap({ upstream: 'origin/main', remoteUrl: 'https://me:s3cret@gitlab.com/me/study.git' }))
  assert.doesNotMatch(JSON.stringify(view), /s3cret|me:/)
  assert.match(view.remoteLine, /https:\/\/\*\*\*@gitlab\.com\/me\/study\.git/)
})

test('a place that does not accept changes: calm wording, button not disabled by this view', () => {
  const view = describeSync(snap({ ahead: 2, sourceAccepts: 'no' }))
  assert.match(view.publish.help, /does not accept changes/)
  assert.doesNotMatch(view.publish.help, /refused!/)
  assert.equal(view.publish.disabled, undefined)
  assert.equal(view.publish.countText, '2 waiting')
  assert.doesNotMatch(describeSync(snap({ sourceAccepts: 'yes' })).publish.help, /does not accept/)
})

test('markup: the Sync section has three blocks and keeps the button ids', () => {
  const html = read('../src/gui/renderer/index.html')
  const section = html.slice(html.indexOf('id="sync-data-section"'), html.indexOf('id="add-remote"'))
  assert.match(section, /<h3[^>]*>Where your saves are shared<\/h3>/)
  assert.match(section, /<h3[^>]*>Get updates<\/h3>/)
  assert.match(section, /<h3[^>]*>Send my saves<\/h3>/)
  assert.match(section, /<button id="update-project"[^>]*>Get updates<\/button>/)
  assert.match(section, /<button id="publish-project"[^>]*>Send my saves<\/button>/)
  for (const id of ['sync-actions-strip', 'sync-actions-quiet', 'remote-info', 'disconnect-remote', 'sync-remote-line', 'sync-status-line', 'sync-update-help', 'sync-update-count', 'sync-publish-help', 'sync-publish-count']) {
    assert.match(section, new RegExp(`id="${id}"`))
  }
  assert.doesNotMatch(section, /Update \(remote\)|Publish \(remote\)/)
  assert.doesNotMatch(section, /called (Update|Publish)/, 'the old names live in describeSync only, so they appear once')
})

test('wiring: a failing card render cannot skip the button gating', () => {
  const app = read('../src/gui/renderer/app.js')
  const body = app.slice(app.indexOf('function applyRemoteGatedButtons'), app.indexOf('function setStatusLine'))
  assert.ok(body.indexOf('computeRemoteGating(') < body.indexOf('renderSyncCards('))
  assert.match(body, /try \{\s*renderSyncCards/)
})

test('wiring: app.js renders the cards from describeSync with textContent only', () => {
  const app = read('../src/gui/renderer/app.js')
  assert.match(app, /import \{ describeSync \} from '\.\/sync-cards\.js'/)
  const body = app.slice(app.indexOf('function renderSyncCards'), app.indexOf('function setStatusLine'))
  assert.match(body, /describeSync\(/)
  assert.doesNotMatch(body, /innerHTML|insertAdjacentHTML/)
  for (const id of ['syncRemoteLine', 'syncStatusLine', 'syncUpdateHelp', 'syncUpdateCount', 'syncPublishHelp', 'syncPublishCount']) {
    assert.match(body, new RegExp(`elements\\.${id}\\.textContent`))
  }
})
