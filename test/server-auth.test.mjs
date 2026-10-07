import assert from 'node:assert/strict'
import test from 'node:test'
import { requestWriteToken, sessionCookieHeader } from '../src/server.mjs'

test('write authorization accepts header, URL and same-origin session cookie', () => {
  const urlToken = new URL('http://127.0.0.1:8787/api/open-folder?t=from-url')
  assert.equal(requestWriteToken({ headers: {} }, urlToken), 'from-url')

  const cookieUrl = new URL('http://127.0.0.1:8787/api/open-folder')
  assert.equal(requestWriteToken({ headers: { cookie: 'other=1; oneskill_token=from-cookie' } }, cookieUrl), 'from-cookie')

  const headerRequest = { headers: { cookie: 'oneskill_token=from-cookie', 'x-oneskill-token': 'from-header' } }
  assert.equal(requestWriteToken(headerRequest, urlToken), 'from-header')
})

test('session cookie is local, HTTP-only and same-site', () => {
  assert.equal(
    sessionCookieHeader('abc 123'),
    'oneskill_token=abc%20123; Path=/; HttpOnly; SameSite=Strict',
  )
})
