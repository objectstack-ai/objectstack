/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `@object-ui/data-objectstack` ↔ `@objectstack/spec` symbol-collision guards
 * (objectui#3160, objectstack#4115 ledger batch 6).
 *
 * Four symbols here wore names the spec already owns. One really WAS the
 * spec's and now carries its binding (`DroppedFieldsEvent`); the other three
 * model something the spec has never modelled under that name and were
 * renamed:
 *
 *   CacheStats          → MetadataCacheStats
 *   MetadataSaveOptions → MetadataClientSaveOptions
 *   ValidationError     → DataApiValidationError
 *
 * A fourth rename joined the table later, from a different ledger:
 * `normalizeFilterOperator` → `toAstFilterOperator` (objectui#7265, rule 1's
 * DEBT block in `scripts/check-spec-symbol-derivation.mjs`). It is here because
 * the guard a rename needs is this one, whichever ledger sent it; what is
 * specific to it -- the site, the block, and the behaviour that refused BIND --
 * is in `scripts/__tests__/spec-symbol-ledger-data-objectstack-7265.test.ts`.
 *
 * The batch's own triage note said "data-objectstack is a direct client of the
 * spec protocol, so `SecurityPolicy` / `DroppedFieldsEvent` are probably hand
 * copies — derive them first". Half of that held: `DroppedFieldsEvent` was
 * exactly a hand copy. The batch's fifth symbol, `SecurityPolicy` →
 * `SecurityManagerPolicy`, shared not one key with the spec's; its guard is
 * gone from this file because objectui#4241 retired `SecurityManagerPolicy`
 * itself along with the rest of `security.ts` (a `v3.0.0 Deep Integration`
 * module with no consumer outside this package). That asymmetry is why every
 * assertion below is per SYMBOL and never per cluster.
 *
 * ## Why the spec's names are read through the compiler, not `import * as`
 *
 * A runtime namespace import sees VALUES only, and every name checked here is a
 * TYPE; a tripwire built on `Object.keys(await import(…))` would pass while
 * proving nothing. So this reads each subpath's `.d.ts` through the TypeScript
 * checker, exactly as `scripts/check-spec-symbol-derivation.mjs` does.
 *
 * ## …and why through `ts.sys` rather than `node:fs`
 *
 * Unlike the sibling batches' parity tests, this package's `tsconfig.json`
 * compiles its whole test tree (it is not in `check-type-check-coverage.mjs`'s
 * TEST_DEBT), so the pins below are already checked by `tsc --noEmit` with no
 * separate `tsconfig.typetests.json`. Keeping that property means NOT pulling
 * `@types/node` into a browser-side adapter's type environment just to read a
 * file — so the probe uses the TypeScript compiler's own host, which is typed
 * by the `typescript` dependency this file already has, and resolves the spec
 * through TS's module resolver instead of hard-coding its subpath list.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';

import { DataApiValidationError } from './errors';
import type { MetadataCacheStats } from './cache/MetadataCache';
import type { MetadataClientSaveOptions } from './metadata-client';
import type { DroppedFieldsEvent } from './index';

import type { DroppedFieldsEvent as SpecDroppedFieldsEvent } from '@objectstack/spec/data';
import type { CacheStats as SpecCacheStats } from '@objectstack/spec/contracts';
import type { ValidationError as SpecValidationError } from '@objectstack/spec/kernel';
// `MetadataSaveOptions` moved `./kernel` → `./system` in spec 17.0.0-rc.2.
// The name still belongs to the spec and still means the FILE writer, so the
// rename this batch recorded stands — only the entry point moved.
import type { MetadataSaveOptions as SpecMetadataSaveOptions } from '@objectstack/spec/system';

const PROBE_OPTIONS: ts.CompilerOptions = {
  noEmit: true,
  skipLibCheck: true,
  strict: false,
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  resolveJsonModule: true,
};

/** This file, as TypeScript's module resolver wants it: an absolute path. */
const HERE = new URL(import.meta.url).pathname;

/** Every name `@objectstack/spec` exports from any subpath — types AND values. */
function specExportNames(): Set<string> {
  const pkgPath = ts.resolveModuleName('@objectstack/spec/package.json', HERE, PROBE_OPTIONS, ts.sys)
    .resolvedModule?.resolvedFileName;
  if (!pkgPath) {
    throw new Error('cannot resolve @objectstack/spec — run `pnpm install` first');
  }
  const pkgDir = pkgPath.slice(0, pkgPath.lastIndexOf('/'));
  const raw = ts.sys.readFile(pkgPath);
  if (!raw) throw new Error(`cannot read ${pkgPath}`);
  const pkg = JSON.parse(raw) as {
    exports?: Record<string, { import?: { types?: string }; require?: { types?: string } }>;
  };

  // Read the export map rather than a hand-written subpath list: a list is a
  // copy, and a copy of the spec's shape is what this whole ledger is about.
  const files: string[] = [];
  for (const cond of Object.values(pkg.exports ?? {})) {
    if (typeof cond !== 'object' || cond === null) continue;
    const dts = cond.import?.types ?? cond.require?.types;
    if (dts) files.push(ts.sys.resolvePath(`${pkgDir}/${dts.replace(/^\.\//, '')}`));
  }

  const program = ts.createProgram(files, PROBE_OPTIONS);
  const checker = program.getTypeChecker();

  const names = new Set<string>();
  for (const file of files) {
    const sf = program.getSourceFile(file);
    if (!sf) continue;
    const moduleSymbol = checker.getSymbolAtLocation(sf);
    if (!moduleSymbol) continue;
    for (const exported of checker.getExportsOfModule(moduleSymbol)) names.add(exported.getName());
  }
  return names;
}

const SPEC_NAMES = specExportNames();

describe('the spec export-name probe itself works', () => {
  it('reads a non-trivial number of names', () => {
    expect(SPEC_NAMES.size).toBeGreaterThan(1000);
  });

  it('sees TYPE-only exports, not just runtime values', () => {
    // `DroppedFieldsEvent` is a type alias — invisible to a runtime `import()`.
    expect(SPEC_NAMES.has('DroppedFieldsEvent')).toBe(true);
  });
});

const RENAMES: Array<[local: string, formerly: string, specMeaning: string]> = [
  [
    'MetadataCacheStats',
    'CacheStats',
    "the platform's ICacheService counters (keyCount / memoryUsage)",
  ],
  [
    'MetadataClientSaveOptions',
    'MetadataSaveOptions',
    'options for writing a metadata item to a FILE (format / path / indent / atomic)',
  ],
  [
    'DataApiValidationError',
    'ValidationError',
    'a plain { field, message, code? } entry in a validation report',
  ],
  // objectui#7265's `@object-ui/data-objectstack` slice. Appended here rather
  // than given a file of its own: this is the package's spec-symbol parity file
  // and the shape it already holds is exactly the one a rename needs. Unlike the
  // three above, the renamed symbol is a FUNCTION and a module-local one, so the
  // probe above has to see VALUE exports as well as types -- it does, it reads
  // the checker's `getExportsOfModule`, and the assertion below would go quiet
  // rather than red if it ever stopped.
  [
    'toAstFilterOperator',
    'normalizeFilterOperator',
    "folding an authored spelling to the canonical VIEW vocabulary (`eq` -> `equals`), the "
      + '`z.preprocess` step on `ViewFilterRuleSchema.operator` -- NOT a translation to the '
      + 'filter-AST symbols this package emits',
  ],
];

describe('renamed local concepts do not collide with a spec export', () => {
  it.each(RENAMES)('the spec does not own `%s`', (local) => {
    expect(
      SPEC_NAMES.has(local),
      `@objectstack/spec now exports \`${local}\`. This package declares its own ` +
        `\`${local}\`, so the rename that fixed objectstack#4115 has re-created the ` +
        `collision under the new name. Rename again — and check the new name here ` +
        `FIRST: objectui#3074 landed a rename straight onto another spec export, and ` +
        `batch 4 burned two obvious candidates (SchemaValidationResult, ` +
        `SchemaValidationReport) the same way.`,
    ).toBe(false);
  });

  it.each(RENAMES)('the spec still owns `%s` (it means: %s)', (_local, formerly) => {
    expect(
      SPEC_NAMES.has(formerly),
      `@objectstack/spec no longer exports \`${formerly}\`, which is the only reason ` +
        `this package renamed it. Either the spec dropped the name (then the plain ` +
        `name can be taken back) or it moved (then re-read what it means now). A ` +
        `workaround must not outlive its reason.`,
    ).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Compile-time pins. A violation is a `tsc` error, not a runtime failure.      */
/* Compiled by this package's own `tsc --noEmit`: unlike its siblings, this      */
/* package's tsconfig.json does NOT exclude test files, so no separate           */
/* tsconfig.typetests.json is needed to make these pins load-bearing.            */
/* -------------------------------------------------------------------------- */

type Assert<T extends true> = T;
type IsAny<T> = 0 extends 1 & T ? true : false;
/** The `unknown` erasure the `any` probe reports `false` for (objectui#3155). */
type IsUnknown<T> = [unknown] extends [T] ? ([T] extends [unknown] ? true : false) : false;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;
type HasKey<T, K extends PropertyKey> = K extends keyof T ? true : false;

describe('DroppedFieldsEvent IS the spec type, not a mirror of it', () => {
  it('is pinned at compile time', () => {
    type _SpecNotAny = Assert<Equal<IsAny<SpecDroppedFieldsEvent>, false>>;
    type _SpecNotUnknown = Assert<Equal<IsUnknown<SpecDroppedFieldsEvent>, false>>;

    type _IsTheSpecType = Assert<Equal<DroppedFieldsEvent, SpecDroppedFieldsEvent>>;

    // The pin that matters. The deleted copy widened `reason` to bare `string`
    // "for forward-compatibility with reasons added server-side" — which is the
    // AGENTS.md #12 lenient fallback, and it deleted the only signal that would
    // tell AdapterProvider's toast (it branches on `readonly_when`) that a third
    // reason had appeared. `Equal` is used rather than `extends` because
    // `'readonly' | 'readonly_when' extends string` is true in the drifted
    // direction too.
    //
    // THIS PIN FIRED, and its firing is the whole point (objectui#4167).
    // `@objectstack/spec` 17.0.0-rc.6 added a third arm, `primary_key`, and this
    // assertion is what reported it — a `tsc` error naming the exact widening,
    // on a bump whose build and full vitest run were both green. Under the
    // deleted hand copy's bare `string` the arm would have arrived silently, and
    // `writeWarningToast` would have narrated it as "Read-only, so it did not
    // take effect" with nobody the wiser.
    //
    // The member list is updated here; the CONSUMER gap is objectui#3935, which
    // was filed BEFORE this arm shipped and named this exact moment as its
    // activation condition ("the moment `.objectui-sha`'s spec pin moves past
    // that change, a user who triggers the primary-key strip is told the field
    // is read-only"). rc.6 is that moment, so #3935 stops being a prediction.
    // Not fixed here: `emitWriteWarning`'s binary ternary needs replacing with
    // an exhaustive map plus a third wording in both locale tables, which is a
    // UX and i18n read of its own rather than bump adaptation. #3935 owns it and
    // already prescribes the shape.
    //
    // IT FIRED AGAIN at objectstack `b2805465`, which added `computed` (a
    // formula field's caller-supplied value, stripped on every write path) —
    // this time in the `Spec Main Shape Gate`, before any pin moved
    // (objectui#11206). Until the pin carried it, this file compiled against
    // BOTH a three-arm pin and objectstack `main` (four), so the member list
    // was stated with `computed` subtracted. `@objectstack/spec` 17.6.0 carries
    // `computed`, so at that bump (objectui#11438) the pin and `main` agree and
    // this is the exact four-member union again, with no `Exclude`: any new arm
    // is a remainder `Equal` refuses, and `_ReasonIsNotString` below still
    // refuses the widening.
    //
    // IT FIRED A THIRD TIME at objectstack-ai/objectstack#24778, which added
    // `stored_expression` (a stored field whose declared `expression` the engine
    // computes on every write, so the computed value is kept, not the caller's),
    // again in the Spec Shape Gate before any pin moved (objectui#13309). So the
    // objectui#11206 shape is back: the member list is stated with
    // `stored_expression` subtracted until the pin carried it. The pin move to
    // objectstack 830a63a6 (objectstack-ai/objectstack#25330) does, so the pin
    // and `main` agree again and this is the exact five-member union, with no
    // `Exclude`: any new arm is a remainder `Equal` refuses, and
    // `_ReasonIsNotString` below still refuses a widening to `string`.
    type _ReasonIsTheEnum = Assert<
      Equal<
        DroppedFieldsEvent['reason'],
        'readonly' | 'readonly_when' | 'primary_key' | 'computed' | 'stored_expression'
      >
    >;
    type _ReasonIsNotString = Assert<Equal<Equal<DroppedFieldsEvent['reason'], string>, false>>;

    expect(true).toBe(true);
  });
});

describe('MetadataCacheStats is not the spec ICacheService stats', () => {
  it('is pinned at compile time', () => {
    type _SpecNotAny = Assert<Equal<IsAny<SpecCacheStats>, false>>;

    // The two agree only on the two counters every cache has. Everything that
    // says what KIND of cache each describes is exclusive to one side: the
    // spec's is a server KV store sized in keys and bytes; this one is a bounded
    // browser LRU that evicts, coalesces in-flight fetches and reports a rate.
    type _Shared = Assert<Equal<Extract<keyof MetadataCacheStats, keyof SpecCacheStats>, 'hits' | 'misses'>>;
    type _SpecOnly = Assert<Equal<Exclude<keyof SpecCacheStats, keyof MetadataCacheStats>, 'keyCount' | 'memoryUsage'>>;
    type _LocalOnly = Assert<
      Equal<
        Exclude<keyof MetadataCacheStats, keyof SpecCacheStats>,
        'size' | 'maxSize' | 'evictions' | 'coalesced' | 'hitRate'
      >
    >;

    expect(true).toBe(true);
  });
});

describe('MetadataClientSaveOptions is not the spec file-save options', () => {
  it('is pinned at compile time', () => {
    type _SpecNotAny = Assert<Equal<IsAny<SpecMetadataSaveOptions>, false>>;

    // Disjoint: the spec's describes serialising an item to disk, this one
    // describes a PUT to /api/v1/meta/*. Not one key is shared, so there was
    // never a subset relationship to derive from.
    type _NoOverlap = Assert<Equal<Extract<keyof MetadataClientSaveOptions, keyof SpecMetadataSaveOptions>, never>>;

    // The keys that make this the HTTP envelope.
    type _HasIfMatch = Assert<HasKey<MetadataClientSaveOptions, 'ifMatch'>>;
    type _HasDraftMode = Assert<Equal<MetadataClientSaveOptions['mode'], 'draft' | 'publish' | undefined>>;
    // …and the ones that make the spec's the file writer.
    type _SpecHasPath = Assert<HasKey<SpecMetadataSaveOptions, 'path'>>;
    type _SpecHasFormat = Assert<HasKey<SpecMetadataSaveOptions, 'format'>>;

    expect(true).toBe(true);
  });
});

describe('DataApiValidationError is an Error, the spec ValidationError is a record', () => {
  it('is pinned at compile time', () => {
    type _SpecNotAny = Assert<Equal<IsAny<SpecValidationError>, false>>;

    // The spec's is one entry in a validation report. `@object-ui/types`
    // re-exports it under that name, so the two were importable side by side.
    type _SpecShape = Assert<Equal<Exclude<keyof SpecValidationError, 'field' | 'message' | 'code'>, never>>;

    // This one is a thrown runtime object: it has a `stack`, which no data
    // record does, and it carries the whole list the spec type is one item of.
    type _WeAreAnError = Assert<HasKey<DataApiValidationError, 'stack'>>;
    type _WeCarryTheList = Assert<
      Equal<DataApiValidationError['validationErrors'], Array<{ field: string; message: string }> | undefined>
    >;

    expect(true).toBe(true);
  });

  it('keeps `name === "ValidationError"` — the RUNTIME name is a wire contract', () => {
    // Deliberately NOT renamed with the class. `normaliseClientError` in
    // ./index.ts sniffs `e.name === 'ValidationError'` on errors thrown by
    // `@objectstack/client`, and `@object-ui/react`'s `error-message` does the
    // same on the way out. Renaming the TypeScript symbol is a source change;
    // renaming this string would be a silent behaviour change.
    expect(new DataApiValidationError('nope').name).toBe('ValidationError');
    expect(new DataApiValidationError('nope')).toBeInstanceOf(Error);
    expect(new DataApiValidationError('nope').code).toBe('VALIDATION_ERROR');
    expect(new DataApiValidationError('nope').statusCode).toBe(400);
  });
});
