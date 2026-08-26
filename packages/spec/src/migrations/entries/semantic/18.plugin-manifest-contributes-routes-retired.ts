// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'plugin-manifest-contributes-routes-retired',
  surface:
    'manifest.contributes.routes (the one member #10724 deliberately excluded; '
    + '`kinds` is now the block\'s sole surviving live member)',
  replacement:
    'delete the key. A route that needs real handler CODE is mounted imperatively: '
    + 'resolve the `http.server` service from the plugin context and register the '
    + 'handler on `kernel:ready` (plugin-hono-server registers the service; '
    + '`examples/app-showcase` mounts POST /api/v1/showcase/recalc that way). A '
    + 'declarative endpoint over a pipeline the platform already runs — query/return '
    + 'records, trigger a flow — is `defineStack({ apis })` (live since protocol 17, '
    + '#5040)',
  reason:
    'ADR-0049 enforce-or-remove; #10726, maintainer ruling 2026-08-22 (Option B of the '
    + 'enforce/remove/enforce-later fork, accepted verbatim 「接受所有」 on the decision '
    + 'batch carrying the four-axis analysis). #10627 measured zero readers of the key '
    + 'monorepo-wide with control probes: the HttpDispatcher never registered a prefix '
    + 'from the declaration, so an entry parsed cleanly and served nothing — while FOUR '
    + 'published surfaces presented it as working machinery, one of them a '
    + 'customer-published skill (`skills/objectstack-api` told authors to choose it when '
    + '"the endpoint needs real handler CODE"). That is ADR-0049\'s silent no-op with a '
    + 'published recommendation attached. Per the ruling\'s own sequencing the '
    + 'author-facing corrections landed FIRST (PR #11327: the skill\'s decision table, '
    + 'the dispatcher protocol doc, ADR-0088:40, app.mdx), and the two remaining '
    + 'teaching sites (#11328: the plugin-rest-api.zod.ts worked manifest example, the '
    + 'metadata-plugin.zod.ts `router` delivered-form comments) are redirected in the '
    + 'removal PR itself. The cloud precondition was discharged 2026-08-24 (#10812: '
    + 'cloud @ 5b5925a, zero `manifest.contributes` reads, controls green). Enforce '
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
    + 'recommends the key: every former teaching site points at the imperative '
    + '`http.server` mount (and `defineStack({ apis })` for declarative projections). '
    + '⚠️ Runtime behaviour is deliberately UNCHANGED and must be verified as such: '
    + 'nothing ever read the member, so removing it removes no behaviour. A package '
    + 'ALREADY INSTALLED whose stored manifest carries one degrades to a single '
    + '`[metadata_spec_invalid]` log line at registration (the registry\'s `validate()` '
    + 'is a diagnostic, not a gate) rather than a boot failure; clear it by deleting the '
    + 'key from the source manifest and reinstalling.',
};
