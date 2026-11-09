// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `connector-error-mapping-removed` conversion (`toMajor:
// 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `connectorErrorMappingRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { stripKeys } from '../shared.js';

/**
 * `connector.errorMapping` removed (protocol 18, commit 13c48c2a5 — ADR-0049
 * enforce-or-remove; triage ruling 2026-09-02, route: removal via the
 * `spec-property-retirement` playbook; the split condition — a downstream
 * consumer in objectui or a customer stack — measured empty at objectui
 * `0d8fd7c`, hotcrm not measurable from the dispatching container).
 *
 * `ErrorMappingConfigSchema` (`rules`, `defaultCategory`, `unmappedBehavior`,
 * `logUnmapped`) and `ErrorMappingRuleSchema` (`sourceCode`, `sourceMessage`,
 * `targetCode`, `targetCategory`, `severity`, `retryable`, `userMessage`) were
 * authorable through `ConnectorSchema.errorMapping` — and, because
 * `DeclarativeConnectorEntrySchema` carries the same shape, through
 * `stack.connectors[]` and the `PUT /meta/connector/:name` door — and NOTHING
 * read them: measured on `origin/main`, the only reference outside the
 * declaring file and its unit test was a type-identity pin. No provider,
 * dispatcher or materializer ever mapped an external error through the rules,
 * so `unmappedBehavior` configured nothing and a rule's `userMessage` was
 * never shown to anyone. That last spelling is what lifted the card above
 * ordinary dead surface: it is the name of the LIVE API-error channel
 * (`ApiError.userMessage`, the user-facing refusal text a thrown HTTP error
 * declares), so an author who had read that documentation and wrote a rule
 * here reasonably believed they were marking a refusal for an end user, and
 * the failure was silent in both directions (it validated, it published, no
 * message was ever shown). Deletion resolves the collision without a rename.
 *
 * A pure lossless delete: the block never had an effect to preserve. The
 * whole shape leaves — `integration/ErrorMappingConfig`,
 * `integration/ErrorMappingRule` and the `integration/ConnectorErrorCategory`
 * enum they were the only consumers of (`RETIRED_DEFS_BY_MAJOR[18]`).
 *
 * `retiredFromLoadPath`: `ConnectorSchema` tombstones the key (`retiredKey`,
 * tsc `never` + the parse-time prescription — the `rateLimitConfig` posture
 * one block over in the same schema), so a live parse refuses loudly rather
 * than absorbing a block the author believes is configuring something. This
 * entry exists so stored 17.x rows replay clean (`applyConversionsToStoredItem`)
 * and `os migrate meta --from 17` lists the mechanical edits for author
 * sources. One notice per connector, not per nested key: the block is what
 * was removed, and the eleven keys inside it leave with it.
 */
const connectorErrorMappingRemoved: MetadataConversion = {
  id: 'connector-error-mapping-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.3.0',
  surface: 'connector.errorMapping',
  summary:
    "connector key 'errorMapping' removed (ADR-0049 — no engine ever mapped an external "
    + 'error through the rules, so the eleven nested keys configured nothing, and the rule-level '
    + '`userMessage` shared its spelling with the live API-error channel while never being shown; '
    + 'deleting the block resolves that collision without a rename. '
    + 'The whole ErrorMappingConfig / ErrorMappingRule shape and the ConnectorErrorCategory enum '
    + 'went with it)',
  apply(stack, emit) {
    return mapCollection(stack, 'connectors', (c, path) =>
      stripKeys(c, ['errorMapping'], emit, path));
  },
  fixture: {
    before: {
      connectors: [
        {
          name: 'payments_api',
          label: 'Payments API',
          type: 'api',
          // The measured shape: every one of the eleven keys, including the
          // `userMessage` the card was filed about.
          errorMapping: {
            rules: [
              {
                sourceCode: 429,
                sourceMessage: 'Too Many Requests',
                targetCode: 'RATE_LIMITED',
                targetCategory: 'rate_limit',
                severity: 'medium',
                retryable: true,
                userMessage: 'The payment provider is busy; try again shortly.',
              },
            ],
            defaultCategory: 'integration_error',
            unmappedBehavior: 'generic_error',
            logUnmapped: true,
          },
        },
        // A connector that never authored the key keeps its identity — the
        // copy-on-write contract `stripKeys` / `mapCollection` are built on.
        { name: 'warehouse_sync', label: 'Warehouse Sync', type: 'saas' },
      ],
    },
    after: {
      connectors: [
        { name: 'payments_api', label: 'Payments API', type: 'api' },
        { name: 'warehouse_sync', label: 'Warehouse Sync', type: 'saas' },
      ],
    },
    // One notice: the connector carrying the block. The nested keys are not
    // counted separately — the block is the unit of removal.
    expectedNotices: 1,
  },
};

export { connectorErrorMappingRemoved };
