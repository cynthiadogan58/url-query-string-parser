/**
 * URL query-string parser with support for duplicate keys, bracket array
 * notation, and nested objects.
 *
 * Design decisions (see README for the full statement):
 *
 * 1. Arrays are denoted by a trailing empty pair of brackets: `a[]=1&a[]=2`.
 *    A key with no brackets is never promoted to an array even if repeated.
 *    Repeating such a key is a conflict, and we resolve the conflict by
 *    keeping the last value. This is a deliberate, documented choice: it is
 *    predictable and keeps the output shape stable per key.
 *
 * 2. Object nesting uses bracket notation: `a[b][c]=1`. Mixed array and
 *    object notation on the same key (`a[]=1&a[b]=2`) is undefined in most
 *    query-string libraries; we treat the first segment's kind as fixed for
 *    the lifetime of that key and let later conflicting assignments overwrite
 *    the leaf value rather than restructure. This keeps parsing O(n) in the
 *    number of pairs with no backtracking.
 *
 * 3. Percent-decoding never throws. Malformed sequences (`%zz`, `%2`, a bare
 *    `%`) are passed through with the offending `%` replaced by `%25` so the
 *    caller still sees every byte. Throwing on bad input would force callers
 *    to wrap every parse in try/catch for data they usually control only
 *    loosely.
 *
 * 4. `+` is decoded to a space only inside the *value* (after the first `=`).
 *    Keys are left alone — keys rarely contain `+` in practice, and leaving
 *    them untouched means a key like `a+b` stays `a+b` instead of becoming
 *    `a b`, which is what callers almost always want when they authored the
 *    query by hand.
 */

const hasOwn = Object.prototype.hasOwnProperty;

/**
 * Percent-decode `s` without throwing on malformed sequences.
 *
 * `decodeURIComponent` throws on `%zz` or a trailing `%2`, which is the wrong
 * default for untrusted query input: a single bad byte should not nuke the
 * entire parse. We rewrite a bare `%` to `%25` (the encoded form of `%`) and
 * then retry; anything still unparseable is left verbatim so the caller can
 * detect it. `plusToSpace` controls whether `+` becomes a space.
 *
 * @param {string} s
 * @param {boolean} [plusToSpace=false]
 * @returns {string}
 */
export function decodeURIComponentSafe(s, plusToSpace = false) {
  let input = s;
  if (plusToSpace) input = input.replace(/\+/g, ' ');
  // Rewrite stray percent signs that don't start a valid hex escape so
  // decodeURIComponent won't throw on them. We intentionally run this in a
  // loop because a single replacement pass can expose a new bare `%`.
  let prev;
  do {
    prev = input;
    input = input.replace(/%(?![0-9A-Fa-f]{2})/g, '%25');
  } while (input !== prev);
  try {
    return decodeURIComponent(input);
  } catch {
    return s;
  }
}

/**
 * Walk a dotted/bracketed key path and write `value` at the leaf.
 *
 * `segments` is the list of decoded key segments between brackets, e.g.
 * `a[b][c]` becomes `['a','b','c']` and `a[]` becomes `['a','']`. The empty
 * string segment signals "append to array". `root` is the top-level object;
 * we mutate it and intermediate nodes in place.
 *
 * The function is structural: it does not try to reconcile conflicting path
 * kinds (array vs object) for the same key — if `a` is an array and a later
 * pair says `a[b]=x`, the array is replaced by an object, per decision 2
 * above. The point is to be simple and total: every input maps to *some*
 * output, never an exception.
 *
 * @param {Record<string, unknown>} root
 * @param {string[]} segments
 * @param {unknown} value
 * @returns {void}
 */
