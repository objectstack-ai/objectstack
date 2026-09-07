// Types for the two dependency loaders `import-prerequisite.mjs` publishes to
// the gates that import it.
//
// The module itself stays `.mjs` for the reason its three sibling mirrors
// state: `pre-commit` and the gates invoke these scripts with bare `node`, and
// every root script here is authored that way. What needs the declaration is
// the other direction -- a TypeScript-authored gate (`.mts`) importing a loader
// from inside the ROOT tsc program, where an untyped `.mjs` import is TS7016.
// `check-exported-any-returns.mts` is the first such consumer; without this
// file its conversion would have added one error to the `@objectstack/spec-
// monorepo` entry of `check:type-check-debt`, a shrink-only ratchet.
//
// PARTIAL on purpose, the `check-regen-pending.d.mts` shape: the module also
// exports the exit-code constants, the classifier and its self-test, and
// omitting them cannot fail green -- a consumer importing an undeclared name
// gets TS2305, which is loud and immediate. Keep this file in step with the
// module by hand; `check:declaration-mirrors` checks name, kind and required
// arity, never types.
//
// ⛔ The return type is `any` BY MEASUREMENT, not by omission: what these
// return is whatever the loaded package exports, and the 27 `.mjs` call sites
// already bind it untyped. A consumer that wants the real namespace types
// declares them itself -- `check-exported-any-returns.mts` keeps an erased
// `import type TS from 'typescript'` beside the runtime binding for exactly
// that, and a `typescript`-shaped return here would be a lie at every other
// call site (`yaml`, `semver`, `eslint`, `github-slugger`).

/**
 * Load a dependency, or print a named `PREREQUISITE NOT MET` diagnosis and exit
 * `EXIT_PREREQUISITE_NOT_MET` (3). Resolves to the module NAMESPACE.
 *
 * @param specifier The bare specifier, e.g. `'@typescript-eslint/parser'`.
 * @param load `() => import('@typescript-eslint/parser')`, written in the CALLER
 *   so the failing resolution is the caller's own.
 * @param importerUrl The caller's `import.meta.url`.
 * @param options `measures` is what the gate would have judged, in the gate's
 *   own words -- the one half of the refusal text that is never shared.
 */
export function requireDependency(
  specifier: string,
  load: () => Promise<unknown>,
  importerUrl: string,
  options?: { measures?: string },
): Promise<any>;

/**
 * `requireDependency` for the DEFAULT export -- the shape `import ts from
 * 'typescript'` had. Reads `.default` strictly rather than falling back to the
 * namespace.
 *
 * @param specifier The bare specifier, e.g. `'typescript'`.
 * @param load `() => import('typescript')`, written in the CALLER.
 * @param importerUrl The caller's `import.meta.url`.
 * @param options `measures` is what the gate would have judged, in the gate's
 *   own words.
 */
export function requireDefaultExport(
  specifier: string,
  load: () => Promise<unknown>,
  importerUrl: string,
  options?: { measures?: string },
): Promise<any>;
