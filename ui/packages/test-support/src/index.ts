/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `@object-ui/test-support` — the surface.
 *
 * This package is `private: true` and is never published, so this index is not
 * public API; it is the ONE specifier other packages' test suites import. The
 * indirection is the objectui#4325 lesson applied ahead of time: a deep
 * subpath into another package (`@object-ui/fields/widgets/MarkdownContent`)
 * resolved only through this repo's vitest alias, was TS2882 for `tsc`, and was
 * ruled out rather than minted as permanent public API. A package's surface is
 * its index — including this one.
 */

export {
  SECURITY_EXPLAIN_ROUTE,
  assertNoOtherNetworkEscape,
  installRecordSecurityExplainDouble,
  recordedExplainRequests,
} from './record-security-explain-double';
export type { ExpectCapable, StubGlobalCapable } from './record-security-explain-double';

export {
  ATTRIBUTE_TO_IDL_ALIAS,
  GLOBAL_HTML_ATTRIBUTES,
  HAPPY_DOM_IDL_GAPS,
  OPEN_PREFIXES,
  SVG_ATTRIBUTES,
  findLeaks,
  isKnownAttribute,
  leakReport,
} from './dom-leak-judge';
export type { Leak } from './dom-leak-judge';

export {
  RETIRED_DESCRIPTION_PREFIX,
  authorableShapeKeys,
  isShapeKeyTombstoned,
  listedShapeKeys,
  resolvePropsShape,
  shapeMemberTypeName,
  tombstoneEvidence,
  tombstonedShapeKeys,
} from './spec-tombstones';

export { enumOptions, shapeEnumOptions } from './spec-enum-options';

/**
 * The array-element reader (objectui#5872 class (2)). Stands on the same
 * `spec-zod-wrappers.ts` walk `enumOptions` does; the walk itself is NOT
 * exported, because it is plumbing between the two readers rather than
 * something a gate should hold.
 */
export { arrayElementSchema } from './spec-array-element';

/**
 * The Zod wrapper-key vocabulary (`d3bf4fa6f`). The DATA lives in
 * `zod-wrapper-keys.json` so that `node scripts/check-*.mjs` can read the same
 * bytes through `@object-ui/test-support/zod-wrapper-keys` — the one thing this
 * package's `.` entry, being TypeScript source, cannot offer a bare-node
 * consumer. `zod-wrapper-keys.ts` carries the reasoning; read it before
 * touching either side.
 */
export { ZOD_WRAPPER_KEYS } from './zod-wrapper-keys';

/**
 * The runtime locale tripwire (objectui#9786, objectui#9909): observes the
 * argument every locale-taking intrinsic receives while a surface renders, so
 * a call that passes a variable which is `undefined` at runtime is caught the
 * way a bare call is. Pure — no React, no DOM — so it lives on the index.
 */
export {
  LOCALE_TAKING_INTL_CONSTRUCTORS,
  isMachineLocale,
  recordLocaleArguments,
  recordLocaleArgumentsAsync,
} from './locale-tripwire';
export type { LocaleCall } from './locale-tripwire';

/**
 * ⛔ `defaults-table-scan.ts` is deliberately NOT re-exported here. It is reached
 * as `@object-ui/test-support/defaults-table-scan`, a DECLARED subpath in this
 * package's `exports` map — the same escape hatch `./zod-wrapper-keys` uses for
 * the case the index cannot serve.
 *
 * The index rule above still stands, and this is not a hole in it: it is the one
 * shape the index physically cannot carry. That module reads the workspace from
 * disk (`node:fs`, `node:path`, `node:module`), so it only type-checks in a
 * program that has Node's ambient types — and a barrel re-export puts a module
 * into the program of EVERY consumer that imports the barrel for anything at all.
 *
 * Measured, not predicted (objectui#7884, PR objectui#7902): with the re-export
 * here, `tsc -p packages/data-objectstack/tsconfig.json --listFiles` pulled all
 * nine of this package's modules into that package's program, because one of its
 * tests imports `{ enumOptions }` from this index. `data-objectstack` has no
 * `node` types, so the repo-wide `pnpm turbo run type-check` failed with three
 * TS2591s in a file that package never asked for. The subpath keeps the Node-only
 * module out of every program that does not name it, which is the property a
 * shared test module owes its consumers: it adds no obligation to anyone.
 *
 * `objectui#4325`'s lesson is untouched — the hazard there was an UNDECLARED deep
 * path that resolved only through the vitest alias and was TS2882 for `tsc`. This
 * one is declared in `exports`, so `tsc` (moduleResolution `bundler`) resolves it
 * exactly as it resolves `.`.
 */

/**
 * The one crossing for deliberately undeclared node input in a test
 * (objectui#11466): see the module's docblock for what may, and may not, go
 * through it.
 */
export { undeclaredNode } from './undeclared-node';
