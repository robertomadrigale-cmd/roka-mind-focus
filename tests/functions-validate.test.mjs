import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { assertEmailAllowed, validatePayload } = require('../functions/lib/validate.js');

test('rejects disallowed provider', () => {
  assert.throws(() => validatePayload({
    provider: 'unknown',
    messages: [{ role: 'user', content: 'hola' }]
  }), /Proveedor de IA no soportado/);
});

test('rejects disallowed model', () => {
  assert.throws(() => validatePayload({
    provider: 'google',
    model: 'gemini-custom',
    messages: [{ role: 'user', content: 'hola' }]
  }), /Modelo de IA no permitido/);
});

test('accepts allowed model and strips client api key', () => {
  const payload = validatePayload({
    provider: 'google',
    model: 'gemini-2.5-flash',
    clientApiKey: 'secret',
    messages: [{ role: 'user', content: 'hola' }]
  });
  assert.equal(payload.provider, 'google');
  assert.equal(payload.model, 'gemini-2.5-flash');
  assert.equal(Object.hasOwn(payload, 'clientApiKey'), false);
});

test('allowlist permits verified listed emails', () => {
  assert.equal(assertEmailAllowed({ email: 'a@example.com', email_verified: true }, 'a@example.com,b@example.com'), true);
});

test('allowlist rejects unlisted or unverified emails', () => {
  assert.throws(() => assertEmailAllowed({ email: 'c@example.com', email_verified: true }, 'a@example.com'), /no tiene acceso/);
  assert.throws(() => assertEmailAllowed({ email: 'a@example.com', email_verified: false }, 'a@example.com'), /no tiene acceso/);
});
