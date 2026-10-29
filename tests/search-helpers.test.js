import test from 'node:test';
import assert from 'node:assert/strict';

import { parseSearchTerms } from '../src/worker.js';

// Lock down input classification and reject malformed or ambiguous searches.
test('parses batch ids', () => {
  assert.deepEqual(parseSearchTerms('60, 61 62'), {
    mode: 'batch',
    values: [60, 61, 62],
  });
});

test('parses a single job order number', () => {
  assert.deepEqual(parseSearchTerms('123456'), {
    mode: 'jon',
    values: [123456],
  });
});

test('rejects multiple jon values in one search', () => {
  assert.equal(parseSearchTerms('123456, 654321'), null);
});

test('rejects mixed batch and jon values in one search', () => {
  assert.equal(parseSearchTerms('60, 123456'), null);
});

test('rejects invalid values', () => {
  assert.equal(parseSearchTerms('abc'), null);
});

test('GET /api/report rejects invalid batch IDs before accessing the database', async () => {
  const worker = (await import('../src/worker.js')).default;
  const response = await worker.fetch(
    new Request('http://example.com/api/report?batch_id=not-a-number'),
    { ASSETS: { fetch: async () => new Response('not used') } },
    { waitUntil: () => {} },
  );

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.error, 'Enter one or more valid batch IDs');
});

test('GET /api/report accepts multiple batch IDs', async () => {
  const worker = (await import('../src/worker.js')).default;
  const response = await worker.fetch(
    new Request('http://example.com/api/report?batch_id=60%2C61'),
    { ASSETS: { fetch: async () => new Response('not used') } },
    { waitUntil: () => {} },
  );

  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.error, 'Report database is not configured');
});
