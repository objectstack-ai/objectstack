// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#15542 / #15854] The `metadata.endpoints.*` switches were re-partitioned so that
// each gates exactly the face its name states. Nothing is renamed, nothing is
// retired and no stored row changes shape — a `RestServerConfig` is plugin TS
// configuration, never a stack collection member or a `sys_metadata` row (the
// `openApi31` precedent, #4579), so there is no D2 conversion to graduate here.
// What an embedder is owed is a PRESCRIPTION, because the mounted route table their
// existing config produces has moved in both directions, and the compiler cannot
// tell them: every key is optional and boolean, so the old spelling still compiles
// and still parses. That is exactly the residue D2 cannot express, which is why this
// is a semantic entry rather than a conversion.
import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'metadata-endpoints-switch-radius-repartitioned',
  surface: 'restServer.metadata.endpoints.items / restServer.metadata.endpoints.item',
  replacement:
    'An `endpoints.*` switch now gates exactly the face its name states, reads and writes alike. '
    + '`items` gates `GET {prefix}/:type` and nothing else; the whole-store operations it used to take '
    + 'with it — `GET {prefix}/diagnostics`, `GET {prefix}/_drafts` and the `POST {prefix}/_migrate-stored` '
    + 'write door — answer to the new key `endpoints.maintenance` (default `true`). `item` now gates the '
    + 'WHOLE per-item face: `GET` / `PUT` / `DELETE {prefix}/:type/:name`, `/references`, `/layers`, the '
    + 'history family (`/history`, `/audit`, `/diff`, `/published`, `/publish`, `/rollback`) and '
    + '`GET {prefix}/book/:name/tree`. ⇒ An embedder that authored `endpoints: { items: false }` to close '
    + 'the whole-store family writes `endpoints: { items: false, maintenance: false }`. An embedder that '
    + 'authored `endpoints: { item: false }` to close only the per-item READS has no key that keeps the '
    + 'writes: the per-item face is one face, so leave `item` on and close the surface at '
    + '`api.enableMetadata`, or per object at `enable.apiEnabled` / `enable.apiMethods`. '
    + '`types` is unchanged and `api.enableMetadata` remains the master switch above all four.',
  reason:
    'Not losslessly convertible, and not compiler-carried either — the two channels that would otherwise '
    + 'reach a consumer are both blind here. No key is renamed, removed or retyped: every one is an '
    + 'optional boolean, so `{ items: false }` compiles and parses exactly as before and simply mounts a '
    + 'different route table. A D2 conversion would have to GUESS which of the four routes the author '
    + 'meant to close, and the two readings differ by a write door — rewriting `{ items: false }` to '
    + '`{ items: false, maintenance: false }` preserves the old mounts but presumes an intent the author '
    + 'never expressed, while leaving it alone re-mounts `POST {prefix}/_migrate-stored`. That is a '
    + 'judgment, so it is delegated rather than automated. The change itself is the ADR-0049 '
    + 'declared-vs-enforced defect in the direction the liveness ledger structurally cannot look: all '
    + 'three keys were genuinely live, and what had drifted was each one\'s RADIUS against its own '
    + '`describe()` — `items` gated a migration write door while naming a listing read (#15542), and '
    + '`item` gated four reads while its own `PUT` / `DELETE` and the history family answered to '
    + '`api.enableMetadata` alone (#15854). Ruled together by the maintainer as one principle. Measured '
    + 'population at the time of the move: ZERO — no shipped boot path constructs a `RestServerConfig` '
    + '(#15543), so only programmatic embedders can have authored these keys at all.',
  acceptanceCriteria:
    'For each `RestServerConfig` the consumer constructs, `new RestServer(...).registerRoutes()` followed '
    + 'by `getRoutes()` yields the route table the consumer intends — specifically: with '
    + '`endpoints.items: false` authored, `GET {prefix}/diagnostics`, `GET {prefix}/_drafts` and '
    + '`POST {prefix}/_migrate-stored` are PRESENT unless `endpoints.maintenance: false` is also authored; '
    + 'and with `endpoints.item: false` authored, `PUT {prefix}/:type/:name`, '
    + '`DELETE {prefix}/:type/:name` and the six history routes are ABSENT. A consumer that authored '
    + 'neither key is unaffected and needs no change: all four switches default `true` and the default '
    + 'route table is byte-identical to before. The reference measurement is '
    + '`packages/rest/src/rest-config-mount-table.pin.test.ts`, which asserts each switch\'s radius as a '
    + 'set difference against the all-true baseline in both directions.',
};
