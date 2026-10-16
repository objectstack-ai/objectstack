// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'plugin-manifest-contributes-routes-retired',
  surface:
    'manifest.contributes.routes (the one member the nine-member retirement deliberately '
    + 'left to its own fork; `kinds` is now the block\'s sole surviving live member)',
  replacement:
    'delete the key. An app does not mount routes on `http.server` — that service is '
    + 'the platform\'s own door-building primitive, and a code-mounted route gets no '
    + 'caller identity, auth gate, rate limit, namespace carve-out or OpenAPI entry. '
    + 'Declare the endpoint under `defineStack({ apis })` (`type: \'object_operation\'` '
    + 'or `\'flow\'`, ADR-0121; live since protocol 17, once the declarative endpoint '
    + 'executor was built and the loud refusal of a non-empty `apis:` became '
    + 'execution), compute in a flow, and register code as a stack function '
    + '(`defineStack({ functions })`) or a connector',
  reason:
    'ADR-0049 enforce-or-remove; maintainer ruling 2026-08-22 (Option B of the '
    + 'enforce/remove/enforce-later fork, accepted verbatim 「接受所有」 on the decision '
    + 'batch carrying the four-axis analysis): remove the key, and redirect every '
    + 'author-facing recommendation of it to the imperative `http.server` mount. A '
    + 'monorepo-wide census with control probes measured zero readers of the key: the '
    + 'HttpDispatcher never registered a prefix '
    + 'from the declaration, so an entry parsed cleanly and served nothing — while FOUR '
    + 'published surfaces presented it as working machinery, one of them a '
    + 'customer-published skill (`skills/objectstack-api` told authors to choose it when '
    + '"the endpoint needs real handler CODE"). That is ADR-0049\'s silent no-op with a '
    + 'published recommendation attached. Per the ruling\'s own sequencing the '
    + 'author-facing corrections landed FIRST (the skill\'s decision table, the '
    + 'dispatcher protocol doc, ADR-0088:40 and app.mdx, each redirected to the '
    + 'imperative mount), and the two remaining teaching sites (the plugin-rest-api.zod.ts '
    + 'worked manifest example, the metadata-plugin.zod.ts `router` delivered-form '
    + 'comments) are redirected in the removal PR itself. The cloud precondition was '
    + 'discharged first: a census of the cloud repository at 5b5925a found zero '
    + '`manifest.contributes` reads, controls green. Enforce '
    + '(fork A) was weighed and rejected on all four facets: net-new execution surface '
    + 'plus a prefix-claim authority question (who may claim `/api/v1/…`) for a '
    + 'declarative spelling with zero measured authors, while the capability is already '
    + 'reachable imperatively. Why D3 semantic and not a D2 conversion: a manifest is '
    + 'not a stack collection member (`PLURAL_TO_SINGULAR` has no `packages`/`plugins` '
    + 'entry), so a conversion would be a transform with no seam that ever runs.',
  acceptanceCriteria:
    'An authored `contributes.routes` is a loud rejection through every spec-validating '
    + 'path — `retiredKey()` types it `never` (tsc error at the authoring site) and the '
    + 'parse raises the prescription itself (`os plugin build` exits non-zero printing '
    + 'it). `contributes.kinds` — the block\'s sole surviving member — keeps parsing and '
    + 'registering (engine → `registry.registerKind`). No author-facing material still '
    + 'recommends the key, and none sends an app author to an imperative `http.server` '
    + 'mount: every former teaching site points at `defineStack({ apis })`, a flow, and a '
    + 'stack function or connector for code. '
    + '⚠️ Runtime behaviour is deliberately UNCHANGED and must be verified as such: '
    + 'nothing ever read the member, so removing it removes no behaviour. A package '
    + 'ALREADY INSTALLED whose stored manifest carries one degrades to a single '
    + '`[metadata_spec_invalid]` log line at registration (the registry\'s `validate()` '
    + 'is a diagnostic, not a gate) rather than a boot failure; clear it by deleting the '
    + 'key from the source manifest and reinstalling.',
};
