import test from 'node:test'
import assert from 'node:assert/strict'
import { redactUrlCredentials } from '../src/datalad/redact.js'

test('redactUrlCredentials hides tokens and passwords in http(s) URLs, wherever they appear in the text', () => {
  assert.equal(redactUrlCredentials('https://user:s3cret@gin.g-node.org/me/x'), 'https://***@gin.g-node.org/me/x')
  assert.equal(redactUrlCredentials('https://ghp_TOKEN@github.com/me/x.git'), 'https://***@github.com/me/x.git')
  assert.equal(
    redactUrlCredentials('siblings add --url https://u:p@h/x\nfatal: unable to access https://u:p@h/x/'),
    'siblings add --url https://***@h/x\nfatal: unable to access https://***@h/x/'
  )
})

test('redactUrlCredentials leaves ordinary remotes alone (ssh user names are not secrets)', () => {
  for (const text of ['https://gin.g-node.org/me/x', 'ssh://git@host/x', 'git@github.com:me/x.git', '/Volumes/USB/study', 'a@b.org']) {
    assert.equal(redactUrlCredentials(text), text)
  }
})
