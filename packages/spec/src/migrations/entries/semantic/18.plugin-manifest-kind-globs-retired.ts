// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'plugin-manifest-kind-globs-retired',
  surface: 'manifest.contributes.kinds[].globs (the `kind` bucket itself and its `id` are untouched)',
  replacement:
    'delete the key — a kind entry is `{ id, description? }`. File-type discovery is '
    + "single-channel on the metadata type registry's `filePatterns` "
    + '(`MetadataTypeSchema`, registered via `registerMetadataTypeSchema` / the default '
    + 'registry), which `contributes.kinds` never extended; if plugin-extensible '
    + 'discovery is ever wanted, it gets designed against that registry, not revived '
    + 'here',
  reason:
    'ADR-0049 enforce-or-remove; #11169, maintainer ruling 2026-08-24 (「接受你的建议。」) on '
    + 'the aligned four-facet analysis. The sub-field was declared-but-unenforced on an '
    + 'authorable published surface: the schema promised that declaring `globs` "enables the '
    + 'system to parse and validate new file types" (its own example: a BI plugin handling '
    + '`*.report.ts`), and the platform accepted it, stored it, and served it back through '
    + '`GET /metadata/kind` — while the discovery the description promised never ran, because '
    + 'real glob-driven artifact discovery reads `filePatterns` off the metadata type registry '
    + 'and `metadata-plugin.zod.ts` records outright that `contributes.kinds` does not extend '
    + 'it. Measured in PR #11168 and re-verified at claim time with the card\'s positive '
    + 'control: zero value reads anywhere (the only non-test occurrences of the path are the '
    + 'schema declaration and two type positions), and no in-repo manifest authors the key '
    + 'outside test fixtures. Enforce was weighed and rejected on all four facets: it would '
    + 'build a SECOND discovery channel parallel to `filePatterns` for a spelling with zero '
    + 'pull. Why D3 semantic and not a D2 conversion: a manifest is not a stack collection '
    + 'member (`PLURAL_TO_SINGULAR` has no `packages`/`plugins` entry), so a conversion would '
    + 'be a transform with no seam that ever runs.',
  acceptanceCriteria:
    'An authored `contributes.kinds[].globs` is a loud rejection through every '
    + 'spec-validating path — `retiredKey()` types it `never` (tsc error at the authoring '
    + 'site) and the parse raises the prescription itself (`os plugin build` exits non-zero '
    + 'printing it). `contributes.kinds` with `{ id, description? }` still parses and still '
    + 'registers (`engine` → `registry.registerKind`), and the registered bucket stays '
    + 'reachable via `GET /metadata/kind`. ⚠️ Runtime behaviour is deliberately UNCHANGED '
    + 'and must be verified as such: nothing read the value, so removing it removes no '
    + 'behaviour; the `registerKind` / `getAllKinds` type positions drop `globs` from their '
    + 'declared shapes (a type-only change — the parameter widens). A stored kind item that '
    + 'still carries `globs` keeps serving as stored data; clear it by deleting the key from '
    + 'the source manifest and republishing.',
};
