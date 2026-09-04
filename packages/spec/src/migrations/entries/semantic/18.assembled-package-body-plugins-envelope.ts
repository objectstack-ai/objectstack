// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #15219 — maintainer ruling A for both keys (2026-09-04, director relay,
// verbatim 「同意」): `plugins` and `devPlugins` are artifact ENVELOPE keys —
// top level only, never inside `packages[]`. Registered as D3 SEMANTIC and
// deliberately NOT as a D2 conversion, on the D2 scope guard (lossless only):
// a plugin declared inside an assembled package body has no lossless target.
// `plugins` is `z.array(z.unknown())` and may hold live instances that never
// survived JSON in the first place, and hoisting a serialisable entry to the
// artifact top level changes WHO loads it (the host, not a package) — a
// judgment the author makes. Nothing is retired: both keys stay declared on
// the stack schema at the top level, so no RETIRED_KEYS entry, and the
// refusal inside a body is the manifest's own strict close naming the key.
export const entry: SemanticMigration = {
  id: 'assembled-package-body-plugins-envelope',
  surface:
    'artifact `packages[].manifest.plugins` and `packages[].manifest.devPlugins` — the two '
    + 'keys inside an ASSEMBLED package body (`AssembledPackageBodySchema`, ADR-0130 D4)',
  replacement:
    'Declare `plugins` / `devPlugins` at the stack TOP LEVEL only — the artifact envelope, '
    + 'where `os serve` / `os migrate` / `os dev` read them and where `composeStacks` still '
    + 'concatenates them (`concat` is unchanged for in-memory composition). Delete both keys '
    + 'from every `packages[i].manifest` body: a multi-package artifact that carried them is '
    + 'rebuilt from source (`os build` / `composeStacks(…, { manifest: \'preserve\' })` no '
    + 'longer folds them into a body), and a hand-written `packages[]` entry drops them.',
  reason:
    'A classification error, not a new special case (#15219; epic #14122 / #14512). '
    + '`plugins` and `devPlugins` were the only members of the assembled-body key set whose '
    + 'values are runtime ASSEMBLY instructions rather than serialisable metadata: `plugins` '
    + 'holds what a host hands to `kernel.use()` — live plugin instances, manifests or package '
    + 'names — and `devPlugins` is the `os dev` load list. Inside an artifact a package body is '
    + 'inert JSON, so a plugin written under `packages[i].manifest` could never be constructed '
    + 'by any loader; every reader (`serve.ts`, `schema-migration-plugins.ts`) reads the top '
    + 'level, and the "resolve `packages[]` when the top level is absent" repair every other '
    + 'reader took would have turned a silent skip into a boot that registers garbage. Options '
    + 'B (readers resolve JSON descriptions into live plugins) and C (the emitter special-cases '
    + 'the two keys) were refused. After the ruling, "an artifact carries metadata, a host '
    + 'assembles plugins" is one sentence every reader inherits. Not losslessly convertible: '
    + 'hoisting a body-level plugin to the envelope changes who loads it, and a live instance '
    + 'has no JSON form to move.',
  acceptanceCriteria:
    'No `packages[i].manifest` in any artifact carries `plugins` or `devPlugins`; the body '
    + 'schema refuses either with `unrecognized_keys` naming the key (pinned in '
    + '`assembled-package-body.test.ts`), and `artifact-packages.ts` refuses the entry at '
    + 'load with that path. A stack declaring `plugins` / `devPlugins` at the top level '
    + 'parses byte-identically to before, `composeStacks` still concatenates both in stack '
    + 'order, and `manifest: \'preserve\'` emits package bodies without them. An existing '
    + 'multi-package artifact that carried a body-level `plugins` is rebuilt from source.',
};
