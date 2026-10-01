import { parseQuery, setNested, decodeURIComponentSafe } from './core.js';

/**
 * Public entry point: `parseQuery` plus the two helpers it exposes for callers
 * who want to extend or inspect parsing behaviour directly.
 *
 * `setNested` is exported so external callers can build on the same nested-key
 * semantics (foo[bar][baz]) without re-implementing the key path walker.
 * `decodeURIComponentSafe` is exported because the no-throw decoding policy
 * is a documented behaviour callers may want to reuse for form bodies.
 */
export { parseQuery, setNested, decodeURIComponentSafe };