export function setNested(root, segments, value) {
  if (segments.length === 0) return;

  let cursor = root;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;
    const isIndex = seg === '';

    if (isIndex) {
      // Array append. We require the current cursor to be an array; if it
      // isn't (e.g. prior pair was `a=1` making cursor a string), replace it
      // with a fresh array — the last write wins per decision 1.
      if (!Array.isArray(cursor)) {
        // Walk back to the parent and reassign. For top-level keys this is
        // trivial; for nested ones we mutate the parent container.
        if (i === 0) {
          const arr = [];
          root[segments[0]] = arr;
          cursor = arr;
        } else {
          // Replace the previous slot with an array and continue from it.
          const prevSeg = segments[i - 1];
          const arr = [];
          if (Array.isArray(cursor)) {
            cursor.push(arr);
          } else {
            cursor[prevSeg] = arr;
          }
          cursor = arr;
        }
      }
      if (isLast) {
        cursor.push(value);
        return;
      }
      // Need to descend; the next segment dictates the child shape. Ensure
      // the slot at the end of the array is an object/array we can descend
      // into.
      const nextSeg = segments[i + 1];
      let child = cursor[cursor.length - 1];
      if (child === undefined || typeof child !== 'object' || Array.isArray(child) && nextSeg !== '') {
        // The next segment decides the container type: empty => array, else object.
        child = nextSeg === '' ? [] : {};
        cursor.push(child);
      }
      cursor = child;
      continue;
    }

    // Named segment (object access).
    if (Array.isArray(cursor)) {
      // We're on an array but the path wants a named child. Promote: replace
      // the array with an object at the parent. For the top level we replace
      // root[key]; for nested we need to fix up the parent slot.
      const obj = {};
      if (i === 0) {
        root[seg] = obj;
        cursor = obj;
      } else {
        const prevSeg = segments[i - 1];
        if (Array.isArray(cursor)) {
          // Replace last element with object.
          cursor[cursor.length - 1] = obj;
        } else {
          cursor[prevSeg] = obj;
        }
        cursor = obj;
      }
    }

    if (isLast) {
      cursor[seg] = value;
      return;
    }

    const nextSeg = segments[i + 1];
    const wantArray = nextSeg === '';
    let child = cursor[seg];
    if (child === undefined || typeof child !== 'object' || (wantArray && !Array.isArray(child)) || (!wantArray && Array.isArray(child))) {
      child = wantArray ? [] : {};
      cursor[seg] = child;
    }
    cursor = child;
  }
}

/**
 * Split a raw key like `a[b][c]` or `a[]` into decoded segments.
 *
 * `a` -> ['a']
 * `a[]` -> ['a','']
 * `a[b]` -> ['a','b']
 * `a[b][c]` -> ['a','b','c']
 * `a[]` with no further segments keeps the trailing empty string to signal
 * "array append".
 *
 * The leading segment and every bracketed segment are percent-decoded using
 * the safe decoder; `+` is NOT converted to space in keys (decision 4).
 *
 * @param {string} key
 * @returns {string[]}
 */
function splitKey(key) {
  const decoded = decodeURIComponentSafe(key, false);
  const segments = [];
  const re = /^([^\[]*)((?:\[[^\]]*\])*)$/;
  const m = re.exec(decoded);
  if (!m) {
    return [decoded];
  }
  const head = m[1];
  if (head.length > 0 || m[2].length === 0) {
    segments.push(head);
  }
  if (m[2].length > 0) {
    const inner = m[2].slice(1, -1); // strip outer brackets of first/last? no — slice each
    // m[2] looks like [a][b][] — split on ][
    const parts = m[2].slice(1, -1).split('][');
    for (const p of parts) {
      segments.push(p);
    }
  }
  return segments;
}

/**
 * Parse a query string into a plain object.
 *
 * Accepts strings with or without a leading `?`. Empty input yields `{}`.
 * Splits on `&`, then on the first `=`. Keys and values are percent-decoded;
 * `+` becomes a space only in values. Supports `a[]=...` for arrays and
 * `a[b]=...` for nested objects.
 *
 * @param {string} input
 * @returns {Record<string, unknown>}
 */
export function parseQuery(input) {
  const out = {};
  if (typeof input !== 'string' || input.length === 0) {
    return out;
  }

  let q = input;
  if (q.charCodeAt(0) === 63 /* ? */) {
    q = q.slice(1);
  }
  if (q.length === 0) return out;

  const pairs = q.split('&');
  for (const pair of pairs) {
    if (pair.length === 0) continue;
    const eq = pair.indexOf('=');
    let rawKey;
    let rawVal;
    if (eq === -1) {
      rawKey = pair;
      rawVal = '';
    } else {
      rawKey = pair.slice(0, eq);
      rawVal = pair.slice(eq + 1);
    }
    const segments = splitKey(rawKey);
    const value = decodeURIComponentSafe(rawVal, true);
    setNested(out, segments, value);
  }

  return out;
}
