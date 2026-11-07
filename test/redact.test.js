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

test('redactUrlCredentials: userinfo ends at the last @ before the path, so a password with @ does not leak', () => {
  assert.equal(redactUrlCredentials('https://u:p@ss@h/x'), 'https://***@h/x')
  assert.equal(redactUrlCredentials('https://u:p@ss@h'), 'https://***@h')
  assert.equal(redactUrlCredentials('https://h/x@y'), 'https://h/x@y')
})

test('redactUrlCredentials hides secret-looking query values in http(s) URLs', () => {
  assert.equal(redactUrlCredentials('https://h/x?token=abc&b=1'), 'https://h/x?token=***&b=1')
  assert.equal(redactUrlCredentials('https://h/x?a=1&access_token=abc&password=p&key=k&secret=s&sig=z'), 'https://h/x?a=1&access_token=***&password=***&key=***&secret=***&sig=***')
  assert.equal(redactUrlCredentials('https://h/x?page=2'), 'https://h/x?page=2')
})

test('redactUrlCredentials hides more secret names and fragments, but only exact names', () => {
  const names = ['apikey', 'api_key', 'api-key', 'private_token', 'access-token', 'auth', 'authorization', 'credential', 'API_KEY']
  for (const n of names) assert.equal(redactUrlCredentials(`https://h/x?a=1&${n}=zzz`), `https://h/x?a=1&${n}=***`, n)
  assert.equal(redactUrlCredentials('https://h/x#access_token=zzz&state=1'), 'https://h/x#access_token=***&state=1')
  assert.equal(redactUrlCredentials('https://h/x#token=zzz'), 'https://h/x#token=***')
  for (const ok of ['https://h/x?tokenizer=a', 'https://h/x?key_id=7', 'https://h/x?author=me', 'https://h/x#section-2']) assert.equal(redactUrlCredentials(ok), ok)
})
