// Types for the entry-point predicate `invoked-as.mjs` publishes to the gates
// that import it (#10549's mirror corpus covers this file automatically).
//
// The module itself stays `.mjs` for the reason its two sibling mirrors state:
// `pre-commit` and the gates invoke these scripts with bare `node`, and every
// root script here is authored that way. What needs the declaration is the
// other direction — a TypeScript-authored gate (`.mts`) importing the predicate
// from inside the ROOT tsc program, where an untyped `.mjs` import is TS7016.
// Left untyped, `isEntrypoint` silently becomes `any`, and the mistake that
// costs the most — `if (isEntrypoint)` instead of `if (isEntrypoint(...))` —
// type-checks clean while running the gate's whole audit on import.
//
// PARTIAL on purpose, the `check-regen-pending.d.mts` shape: the module also
// exports `invokedAs` and `selfTest`, and omitting them cannot fail green — a
// consumer importing an undeclared name gets TS2305, which is loud and
// immediate. Keep this file in step with the module by hand; the mirror gate
// checks name, kind and required arity, never types.

/**
 * Was this module the process entry point, rather than imported by another?
 *
 * Compares `process.argv[1]` against the module's own path, resolving symlinks
 * on both sides — the difference between what node puts in `argv[1]` and what
 * it puts in `import.meta.url` is the whole reason this is a shared predicate
 * and not a one-liner in each gate.
 *
 * @param importMetaUrl The caller's own `import.meta.url`.
 */
export function isEntrypoint(importMetaUrl: string): boolean;
