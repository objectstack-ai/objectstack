// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'api-runtime-create-withdrawn',
  surface: 'PUT /api/v1/meta/api/{name} (runtime-authored `api` endpoints, draft and active alike)',
  replacement:
    'Declare the endpoint as a stack artifact (`**/*.api.ts`, or `defineStack({ apis })`) '
    + 'and ship it through `publishPackage`',
  reason:
    'The `api` registry entry declared `allowRuntimeCreate: true` and the runtime never '
    + 'honoured it. Measured on a real showcase boot (#5488): `PUT /api/v1/meta/api/'
    + 'e8_backdoor` answered 200 with `{"success":true,…,"message":"Saved …"}`, and the '
    + 'declared route then answered 404 forever — with NO `[EndpointMatcher] … EXCLUDED` '
    + 'line, because the endpoint was never in the index to be excluded from. The serving '
    + 'criterion belongs to `IMetadataService.matchEndpoint` -> `EndpointMatcher` -> '
    + "`MetadataManager.listForIndex('api')`, which reads the manager's registry plus its "
    + 'registered loaders (`["filesystem","memory"]` on dev/serve); a runtime write lands '
    + 'in `sys_metadata`, which is in neither. A declared capability the runtime does not '
    + 'honour is ADR-0049 false compliance, and a write that answers "Saved" and then 404s '
    + 'forever is its most dangerous shape for the AI authors ADR-0033 targets. The '
    + 'maintainer ruled REMOVE on 2026-08-07 rather than converge the read path, because '
    + 'making the matcher read `sys_metadata` re-opens cache, invalidation, tenancy and '
    + "the ADR-0110 D3 miss-vs-outage distinction on a new read path, and there is no "
    + 'business pull for Studio-authored endpoints today (zero `.api.*` artifacts author '
    + 'them at runtime; showcase uses the artifact route, #5040 E8 LIVE). '
    + 'There is NO D2 conversion, for the reason this list exists: nothing in an authored '
    + 'source spells this key. `allowRuntimeCreate` is a PLATFORM registry value, not an '
    + 'authorable one, and the artifact route it points authors toward is untouched — a '
    + '`**/*.api.ts` file valid before this change is valid after it, byte for byte. What '
    + 'changed is a runtime HTTP verdict, so it is one semantic TODO for operators and '
    + 'Studio callers rather than a stack conversion — the same disposition '
    + '`BatchOptions.validateOnly` (#4052) takes. Consequently `gateApiDraftsForPublish` '
    + '(PR #5279) is retired with it: it gated a promotion into a state the matcher can '
    + 'never read, and with the inlet closed no `api` draft can exist for it to judge. '
    + 'Re-entry is recorded in the ruling: if #2657 Part B promotes `apis` to a registered '
    + 'type WITH A REAL CONSUMPTION PATH, the flag flips back then — implementation first, '
    + 'declaration second. ADR-0049 / ADR-0121, #5488 (subsumes #5311).',
  acceptanceCriteria:
    'No caller creates or updates an `api` item through the runtime metadata API. '
    + '`PUT /api/v1/meta/api/{name}` answers 403 with `code: "NOT_CREATABLE"` and a body '
    + 'naming both flags (`allowRuntimeCreate=false, allowOrgOverride=false`) and the '
    + 'prescription `Declare it in source (**/*.api.ts) and redeploy` — in `?mode=draft` '
    + 'as well as direct-active, because the gate runs before the draft/publish branch and '
    + 'does not read `mode`. ⚠️ Verify the artifact route is UNAFFECTED, which is the whole '
    + 'point of the change: a stack declaring `apis:` still compiles, still passes '
    + '`validateApiEndpointDeclarations` at publish (`publishPackage`, #5189) and at load '
    + '(`buildEndpointIndex`, PR #5203), and its endpoints still SERVE — that route was '
    + 'always the only one that served. An operator who genuinely needs the runtime door '
    + 'back on one deployment sets `OS_METADATA_WRITABLE=api`, the same single escape '
    + 'hatch `job` / `agent` / `capability` use; note that this unlocks the WRITE only, and '
    + 'the endpoint still will not be served, which is why it is a diagnostic and not a '
    + 'workaround. Any `api` rows already sitting in `sys_metadata` from before this change '
    + 'were never served either; they can be deleted (`deleteMetaItem` is deliberately not '
    + 'gated by this refusal, so repair stays possible).',
};
