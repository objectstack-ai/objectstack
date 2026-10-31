// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0025 v2 §3.3 (maintainer decision Q6, 2026-10-28), ADR-0049
// enforce-or-remove: `manifest-deps` leaves `PluginPackagingSchema`, and
// `bundled` is a plugin's one packaging strategy. Deleting the value is
// mechanical (the D2 conversion `manifest-packaging-manifest-deps-removed`);
// what this entry carries is the judgement the upgrader still owes: a plugin
// that relied on a dependency staying out of the bundle now has it inlined,
// and one whose dependency is a native addon is refused by the build.
export const entry: SemanticMigration = {
  id: 'manifest-packaging-manifest-deps-retired',
  surface:
    "manifest.packaging: 'manifest-deps' (and packages[].manifest.packaging, and objectstack.plugin.json) — "
    + "the second packaging strategy left; PluginPackagingSchema is now 'bundled' alone",
  replacement:
    'no `packaging` key, or `packaging: \'bundled\'` — `os plugin build` inlines every dependency except the '
    + 'host-provided `@objectstack/*` packages into `dist/index.mjs`, and refuses a native (`.node`) addon',
  reason:
    'ADR-0049 enforce-or-remove: the strategy existed on the build side only. `os plugin build` kept the '
    + '`package.json` dependencies out of the bundle and packed `package.json` + `pnpm-lock.yaml` for an '
    + 'install-time resolution, and nothing ever ran one: `os plugin install` and the boot-time loader '
    + 'import `dist/index.mjs` as packed, so an artifact built with it could not load the dependencies it '
    + 'left out. The D2 conversion `manifest-packaging-manifest-deps-removed` deletes the value from a '
    + 'stack\'s manifest and every `packages[].manifest`, losslessly, since `bundled` is what the build '
    + 'does with or without the key. What it cannot do is reach a plugin project\'s own '
    + '`objectstack.plugin.json`, which `os plugin build` parses straight through the manifest schema, or '
    + 'judge the bundle: a dependency that was kept out on purpose is now inlined, and one that is a '
    + 'native addon is refused by the build. Authoring now refuses the value at parse with that '
    + 'prescription, and TypeScript rejects it',
  acceptanceCriteria:
    'No manifest — the stack\'s own, any packages[] entry, any objectstack.plugin.json — declares '
    + '`packaging: \'manifest-deps\'`; the value is refused at parse with its prescription, and TypeScript '
    + 'rejects it. `os plugin build` builds each plugin clean: every dependency it imports is inlined into '
    + '`dist/index.mjs` (only `@objectstack/*` stays external), the artifact carries no `package.json` or '
    + 'lockfile, and no dependency is a native addon (the build refuses one by name).',
  conversionIds: ['manifest-packaging-manifest-deps-removed'],
};
