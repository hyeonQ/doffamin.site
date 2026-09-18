/**
 * POST /api/contact — Cloudflare Pages Function that fronts the contact form.
 *
 * Flow: same-origin check → honeypot → field validation → Turnstile siteverify
 *       → forward name/email/message to the Google Apps Script mailer.
 *
 * Variables (Cloudflare Pages → Settings → Variables and Secrets):
 *   TURNSTILE_SECRET_KEY   secret   Turnstile widget secret key
 *   CONTACT_FORWARD_URL    secret   Apps Script web app URL (…/exec). Keep it out of git.
 *   CONTACT_FORWARD_TOKEN  secret   optional; sent as `token` so doPost can reject direct
 *                                   submissions (see docs/contact-form.md)
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_ACTION = 'contact';
const LIMITS = { name: 100, email: 254, message: 4000 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  }

  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  if (origin !== url.origin) {
    return json({ ok: false, error: 'bad_origin' }, 403);
  }

  if (!env.TURNSTILE_SECRET_KEY || !env.CONTACT_FORWARD_URL) {
    console.error('contact: TURNSTILE_SECRET_KEY / CONTACT_FORWARD_URL are not configured');
    return json({ ok: false, error: 'not_configured' }, 500);
  }

  let fields;
  try {
    fields = await readFields(request);
  } catch {
    return json({ ok: false, error: 'bad_request' }, 400);
  }

  // Bots that fill every input get a fake success and nothing is forwarded.
  if (fields.honeypot) {
    return json({ ok: true });
  }

  const invalid = validate(fields);
  if (invalid.length) {
    return json({ ok: false, error: 'invalid_fields', fields: invalid }, 400);
  }

  if (!fields.turnstile) {
    return json({ ok: false, error: 'turnstile_missing' }, 400);
  }

  const verdict = await verifyTurnstile({
    secret: env.TURNSTILE_SECRET_KEY,
    token: fields.turnstile,
    ip: request.headers.get('cf-connecting-ip'),
    hostname: url.hostname,
  });
  if (!verdict.ok) {
    console.warn(`contact: turnstile rejected (${verdict.reason}${verdict.codes ? ': ' + verdict.codes.join(',') : ''})`);
    return json({ ok: false, error: verdict.reason }, verdict.reason === 'siteverify_unavailable' ? 502 : 403);
  }

  const forwarded = await forward(env, fields);
  if (!forwarded) {
    return json({ ok: false, error: 'forward_failed' }, 502);
  }

  return json({ ok: true });
}

async function readFields(request) {
  const type = request.headers.get('content-type') || '';
  let raw;
  if (type.includes('application/json')) {
    raw = await request.json();
  } else {
    raw = Object.fromEntries(await request.formData());
  }
  const str = value => (typeof value === 'string' ? value.trim() : '');
  return {
    name: str(raw.name),
    email: str(raw.email),
    message: str(raw.message),
    honeypot: str(raw.honeypot),
    turnstile: str(raw['cf-turnstile-response']),
  };
}

function validate({ name, email, message }) {
  const invalid = [];
  if (!name || name.length > LIMITS.name) invalid.push('name');
  if (!email || email.length > LIMITS.email || !EMAIL_RE.test(email)) invalid.push('email');
  if (!message || message.length > LIMITS.message) invalid.push('message');
  return invalid;
}

async function verifyTurnstile({ secret, token, ip, hostname }) {
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set('remoteip', ip);

  let outcome;
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) return { ok: false, reason: 'siteverify_unavailable' };
    outcome = await res.json();
  } catch {
    return { ok: false, reason: 'siteverify_unavailable' };
  }

  if (!outcome.success) {
    return { ok: false, reason: 'turnstile_failed', codes: outcome['error-codes'] || [] };
  }
  // Cloudflare's testing keys report hostname "example.com" and no action; only
  // enforce the binding checks for real keys.
  const testingKey = outcome.metadata?.result_with_testing_key === true;
  if (!testingKey) {
    if (outcome.action !== TURNSTILE_ACTION) return { ok: false, reason: 'turnstile_action_mismatch' };
    if (outcome.hostname !== hostname) return { ok: false, reason: 'turnstile_hostname_mismatch' };
  }
  return { ok: true };
}

async function forward(env, { name, email, message }) {
  // Apps Script reads these from e.parameters; only the three form fields are passed on.
  const body = new URLSearchParams({ name, email, message });
  if (env.CONTACT_FORWARD_TOKEN) body.set('token', env.CONTACT_FORWARD_TOKEN);

  try {
    // The /exec endpoint answers with a 302 to script.googleusercontent.com; follow it.
    const res = await fetch(env.CONTACT_FORWARD_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      redirect: 'follow',
    });
    const text = await res.text();
    if (!res.ok) {
      console.error(`contact: forward returned ${res.status}`);
      return false;
    }
    let result = null;
    try {
      result = JSON.parse(text);
    } catch {
      // Non-JSON body: treat a 2xx as delivered.
    }
    if (result && result.result === 'error') {
      console.error('contact: Apps Script reported an error');
      return false;
    }
    return true;
  } catch (error) {
    console.error('contact: forward failed', error);
    return false;
  }
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}
