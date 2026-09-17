const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./server.cjs');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

async function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'doi-fixture-'));
  const requests = [];
  const result = createApp({ databasePath: join(directory, 'pending.db'), brevoKey: 'synthetic-fixture-key', fetchImpl: async (url, init) => { requests.push({ url, init }); return new Response('{}', { status: 201 }); }, ...options });
  const server = result.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); result.db.close(); rmSync(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { ...result, requests, base, post: (path, data, origin = 'https://waermenetz.hhb-agrarenergie.de') => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(data) }) };
}

test('provider absence and cross-origin requests never send messages', async t => {
  const f = await fixture(t, { brevoKey: '' });
  assert.equal((await f.post('/api/newsletter/signup', { email: 'x@example.invalid' })).status, 503);
  assert.equal((await f.post('/api/newsletter/signup', { email: 'x@example.invalid' }, 'https://evil.invalid')).status, 403);
  assert.equal(f.requests.length, 0);
});

test('health checks actual SQLite and version exposes runtime metadata only', async t => {
  const f = await fixture(t);
  const health = await (await fetch(f.base + '/api/health')).json();
  assert.equal(health.db, 'ok');
  assert.equal(health.providerConfigured, true);
  assert.equal(f.requests.length, 0);
});

test('DOI confirms once and blocks repeated sends', async t => {
  const f = await fixture(t);
  assert.equal((await f.post('/api/newsletter/signup', { email: 'fixture@example.invalid' })).status, 200);
  assert.equal(f.requests.length, 1);
  const token = f.db.prepare('SELECT token FROM pending').get().token;
  const url = f.base + '/api/newsletter/confirm?token=' + token;
  const first = await fetch(url, { redirect: 'manual' });
  assert.match(first.headers.get('location'), /status=ok/);
  assert.equal(f.requests.length, 3);
  const second = await fetch(url, { redirect: 'manual' });
  assert.match(second.headers.get('location'), /status=already/);
  assert.equal(f.requests.length, 3);
});

test('interest confirmation requires privacy acknowledgement and does not subscribe implicitly', async t => {
  const f = await fixture(t);
  const data = { email: 'fixture@example.invalid', vorname: '<img src=x onerror=alert(1)>', nachricht: '<script>bad</script>' };
  assert.equal((await f.post('/api/interest/signup', data)).status, 400);
  assert.equal((await f.post('/api/interest/signup', { ...data, datenschutz: true })).status, 200);
  const token = f.db.prepare('SELECT token FROM pending').get().token;
  await fetch(f.base + '/api/newsletter/confirm?token=' + token, { redirect: 'manual' });
  assert.equal(f.requests.length, 2); // DOI plus owner notification, no subscription/welcome
  assert.ok(f.requests.every(request => !request.url.endsWith('/contacts')));
  const html = JSON.parse(f.requests[1].init.body).htmlContent;
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('<script>'));
});

test('invalid and expired confirmations never contact a provider', async t => {
  const f = await fixture(t);
  const invalid = await fetch(f.base + '/api/newsletter/confirm?token=bad', { redirect: 'manual' });
  assert.match(invalid.headers.get('location'), /status=invalid/);
  f.db.prepare('INSERT INTO pending(token,email,data,type,created_at) VALUES (?,?,?,?,?)').run('a'.repeat(64), 'fixture@example.invalid', '{}', 'newsletter', 1);
  const expired = await fetch(f.base + '/api/newsletter/confirm?token=' + 'a'.repeat(64), { redirect: 'manual' });
  assert.match(expired.headers.get('location'), /status=expired/);
  assert.equal(f.requests.length, 0);
});

test('provider failures are reported without secret or recipient response bodies', async t => {
  const f = await fixture(t, { fetchImpl: async () => new Response('sensitive provider detail', { status: 503 }) });
  const response = await f.post('/api/newsletter/signup', { email: 'fixture@example.invalid' });
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, 'server_error');
});

test('parallel confirmations acquire one database claim before provider writes', async t => {
  let releaseContact;
  let contactStarted;
  const started = new Promise(resolve => { contactStarted = resolve; });
  const waitContact = new Promise(resolve => { releaseContact = resolve; });
  let contactCalls = 0;
  const f = await fixture(t, { fetchImpl: async url => {
    if (url.endsWith('/contacts')) { contactCalls++; contactStarted(); await waitContact; }
    return new Response('{}', { status: 201 });
  } });
  await f.post('/api/newsletter/signup', { email: 'fixture@example.invalid' });
  const token = f.db.prepare('SELECT token FROM pending').get().token;
  const url = f.base + '/api/newsletter/confirm?token=' + token;
  const first = fetch(url, { redirect: 'manual' });
  await started;
  const second = await fetch(url, { redirect: 'manual' });
  assert.equal(second.status, 409);
  releaseContact();
  assert.equal((await first).status, 302);
  assert.equal(contactCalls, 1);
});
