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
