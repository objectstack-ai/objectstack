// Types for `tsup-drop-sources-content.mjs`, published for the root
// `tsup.config.ts` — a TypeScript-authored config running inside the ROOT tsc
// program, where an untyped `.mjs` import is TS7016. See `invoked-as.d.mts`
// for why this pairing exists; this file follows the same convention.
//
// `esbuild`'s own `BuildOptions` is not imported here on purpose: it is not
// resolvable from every context this declaration is read in (measured — it is
// not a direct or hoisted dependency at the repo root). tsup's own
// `Options['esbuildOptions']` field type is
// `(options: BuildOptions, context: { format: Format }) => void` — a
// structural `Record<string, unknown>` parameter is NOT assignable there
// (measured: TS2322, `BuildOptions` does not satisfy an index signature), so
// the parameter is declared `any` on purpose. That costs the one property
// this module actually writes (`sourcesContent`) any narrowing here — the
// caller gets no assurance beyond "this function exists and takes one
// argument" — but it is what makes `esbuildOptions: dropSourcesContent`
// type-check against tsup's real, imported `BuildOptions` at every call site.

/**
 * A tsup `esbuildOptions` hook: mutates the real esbuild options in place,
 * setting `sourcesContent = false`.
 */
export function dropSourcesContent(options: any): void;
