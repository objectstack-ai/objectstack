// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';

/**
 * Matches a recursive TypeScript file pattern and captures its type infix:
 * the `object` in `object` type's declared `filePatterns` entry for `.ts`.
 *
 * Anchored on purpose. A pattern this expression does not match is one the
 * derivation below does not understand, and it answers `null` rather than
 * inventing a filename out of a shape nobody checked.
 */
const RECURSIVE_TS_PATTERN = /^\*\*\/\*\.([^/]+)\.ts$/;

/**
 * The type infix the registry declares for `type` — `object` for the `object`
 * entry's `.ts` pattern — or `null` when it declares no TypeScript pattern.
 */
export function metadataFileInfix(type: string): string | null {
  const entry = DEFAULT_METADATA_TYPE_REGISTRY.find(candidate => candidate.type === type);
  if (!entry) return null;

  for (const pattern of entry.filePatterns) {
    const match = RECURSIVE_TS_PATTERN.exec(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * The filename `os generate` writes for a metadata type, derived from that
 * type's OWN `filePatterns` in `DEFAULT_METADATA_TYPE_REGISTRY`.
 *
 * ## Why this is derived rather than tabulated
 *
 * `MetadataPlugin._loadFromFileSystem` primes every registered type by
 * globbing that type's `filePatterns`. A scaffold whose name matches none of
 * those patterns is never primed, and nothing anywhere reports it: it still
 * type-checks, still passes `os validate` and still publishes — the
 * silent-strip shape ADR-0063's retirement of `os g agent` closed (#10359).
 *
 * ### That mechanism has a precondition, and this tree never meets it (#12075)
 *
 * The paragraph above used to carry the whole argument, which made it read as
 * a universal property of the platform. It is not one. `MetadataPlugin.start`
 * reaches `_loadFromFileSystem` on exactly ONE branch: `bootstrap` is `eager`
 * (the default) AND `options.artifactSource` is unset. An artifact source
 * routes eager to `_loadFromLocalFile` instead, and `lazy` / `artifact-only`
 * never glob at all. Re-measured on `origin/main` while writing this note:
 *
 * - Both non-test `new MetadataPlugin(...)` sites in this repo pass
 *   `artifactSource: { mode: 'local-file', path }` unconditionally —
 *   `packages/runtime/src/standalone-stack.ts` and the dev-HMR site in
 *   `packages/cli/src/commands/serve.ts`. `os dev` compiles and spawns
 *   `serve`; `os serve` and `os start` boot from the compiled artifact; and
 *   `os init` writes a `package.json` whose every script runs one of those.
 * - All nine tracked `objectstack.config.ts` files declare their metadata in
 *   code — a barrel (`import * as objects from './src/objects'`) or a named
 *   import — or declare none at all. ZERO rely on `filePatterns` to find
 *   anything.
 *
 * The discriminating measurement, because "the glob might not be consulted"
 * and "the glob is not consulted here" are different claims: a file spelled
 * exactly the way the registry declares, sitting in the scaffold's own object
 * directory, does NOT reach the compiled artifact when the barrel omits it,
 * while a file matching no pattern at all DOES reach it as soon as the barrel
 * names it. `os compile` builds `dist/objectstack.json` out of `loadConfig`
 * alone and globs nothing. For everything this CLI scaffolds, the barrel's
 * module specifier is the whole load path.
 *
 * The derivation below still stands, on narrower ground than it used to
 * claim: it is a CONSISTENCY property — one CLI teaching one spelling that
 * the registry and every example already agree on — not the DISCOVERABILITY
 * property the first paragraph reads as on its own. Do not argue "matches no
 * pattern therefore silently skipped" from this docblock alone; check the
 * project's bootstrap first, and for anything `os init` writes the answer is
 * no.
 *
 * ### Why `filePatterns` gets no end-to-end dogfood (#12075)
 *
 * It is a declared discovery surface with no measured consumer in this tree,
 * and the recorded disposition is that it stays one: no end-to-end dogfood is
 * being minted for the eager `_loadFromFileSystem` path — startup focus, and
 * a surface with zero measured consumers does not earn one. Recorded here, on
 * the CLI's own read of `filePatterns`, rather than beside the registry
 * declaration itself — that lives in
 * `packages/spec/src/kernel/metadata-plugin.zod.ts`, which this package only
 * reads. Unexercised is NOT broken: nothing above reports the eager path as
 * defective, only as unmeasured.
 *
 * The harness used to write `NAME.ts` for every type, and that name matches
 * no pattern the registry declares for ANY type. Measured rather than
 * assumed: across the seven generators, `NAME.ts` matched zero `filePatterns`
 * entries and `NAME.TYPE.ts` matched exactly one, every time. #11025 closed
 * it for `skill` alone through a per-generator filename override and fenced
 * the repo-wide route as a decision of its own. This is that decision
 * (#11071), and it retires the override rather than growing it to six copies.
 *
 * ## Why it reads the pattern instead of interpolating the type name
 *
 * Three of the registry's 27 entries do not spell their pattern from their
 * own type key. `email_template` declares `*.email-template.ts` and
 * `external_catalog` declares `*.external-catalog.ts`, so a `${type}` infix
 * would write `NAME.email_template.ts` and re-create the exact invisibility
 * this closes — for a generator nobody would have to get wrong on purpose.
 * `doc` declares only a Markdown pattern and so has no TypeScript filename to
 * derive at all, which is why the miss below is a `null` the caller must
 * answer for rather than a guess.
 *
 * @param type       Metadata type key, as registered in the registry.
 * @param baseName   Already-normalized file stem (snake_case), no extension.
 * @returns The filename to write, or `null` when the registry declares no
 *          TypeScript file pattern for this type.
 */
export function metadataFileName(type: string, baseName: string): string | null {
  const infix = metadataFileInfix(type);
  return infix === null ? null : `${baseName}.${infix}.ts`;
}
