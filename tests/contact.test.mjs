import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/contact.js';

const ORIGIN = 'https://doffamin.site';
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const FORWARD_URL = 'https://script.google.com/macros/s/NEW-DEPLOYMENT/exec';

const env = {
  TURNSTILE_SECRET_KEY: 'secret',
  CONTACT_FORWARD_URL: FORWARD_URL,
  CONTACT_FORWARD_TOKEN: 'shared-token',
};

const realFetch = globalThis.fetch;
let calls;
let siteverifyOutcome;
let forwardResponse;

beforeEach(() => {
  calls = [];
  siteverifyOutcome = { success: true, action: 'contact', hostname: 'doffamin.site', 'error-codes': [] };
  forwardResponse = () => new Response(JSON.stringify({ result: 'success' }), { status: 200 });
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url) === SITEVERIFY) return Response.json(siteverifyOutcome);
    if (String(url) === FORWARD_URL) return forwardResponse();
    throw new Error(`unexpected fetch ${url}`);
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function submit(fields, { origin = ORIGIN, method = 'POST' } = {}) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  const headers = { 'cf-connecting-ip': '203.0.113.7' };
  if (origin) headers.origin = origin;
  const request = new Request(`${ORIGIN}/api/contact`, { method, headers, body: method === 'POST' ? body : undefined });
  return onRequest({ request, env });
}

const valid = {
  name: 'Kim',
  email: 'kim@example.com',
  message: 'Hello there',
  'cf-turnstile-response': 'tok',
};

test('rejects non-POST', async () => {
  const res = await submit({}, { method: 'GET' });
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'POST');
});

test('rejects cross-origin and missing Origin', async () => {
  assert.equal((await submit(valid, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await submit(valid, { origin: null })).status, 403);
  assert.equal(calls.length, 0);
});

test('fails closed when not configured', async () => {
  const request = new Request(`${ORIGIN}/api/contact`, { method: 'POST', headers: { origin: ORIGIN }, body: new FormData() });
  const res = await onRequest({ request, env: {} });
  assert.equal(res.status, 500);
  assert.equal((await res.json()).error, 'not_configured');
});

test('honeypot submissions get a fake success and are not forwarded', async () => {
  const res = await submit({ ...valid, honeypot: 'http://spam.example' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(calls.length, 0);
});

test('validates required fields, email shape and length limits', async () => {
  const res = await submit({ ...valid, name: '', email: 'not-an-email', message: 'x'.repeat(4001) });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { ok: false, error: 'invalid_fields', fields: ['name', 'email', 'message'] });
  assert.equal(calls.length, 0);
});

test('requires a Turnstile token before calling siteverify', async () => {
  const res = await submit({ ...valid, 'cf-turnstile-response': '' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'turnstile_missing');
  assert.equal(calls.length, 0);
});

test('rejects when Turnstile fails', async () => {
  siteverifyOutcome = { success: false, 'error-codes': ['timeout-or-duplicate'] };
  const res = await submit(valid);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'turnstile_failed');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, SITEVERIFY);
});

test('rejects tokens bound to another action or hostname', async () => {
  siteverifyOutcome = { success: true, action: 'login', hostname: 'doffamin.site' };
  let res = await submit(valid);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'turnstile_action_mismatch');

  siteverifyOutcome = { success: true, action: 'contact', hostname: 'other.example' };
  res = await submit(valid);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'turnstile_hostname_mismatch');
  assert.equal(calls.filter(c => c.url === FORWARD_URL).length, 0);
});

test('skips action/hostname binding for Cloudflare testing keys', async () => {
  siteverifyOutcome = { success: true, hostname: 'example.com', metadata: { result_with_testing_key: true } };
  const res = await submit(valid);
  assert.equal(res.status, 200);
});

test('forwards only name/email/message plus the shared token', async () => {
  const res = await submit({ ...valid, honeypot: '', extra: 'ignored' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });

  const verify = calls[0];
  assert.equal(verify.url, SITEVERIFY);
  const verifyBody = new URLSearchParams(verify.init.body);
  assert.equal(verifyBody.get('secret'), 'secret');
  assert.equal(verifyBody.get('response'), 'tok');
  assert.equal(verifyBody.get('remoteip'), '203.0.113.7');

  const forward = calls[1];
  assert.equal(forward.url, FORWARD_URL);
  assert.equal(forward.init.redirect, 'follow');
  const body = new URLSearchParams(forward.init.body);
  assert.deepEqual([...body.keys()], ['name', 'email', 'message', 'token']);
  assert.equal(body.get('email'), 'kim@example.com');
  assert.equal(body.get('token'), 'shared-token');
});

test('reports a failed forward', async () => {
  forwardResponse = () => new Response(JSON.stringify({ result: 'error' }), { status: 200 });
  let res = await submit(valid);
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error, 'forward_failed');

  forwardResponse = () => new Response('nope', { status: 500 });
  res = await submit(valid);
  assert.equal(res.status, 502);
});
