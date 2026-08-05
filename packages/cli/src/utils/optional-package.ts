// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Loading a package the caller can live without — with "it is not here" and
 * "it is here and broken" kept apart (#5644).
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * The shape it replaces is one `try` around a dynamic `import()` whose `catch`
 * means "not installed":
 *
 *     try { mod = await import('@objectstack/cloud-connection'); }
 *     catch { return nothing; }
 *
 * That is right for exactly one of the two things it catches. A specifier that
 * does not resolve IS the optional package being absent, and silence is the
 * correct, deliberate answer — `os doctor` must run to completion in a checkout
 * that never had it. But a package that IS there and fails to load — an
 * interrupted install, a pruned or unbuilt `dist/`, an artefact that throws
 * while it evaluates, a transitive dependency missing under it — arrives in the
 * same `catch` and is answered with the same silence. The caller then reports
 * on a world it never looked at. In `os doctor` that produced a clean bill of
 * health over an installed-package ledger it had not read (#5644, the `import`
 * boundary of the same false PASS #5412 fixed at the `readdir` boundary).
 *
 * ── How the two are told apart ───────────────────────────────────────────
 *
 * Two mechanisms, in this order, both owned elsewhere in this repo:
 *
 *   1. **The error is not a module-not-found error at all** — the module was
 *      found and threw while evaluating. Nothing more needs asking: that is a
 *      broken package under every resolver. `isModuleNotFoundError()` is the
 *      repo's single shared owner of this classification (`@objectstack/types`,
 *      framework#3265); `serve.ts` reads it for the same purpose.
 *   2. **It IS a module-not-found error** — which still covers two worlds, and
 *      the error alone cannot separate them. `import.meta.resolve()` can, and
 *      is the documented, stable API for asking it (Node >= 20.6; this package
 *      requires >= 22). Measured on Node 22.22 against the real package:
 *
 *        | state                                   | resolve()   | import()    |
 *        |-----------------------------------------|-------------|-------------|
 *        | package absent                          | throws      | throws      |
 *        | present, `dist/` missing (unbuilt/prun.) | RESOLVES    | throws      |
 *        | present, entry throws while evaluating  | resolves    | throws      |
 *        | healthy                                 | resolves    | loads       |
 *
 *      The second row is the one that matters and the reason `resolve()` is
 *      used rather than `createRequire().resolve()`: CJS resolution stats the
 *      entry file, so it fails there too and collapses the row back into
 *      "absent" — and it answers for the `require` condition, i.e. a DIFFERENT
 *      artefact than the one `import()` loads. `import.meta.resolve()` answers
 *      for the same artefact and does not stat it, so "the package is there"
 *      and "its entry is loadable" stay two questions.
 *
 * The resolve call is made only after `import()` has already failed: it costs
 * nothing on the happy path, and the loaded module — never the resolver — stays
 * the thing that decides whether loading worked.
 *
 * ── The one thing this must never do ─────────────────────────────────────
 *
 * Report a package that is genuinely absent. Every `absent` answer here is a
 * caller's silence; every `broken` answer is a caller's finding. When the
 * classification cannot be made — a runtime with no `import.meta.resolve` —
 * only step 1's certainty is kept and the ambiguous case stays `absent`, i.e.
 * the pre-#5644 behaviour, never a false alarm in a checkout that never
 * installed anything.
 */

import { isModuleNotFoundError } from '@objectstack/types';

/**
 * What became of an optional package's load. Three states, because there are
 * three facts — the two-state version of this type is the defect.
 */
export type OptionalPackageLoad =
  /** The specifier does not resolve. The package is not installed. */
  | { state: 'absent' }
  /**
   * It loaded. `module` is its namespace — `any`, like every other read of an
   * optional package in this package: nothing here compiles against it.
   */
  | { state: 'loaded'; module: any }
  /** It is installed and could not be loaded. `cause` is what was thrown. */
  | { state: 'broken'; cause: unknown };

/**
 * True when `specifier` resolves from THIS module — the same base the
 * `import()` below uses, so the two answer about the same package.
 *
 * A runtime without `import.meta.resolve` cannot answer, and says so by
 * returning `false`: the caller then keeps the ambiguous case silent (see the
 * header). Node 22+, this package's floor, always has it; so does vitest.
 */
function specifierResolves(specifier: string): boolean {
  const resolve = (import.meta as ImportMeta & { resolve?: (s: string) => string }).resolve;
  if (typeof resolve !== 'function') return false;
  try {
    resolve(specifier);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load an optional package, saying which of the three things happened.
 *
 * @param specifier What a static import in THIS file would be given — normally
 * a bare package name, resolved against this file's own `node_modules` chain.
 * An absolute `file:` URL resolves as itself and is what the tests use to stand
 * a real broken artefact up on disk.
 */
export async function loadOptionalPackage(specifier: string): Promise<OptionalPackageLoad> {
  try {
    const module = await import(specifier);
    return { state: 'loaded', module };
  } catch (cause) {
    // Anything that is not a module-not-found error was thrown BY the package:
    // it is present by definition, whatever any resolver would say.
    if (!isModuleNotFoundError(cause)) return { state: 'broken', cause };
    // A module-not-found error is either the package being absent or something
    // missing UNDER a package that is present. Only the resolver knows.
    return specifierResolves(specifier) ? { state: 'broken', cause } : { state: 'absent' };
  }
}
