import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery, setNested, decodeURIComponentSafe } from '../src/core.js';

test('empty input returns empty object', () => {
  assert.deepEqual(parseQuery(''), {});
  assert.deepEqual(parseQuery('?'), {});
});

test('single key=value', () => {
  assert.deepEqual(parseQuery('a=1'), { a: '1' });
});

test('multiple distinct keys', () => {
  assert.deepEqual(parseQuery('a=1&b=2'), { a: '1', b: '2' });
});

test('value without equals becomes empty string', () => {
  assert.deepEqual(parseQuery('flag'), { flag: '' });
});

test('duplicate plain key keeps last value', () => {
  // Per decision 1: only `[]` promotes to array. A repeated plain key is a
  // conflict resolved last-wins.
  assert.deepEqual(parseQuery('a=1&a=2'), { a: '2' });
});

test('bracket notation produces array', () => {
  assert.deepEqual(parseQuery('a[]=1&a[]=2'), { a: ['1', '2'] });
});

test('single bracket element still an array', () => {
  assert.deepEqual(parseQuery('a[]=solo'), { a: ['solo'] });
});

test('nested object one level', () => {
  assert.deepEqual(parseQuery('a[b]=1'), { a: { b: '1' } });
});

 test('nested object two levels', () => {
  assert.deepEqual(parseQuery('a[b][c]=1'), { a: { b: { c: '1' } } });
});

test('plus becomes space in value but not key', () => {
  // Decision 4.
  const out = parseQuery('a+b=c+d');
  assert.deepEqual(out, { 'a+b': 'c d' });
});

test('percent-encoded value decodes', () => {
  assert.deepEqual(parseQuery('q=%24price'), { q: '$price' });
});

test('percent-encoded key decodes', () => {
  assert.deepEqual(parseQuery('%24price=1'), { '$price': '1' });
});

test('malformed percent sequence does not throw', () => {
  // `%zz` is invalid; safe decoder leaves it intact rather than throwing.
  assert.deepEqual(parseQuery('q=%zz'), { q: '%zz' });
});

test('bare trailing percent is handled', () => {
  assert.deepEqual(parseQuery('q=100%'), { q: '100%' });
});

test('empty value with equals', () => {
  assert.deepEqual(parseQuery('a='), { a: '' });
});

test('empty pairs are skipped', () => {
  assert.deepEqual(parseQuery('a=1&&b=2'), { a: '1', b: '2' });
});

test('setNested writes a simple value', () => {
  const root = {};
  setNested(root, ['a'], '1');
  assert.deepEqual(root, { a: '1' });
});

test('setNested appends to array via empty segment', () => {
  const root = {};
  setNested(root, ['a', ''], '1');
  setNested(root, ['a', ''], '2');
  assert.deepEqual(root, { a: ['1', '2'] });
});

test('setNested writes nested path', () => {
  const root = {};
  setNested(root, ['a', 'b', 'c'], '1');
  assert.deepEqual(root, { a: { b: { c: '1' } } });
});

test('decodeURIComponentSafe passes valid sequences', () => {
  assert.equal(decodeURIComponentSafe('%24'), '$');
});

test('decodeURIComponentSafe rewrites bare percent', () => {
  assert.equal(decodeURIComponentSafe('100%'), '100%');
});

test('decodeURIComponentSafe with plusToSpace', () => {
  assert.equal(decodeURIComponentSafe('a+b', true), 'a b');
});

test('decodeURIComponentSafe leaves plus alone by default', () => {
  assert.equal(decodeURIComponentSafe('a+b', false), 'a+b');
});

test('array then object on same key restructures to object last-wins', () => {
  // Decision 2: first segment kind conflict. `a[]=1` makes an array; `a[b]=2`
  // replaces with object. The leaf value from the second pair wins.
  const out = parseQuery('a[]=1&a[b]=2');
  assert.deepEqual(out, { a: { b: '2' } });
});

test('object then array on same key restructures to array last-wins', () => {
  const out = parseQuery('a[b]=1&a[]=2');
  assert.deepEqual(out, { a: ['2'] });
});
