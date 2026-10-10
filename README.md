# URL Query String Parser

Parses `application/x-www-form-urlencoded` query strings into plain JavaScript objects, with support for duplicate keys, bracket-array notation (`a[]=1&a[]=2`), and nested objects (`a[b][c]=1`).

## Usage

```js
import { parseQuery } from './src/index.js';

const obj = parseQuery('a[]=1&a[]=2&b[x]=hi');
// { a: ['1', '2'], b: { x: 'hi' } }
```

Exports:

- `parseQuery(input: string): Record<string, unknown>` — the parser.
- `setNested(root, segments, value)` — writes a value at a bracket-key path; exposed for callers building on the same nested semantics.
- `decodeURIComponentSafe(s, plusToSpace?)` — percent-decodes without throwing on malformed sequences.

## Why

Every framework ships a query parser; this one exists to be small, dependency-free, and to make one hard choice up front instead of trying to satisfy every convention simultaneously.

The choice: **only the trailing `[]` notation creates arrays.** A repeated plain key (`a=1&a=2`) is a conflict, and conflicts are resolved last-wins — the value becomes `'2'`, not `['1','2']`. This matches what authors usually mean when they write `a=1&a=2` by hand (override), and keeps the output shape of each key stable regardless of how many times it appears. Libraries that auto-promote repeated keys to arrays produce a different output *type* depending on count, which breaks callers downstream.

## Awkward edges

- **Mixed array and object notation on the same key** (`a[]=1&a[b]=2`) is genuinely ambiguous. This parser does not try to merge them: the last pair's shape wins, and earlier leaf data is discarded. If you need both shapes, use distinct keys.
- **Malformed percent-escapes** (`%zz`, a trailing `%`) never throw. The bare `%` is rewritten to `%25` and decoded; genuinely malformed sequences are passed through verbatim so you can detect them rather than losing the whole parse.
- **`+` decodes to a space only in values**, not in keys. Keys are left byte-for-byte (after percent-decoding) so a hand-authored key like `a+b` stays `a+b`.

Run the tests with `node --test test/`.

## Design notes

The window stores values eagerly rather than keeping running aggregates. Running
sums drift with floating point over long streams, and recomputing from a small
buffer is cheap enough that the drift is not worth the speed.

