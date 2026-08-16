// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { FieldSchema, UniqueScopeSchema } from './field.zod';
import { ValidationRuleSchema } from './validation.zod';
import { ActionSchema } from '../ui/action.zod';
import { ObjectListViewSchema } from '../ui/view.zod';

/**
 * API Operations Enum
 */
import { ExpressionInputSchema, TemplateExpressionInputSchema, type Expression, type ExpressionInput } from '../shared/expression.zod';
import { lazySchema } from '../shared/lazy-schema';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
import { strictObject } from '../shared/strict-object';
import { ProtectionSchema } from '../shared/protection.zod';
import { retiredKey } from '../shared/retired-key';
export const ApiMethod = z.enum([
  'get', 'list',                // Read
  'create', 'update', 'delete', // Write
  'bulk',                       // Batch operations
]);
export type ApiMethod = z.input<typeof ApiMethod>;

/**
 * The eight RETIRED legacy `apiMethods` values (#3543, P2 of #3391). Each is
 * DERIVED from the six primitives by the spec's single derivation table
 * (`API_METHOD_DERIVATION` in `api-derivation.ts`) — an author never declares
 * them. A stored/authored legacy value is stripped at parse by
 * {@link stripLegacyApiMethods} (canonicalize-and-warn, never a hard parse
 * failure): real metadata does not upgrade in lockstep with the spec, so this
 * tolerance is a PERMANENT compatibility layer, not a one-release transition.
 */
export const LEGACY_API_METHODS = [
  'upsert', 'aggregate', 'history', 'search', 'restore', 'purge', 'import', 'export',
] as const;
export type LegacyApiMethod = (typeof LEGACY_API_METHODS)[number];

/**
 * Tombstones for the retired legacy values — same doctrine as
 * `CAPABILITIES_RETIRED_KEY_GUIDANCE` below: the strip warning must carry the
 * FROM → TO prescription, because it is the one channel a consumer whose
 * metadata still declares a legacy value is guaranteed to hit.
 */
export const LEGACY_API_METHOD_GUIDANCE: Record<LegacyApiMethod, string> = {
  upsert: "declare ['create','update'] — `upsert` derives from create ∧ update",
  aggregate: "declare ['list'] — `aggregate` derives from list",
  history: "declare ['get'] with `enable.trackHistory: true` — `history` derives from get ∧ trackHistory",
  search: "declare ['list'] (with `searchable` not false) — `search` derives from list ∧ searchable",
  restore: "delete the value — `restore` never derives (`enable.trash` retired, #2377); it returns only with a real recycle bin (#3146, parked)",
  purge: "delete the value — `purge` never derives (`enable.trash` retired, #2377)",
  import: "declare ['create'] and/or ['update'] — `import` derives from create ∨ update (writeMode-precise at the gate)",
  export: "declare ['list'] — `export` derives from list",
};

/**
 * The canonical serialization order of the EFFECTIVE operation vocabulary —
 * the declaration order of the pre-#3543 fourteen-value enum, preserved
 * verbatim so the wire contract (405 `allowed` array, `/me/permissions`
 * `apiOperations`) is byte-stable across the shrink.
 */
export const API_OPERATION_ORDER = [
  'get', 'list', 'create', 'update', 'delete', 'upsert', 'bulk',
  'aggregate', 'history', 'search', 'restore', 'purge', 'import', 'export',
] as const;

/**
 * An effective API operation — the vocabulary of gates and wire serialization:
 * the six authored primitives plus the eight derived verbs. Authors declare
 * {@link ApiMethod}; servers derive and speak THIS (see `api-derivation.ts`).
 */
export type ApiOperation = (typeof API_OPERATION_ORDER)[number];

/**
 * Zod schema for {@link ApiOperation} — response-side surfaces that carry an
 * effective operation set (e.g. `EffectiveObjectPermissionSchema.apiOperations`)
 * validate against THIS, never against the authored {@link ApiMethod} enum.
 */
export const ApiOperationSchema = z.enum(API_OPERATION_ORDER);

const LEGACY_API_METHOD_SET: ReadonlySet<string> = new Set(LEGACY_API_METHODS);

/** Distinct legacy combinations already warned about (bounded; parse is hot). */
const warnedLegacyApiMethods = new Set<string>();

/**
 * Strip retired legacy values from an `apiMethods` whitelist before enum
 * validation (#3543). Non-arrays pass through untouched (the schema reports
 * them). Emits a single warning per distinct legacy combination — parse runs
 * on hot paths and carries no object-name context; the registration-time
 * diagnostic in objectql `registry.ts` adds the per-object view.
 *
 * The one behavioral cliff is called out loudly: a whitelist that becomes
 * EMPTY after stripping is `[]` = deny-all under the three-state contract,
 * so a pure-legacy whitelist (e.g. `['upsert']`) now closes the object's API
 * entirely instead of widening it.
 */
export function stripLegacyApiMethods(
  raw: unknown,
  opts?: { warn?: (msg: string) => void },
): unknown {
  if (!Array.isArray(raw)) return raw;
  const legacy = [...new Set(raw.filter(
    (v): v is LegacyApiMethod => typeof v === 'string' && LEGACY_API_METHOD_SET.has(v),
  ))];
  if (legacy.length === 0) return raw;
  const kept = raw.filter((v) => !(typeof v === 'string' && LEGACY_API_METHOD_SET.has(v)));
  const key = `${[...legacy].sort().join(',')}${kept.length === 0 ? '|deny-all' : ''}`;
  if (!warnedLegacyApiMethods.has(key)) {
    warnedLegacyApiMethods.add(key);
    const warn = opts?.warn ?? ((msg: string) => console.warn(msg));
    warn(
      `[spec] enable.apiMethods declares retired legacy value(s) [${legacy.join(', ')}] — ` +
        `the ApiMethod enum is the six primitives get/list/create/update/delete/bulk (#3543). ` +
        `Legacy values are stripped at parse; their semantics are DERIVED from the primitives:\n` +
        legacy.map((v) => `  • \`${v}\`: ${LEGACY_API_METHOD_GUIDANCE[v]}`).join('\n') +
        (kept.length === 0
          ? `\n  ⚠ After stripping, this whitelist is EMPTY — \`[]\` means DENY-ALL (fully closed ` +
            `API). Declare the underlying primitives if the object should stay reachable.`
          : '') +
        `\nCodemod: node scripts/codemod/apimethods-legacy-to-primitives.mjs`,
    );
  }
  return kept;
}

/**
 * Tombstones for RETIRED capability flags — same doctrine as the tenancy
 * block and the top-level `UNKNOWN_KEY_GUIDANCE` map below: a retired
 * key's rejection must carry the upgrade prescription, because the parse
 * error is the one channel every consumer bumping `@objectstack/spec` is
 * guaranteed to hit. Removed in the 16.x line (#2377, ADR-0049
 * enforce-or-remove).
 */
const CAPABILITIES_RETIRED_KEY_GUIDANCE: Record<string, string> = {
  trash:
    '`enable.trash` was removed from @objectstack/spec in the 16.x line (#2377/#3207, ' +
    'ADR-0049) — it never had a runtime consumer: every delete has always been a ' +
    'hard delete, and a default-true flag promising a recycle bin was a false ' +
    'affordance (authors wrote `trash: false` believing they were opting out of a ' +
    'soft-delete that never ran). Delete the key. For recoverability use per-field ' +
    '`trackHistory` (audit trail) or a `lifecycle` policy; soft delete is parked at ' +
    '#3146 and, if built, returns as a live enforced flag (ADR-0049 prune-or-build). ' +
    'Run `os migrate meta --from 16` to rewrite existing sources automatically.',
  mru:
    '`enable.mru` was removed from @objectstack/spec in the 16.x line (#2377/#3207, ' +
    'ADR-0049) — Most-Recently-Used tracking was never implemented; no reader ' +
    'existed, so the flag changed nothing. Delete the key. If MRU tracking is ' +
    'built it returns as a live enforced flag (ADR-0049 prune-or-build). ' +
    'Run `os migrate meta --from 16` to rewrite existing sources automatically.',
};

/**
 * The standing history sentence for the `enable` block, emitted LAST on every
 * rejection — the shared template's `history` slot.
 *
 * ## Why the slot, and why the fold waited for it (#6805)
 *
 * This block was the LAST hand-written `unrecognized_keys` map in this file.
 * #6619 folded its sibling `strictTenancyError` into the shared `strictObject`
 * template and left this one out for a reason it stated precisely: the map
 * emitted NO trailing sentence while `strictUnknownKeyError` appends its
 * `history` unconditionally (`${message} ${history}`). Measured again at #6805,
 * that is a statement about the TEXT and not about the template — `enable` has
 * a real history, it had simply never been written down. Writing it is the
 * whole of what the fold needed.
 *
 * The reading of the slot is #6619's, unchanged: what it encodes is *position*
 * — the one standing sentence that follows both fix channels (#5955 / #6416) —
 * so the surface decides what belongs there, and background is as legitimate as
 * literal history.
 *
 * The rejection itself is unchanged in kind: an unknown key — a retired
 * `trash`/`mru` or a typo like `feedEnabled` — is a loud, *fixable* parse error
 * instead of a silent strip (#1535), a retired key's error carries its upgrade
 * prescription, and every other issue code defers to zod's default. What the
 * fold changes is the *other* key: `searchible` now resolves to `searchable`
 * through the template's rename channel instead of being told only that it "is
 * not an `enable` capability flag", which named the problem and never the fix.
 * And it is what puts this table under `alias-integrity.test.ts`, which no
 * hand-rolled map has ever been judged by.
 *
 * ⚠️ `scripts/strictness-ledger.test.ts` used the `ObjectCapabilities` site
 * below as its `z.object(…).strict()` fixture. #6805 moved it to
 * `PerOperationRequiredPermissionsSchema` in this same file rather than
 * deleting the assertion, exactly as that test's own note instructs.
 */
const CAPABILITIES_HISTORY =
  'Until this shape was closed an unknown flag was dropped without a word — the object '
  + 'shipped as if the author had never written it (#1535); `enable` is a closed vocabulary '
  + 'in which every flag carries an enforcement contract (#2707).';

/**
 * Capability Flags
 * Defines what system features are enabled for this object.
 *
 * Modeled on industry standards (Salesforce "Allow Activities"/"Track Field
 * History"/"Enable Feed Tracking", Dataverse table options). Each flag has a
 * defined enforcement contract (#2707); a flag with no runtime consumer is a
 * bug, not a reservation — see `@objectstack/spec/liveness/object.json`.
 *
 * Opt-out flags (`feeds`, `activities`, `clone`, `searchable`, `apiEnabled`)
 * default to `true`: absent block/flag = enabled, and consumers gate on
 * explicit `false` only. Opt-in flags (`trackHistory`, `files`) default to
 * `false`.
 *
 * `.strict()`: unknown keys (incl. the retired `trash` / `mru`, #2377) are
 * rejected with guidance, not stripped (#1535).
 *
 * Closed with the shared `strictObject` template since #6805 — see
 * {@link CAPABILITIES_HISTORY} for why the fold waited on one sentence, and
 * what changes (and does not) about the message.
 *
 * ⚠️ ORDER IS LOAD-BEARING here for the same reason it is at
 * `ObjectSchemaBase` (#5593, ~1000 lines below): `strictObject` evaluates its
 * options object at CONSTRUCTION — that is what lets `alias-integrity.test.ts`
 * judge the table against the real `.shape` — so both
 * `CAPABILITIES_RETIRED_KEY_GUIDANCE` and `CAPABILITIES_HISTORY` must be
 * declared ABOVE this site. Moving either below it reintroduces the temporal
 * dead zone as a module-init crash under `OS_EAGER_SCHEMAS=1` (how
 * `build-schemas.ts` runs), which the test suite does not reach because tests
 * import lazily.
 *
 * @example
 * {
 *   trackHistory: true,
 *   searchable: true,
 *   apiEnabled: true,
 *   activities: false
 * }
 */
export const ObjectCapabilities = strictObject({
  surface: '`enable`',
  history: CAPABILITIES_HISTORY,
  guidance: CAPABILITIES_RETIRED_KEY_GUIDANCE,
}, {
  /**
   * History tracking (Audit Trail) master switch — opt-in.
   *
   * Contract: `true` surfaces the record History tab (audit-trail UI) in the
   * console. Pair with per-field `trackHistory: true` to select which field
   * diffs render as human-readable timeline summaries (ADR-0052 §5b). Audit
   * *capture* into `sys_audit_log` is a compliance ledger and stays on
   * regardless of this flag; retention is governed by data lifecycle
   * (ADR-0057), not by hiding the UI.
   */
  trackHistory: z.boolean().default(false).describe('Show the record History tab (audit-trail UI). Pair with per-field trackHistory to pick which field diffs are summarized; audit capture itself is always on for compliance'),

  /** Enable global search indexing */
  searchable: z.boolean().default(true).describe('Index records for global search'),

  /** Enable REST/GraphQL API access */
  apiEnabled: z.boolean().default(true).describe('Expose object via automatic APIs'),

  /**
   * API Supported Operations
   * Granular control over API exposure — a whitelist over the SIX PRIMITIVES
   * (#3391/#3543): `undefined` = unrestricted, `[]` = deny-all, a subset = the
   * derived closure (see `api-derivation.ts`). Retired legacy values are
   * stripped at parse by {@link stripLegacyApiMethods} (permanent tolerance
   * for stored metadata); the cast below keeps the AUTHORING type at the six
   * primitives so TS authors get the compile-time migration signal instead of
   * the `unknown` input a raw `z.preprocess` would infer.
   */
  apiMethods: (z.preprocess((raw) => stripLegacyApiMethods(raw), z.array(ApiMethod))
    .optional() as unknown as z.ZodOptional<z.ZodType<ApiMethod[], ApiMethod[]>>)
    .describe('Whitelist of allowed API operations (six primitives; undefined = all, [] = none)'),

  /**
   * Generic Attachments panel (Salesforce "Notes & Attachments" parity) —
   * opt-in.
   *
   * Contract (#2727): `true` surfaces the record Attachments panel in the
   * console (upload/list/download/delete over `sys_attachment` join rows)
   * and permits `sys_attachment` rows to target this object; anything else
   * rejects new attachments server-side (403 FILES_DISABLED, enforced at
   * the engine hook seam by plugin-audit — opt-in means explicit).
   * `Field.file` / `Field.image` column attachments are independent of
   * this flag.
   */
  files: z.boolean().default(false).describe('Generic record Attachments panel (sys_attachment). Opt-in: true surfaces the panel and permits attachments targeting this object; otherwise creation is rejected. Field.file/Field.image are independent'),

  /**
   * Social collaboration (Comments, Mentions, Feeds) — opt-out.
   *
   * Contract: default on. An explicit `false` hides the record feed UI and
   * rejects new `sys_comment` rows targeting this object (403
   * FEEDS_DISABLED, enforced at the engine hook seam by plugin-audit).
   */
  feeds: z.boolean().default(true).describe('Record comments/collaboration feed. Default on; explicit false hides the feed UI and rejects new comments for this object'),

  /**
   * Activity timeline (sys_activity mirror of create/update/delete) — opt-out.
   *
   * Contract: default on. An explicit `false` stops plugin-audit from
   * mirroring this object's CRUD into `sys_activity` (the record timeline)
   * and hides the timeline merge in the console. The off-switch is also the
   * per-object lever for activity-row growth (ADR-0057).
   */
  activities: z.boolean().default(true).describe('Record activity timeline (sys_activity mirror of CRUD). Default on; explicit false stops mirroring and hides the timeline'),

  /** Allow cloning records */
  clone: z.boolean().default(true).describe('Allow record deep cloning'),
});

/**
 * Schema for database indexes.
 *
 * The declaration surface is exactly what the driver materializes:
 * `name` / `fields` / `unique` (ADR-0120 scope). Nothing else — see the
 * retirement note below.
 *
 * @example
 * {
 *   name: "idx_account_name",
 *   fields: ["name"],
 *   unique: true
 * }
 *
 * ## `type` / `partial` were RETIRED at protocol 17 (#5248, #4943, ADR-0049)
 *
 * Both were authorable and had **zero** DDL consumers.
 * `SqlDriver.syncDeclaredIndexes` builds every declared index through knex's
 * `table.unique(fields, { indexName })` / `table.index(fields, name)`, and the
 * differ's `DeclaredIndexInput` (`driver-sql/src/schema-drift.ts`) carries
 * `name` / `fields` / `unique` / `nullSafeColumns` — neither key ever reached
 * a `CREATE INDEX`. `type` was the louder of the two because it also carried
 * `.default('btree')`, so it appeared in *every* parse output: a knob that had
 * never influenced a single statement, rendered as live configuration. That is
 * the exact shape ADR-0078 (no-silently-inert-metadata) and ADR-0049
 * (enforce-or-remove) exist to delete.
 *
 * The maintainer chose **remove** over **enforce** (2026-08-06, #5248):
 * enforcing would mean per-dialect algorithm mapping (`gin`/`gist` Postgres-only,
 * `fulltext` MySQL-only), raw-SQL `CREATE INDEX … WHERE` (MySQL has no partial
 * index at all), and a redesign of how `isSyncReproducibleIndex` excludes
 * partial indexes from incremental sync — real design cost for a capability
 * nothing has asked for. If a genuine need appears, it comes back enforce-first.
 *
 * Replacements: an index **method** is the driver/dialect's choice, not a
 * declaration-surface concern. A **partial** index is built at the database
 * layer (a runtime migration issuing `CREATE UNIQUE INDEX … WHERE`, the way
 * `metadata-protocol`'s `ensureOverlayIndex` does for `sys_metadata`); drift
 * detection's exemption for DB-authored partial indexes is unaffected —
 * `isSyncReproducibleIndex` reads a boolean parsed out of the database's OWN
 * DDL (`parseIndexDdl`), which never had anything to do with this string.
 *
 * ⚠️ The tombstones sit at the BOTTOM of the shape deliberately (#5606): the
 * docs renderer prints only the first `INLINE_KEY_LIMIT` keys of an inline
 * shape and has no `z.never()` branch, so a tombstone high in the shape prints
 * as `any` and reads as a free-form slot.
 *
 * ## Closed at #4001 批 20 site 14 — the batch's held site, after its producer converged
 *
 * This shape was 批 20's ONE deliberately-open site. The console's embedded
 * index editor (`objectui` → `metadata-admin/EmbeddedItemEditor.tsx`,
 * `FALLBACK_SCHEMAS.index`) ships its own hand-copied JSON-Schema for this
 * shape — the framework publishes none, because `index` is an embedded-only
 * sub-type with no metadata type of its own — and that copy had drifted: it
 * offered **`where`** for the partial predicate and **`brin`** in the
 * algorithm enum, spliced its form output into `object.indexes[]`, and PUT
 * the WHOLE object. Closing the shape while those controls rendered would
 * have turned an admin's clean save into a 422 on a control the console
 * itself drew (the #5114 class), so the strip was held until the producer
 * was fixed (contract-first: the drift was in the copy, not here).
 *
 * objectui#4772 (#5247's fix) deleted both drifted controls — the fallback
 * now offers exactly `name` / `fields` / `unique`, converged to this schema —
 * so the hold's evidence is spent and the shape is `strictObject` like its
 * thirteen siblings. `where` keeps a curated `guidance` entry rather than a
 * rename suggestion: the predicate never reached any DDL under EITHER
 * spelling (`syncDeclaredIndexes` consumes `name`/`fields`/`unique` only),
 * and the replacement is a database-layer migration, not another key — a
 * rename onto the retired `partial` tombstone would be the campaign's
 * finding 7 (a suggestion pointing into a second rejection).
 */
export const IndexSchema = lazySchema(() => strictObject({
  surface: 'this index',
  history:
    'Until #4001 批 20 closed this site (its held 14th, closed once objectui#4772 ' +
    "converged the console's drifted index editor), an unknown key here was dropped " +
    'silently: the index still parsed and registered, minus whatever the author ' +
    'believed the key did.',
  guidance: {
    where:
      '`where` has never been an index key in this protocol — it was the console ' +
      "fallback editor's drifted spelling for a partial-index predicate (objectui#4772 " +
      'removed the control), and no driver ever emitted a predicate under either ' +
      'spelling. Delete the key. A partial index is built at the database layer, not ' +
      'the declaration surface: issue `CREATE [UNIQUE] INDEX … WHERE <predicate>` from ' +
      "a runtime migration (what `metadata-protocol`'s `ensureOverlayIndex` already " +
      'does for `sys_metadata`).',
  },
}, {
  name: z.string().optional().describe('Index name (auto-generated if not provided)'),
  fields: z.array(z.string()).describe('Fields included in the index'),
  // Unique scope on a DECLARED index (ADR-0120 D1, amending #3696):
  //
  //   - `'global'` — the VERBATIM contract: materialized over exactly the
  //     columns listed in `fields`, no organization column injected. Correct
  //     for genuinely installation-wide reservations (a DNS hostname, a
  //     reserved slug, an external provider id, every engine dedup key).
  //   - `'organization'` — one holder per organization: the driver prepends
  //     the organization key part to the listed columns at REGISTRATION,
  //     where tenancy is known (authoring-time inference is impossible —
  //     `organization_id` is kernel-injected, not authored). The key part is
  //     NULL-safe — `COALESCE(organization_id, '__global__')` (ADR-0120 D3,
  //     #5030): NULL-organization rows form one platform bucket instead of
  //     escaping the constraint under SQL's NULL-distinct semantics.
  //     Materialization lands with #5030's driver PR. On an object with no
  //     organization column it degrades to the listed columns alone,
  //     mirroring field-level behavior.
  //   - bare `true` — the DEPRECATED positional spelling of `'global'`
  //     (today's verbatim behavior, unchanged). It is the spelling whose
  //     meaning was encoded by position — the #4986 trap — so 17.x warns
  //     (lint `unique/unscoped-declared-index`) and protocol 18 rejects it
  //     with a prescriptive error (#5082). State the scope.
  //
  // The old advice "spell a per-tenant index as
  // `fields: ['organization_id', 'code']`" survives as valid legacy input,
  // but new code says `unique: 'organization'` — the hand-written composite
  // is NOT NULL-safe (#5030).
  unique: UniqueScopeSchema.optional().default(false).describe("Whether the index enforces uniqueness, and at which scope (ADR-0120). 'global' = materialized over exactly `fields`, no organization column injected — one holder across the whole installation; 'organization' = the driver prepends the NULL-safe organization key part (COALESCE(organization_id, '__global__')) at registration — one holder per organization; bare true = deprecated positional spelling of 'global' (warned in 17.x by lint unique/unscoped-declared-index, rejected at protocol 18, #5082) — state the scope. 'tenant'/'org' are rejected — the word is 'organization'"),

  // ── Tombstones (ADR-0049 / ADR-0087) ─────────────────────────────────
  // Kept LAST in the shape on purpose — see the #5606 note in the block
  // comment above. `IndexSchema` is not `.strict()`, so a plain delete would
  // make Zod strip an authored value silently, which is the same no-op these
  // keys already were (#3726 / #3733, the ADR-0104 class). The tombstone
  // makes the removal audible in the two channels an upgrading author
  // actually reads: `tsc` (input type `never`) and the parse itself.
  // `object-index-type-partial-removed` strips both from stored/authored
  // sources on the protocol-17 migration.
  type: retiredKey(
    '`indexes[].type` was removed in @objectstack/spec 17.0.0 (#5248, ADR-0049) — no driver ever ' +
    'read it. `SqlDriver.syncDeclaredIndexes` creates every declared index through knex\'s ' +
    '`table.index()` / `table.unique()`, which cannot express an access method, so the value ' +
    'changed no DDL; its `.default(\'btree\')` merely made an inert knob show up in every parse ' +
    'output. Delete the key. The index method is the driver/dialect\'s decision (Postgres ' +
    'defaults to B-tree; `gin`/`gist`/`fulltext` are dialect-specific and are chosen by a ' +
    'database-layer migration when a workload actually needs one). ' +
    'Run `os migrate meta --from 16` to rewrite existing sources automatically.',
  ),
  partial: retiredKey(
    '`indexes[].partial` was removed in @objectstack/spec 17.0.0 (#5248, #4943, ADR-0049) — no ' +
    'driver ever emitted the `WHERE` clause, so a declared partial index was materialized as a ' +
    'FULL index and the predicate silently did nothing. Delete the key. Partial indexes are ' +
    'built at the database layer, not the declaration surface: issue `CREATE [UNIQUE] INDEX … ' +
    'WHERE <predicate>` from a runtime migration (this is what `metadata-protocol`\'s ' +
    '`ensureOverlayIndex` already does for `sys_metadata`). Drift detection is unaffected — it ' +
    'reads partiality back from the database\'s own DDL, never from this key. ' +
    'Run `os migrate meta --from 16` to rewrite existing sources automatically.',
  ),
}));

/**
 * Tombstones for RETIRED tenancy keys — same doctrine as the top-level
 * `UNKNOWN_KEY_GUIDANCE` map below: a retired key's rejection must carry the
 * upgrade prescription, because the parse error is the one channel every
 * consumer bumping `@objectstack/spec` is guaranteed to hit. Removed after
 * spec 15.0 by owner decision #2763 (enforce-or-remove, ADR-0049; precedent
 * ADR-0056 D8 — compliance-grade config must never merely look live).
 */
const TENANCY_RETIRED_KEY_GUIDANCE: Record<string, string> = {
  strategy:
    '`tenancy.strategy` was removed from @objectstack/spec after v15.0 (#2763) — it ' +
    'never had a consumer. The platform has exactly two tenancy modes and neither is ' +
    'object-level config: database-per-tenant isolation is an environment/deployment ' +
    'choice (each environment carries its own database URL), and row-level isolation ' +
    'is `tenancy.enabled` + `tenancy.tenantField`. Delete the key.',
  crossTenantAccess:
    '`tenancy.crossTenantAccess` was removed from @objectstack/spec after v15.0 (#2763) — it ' +
    'never had a consumer; setting it granted nothing. Cross-tenant visibility is ' +
    'governed by sharing rules / OWD (ADR-0056), `externalSharingModel` (ADR-0090 ' +
    'D11), and the object access posture. Delete the key.',
};

/**
 * The standing two-modes explainer, emitted LAST on every `tenancy` rejection.
 *
 * It occupies the template's `history` slot, which is the slot for exactly this
 * — the one sentence of standing background that follows both fix channels
 * (#5955 / #6416). It is background rather than history in the literal sense,
 * and that is fine: the contract the slot encodes is *position*, and this
 * sentence is the thing that must not sit in front of a key's own prescription.
 * On the single-line renders several consumers use (`os validate`'s
 * `• where: message`, CI logs) it used to bury each bullet behind ~160
 * characters.
 */
const TENANCY_MODES_EXPLAINER =
  'The two supported tenancy modes are: database-per-tenant = environment-level '
  + 'deployment (no object config); row-level isolation = `tenancy.enabled` + '
  + '`tenancy.tenantField`.';

/**
 * Multi-Tenancy Configuration Schema
 * Row-level tenant isolation for shared-database SaaS applications: the
 * tenant field is injected on write and enforced on read (RLS predicate).
 * Platform objects declare `enabled: false` to opt out of org row-scoping
 * (environment-level objects). Database-per-tenant isolation is NOT object
 * metadata — it is an environment/deployment choice.
 *
 * `.strict()`: unknown keys (incl. the retired `strategy` /
 * `crossTenantAccess`, #2763) are rejected with guidance, not stripped (#1535).
 *
 * Closed with the shared `strictObject` template since #6619. The tombstone
 * bullets and the trailing explainer are byte-for-byte what the hand-written
 * `strictTenancyError` emitted; what the fold changes is the *other* key — a
 * near-miss like `tenantfield` now resolves to `tenantField` through the
 * template's rename channel instead of being told only that it "is not a
 * `tenancy` key", which named the problem and never the fix. Folding it in is
 * also what puts this table under `alias-integrity.test.ts`, which no
 * hand-rolled map has ever been judged by.
 *
 * `tenantField` carries **no default** (#5315). It used to default to
 * `'tenant_id'`, which no consumer could act on: the platform's tenant column
 * is `organization_id` (kernel-injected; the same column `tenantPolicy()` in
 * `security/rls.zod.ts` and the RLS predicates assume), and the SQL driver's
 * `computeTenantField` honours a declared name only when the object actually
 * has that field — so the materialized `'tenant_id'` merely sent it looking for
 * a column that did not exist before falling back to `organization_id` anyway.
 * A declaration nobody reads is exactly what ADR-0078 prohibits, and `tenant`
 * is a word ADR-0120 §Terminology refuses for the authorable vocabulary
 * (`organization` is the product's noun). Undeclared now stays `undefined` and
 * the driver's fallback is the single source of truth.
 *
 * `organizationField` (#8707 / #8778, maintainer-ruled option A) is the
 * STAMP-ONLY sibling: it answers "which column says who this row is ABOUT",
 * where `tenantField` answers "what is this object WALLED by". For ordinary
 * objects the two coincide and `organizationField` is never needed; for
 * credential tables they deliberately do not — `sys_api_key` records the
 * organization a key authenticates into under `active_organization_id`
 * precisely so the credential table does NOT become org-walled (#8287). The
 * key is consulted exclusively by audit stamping (plugin-audit's
 * `resolveRecordOrganizationField`); no read path reads it, and that
 * read-neutrality is pinned by tests beside each read path. ⛔ Scope-pinned by
 * the #8778 ruling: this is ONE stamp-only declaration key, not the opening
 * move of a general field-roles mechanism — a consumer other than audit
 * stamping needs its own ruling before reading it.
 *
 * @example Shared database, platform-default tenant column (organization_id)
 * {
 *   enabled: true
 * }
 *
 * @example An object whose tenant column is genuinely not organization_id
 * {
 *   enabled: true,
 *   tenantField: 'workspace_id'
 * }
 *
 * @example An unwalled credential table whose audit rows still stamp the
 * organization of the record they describe (sys_api_key, #8778)
 * {
 *   enabled: false,
 *   organizationField: 'active_organization_id'
 * }
 */
export const TenancyConfigSchema = lazySchema(() => strictObject({
  surface: '`tenancy`',
  history: TENANCY_MODES_EXPLAINER,
  guidance: TENANCY_RETIRED_KEY_GUIDANCE,
}, {
  enabled: z.boolean().describe('Enable multi-tenancy for this object'),
  tenantField: z.string().optional().describe(
    'Column this object is tenant-scoped by. Omit it unless the tenant column ' +
    "genuinely is not the platform's: when undeclared the driver falls back to " +
    '`organization_id`, the kernel-injected column the RLS predicates and ' +
    '`tenantPolicy()` also assume. A declared name is honoured only when the ' +
    'object really has that field — otherwise the same `organization_id` ' +
    'fallback applies. No default is materialized here on purpose (#5315).',
  ),
  organizationField: z.string().optional().describe(
    'STAMP-ONLY (#8778): column carrying the organization a row is ABOUT, ' +
    'consulted exclusively when audit rows are stamped. It does NOT ' +
    'tenant-scope anything — no read path (`applyTenantScope`, ' +
    '`injectTenantOnInsert`, `computeTenantLayer0Filter`) reads it, so ' +
    'declaring it never walls the object and never hides rows. Declare it ' +
    'only when the organization a row belongs to lives under a column that ' +
    'deliberately is NOT the tenant column: `sys_api_key` is the shipped ' +
    'example — a credential table that must stay unwalled (`enabled: false`) ' +
    'while history/revocation audit rows stamp the organization of the key ' +
    'they describe (`active_organization_id`). Ordinary tenant objects omit ' +
    'it; their stamp column is resolved from `tenantField` / ' +
    '`organization_id` already. Honoured only when the object really has ' +
    'the field, like `tenantField`.',
  ),
}));

/**
 * [ADR-0066] Platform-global posture: `tenancy.enabled === false` explicitly
 * opts the object out of row-level org scoping, even when it carries an
 * `organization_id` column (e.g. `sys_license` keeps an optional owner FK).
 * Single source of truth for the registry (tenant-column injection), the
 * ObjectQL engine (tenantId propagation into driver options), and drivers
 * (native scoping) — previously each re-derived `tenancy?.enabled === false`
 * independently and could drift (#3249).
 */
export function isTenancyDisabled(schema: unknown): boolean {
  return (schema as { tenancy?: { enabled?: boolean } } | null | undefined)?.tenancy?.enabled === false;
}

/**
 * [ADR-0066 D2] Secure-by-default object posture.
 *
 * Declares whether the object participates in blanket wildcard permission
 * grants — a data-model posture like {@link TenancyConfigSchema}, NOT an
 * assignment (it names no principal).
 *
 * - `public` (default) — covered by a permission set's `'*'` wildcard object
 *   grant; today's allow-by-default behaviour.
 * - `private` — NOT covered by the `'*'` wildcard grant; access requires an
 *   EXPLICIT per-object grant (Salesforce "new object = no access until
 *   granted"). A `private` object is ALSO exempt from wildcard RLS
 *   (`tenant_isolation`, owner scoping): the posture-gated superuser bypass
 *   (`viewAllRecords`/`modifyAllRecords`) short-circuits RLS, so a platform
 *   admin — incl. one who is also an org admin whose `tenant_isolation` would
 *   otherwise narrow the result — sees all rows, while non-admins without an
 *   explicit grant see none.
 *
 * Pair with the object's `requiredPermissions` (D3) to additionally gate access
 * on holding a capability.
 */
export const ObjectAccessConfigSchema = lazySchema(() => strictObject({
  surface: "this object's `access` block",
  history:
    'Until #4001 these were dropped silently — the block still parsed, so an object the ' +
    'author declared `private` shipped `public`: covered by every `\'*\'` wildcard grant, ' +
    'with no signal that the posture had been discarded.',
  aliases: {
    visibility: 'default',
    posture: 'default',
    defaultAccess: 'default',
  },
  guidance: {
    // Wrong-layer, not typos: both are real TOP-LEVEL object keys, and both
    // are the neighbouring half of the same access story — so edit distance
    // would never reach them and a bare rejection would read as "no such
    // concept" when the concept exists one level up.
    sharingModel:
      '`sharingModel` is the object-wide default record visibility (OWD) and is a ' +
      'TOP-LEVEL object key, not an `access` key — write it beside `access`, not inside ' +
      'it. `access.default` decides wildcard-GRANT coverage; `sharingModel` decides ' +
      'record visibility between users (ADR-0090).',
    requiredPermissions:
      '`requiredPermissions` is a TOP-LEVEL object key (ADR-0066 D3) — it gates access on ' +
      'the caller HOLDING a capability, which is a different axis from `access.default` ' +
      '(whether a wildcard grant covers this object at all). Pair them, side by side.',
  },
}, {
  default: z.enum(['public', 'private']).default('public')
    .describe('Default exposure posture: public (covered by wildcard grants) | private (needs explicit grant; exempt from wildcard RLS).'),
}));

/**
 * [ADR-0066 ⑤] Per-operation capability requirements for an object. Each key
 * lists the capabilities a caller must hold for that operation CLASS; an absent
 * key means that operation carries no capability gate. Lets an object be
 * "read-open / write-gated" (Salesforce & Dataverse separate capability by
 * operation) instead of the flat all-CRUD gate the `string[]` form applies.
 * Operation→class mapping mirrors the CRUD permission bits: `transfer`/`restore`
 * fold into `update`, `purge` into `delete`. `.strict()` so a mistyped key
 * (e.g. `reads`) is rejected at author time rather than silently ignored.
 *
 * ⚠️ This site is `scripts/strictness-ledger.test.ts`'s fixture for the OLDER
 * `z.object(…).strict()` spelling — the reading the ledger's AST walker has to
 * keep making, and `packages/spec` is not the only tree it reads. The fixture
 * has moved twice as the campaign converted its predecessors
 * (`security/permission.zod.ts` → `TenancyConfigSchema` at #5593 →
 * `ObjectCapabilities` at #6619 → here at #6805). If THIS one is ever
 * converted, move the fixture again rather than deleting the assertion.
 */
export const PerOperationRequiredPermissionsSchema = z.object({
  read: z.array(z.string()).optional().describe('Capabilities required to read (find/findOne/count/aggregate).'),
  create: z.array(z.string()).optional().describe('Capabilities required to create (insert).'),
  update: z.array(z.string()).optional().describe('Capabilities required to update (update/transfer/restore).'),
  delete: z.array(z.string()).optional().describe('Capabilities required to delete (delete/purge).'),
}).strict();

/**
 * [ADR-0066 D3/⑤] Object capability contract — either capabilities required for
 * ALL operations (`string[]`, the original shape) or a per-operation map
 * (narrows the gate by operation). See the field doc on `Object.requiredPermissions`.
 */
export const ObjectRequiredPermissionsSchema = z.union([
  z.array(z.string()),
  PerOperationRequiredPermissionsSchema,
]);
export type PerOperationRequiredPermissions = z.input<typeof PerOperationRequiredPermissionsSchema>;
export type ObjectRequiredPermissions = z.input<typeof ObjectRequiredPermissionsSchema>;

/**
 * Data Lifecycle (ADR-0057)
 *
 * Declares how long an object's data lives and how its space is reclaimed —
 * the axis validation/permissions never covered. Enforced at runtime by the
 * platform-owned LifecycleService (`@objectstack/objectql`): Reaper (TTL/age
 * batch delete), Rotator (time-shard + DROP oldest on SQLite, an age-based
 * reap of the same window elsewhere), Archiver (cold-store
 * copy then delete). A declared policy with no runtime consumer is a spec
 * defect (ADR-0049 enforce-or-remove); the liveness gate requires every
 * non-`record` class to declare `retention`, `ttl`, or rotation `storage`.
 */

/**
 * Lifecycle class — what persistence contract the object's data carries.
 *
 * | class       | contract                                        |
 * |-------------|-------------------------------------------------|
 * | `record`    | business truth — permanent, recoverable          |
 * | `audit`     | compliance ledger — retain → archive → delete    |
 * | `telemetry` | high-frequency log — rotation, short retention   |
 * | `transient` | ephemeral state — TTL auto-expire                |
 * | `event`     | event-bus messages — very short TTL              |
 *
 * `record` is the back-compat default: an object with no `lifecycle` block
 * behaves exactly as today (immortal data).
 */
export const LifecycleClassSchema = z.enum(['record', 'audit', 'telemetry', 'transient', 'event']);

/**
 * Duration literal: `<n><unit>` where unit is h(ours), d(ays), w(eeks) or
 * y(ears) — e.g. `'6h'`, `'14d'`, `'12w'`, `'7y'`. Parsed by
 * `@objectstack/objectql` `parseLifecycleDuration`.
 */
export const LIFECYCLE_DURATION_REGEX = /^\d+(h|d|w|y)$/;
const lifecycleDuration = (what: string) =>
  z.string().regex(LIFECYCLE_DURATION_REGEX, `${what} must be a duration literal like '6h', '14d', '12w' or '7y'`);

export const LifecycleSchema = lazySchema(() => strictObject({
  surface: "this object's `lifecycle` block",
  history:
    'Until #4001 these were dropped silently — the block still parsed, so a bounding ' +
    'policy written one level too high left the object with NO policy at all. ADR-0057 ' +
    "§3.5's own refine then passed, because the key it looks for was never there.",
  aliases: { rotation: 'storage' },
  guidance: {
    // The dominant failure on this block is FLATTENING: every one of these is a
    // real key of a real sub-block, written one level too high. Edit distance
    // cannot help — the key is spelled correctly, it is just in the wrong
    // object — and the §3.5 refine makes the mistake worse than inert: a
    // flattened `maxAge` leaves `retention` absent, so a non-`record` class is
    // then rejected as unbounded and the author is told about the wrong key.
    maxAge:
      '`maxAge` belongs to the retention block, one level down: ' +
      "`retention: { maxAge: '30d' }`. Written here it is not read, and a non-`record` " +
      'class with no `retention`/`ttl`/`storage` is rejected as unbounded (ADR-0057 §3.5).',
    expireAfter:
      '`expireAfter` belongs to the TTL block, one level down: ' +
      "`ttl: { field: 'expires_at', expireAfter: '1d' }`.",
    field:
      '`field` belongs to the TTL block, one level down — it names the timestamp the TTL ' +
      "is measured from: `ttl: { field: 'expires_at', expireAfter: '1d' }`.",
    after:
      '`after` belongs to the archive block, one level down: ' +
      "`archive: { after: '7y', to: 'cold_store' }` — and ADR-0057 requires it to EQUAL " +
      '`retention.maxAge`.',
    to:
      '`to` belongs to the archive block, one level down — it names the cold-storage ' +
      "datasource: `archive: { after: '7y', to: 'cold_store' }`.",
    keep:
      '`keep` belongs to the archive block, one level down — it is how long COLD rows are ' +
      'kept. The HOT window is `retention.maxAge`.',
    strategy:
      '`strategy` belongs to the storage block, one level down: ' +
      "`storage: { strategy: 'rotation', shards: 7, unit: 'day' }`.",
    shards:
      '`shards` belongs to the storage block, one level down: ' +
      "`storage: { strategy: 'rotation', shards: 7, unit: 'day' }`.",
    unit:
      '`unit` belongs to the storage block, one level down: ' +
      "`storage: { strategy: 'rotation', shards: 7, unit: 'day' }`.",
  },
}, {
  class: LifecycleClassSchema.describe(
    'Persistence contract: record (business truth, permanent) | audit (compliance ledger) | telemetry (high-freq log) | transient (ephemeral state) | event (bus messages).',
  ),
  retention: strictObject({
    surface: "this object's `lifecycle.retention` block",
    history:
      'Until #4001 these were dropped silently — the retention window still parsed, so a ' +
      'row filter written under the wrong key reaped rows the author had meant to exempt.',
    aliases: { filter: 'onlyWhen', where: 'onlyWhen', when: 'onlyWhen', age: 'maxAge' },
    guidance: {
      expireAfter:
        '`expireAfter` is a `ttl` key, not a retention key. Retention reaps by AGE from ' +
        '`created_at` (`maxAge`); TTL expires each row relative to a timestamp field you ' +
        'name (`ttl.field`). Pick the one that matches how the rows die.',
      keep:
        '`keep` is an `archive` key — how long COLD rows survive. The hot window is ' +
        '`retention.maxAge`.',
    },
  }, {
    maxAge: lifecycleDuration('retention.maxAge').describe('Rows older than this (by created_at) are deleted by the Reaper — or archived first when `archive` is set.'),
    onlyWhen: z.record(
      z.string(),
      z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.object({ $in: z.array(z.union([z.string(), z.number()])).min(1) }).strict(),
      ]),
    ).optional().describe(
      'Row filter the retention applies to — per-field equality or {$in: [...]} (e.g. { status: { $in: ["completed", "failed"] } }). Rows OUTSIDE the filter are retained regardless of age: for tables that interleave live workflow state with terminal history (sys_automation_run). Incompatible with rotation storage and archive, which act on whole shards / age alone.',
    ),
  }).optional().describe('Age-based retention window enforced by the LifecycleService Reaper.'),
  ttl: strictObject({
    surface: "this object's `lifecycle.ttl` block",
    history:
      'Until #4001 these were dropped silently — the TTL block still parsed, so rows the ' +
      'author expected to auto-expire lived forever.',
    aliases: { expiresAfter: 'expireAfter', after: 'expireAfter', timestampField: 'field', on: 'field' },
    guidance: {
      maxAge:
        '`maxAge` is a `retention` key, not a TTL key. TTL measures from the timestamp ' +
        'field named in `ttl.field`; retention measures AGE from `created_at`. For ' +
        "age-based reaping write `retention: { maxAge: '30d' }` instead.",
    },
  }, {
    field: z.string().describe('Timestamp field the TTL is measured from (e.g. created_at, expires_at).'),
    expireAfter: lifecycleDuration('ttl.expireAfter').describe('Rows expire this long after `field` and are deleted by the Reaper.'),
  }).optional().describe('Per-row TTL auto-expiry (transient/event classes).'),
  storage: strictObject({
    surface: "this object's `lifecycle.storage` block",
    history:
      'Until #4001 these were dropped silently — the rotation block still parsed, so a ' +
      'telemetry table declared as rotating kept every shard it ever cut.',
    aliases: { count: 'shards', interval: 'unit', period: 'unit', granularity: 'unit' },
    guidance: {
      maxAge:
        '`maxAge` is a `retention` key. Rotation takes its window from `shards` × `unit`, ' +
        'not from an age you name — reclaimed by DROPping the oldest shard whole on SQLite, ' +
        'by an equivalent age-based reap elsewhere. Set the window ' +
        'with `shards`/`unit`, or use `retention` instead of rotation.',
    },
  }, {
    strategy: z.literal('rotation').describe(
      'Time-shard the table. The retained window (`shards` × `unit`) is the same on every ' +
      'dialect; the reclamation is not — SQLite DROPs the oldest shard whole (O(1) reclaim), ' +
      'other dialects reap that same window by age from `created_at`.',
    ),
    shards: z.number().int().min(2).describe('Number of shards retained; total window = shards × unit.'),
    unit: z.enum(['day', 'week', 'month']).describe('Time width of one shard.'),
  }).optional().describe('Physical storage strategy for high-frequency telemetry (LifecycleService Rotator).'),
  archive: strictObject({
    surface: "this object's `lifecycle.archive` block",
    history:
      'Until #4001 these were dropped silently — the archive block still parsed, so audit ' +
      'rows were reaped hot with no cold copy ever written.',
    aliases: { datasource: 'to', target: 'to', destination: 'to', retain: 'keep' },
    guidance: {
      maxAge:
        '`maxAge` is a `retention` key. The archive boundary is `archive.after`, and ' +
        'ADR-0057 requires the two to be EQUAL — the hot window ends exactly where the ' +
        'archive begins, so declare `retention.maxAge` and `archive.after` with the same value.',
    },
  }, {
    after: lifecycleDuration('archive.after').describe('Rows older than this are copied to the archive datasource before hot deletion.'),
    to: z.string().describe('Target datasource name for cold storage. When it is not registered, the Archiver skips (audit rows are then retained, never dropped unarchived).'),
    keep: lifecycleDuration('archive.keep').optional().describe('How long archived rows are kept in cold storage (undefined = forever).'),
  }).optional().describe('Cold-store archival (LifecycleService Archiver) — audit-class hot→cold hand-off.'),
  reclaim: z.boolean().optional().describe('Run driver space reclamation (SQLite incremental_vacuum) after sweeping this object. Default true for non-record classes.'),
}).superRefine((lc, ctx) => {
  // ADR-0057 §3.5: a non-`record` lifecycle class with no bounding policy is a
  // false surface — the object would still grow forever. Enforce-or-remove.
  if (lc.class !== 'record' && !lc.retention && !lc.ttl && !lc.storage) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `lifecycle.class '${lc.class}' requires at least one bounding policy: retention, ttl, or storage (rotation) — ADR-0057 §3.5`,
    });
  }
  if (lc.class === 'record' && (lc.retention || lc.ttl || lc.storage || lc.archive)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `lifecycle.class 'record' is permanent business truth — retention/ttl/storage/archive policies are not allowed on it (ADR-0057 §3.1)`,
    });
  }
  if (lc.archive && lc.retention && lc.archive.after !== lc.retention.maxAge) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `lifecycle.archive.after ('${lc.archive.after}') must equal retention.maxAge ('${lc.retention.maxAge}') — the hot window ends where the archive begins`,
    });
  }
  if (lc.retention?.onlyWhen && lc.storage?.strategy === 'rotation') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'lifecycle.retention.onlyWhen cannot be combined with rotation storage — the Rotator DROPs whole shards and would destroy rows the filter protects',
    });
  }
  if (lc.retention?.onlyWhen && lc.archive) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'lifecycle.retention.onlyWhen cannot be combined with archive — the Archiver moves rows by age alone and would archive rows the filter protects',
    });
  }
}));

/**
 * Object Field Group Schema — MVP (data-layer protocol)
 * 
 * Declares the set of logical field groups for an object. A group bundles
 * related fields together for presentation in forms, detail pages, and
 * editors (e.g., "Contact Info", "Billing", "System").
 * 
 * Design rules (MVP):
 * - Group **order** is the declaration order of this array — no `order` property.
 * - Field → group mapping is derived automatically from `Field.group`
 *   matching `ObjectFieldGroup.key`; the **in-group display order** equals
 *   the traversal order of `ObjectSchema.fields`.
 * - Fields whose `group` is unset (or references an undeclared key) are
 *   considered ungrouped and must be rendered by consumers in a default
 *   bucket after the declared groups, preserving their field declaration order.
 * - Extension packages and runtime code use `Field.group` to assign fields
 *   to an existing group — no per-field order property is introduced at this
 *   layer.
 * 
 * Migration operations supported by this MVP:
 *   - add / rename / delete / reorder groups (via the array)
 *   - assign an existing field to a group (via `Field.group`)
 * 
 * Deferred (not part of MVP):
 *   - explicit per-field in-group ordering
 *   - nested groups / sub-groups
 *   - group-level visibility predicates (a `visibleOn` key existed here
 *     briefly with no consumer anywhere; removed per ADR-0085 / ADR-0049
 *     enforce-or-remove — re-add together with its enforcement when a
 *     surface actually evaluates it)
 *
 * Derivation semantics (declared order, empty groups dropped, ungrouped
 * trailing bucket, collapse passthrough) are single-sourced in
 * `deriveFieldGroupLayout` (field-group-layout.ts, ADR-0085 §5) — UI
 * renderers consume that helper instead of re-implementing the rules.
 *
 * @example
 * ```ts
 * fieldGroups: [
 *   { key: 'contact_info', label: 'Contact Information', icon: 'user' },
 *   { key: 'billing',      label: 'Billing',             collapse: 'collapsed' },
 *   { key: 'system',       label: 'System' },
 * ]
 * ```
 */
export const ObjectFieldGroupSchema = lazySchema(() => strictObject({
  surface: 'this field group',
  history:
    'Until #4001 these were dropped silently — the group still parsed AND still rendered, ' +
    'which is the worst version of the failure: the section appeared, so the author had ' +
    'every reason to believe the setting they wrote had been applied.',
  aliases: {
    title: 'label',
    name: 'key',
    id: 'key',
    help: 'description',
    helpText: 'description',
  },
  guidance: {
    // Membership is declared the OTHER WAY ROUND, and this is the single most
    // likely thing an author reaches for here — a group that lists its fields
    // is what every other layout system in this space looks like.
    fields:
      '`fields` does not live on a group — membership is declared on the FIELD, pointing ' +
      "back: `fields: { email: { type: 'email', group: 'contact_info' } }`. The group " +
      'declares only its `key`, `label` and presentation; `deriveFieldGroupLayout` ' +
      '(ADR-0085 §5) does the assembly.',
    order:
      '`order` is not a group key — ARRAY ORDER is display order. `fieldGroups: [...]` ' +
      'renders top to bottom, so move the entry rather than numbering it.',
    expanded:
      '`expanded` is not a group key — use the `collapse` enum: ' +
      "`collapse: 'expanded'` (collapsible, starts open), `'collapsed'` (starts closed), " +
      "or `'none'` (always open, no toggle).",
    // Tombstone: this key really did exist here, briefly, reading nothing.
    visibleWhen:
      '`visibleWhen` was REMOVED from field groups (ADR-0085 / ADR-0049 enforce-or-remove) ' +
      '— it existed here briefly with no consumer on any surface, so it never gated ' +
      'anything. Gate the individual fields, or assign a Page for per-surface control.',
    visibleOn:
      '`visibleOn` is not a field-group key — group-level visibility predicates were ' +
      'removed under ADR-0085 / ADR-0049 (nothing evaluated them). Gate the individual ' +
      'fields, or assign a Page.',
  },
}, {
  /** Group key — referenced by `Field.group` to assign a field to this group. Must be snake_case. */
  key: z.string().regex(/^[a-z_][a-z0-9_]*$/, {
    message: 'Field group key must be lowercase snake_case (e.g., "contact_info", "billing", "system")',
  }).describe('Group machine key (snake_case). Referenced by Field.group.'),

  /** Human-readable label displayed as the group header. */
  label: z.string().describe('Group display label'),

  /** Optional Lucide/Material icon name for the group header. */
  icon: z.string().optional().describe('Icon name (Lucide/Material) for the group header'),

  /** Optional description / help text shown under the group header. */
  description: z.string().optional().describe('Optional description shown under the group header'),

  /**
   * [ADR-0085] Collapse behaviour of the group's rendered section, on every
   * surface (form, detail, drawer). One enum, three valid states — replaces
   * the old `defaultExpanded` flag AND the UI-dialect `collapsible`/`collapsed`
   * boolean pair, which could express contradictions and had drifted between
   * spec and renderer (spec declared a key no renderer read; renderers read
   * keys the spec rejected).
   */
  collapse: z.enum(['none', 'expanded', 'collapsed']).optional().default('none')
    .describe("[ADR-0085] Section collapse behaviour: 'none' (always open, no toggle), 'expanded' (collapsible, starts open), 'collapsed' (collapsible, starts closed)."),

  /**
   * @deprecated [ADR-0085 → `collapse`] Accepted as a parse-time alias:
   * `defaultExpanded: false` maps to `collapse: 'collapsed'`, `true` to
   * `'expanded'`, when `collapse` is absent. New metadata sets `collapse`.
   */
  defaultExpanded: z.boolean().optional().describe("[DEPRECATED → collapse] true → 'expanded', false → 'collapsed'."),
  /** @deprecated [ADR-0085 → `collapse`] UI-dialect alias (pair with `collapsed`); mapped onto `collapse` at parse. */
  collapsible: z.boolean().optional().describe("[DEPRECATED → collapse] Boolean pair with `collapsed`; use the `collapse` enum."),
  /** @deprecated [ADR-0085 → `collapse`] UI-dialect alias (pair with `collapsible`); mapped onto `collapse` at parse. */
  collapsed: z.boolean().optional().describe("[DEPRECATED → collapse] Boolean pair with `collapsible`; use the `collapse` enum."),
}));

export type ObjectFieldGroup = z.input<typeof ObjectFieldGroupSchema>;
/** Post-parse shape of {@link ObjectFieldGroup} — defaults applied, transforms run (ADR-0122). */
export type ObjectFieldGroupParsed = z.infer<typeof ObjectFieldGroupSchema>;

/**
 * Base Object Schema Definition
 * 
 * The Blueprint of a Business Object.
 * Represents a table, a collection, or a virtual entity.
 * 
 * @example
 * ```yaml
 * name: project_task
 * label: Project Task
 * icon: task
 * fields:
 *   project:
 *     type: lookup
 *     reference: project
 *   status:
 *     type: select
 *     options: [todo, in_progress, done]
 * enable:
 *   trackHistory: true
 *   files: true
 * ```
 */

/**
 * External Binding (ADR-0015)
 *
 * Optional per-object descriptor that binds this object to a remote table
 * on a federated datasource (one whose `schemaMode !== 'managed'`). When
 * present, the object is "external": DDL is forbidden, the table is
 * validated against the remote schema at boot, and writes require a double
 * opt-in (`datasource.external.allowWrites` **and** this `writable`).
 *
 * The cross-field invariant ("`external` only when the object's datasource
 * has `schemaMode !== 'managed'`") is enforced at metadata-load time, not
 * in this schema, because the datasource may live in another artefact.
 */
export const ObjectExternalBindingSchema = strictObject({
  surface: "this object's `external` binding (ADR-0015)",
  history:
    'Until #4001 these were dropped silently — the binding still parsed, so a federated ' +
    'object bound to the wrong remote table, or shipped read-only after the author had ' +
    'explicitly asked for writes.',
  aliases: {
    table: 'remoteName',
    tableName: 'remoteName',
    remoteTable: 'remoteName',
    schema: 'remoteSchema',
    columns: 'columnMap',
    skipColumns: 'ignoreColumns',
    excludeColumns: 'ignoreColumns',
  },
  guidance: {
    // The mirror image of `datasource.zod.ts`'s own `writable → allowWrites`
    // alias. ADR-0015 makes writes a DOUBLE opt-in, so the two spellings are
    // both correct — each on the other layer — and an author who learned one
    // will write it here. Getting this wrong fails open-looking: the object
    // stays read-only and nothing says why.
    allowWrites:
      '`allowWrites` is the DATASOURCE-level gate (`datasource.external.allowWrites`). ' +
      'The per-object opt-in is spelled `writable: true`. ADR-0015 requires BOTH — set ' +
      '`writable` here and `allowWrites` on the datasource; either one alone leaves the ' +
      'object read-only.',
    schemaMode:
      '`schemaMode` is a DATASOURCE key, not an object key — an object becomes external ' +
      "by being routed to a datasource whose `schemaMode !== 'managed'`. This block only " +
      'describes the remote binding once that is true.',
  },
}, {
  remoteName: z.string().optional()
    .describe('Remote table/view name. Defaults to object.name.'),
  remoteSchema: z.string().optional()
    .describe('Remote schema/database qualifier.'),
  writable: z.boolean().default(false)
    .describe('Per-object write opt-in (also requires datasource.external.allowWrites).'),
  columnMap: z.record(z.string(), z.string()).optional()
    .describe('Remote column name → local field name.'),
  introspectedAt: z.string().datetime().optional()
    .describe('Set by `os datasource introspect`; informational.'),
  ignoreColumns: z.array(z.string()).optional()
    .describe('Remote columns to skip during validation (dev convenience).'),
}).describe('External datasource binding (ADR-0015)');

export type ObjectExternalBinding = z.input<typeof ObjectExternalBindingSchema>;
/** Post-parse shape of {@link ObjectExternalBinding} — defaults applied, transforms run (ADR-0122). */
export type ObjectExternalBindingParsed = z.infer<typeof ObjectExternalBindingSchema>;

/**
 * Object form of a `userActions` CRUD override — extends the plain boolean
 * with CEL predicates so a built-in affordance can be hidden or disabled
 * against record state rather than only per object
 * (objectstack-ai/objectui#2614).
 *
 * Semantics (mirrors custom actions' `visible` / `disabled`):
 * - `enabled`      — object-level on/off, same meaning as the bare boolean.
 *                    Omitted → the `managedBy` bucket default.
 * - `visibleWhen`  — CEL over `record.*`; evaluates **false** → the button
 *                    is not rendered. Fail-closed (a faulting predicate
 *                    hides, and warns once).
 * - `disabledWhen` — CEL over `record.*`; evaluates **true** → the button
 *                    renders greyed / non-clickable. Fail-soft (a faulting
 *                    predicate leaves the button enabled).
 *
 * The predicates are advisory UI gating only — server-side enforcement
 * stays with permissions / hooks (e.g. `beforeUpdate` rejecting frozen
 * rows). Evaluation happens on the canonical CEL engine, with the record
 * bound as `record.*` (and bare fields) — the same machinery custom actions
 * already use, so authoring is identical.
 *
 * **What `record.*` binds to depends on where the affordance renders, and
 * the two cases are not the same fact** (#7692):
 * - Row affordances (`edit`, `delete`) evaluate **per row**, against that
 *   row's own record. This is the original #2614 case and the reason for
 *   the `RowCrud` name, kept for export compatibility.
 * - Toolbar affordances (`create`, `import`) have no row to bind — the
 *   record they gate does not exist yet. They evaluate **once per toolbar**
 *   against the record in scope where the toolbar renders: on a record
 *   page's related list that is the **host (parent) record**. On a
 *   standalone object list there is no record in scope, so a predicate
 *   reading `record.*` has nothing to bind and — per the fail-closed rule
 *   above — hides the button. Gate a toolbar action on parent state only
 *   where a parent is actually in scope; anything else the child row must
 *   carry itself (the denormalised parent-status snapshot pattern that
 *   `edit`/`delete` already use).
 */
export const RowCrudActionOverrideSchema = strictObject({
  surface: 'this row CRUD override',
  // Closed from birth (objectui#2614), so nothing was ever silently stripped
  // here — but the rejection was zod's own bare `Unrecognized key: "visible"`,
  // which names neither the surface nor a key to write instead. #7832.
  history:
    'This shape has been closed since objectui#2614, so the key was never silently dropped — '
    + 'until #7832 the rejection just could not tell you which key to write instead.',
  aliases: {
    // `showWhen` carries no boolean reading: whatever surface an author borrowed
    // it from, they meant a predicate, and the predicate slot here is
    // `visibleWhen`. The two keys that DO have both readings are answered by
    // `guidance` below rather than renamed, because a rename has to pick one.
    showWhen: 'visibleWhen',
  },
  guidance: {
    // The near-misses on this surface all arrive from custom row actions
    // (`actions[].visible` / `.disabled`), where ONE key takes either a boolean
    // or a CEL string. This shape splits that pair in two — `enabled` for the
    // object-level switch, `*When` for the per-record predicate — so a rename
    // cannot answer either key without guessing which form the author meant,
    // and guessing wrong just relocates the confusion (#7816's own note: point
    // the boolean reading at `enabled`, not at `visibleWhen`).
    visible:
      '`visible` is the CUSTOM row-action spelling (`actions[].visible`), where one key takes '
      + 'either form. This override splits them: write `enabled: false` for the object-level '
      + 'on/off, or `visibleWhen: <CEL over record.*>` for a per-record predicate (FALSE hides '
      + 'that row\'s button).',
    disabled:
      '`disabled` is the CUSTOM row-action spelling (`actions[].disabled`). The per-record form '
      + 'here is `disabledWhen: <CEL over record.*>` (TRUE renders that row\'s button disabled); '
      + 'there is no boolean `disabled` — switch the affordance off with `enabled: false`.',
  },
}, {
  enabled: z.boolean().optional().describe(
    'Object-level on/off for the generic affordance; same meaning as the bare boolean form. Omitted → managedBy bucket default.',
  ),
  visibleWhen: ExpressionInputSchema.optional().describe(
    'CEL predicate over the record in scope (row record for edit/delete, host record for a related-list create/import toolbar); false → hide the button. Fail-closed.',
  ),
  disabledWhen: ExpressionInputSchema.optional().describe(
    'CEL predicate over the record in scope (row record for edit/delete, host record for a related-list create/import toolbar); true → render the button disabled. Fail-soft.',
  ),
}).describe('Boolean-or-predicates override for a built-in CRUD affordance.');
export type RowCrudActionOverride = z.input<typeof RowCrudActionOverrideSchema>;
/** Post-parse shape of {@link RowCrudActionOverride} — defaults applied, transforms run (ADR-0122). */
export type RowCrudActionOverrideParsed = z.infer<typeof RowCrudActionOverrideSchema>;

/*
 * ── Unknown-key strictness (#4001 registered-types line) ────────────────────
 *
 * `.strict()` HERE, not only in `create()`. #1535 built the unknown-key guard
 * as a hand-rolled check inside the `create()` factory, on the reasoning that
 * "authored `*.object.ts` modules call `create()`". They do — but they are not
 * the only producer, and they are not the path most instances travel:
 * `defineStack({ objects })`, `/api/v1/meta/types/object` and the Studio form
 * all reach this schema through `parse()` / `safeParse()`, which stripped
 * unknown keys in silence for the whole time #1535 was considered fixed. The
 * founding example of #4001 — object-level `workflows: [...]` believed to wire
 * up automation, silently discarded — was still reproducible on `parse()`.
 *
 * `create()` is unaffected: its own check runs BEFORE parsing and throws a
 * richer located Error, so its message still wins where it applies.
 *
 * Safe on the read path for the same reason the other closed registered types
 * are: the ADR-0010 envelope is declared below, and `stripReadDecorations`
 * removes `_diagnostics` / `_draft` before any strict re-parse (cloud#971).
 * Verified empirically rather than assumed — every `ObjectSchema.create()` call
 * across `platform-objects` and the three example apps uses only declared
 * top-level keys.
 */
/**
 * Prescription for the retired `managedBy: 'system'` bucket (#3355, the v17
 * close-out of ADR-0103's v16 split).
 *
 * ADR-0103 split the overloaded `system` bucket ADDITIVELY: the 20 engine-owned
 * objects moved to the new explicit `engine-owned`, and the 8 admin/user-writable
 * ones stayed behind on `system`. That left the name pointing at the half it no
 * longer described — "system" on precisely the objects a user writes — which is
 * the kind of residual overload an author (especially a model author) resolves by
 * guessing. v17 finishes the split by renaming the residue to `system-data` and
 * retiring the bare value.
 *
 * Because v16 already drained the engine side, `system` → `system-data` is a
 * ONE-TO-ONE mechanical replacement: there is no judgement call in the upgrade,
 * which is why the message can prescribe a single answer.
 */
const MANAGED_BY_SYSTEM_RETIRED =
  "`object.managedBy: 'system'` was removed in @objectstack/spec 17 (#3355, ADR-0103 v17 "
  + 'addendum) — v16 moved every engine-owned object to `engine-owned`, leaving `system` '
  + 'labelling admin/user-writable platform DATA under a name that says the opposite. '
  + "Use `managedBy: 'system-data'` (platform-defined schema, admin/user-writable data; "
  + 'authz stays the DelegatedAdminGate / RLS / permission sets). Rename the value; nothing '
  + 'else about the object changes. Note `system-data` defaults to WRITABLE affordances — '
  + 'create, edit, delete and exportCsv (the old `system` default was locked) — so a '
  + '`userActions` block that existed only to re-open create/edit/delete is now redundant '
  + 'and can be deleted; keep it only to NARROW. CSV `import` is deliberately NOT in that '
  + 'default (#4671): it stays opt-in per object via `userActions: { import: true }`, which '
  + 'is what a v16 `system` object already resolved to. Run `os migrate meta --from 16` to '
  + 'rewrite existing sources automatically.';

/**
 * Known-confusable schema keys → precise authoring guidance.
 *
 * ADR-0032's "no silent failure" principle applied to metadata *shape*: an
 * unknown top-level key on `ObjectSchema.create()` used to be discarded by
 * Zod's default `.strip()`, so a misauthored schema key vanished with no
 * error, no warning, and a green `tsc` — shipping dead metadata the author
 * believed they had wired up (issue #1535, object-level `workflows: [...]`).
 *
 * These entries turn the most likely mistakes into a fixable error that points
 * at the *supported* mechanism rather than a generic "unknown key".
 */
const UNKNOWN_KEY_GUIDANCE: Record<string, string> = {
  workflows:
    '`workflows` is not an ObjectSchema field. Object-level, record-triggered ' +
    'automation is authored as a lifecycle hook (`src/objects/<name>.hook.ts`, ' +
    'wrapped in `defineHook()` from `@objectstack/spec/data`) or as a top-level ' +
    '`record_change` flow — not as `workflows[]` on the object schema.',
  workflow:
    '`workflow` is not an ObjectSchema field. Record-triggered automation is ' +
    'authored as a lifecycle hook (`src/objects/<name>.hook.ts`) or a top-level ' +
    '`record_change` flow.',
  hooks:
    '`hooks` is not an ObjectSchema field. Lifecycle hooks live in their own ' +
    '`src/objects/<name>.hook.ts` module, wrapped in `defineHook()` from ' +
    '`@objectstack/spec/data`.',
  triggers:
    '`triggers` is not an ObjectSchema field. Use a lifecycle hook ' +
    '(`src/objects/<name>.hook.ts`) or a top-level `record_change` flow.',

  // ── Tombstones for RETIRED keys (upgrade prescriptions) ────────────────
  // A retired key's error must carry the fix: the compile/validation error is
  // the one upgrade channel every consumer is guaranteed to hit — an agent
  // bumping @objectstack/spec sees THIS message, not our docs site. Each entry
  // names what replaced the key and the version/decision that removed it.
  // Tombstones age out too: drop an entry ~two majors after the removal
  // (by then it's archaeology, not an upgrade; see CHANGELOG.md for history).
  namespace:
    '`namespace` was retired in ADR-0006 D4 — the object `name` IS the canonical id ' +
    'everywhere (API, ObjectQL, REST, SDK, DB table), so there is no separate namespace ' +
    'to declare. Embed the module prefix in the name instead: `namespace: "sys", ' +
    'name: "user"` becomes `name: "sys_user"`. Until #4001 closed this shape on the ' +
    'parse path it was stripped in silence, so an object declaring one shipped under ' +
    'the unprefixed name its author did not intend.',
  compactLayout:
    '`compactLayout` was renamed to `highlightFields` in @objectstack/spec 11.7.0 ' +
    '(ADR-0085 semantic roles) and the alias was retired in 11.9.1 (#2536). ' +
    'Rename the key — the value shape (ordered field-name list) is unchanged.',
  detail:
    'The `detail` UI-hints block was removed by ADR-0085 (spec 11.7.0). Its ' +
    'jobs moved to top-level semantic roles: `detail.stageField` → `stageField` ' +
    '(string | false), `detail.highlightFields` → `highlightFields`, section ' +
    'layout → `fieldGroups` + `Field.group`. Whole-page customization is done ' +
    'by assigning a custom Page schema instead of per-page hint keys.',
  views:
    '`views` is not an ObjectSchema field: the object-level `views.form/*` and ' +
    '`views.detail/*` UI-hint dialect was never part of the spec and its ' +
    'renderer support was removed (ADR-0085). Use the semantic roles ' +
    '(`highlightFields`, `stageField`, `fieldGroups`) for hints and `listViews` ' +
    'for named list views.',
  defaultDetailForm:
    '`defaultDetailForm` was never implemented and was removed from the spec ' +
    '(#2402). Curate the record page by assigning a custom Page schema; form ' +
    'layout derives from `fieldGroups` + `Field.group`.',
  softDelete:
    '`softDelete` was removed from the spec in 16.0 (#2377, ADR-0049 ' +
    'enforce-or-remove) — there is no soft-delete/recycle-bin runtime, so it ' +
    'stored nothing and implied restore semantics that do not exist. Deletes ' +
    'are hard deletes; remove the key.',
  versioning:
    '`versioning` was removed from the spec in 16.0 (#2377, ADR-0049) — no ' +
    'record-versioning engine ever read it (it snapshotted no history). Use ' +
    'per-field `Field.trackHistory` for field-level history, or a data ' +
    'lifecycle policy (`lifecycle`) for retention.',
  search:
    '`search` (the SearchConfig block) was removed from the spec in 16.0 ' +
    '(#2377, ADR-0049) — no search-engine config was consumed. Declare the ' +
    'indexed fields with `searchableFields` (ADR-0061); records stay queryable ' +
    'via the normal data API regardless.',
  recordName:
    '`recordName` was removed from the spec in 16.0 (#2377, ADR-0049) — it was ' +
    'never read. Auto-naming is modelled as a `Field` of type \'autonumber\' ' +
    '(with `autonumberFormat`) designated as the object\'s `nameField`.',
  keyPrefix:
    '`keyPrefix` was removed from the spec in 16.0 (#2377, ADR-0049) — record ' +
    'ids are not prefixed from it (no Salesforce-style key-prefix runtime). ' +
    'Remove the key; it had no effect.',
  tags:
    '`tags` (object-level categorization) was removed from the spec (#2377, ' +
    'ADR-0049) — it had no runtime reader. Remove the key; use `managedBy` for ' +
    'lifecycle bucketing or a real field for per-record tagging.',
  active:
    '`active` was removed from the spec (#2377, ADR-0049) — no runtime reader ' +
    'gated on it, so an "inactive" object was still fully queryable and usable. ' +
    'Remove the key; gate availability with permissions/sharing instead.',
  abstract:
    '`abstract` was removed from the spec (#2377, ADR-0049) — object ' +
    'inheritance/abstraction is not implemented, so an abstract object still ' +
    'got a table and was instantiable. Remove the key.',
};

// ⚠️ ORDER IS LOAD-BEARING (#5593). This map used to live ~700 lines BELOW
// `ObjectSchemaBase`, and the error map that reads it was built lazily
// (`objectUnknownKeyErrorImpl ??= …`) purely to step around the temporal dead
// zone that created. `strictObject` evaluates its options object at
// CONSTRUCTION — that is what lets the audit in `alias-integrity.test.ts` judge
// the table against the real `.shape` — so the deferral had to go, and the
// declaration order is what replaces it. Keep this block above
// `ObjectSchemaBase`; moving it back reintroduces the TDZ as a module-init
// crash under `OS_EAGER_SCHEMAS=1` (how `build-schemas.ts` runs), which the
// test suite does not reach because tests import lazily.
const ObjectSchemaBase = strictObject(
  {
    surface: 'this object',
    // The same semantic renames the WARNING layer already knew
    // (`OBJECT_KEY_GUIDANCE`). Graduating a surface from warn to reject must
    // not cost the author a prescription: `capabilities` → `enable` is a
    // different word for the same intent, so edit distance cannot reach it and
    // only an explicit entry can.
    aliases: { capabilities: 'enable', features: 'enable' },
    guidance: UNKNOWN_KEY_GUIDANCE,
    history:
      'Until #4001 closed this shape these were dropped silently on the PARSE path — '
      + '`ObjectSchema.create()` has rejected them since #1535, but `defineStack({ objects })`, '
      + '`/api/v1/meta/types/object` and the Studio form all go through `parse()`, which did not.',
  },
  {
  /**
   * Identity & Metadata
   */
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Machine unique key (snake_case). Immutable.'),
  label: z.string().optional().describe('Human readable singular label (e.g. "Account")'),
  pluralLabel: z.string().optional().describe('Human readable plural label (e.g. "Accounts")'),
  description: z.string().optional().describe('Developer documentation / description'),
  icon: z.string().optional().describe('Icon name (Lucide/Material) for UI representation'),

  /**
   * Taxonomy & Organization
   */
  // `tags`, `active`, `abstract` removed in the 16.x line (#2377, ADR-0049):
  // no runtime reader (an "inactive"/"abstract" object still got a table and was
  // fully usable; tags were never consumed). `isSystem` STAYS — it is live:
  // plugin-sharing effectiveSharingModel defaults a no-sharingModel isSystem
  // object to public, and the security-posture lint exempts system objects.
  isSystem: z.boolean().optional().default(false).describe('Is system object (protected from deletion; defaults its org-wide sharing to public when no sharingModel is set — plugin-sharing)'),

  /**
   * Managed-by hint — declares which lifecycle bucket the object belongs
   * to so UI clients render the appropriate set of CRUD affordances and
   * the security layer can enforce matching defaults. Modelled after the
   * way Salesforce / ServiceNow / Workday segregate user-owned business
   * data from admin-authored configuration, system-driven runtime rows,
   * and append-only audit trails.
   *
   * - `platform`     — **Default.** User-owned business data. Generic
   *   New / Import / Edit / Delete affordances are all shown. Example:
   *   the user's own `sys_attachment`, `sys_comment`, `sys_saved_report`.
   * - `config`       — Admin-authored metadata / configuration. Generic
   *   New / Edit / Delete shown (admins author via wizard or form), but
   *   CSV Import is suppressed (config rows have nested JSON envelopes
   *   that don't round-trip through a flat sheet; clients should offer a
   *   purpose-built "Import definition (JSON)" action instead). Example:
   *   `sys_sharing_rule`, `sys_position`, `sys_permission_set`, `sys_view`,
   *   `sys_app`.
   * - `system-data`  — Platform-defined schema that holds **admin/user-writable
   *   DATA**: the RBAC link tables (`sys_user_position`,
   *   `sys_user_permission_set`, `sys_position_permission_set`, governed by
   *   the `DelegatedAdminGate`), `sys_user_preference`, the messaging config
   *   grids (`sys_notification_subscription`, `_template`, `_preference`). Two
   *   boundaries define it: the SCHEMA is the platform's (versioned with the
   *   release, not tenant-modelled — that is `platform`), while the DATA is the
   *   admin's or the user's, written through a governed path (not the engine's —
   *   that is `engine-owned`). The bucket DEFAULT is therefore WRITABLE (full
   *   CRUD); narrow it with {@link userActions} where an object takes less. The
   *   affordance is a declaration only — the real authz stays the
   *   delegated-admin gate / RLS / permission sets.
   *   (Renamed from the residual `system` in v17 — #3355. `system` named the
   *   bucket after the half of the overload v16 had already moved out to
   *   `engine-owned`, so it read as "the engine owns this" on precisely the
   *   objects users write.)
   * - `engine-owned` — Runtime rows whose lifecycle a platform service owns
   *   end to end (the approval engine, the sharing engine, the job runner, the
   *   metadata store, …), written only via `isSystem` / a service `SYSTEM_CTX` /
   *   a context-less engine call. No user writes, ever. Generic CRUD is hidden —
   *   users interact via *domain actions* on the source record (e.g. "Submit
   *   for Approval" creates a `sys_approval_request`). Example:
   *   `sys_approval_request`, `sys_record_share`, `sys_notification`,
   *   `sys_automation_run`, `sys_job`, `sys_metadata`, `sys_secret`. (ADR-0103;
   *   the explicit successor to the old engine-owned-DEFAULT overload of
   *   `system`. `append-only` objects granting no resolved write are also
   *   treated as engine-owned by the write guard, so the split is a
   *   self-documenting relabel, not an enforcement change.)
   * - `append-only`  — Immutable audit log. No New / Import / Edit /
   *   Delete; only View and Export. Example: `sys_approval_action`,
   *   `sys_audit_log`, `sys_activity`, `sys_email`, `sys_presence`.
   * - `better-auth`  — Identity tables owned by the better-auth driver
   *   (sys_user, sys_session, sys_account, sys_member, sys_organization,
   *   sys_api_key, sys_jwks, sys_verification, sys_two_factor,
   *   sys_oauth_*, sys_device_code). Mutations must flow through the
   *   better-auth API so password hashing, token signing, email
   *   verification, and invitation flows fire correctly. Generic CRUD
   *   suppressed; replaced by purpose-built actions
   *   (Invite User, Reset Password, Revoke Session, Rotate Key, …).
   *
   * The flag supplies the DEFAULT affordance row; the enforced write policy
   * is {@link resolveCrudAffordances} (bucket default + `userActions`).
   * Enforcement happens in three places:
   *   1. Default permission sets ({@link packages/platform-objects/src/security/default-permission-sets.ts})
   *      deny direct CRUD for `engine-owned` / `append-only` / `better-auth`.
   *   2. UI clients honour {@link resolveCrudAffordances} to gate the
   *      New / Import / Edit / Delete / Export buttons accordingly.
   *   3. Engine write guards fail-closed on user-context generic writes to a
   *      managed object whose resolved affordances forbid the verb —
   *      `better-auth` via plugin-auth's identity write guard (ADR-0092),
   *      `engine-owned` / `append-only` via plugin-security's engine-owned
   *      write guard (ADR-0103). `isSystem` / context-less engine writes bypass.
   *      `system-data` — like `platform` / `config` — is writable by default and
   *      carries no such guard; its writes are adjudicated by the delegated-admin
   *      gate / RLS / permission sets.
   *
   * Use {@link userActions} to override the default matrix for a single
   * field (e.g. an "append-only" table that should still allow Export).
   */
  managedBy: z.enum(['platform', 'config', 'system-data', 'engine-owned', 'append-only', 'better-auth'], {
    // Only the value that USED to be legal gets the retirement prescription —
    // telling the author of `managedBy: 'sytem'` that their value "was removed"
    // would misinform. Everything else keeps zod's own enum message, which
    // already lists the legal values.
    error: (issue) => (issue.input === 'system' ? MANAGED_BY_SYSTEM_RETIRED : undefined),
  }).optional().describe(
    'Lifecycle bucket — platform (user CRUD) | config (admin authored) | system-data (platform-defined schema, admin/user-writable data) | engine-owned (engine owns the lifecycle, no user writes) | append-only (audit) | better-auth (identity). UI clients honour the resolved affordance matrix.',
  ),

  /**
   * Record-ownership model — who a *record* belongs to. Drives the registry's
   * `owner_id` auto-provisioning (`packages/objectql/src/registry.ts` →
   * `applySystemFields`):
   *
   *   - `user` (default) — per-record owner: injects the reassignable `owner_id`
   *     lookup, engaging owner-scoped RLS, "My" views, owner reports and
   *     first-admin bootstrap. Also carries `owning_business_unit_id`.
   *   - `business_unit` — owned by an org UNIT, not by a person (inventory,
   *     equipment ledgers, departmental budgets): `owner_id` is NOT injected,
   *     `owning_business_unit_id` IS. [ADR-0117 D1]
   *   - `org` / `none` — no per-record owner of EITHER kind (Dataverse-style
   *     catalog / junction tables); neither anchor is injected. (Platform-managed
   *     tables — `managedBy` set, or the `sys_` namespace — skip ownership
   *     injection regardless.)
   *
   * The per-tier authority is `resolveInjectedSystemColumns`
   * (`@objectstack/spec/data`) — its table, not this prose, is what
   * `applySystemFields` and author-time lint both read.
   *
   * NOTE: this is the RECORD-ownership model, DISTINCT from the package
   * *contribution* kind (`own` | `extend` | `overlay`,
   * {@link ObjectOwnershipEnum}) that lives on the registry's contributor
   * record and is set via `registerObject` — do not conflate the two despite
   * the shared word.
   */
  ownership: z.enum(['user', 'business_unit', 'org', 'none'], {
    error:
      "`ownership` is the record-ownership model — one of 'user' (default) | 'business_unit' | 'org' | 'none'. " +
      "The package-contribution kind 'own'/'extend' is set via registerObject, not on the object schema.",
  }).optional().describe(
    "Record-ownership model: user (default — injects reassignable owner_id plus owning_business_unit_id) | business_unit (unit-owned: owning_business_unit_id only, no owner_id) | org | none (no per-record owner, neither anchor). Distinct from the package own/extend contribution kind.",
  ),

  /**
   * Per-object override of the generic CRUD affordances that the UI
   * surfaces. Each flag overrides the default derived from
   * {@link managedBy} via {@link resolveCrudAffordances}. Useful for the
   * handful of objects whose lifecycle doesn't cleanly fit a single
   * bucket — e.g. an `append-only` table that should still expose CSV
   * Export, or a `config` table that admins legitimately want to bulk
   * import via CSV.
   *
   * Omitting the block (or leaving individual flags `undefined`) keeps
   * the {@link managedBy}-derived default.
   *
   * Every CRUD flag except `exportCsv` also accepts the object form
   * {@link RowCrudActionOverrideSchema} — `{ enabled?, visibleWhen?,
   * disabledWhen? }` — which gates the affordance on record state instead
   * of only per object. `edit`/`delete` evaluate it per row (objectui#2614);
   * `create`/`import` evaluate it once per toolbar against the record in
   * scope (#7692). Read that schema's docblock for what `record.*` binds to
   * in each position — they are different records.
   */
  userActions: strictObject({
    surface: "this object's `userActions` block",
    history:
      'Until #4001 these were dropped silently — the block still parsed, so an affordance ' +
      'the author meant to hide stayed on the toolbar, and the `managedBy`-derived ' +
      'default silently won.',
    aliases: {
      export: 'exportCsv',
      csvExport: 'exportCsv',
      exportcsv: 'exportCsv',
      new: 'create',
      add: 'create',
      insert: 'create',
      update: 'edit',
      remove: 'delete',
      destroy: 'delete',
    },
    guidance: {
      // Wrong-LAYER, and the trap is that the key name is right somewhere else.
      // `ui/view.zod.ts` declares its own `userActions` with a completely
      // disjoint vocabulary (sort/search/filter/refresh/rowHeight/
      // addRecordForm/editInline/buttons), so an author who learned that block
      // writes these here and gets a shape that has never heard of them.
      sort:
        '`sort` is a VIEW `userActions` key, not an object one — the two blocks share a ' +
        'name and nothing else. The object block governs CRUD affordances ' +
        '(create/import/edit/delete/exportCsv); toolbar controls ' +
        '(sort/search/filter/refresh/rowHeight/editInline) live on the view.',
      search:
        '`search` is a VIEW `userActions` key. This object block governs CRUD affordances ' +
        'only — put toolbar controls on the view that renders the records.',
      filter:
        '`filter` is a VIEW `userActions` key. This object block governs CRUD affordances ' +
        'only — put toolbar controls on the view that renders the records.',
      editInline:
        '`editInline` is a VIEW `userActions` key. The object-level `edit` flag decides ' +
        'whether editing is offered AT ALL; how it is offered (inline vs form) is the ' +
        "view's call.",
      clone:
        '`clone` is a CAPABILITY, not a user action — write `enable: { clone: false }`. ' +
        'The `enable` block (ObjectCapabilities) is where record deep-cloning is governed.',
      read:
        '`userActions` toggles WRITE affordances only; there is no read toggle. Read ' +
        'access is governed by permissions (`requiredPermissions`) and `access.default`.',
      view:
        '`userActions` toggles WRITE affordances only; there is no view toggle. ' +
        'Visibility is governed by permissions (`requiredPermissions`) and `access.default`.',
    },
  }, {
    create: z.union([z.boolean(), RowCrudActionOverrideSchema]).optional().describe(
      'Show generic "New" button. Boolean, or an object adding visibleWhen/disabledWhen CEL predicates evaluated once per toolbar against the record in scope (the host record on a related list).',
    ),
    import: z.union([z.boolean(), RowCrudActionOverrideSchema]).optional().describe(
      'Show CSV import wizard entry. Boolean, or an object adding visibleWhen/disabledWhen CEL predicates evaluated once per toolbar against the record in scope (the host record on a related list).',
    ),
    edit: z.union([z.boolean(), RowCrudActionOverrideSchema]).optional().describe(
      'Allow inline / form edit of existing rows. Boolean, or an object adding per-record visibleWhen/disabledWhen CEL predicates.',
    ),
    delete: z.union([z.boolean(), RowCrudActionOverrideSchema]).optional().describe(
      'Show row-level delete + bulk delete. Boolean, or an object adding per-record visibleWhen/disabledWhen CEL predicates.',
    ),
    exportCsv: z.boolean().optional().describe('Show CSV export entry.'),
  }).optional().describe('Per-object override of the resolved CRUD affordance matrix.'),

  /**
   * System-field auto-injection control.
   *
   * The `SchemaRegistry` augments every user object with a small set of
   * implicit system fields at registration time so authors don't have to
   * declare them per-object (Salesforce-style). Currently injected
   * (`packages/objectql/src/registry.ts` → `applySystemFields`):
   *
   *   - `organization_id` — `lookup → sys_organization`. The COLUMN is
   *     provisioned unconditionally (subject to the opt-outs below); only its
   *     DB index is gated on multi-tenant mode. It stays NULL on single-tenant
   *     stacks and is auto-stamped on insert by `@objectstack/organizations`
   *     (the `org-scoping` service) in multi-tenant mode.
   *   - Audit columns — `created_at`, `created_by`, `updated_at`, `updated_by`
   *     (`readonly` + `system`). Gated by `audit` below.
   *   - `owner_id` — `lookup → sys_user`, auto-provisioned on user-authored
   *     business objects (auto-stamped to the creating user on insert;
   *     reassignable). Governed by the object-level `ownership` property
   *     (`'user' | 'business_unit' | 'org' | 'none'`), NOT by `owner` below.
   *     Injected under `'user'` and when `ownership` is omitted; withheld under
   *     `'business_unit' | 'org' | 'none'`.
   *   - `owning_business_unit_id` — `lookup → sys_business_unit`, the
   *     record-level ORG-UNIT ownership tier between `owner_id` (a person) and
   *     `organization_id` (the tenant wall). [ADR-0117 D1, landed in #5677]
   *     Governed by the same `ownership` property, but over a WIDER set of
   *     tiers than `owner_id`: injected under `'user'`, when `ownership` is
   *     omitted, and under `'business_unit'` (the tier that carries this anchor
   *     and deliberately no `owner_id`); withheld under `'org' | 'none'`.
   *     Shaped after `organization_id` (`readonly` + `hidden` + `system`), not
   *     after `owner_id` — it is a server-stamped scope anchor. Provisioned but
   *     **inert**: the stamping middleware (ADR-0117 D2/D4) has not landed, so
   *     nothing writes a value yet — including on `'business_unit'` objects,
   *     where the declaration is authorable (#5678) while the stamp is not.
   *
   * The authority on which of these an object actually carries is
   * `resolveInjectedSystemColumns` (`@objectstack/spec/data`): `applySystemFields`
   * consumes it, and author-time lint reads the same derivation rather than
   * re-deriving the conditions from this prose.
   *
   * Author-declared fields with the same name always win over injection
   * (no overwrite). Objects with `managedBy` set (and the `sys_*` namespace)
   * are skipped for ownership; `managedBy: 'better-auth'` is skipped entirely —
   * better-auth's own migrations own that column layout.
   *
   * Set `systemFields: false` to opt the object out completely. Pass an
   * options object to selectively disable individual injections (`tenant`,
   * `audit`).
   *
   * @default undefined (= injection enabled)
   */
  systemFields: z
    .union([
      z.literal(false),
      strictObject({
        surface: "this object's `systemFields` block",
        history:
          'Until #4001 these were dropped silently — the block still parsed, so an ' +
          'opt-out the author wrote had no effect and the registry injected the column ' +
          'anyway.',
        aliases: {
          organization: 'tenant',
          org: 'tenant',
          tenancy: 'tenant',
          organizationId: 'tenant',
          auditFields: 'audit',
          timestamps: 'audit',
        },
        guidance: {
          // The field doc above this block names `owner` while the shape has
          // never declared it — so an author following the prose lands exactly
          // here. `ownership` is the real, enforced lever.
          owner:
            '`owner` is not a `systemFields` key — `owner_id` injection is governed by the ' +
            "object-level `ownership` property: `'user'` (or omitted) injects it, while " +
            "`'org'` and `'none'` BOTH skip it and no `owner_id` is injected at all — " +
            "`'org'` for an org-wide catalog (Dataverse-style), `'none'` for a junction/link " +
            "table. `'business_unit'` skips it too, for a different reason: that tier is " +
            'owned by an org UNIT rather than a person, so it carries ' +
            '`owning_business_unit_id` and deliberately no `owner_id` (ADR-0117 D1). ' +
            '`systemFields` controls only `tenant` (organization_id) and `audit` ' +
            '(created_at/created_by/updated_at/updated_by).',
          ownership:
            '`ownership` is a TOP-LEVEL object key, not a `systemFields` key — write it ' +
            'beside `systemFields`. It, not this block, decides whether the ownership ' +
            'anchors (`owner_id` and `owning_business_unit_id`) are injected.',
        },
      }, {
        tenant: z.boolean().optional().describe('Inject the organization_id column. Default true (the column is always provisioned; the multi-tenant flag governs only its index).'),
        audit: z.boolean().optional().describe('Inject the audit columns (created_at/created_by/updated_at/updated_by). Default true.'),
      }),
    ])
    .optional()
    .describe('Opt out of, or selectively disable, registry-level system-field auto-injection.'),

  /** 
   * Storage & Virtualization 
   */
  datasource: z.string().optional().default('default').describe('Target Datasource ID. "default" is the primary DB.'),

  /**
   * External Binding (ADR-0015)
   * Present only for federated objects routed to a datasource whose
   * `schemaMode !== 'managed'`. Describes the remote table binding and
   * per-object writability. See {@link ObjectExternalBindingSchema}.
   */
  external: ObjectExternalBindingSchema.optional()
    .describe('Remote table binding for federated (external) objects.'),

  /**
   * Data Model
   */
  fields: z.record(z.string().regex(/^[a-z_][a-z0-9_]*$/, {
    message: 'Field names must be lowercase snake_case (e.g., "first_name", "company", "annual_revenue")',
  }), FieldSchema).describe('Field definitions map. Keys must be snake_case identifiers.'),
  indexes: z.array(IndexSchema).optional().describe('Database performance indexes'),

  /**
   * Field Groups (MVP)
   * 
   * Declares logical groups for presenting fields in forms and detail
   * pages. The **array order is the group display order**. Each field's
   * `Field.group` references an entry's `key` to assign it to a group;
   * within a group, fields are displayed in their `ObjectSchema.fields`
   * declaration order.
   * 
   * See {@link ObjectFieldGroupSchema} for the full MVP contract and
   * deferred features.
   */
  fieldGroups: z.array(ObjectFieldGroupSchema).refine(
    (groups) => new Set(groups.map(g => g.key)).size === groups.length,
    { message: 'fieldGroups[].key must be unique within an object' },
  ).optional().describe('Ordered list of field groups (array order = display order). See ObjectFieldGroupSchema.'),
  
  /**
   * Advanced Data Management
   */
  
  // Multi-tenancy configuration
  tenancy: TenancyConfigSchema.optional().describe('Multi-tenancy configuration for SaaS applications'),

  /**
   * [ADR-0066 D2] Secure-by-default object posture. `access.default: 'private'`
   * opts the object OUT of blanket wildcard (`'*'`) permission grants (access
   * then needs an explicit per-object grant) and exempts it from wildcard RLS
   * via the posture-gated superuser bypass. Absent ⇒ `public` (today's
   * allow-by-default behaviour; no migration for existing objects).
   */
  access: ObjectAccessConfigSchema.optional().describe('[ADR-0066 D2] Object exposure posture (public-by-default vs private secure-by-default).'),

  /**
   * [ADR-0066 D3/⑤] Capability contract — capability name(s) (permission-set
   * `systemPermissions`; D1 records) a caller MUST hold to access this object.
   * Mirrors `App.requiredPermissions`. Enforced by plugin-security as an
   * AND-gate: checked IN ADDITION to permission-set CRUD grants — a caller
   * missing any required capability is denied regardless of grants.
   *
   * Two shapes:
   *  - `string[]` — required for ALL operations (read/create/update/delete).
   *  - `{ read?, create?, update?, delete? }` (⑤) — required only for the listed
   *    operation class, so an object can be read-open but write-gated.
   * Absent/empty ⇒ no capability gate.
   */
  requiredPermissions: ObjectRequiredPermissionsSchema.optional().describe('[ADR-0066 D3/⑤] Capabilities required to access this object (AND-gate) — `string[]` gates all CRUD, or a `{read,create,update,delete}` map gates per operation.'),

  // Data lifecycle (ADR-0057) — retention / rotation / archival contract,
  // enforced by the LifecycleService. Absent = `record` (today's behavior).
  lifecycle: LifecycleSchema.optional().describe('Data lifecycle contract (ADR-0057): class + retention/ttl/rotation/archive policies enforced by the platform LifecycleService.'),

  /**
   * Who answers "may this caller download a file owned by this object's media
   * fields?" (ADR-0104 D3 wave 2).
   *
   * By default the storage service asks the question directly — can the caller
   * READ the owning row? That is right for ordinary business objects, where
   * row readability *is* the access rule. It is wrong for an object whose
   * access is **mediated by a service** rather than by row permissions: a
   * system audit table like `sys_approval_action` is deliberately unreadable
   * to ordinary positions, yet a legitimate approver must still be able to
   * open a decision attachment. Testing raw readability there asks the wrong
   * authority and denies the very people the record is for.
   *
   * Naming a kernel service here delegates the question to it. The service
   * must implement `authorizeFileRead(recordId, context) => boolean` (see
   * `IFileAccessDelegate`). Fails CLOSED: a declared service that is missing
   * or does not implement the method denies the download rather than falling
   * back to the raw read.
   */
  fileAccessDelegate: z.string().optional().describe(
    'Kernel service that authorizes downloads of files owned by this object\'s media fields, '
    + 'instead of testing whether the caller can read the owning row. For objects whose access '
    + 'is mediated by a service (e.g. sys_approval_action → approvals). Fails closed.',
  ),

  /**
   * Logic & Validation (Co-located)
   * Best Practice: Define rules close to data.
   */
  validations: z.array(ValidationRuleSchema).optional().describe('Object-level validation rules'),

  /**
   * Declarative semantic activity milestones (ADR-0052 §5b.2). When a watched
   * field transitions INTO `value`, the platform emits a templated activity-row
   * on the record timeline — no `*.hook.ts` / `*.flow.ts`. Complements field-level
   * `trackHistory` (which renders raw "Field: old → new"): use milestones for
   * business-meaningful events ("Deal won", "Task completed"). `summary` supports
   * `{field}` tokens interpolated from the record; the milestone summary takes
   * precedence over the field-change summary for the same update. Consumed by
   * `@objectstack/plugin-audit` audit-writers (enforce-or-remove, ADR-0049).
   */
  activityMilestones: z.array(strictObject({
    surface: 'this activity milestone',
    history:
      'Until #4001 these were dropped silently — the milestone still parsed, so a ' +
      'mis-keyed template shipped a timeline row with the wrong text, or the milestone ' +
      'never fired at all.',
    aliases: {
      message: 'summary',
      template: 'summary',
      text: 'summary',
      title: 'summary',
      to: 'value',
      watch: 'field',
      activityType: 'type',
    },
    guidance: {
      from:
        '`from` is not a milestone key — a milestone fires on transition INTO `value`, ' +
        'whatever the previous value was. There is no from-state filter here; when the ' +
        'TRANSITION itself must be constrained, declare a `state_machine` rule in ' +
        '`validations` (ADR-0020), which is where the legal transition table lives.',
      when:
        '`when` is not a milestone key — the trigger is structural: `field` transitions ' +
        'INTO `value`. For a conditional timeline row, gate it with a `state_machine` ' +
        'rule in `validations` or a hook.',
    },
  }, {
    field: z.string().describe('Field to watch (typically a status/stage select).'),
    value: z.string().describe('The value the field must transition INTO to fire the milestone.'),
    summary: z.string().describe('Activity summary template; {field} tokens interpolate the record value. e.g. "Deal won: {name}".'),
    type: z.string().optional().describe('Activity type for the emitted row (default "completed").'),
  })).optional().describe('Declarative semantic activity milestones — emit a templated timeline row when a field transitions into a value, no hook code (ADR-0052 §5b.2).'),

  // ADR-0020: record state machines are not a separate `stateMachines` map —
  // each lifecycle is a `state_machine` rule in `validations` above (one rule
  // per state field). Parallel lifecycles = multiple rules. The write path
  // enforces the transition table; UIs read the legal next states via the
  // `/meta/objects/:name/state/:field?from=` introspection endpoint.

  /**
   * Display & UI Hints (Data-Layer)
   */
  /**
   * [ADR-0079] Canonical pointer to the object's PRIMARY title field — the one
   * real stored field (text / autonumber / formula→text) that is a record's
   * human name. Optional at the schema level for now (a hard required-refine is
   * staged so existing title-less metadata still parses). Resolve / derive via
   * `resolveDisplayField` from `@objectstack/spec/data` (display-name.ts), which
   * falls back to the deprecated `displayNameField` alias and then a derivation.
   * Auto-naming (system-generated record names) is modelled as a `Field` of
   * type 'autonumber' with `autonumberFormat`, designated as the `nameField`.
   */
  nameField: z.string().optional().describe('[ADR-0079] Canonical primary title field — the stored field used as the record display name (e.g. "name", "title").'),
  /**
   * @deprecated [ADR-0079] Renamed to `nameField`. Still ACCEPTED as an alias:
   * the schema copies `displayNameField` onto `nameField` on parse when
   * `nameField` is absent (both are preserved on the parsed output for
   * cross-repo back-compat). New metadata should set `nameField`.
   */
  displayNameField: z.string().optional().describe('[DEPRECATED → nameField] Field to use as the record display name (e.g., "name", "title"). Accepted as an alias for nameField.'),
  titleFormat: TemplateExpressionInputSchema.optional().describe('[DEPRECATED → nameField (ADR-0079)] Render-only title template; the server cannot return or query it, and an explicit nameField now takes precedence. Migrate a single-field title to nameField, a composite to a formula field designated as nameField.'),
  /**
   * [ADR-0085] Semantic role: the object's most important fields, in priority
   * order (the first entry wins wherever only one field fits, e.g. child-record
   * previews). Cross-surface by definition — drives default list/grid columns,
   * cards, hover/lookup previews, and the record-detail highlight strip (first
   * 4). Renamed from `compactLayout` (the value is an ordered field list, not
   * a layout); Salesforce compact-layout semantics.
   */
  highlightFields: z.array(z.string()).optional().describe('[ADR-0085] Ordered most-important fields; first entry wins where only one fits. Drives default columns, cards, previews, detail highlight strip. Renamed from compactLayout.'),
  // `compactLayout` (the pre-ADR-0085 spelling of `highlightFields`) was an
  // accepted parse-time alias for one deprecation window and is now RETIRED
  // (framework#2536): authoring it is rejected by `create()` like any unknown
  // key. All first-party consumers read `highlightFields` since objectui#2168.
  /**
   * [ADR-0085] Semantic role: the field that represents the record's LINEAR
   * lifecycle (an ordered pipeline / stage progression). A string names the
   * field; `false` declares the object's status-like field NON-linear (an
   * unordered state set such as active/suspended/void) and suppresses every
   * consumer's stage heuristics. Absent = consumers may heuristically detect
   * a stage field (status/stage/state/phase). Consumed by the record-detail
   * path/stepper today; kanban default grouping, list badges and report
   * bucketing are natural future consumers.
   */
  stageField: z.union([z.string(), z.literal(false)]).optional().describe('[ADR-0085] Lifecycle stage field (linear/ordered), or false to declare the status field non-linear and suppress stage heuristics. Absent = heuristic detection allowed.'),

  /**
   * Built-in List Views
   *
   * Curated, platform-shipped list views (grid / kanban / calendar / …)
   * keyed by view name. Rendered as segmented tabs in the console list page
   * **before** any user-saved `sys_view` rows. Use this for system objects
   * (audit, runtime, config) where the default "All records" grid lacks
   * business context — e.g. an approval-request list should ship with
   * "My pending", "I submitted", "Completed" tabs out of the box.
   *
   * Each value is an `ObjectListViewSchema` (a `ListViewSchema` whose `userFilters`
   * is narrowed to dropdown value chips — ADR-0047 "views" mode, where the
   * `ViewTabBar` owns the tab-bar role so `tabs` presets stay page-only) so authors
   * get the full filter/sort/grouping vocabulary plus quick-filter dropdowns.
   *
   * @example
   * ```ts
   * listViews: {
   *   my_pending: {
   *     type: 'grid',
   *     label: 'My Pending',
   *     filter: [{ field: 'pending_approvers', operator: 'contains', value: '{current_user_id}' }],
   *     sort: [{ field: 'updated_at', order: 'desc' }],
   *   },
   * }
   * ```
   */
  listViews: z.record(z.string(), ObjectListViewSchema).optional().describe('Built-in named list views (segmented tabs) shipped with the object schema — "views" mode, dropdown userFilters allowed, no page-only tabs (ADR-0047)'),

  /**
   * Search Engine Config 
   */
  searchableFields: z.array(z.string()).optional().describe('Fields the `$search` query matches against (ADR-0061). Canonical default for the record picker, list quick-search and global search; views may narrow it. When unset, search auto-defaults to the name/title field plus short-text fields. Entries must name a STORED column: a virtual `formula` field is computed on read and materializes no column, so searching it can never match and it is refused (#6674) — mirror the value onto a stored text field and declare that.'),

  /**
   * System Capabilities
   */
  enable: ObjectCapabilities.optional().describe('Enabled system features modules'),

  /**
   * Sharing Model (org-wide default).
   *
   * `controlled_by_parent` (ADR-0055) makes this a DETAIL object in a
   * master-detail relationship: its access is *derived* from the master record
   * — a user sees/edits a detail only if they can see/edit its master. The
   * object must declare exactly one required `master_detail` field identifying
   * the master; the security layer auto-injects `masterFK IN (accessible master
   * ids)` on reads and requires master edit-access on by-id writes. No RLS policy
   * is authored — the inheritance is derived from the relationship.
   */
  sharingModel: z.enum(['private', 'public_read', 'public_read_write', 'controlled_by_parent']).optional().describe('Org-Wide Default record visibility (OWD) for INTERNAL users. Canonical four only (legacy aliases removed, ADR-0090 D4): private (owner-only) | public_read (everyone reads, owner writes) | public_read_write (everyone reads+writes) | controlled_by_parent (derived from the master record). A CUSTOM object that omits this resolves to private at runtime (ADR-0090 D1).'),

  /**
   * [ADR-0090 D11] Org-Wide Default for EXTERNAL principals
   * (`principal.audience: 'external'` — portal / partner users). A second,
   * stricter dial: defaults to `private` when omitted and may NEVER be wider
   * than the internal `sharingModel` (validated at authoring). The BU depth
   * axis does not apply to externals; their visibility = own records +
   * explicit shares + this baseline.
   */
  externalSharingModel: z.enum(['private', 'public_read', 'public_read_write', 'controlled_by_parent']).optional().describe('[ADR-0090 D11] OWD for external (portal/partner) principals. Defaults to private; must be <= sharingModel in openness.'),

  /**
   * Public Share-Link Policy
   *
   * Opt-in declaration that records of this object MAY be published via
   * an opaque capability token (Notion / Google Docs / Figma "anyone with
   * the link" style). When omitted or `enabled:false`, the platform
   * refuses to create share-link rows for this object — independent of
   * any permission the caller holds.
   *
   * Distinct from {@link sharingModel}, which governs *principal-based*
   * sharing (share with specific users / teams / roles). A single object
   * can opt into both: principals get full edit, link recipients get
   * read-only with redaction.
   *
   * Defaults are conservative: when `enabled:true` and no other field is
   * provided, the plugin allows `link_only` audience + `view` permission
   * (the safest combination — caller still needs the URL to access).
   *
   * @see packages/plugins/plugin-sharing/src/share-link-service.ts
   */
  publicSharing: strictObject({
    surface: "this object's `publicSharing` policy",
    history:
      'Until #4001 these were dropped silently — the policy still parsed, so a redaction ' +
      'list or an expiry cap the author wrote was never applied to the links the platform ' +
      'went on to issue. On a policy whose whole job is to be restrictive, a silently ' +
      'dropped key fails OPEN.',
    aliases: {
      audiences: 'allowedAudiences',
      permissions: 'allowedPermissions',
      redact: 'redactFields',
      redacted: 'redactFields',
      maxExpiry: 'maxExpiryDays',
      expiryDays: 'maxExpiryDays',
      condition: 'eligibility',
    },
    guidance: {
      sharingModel:
        '`sharingModel` governs PRINCIPAL-based sharing (specific users / teams / roles) ' +
        'and is a TOP-LEVEL object key, not a `publicSharing` key. `publicSharing` is the ' +
        'separate opt-in for opaque share LINKS — an object may declare both, and they ' +
        'do not constrain each other.',
      externalSharingModel:
        '`externalSharingModel` is a TOP-LEVEL object key (ADR-0090 D11) — the OWD for ' +
        'external portal/partner principals. Link sharing is this block; principal-based ' +
        'external access is that key, one level up.',
    },
  }, {
    /** Master switch. When false (default), no share links can be issued for this object. */
    enabled: z.boolean().default(false).describe('Allow records of this object to be published via share link'),
    /**
     * Audiences the platform will accept when issuing a link.
     * - `public`       — search engines may index; no token check (rare)
     * - `link_only`    — anyone holding the token (default)
     * - `signed_in`    — token + an authenticated session of any tenant user
     * - `email`        — token + recipient's email matches an allowlist
     */
    allowedAudiences: z.array(z.enum(['public', 'link_only', 'signed_in', 'email'])).optional().describe('Audiences callers may select when creating a link'),
    /** Permission levels callers may grant via a link. Defaults to `['view']`. */
    allowedPermissions: z.array(z.enum(['view', 'comment', 'edit'])).optional().describe('Permission levels selectable on the share dialog'),
    /** Hard cap on requested expiry, in days. Links with `expires_at` further out are rejected. */
    maxExpiryDays: z.number().int().positive().optional().describe('Reject links with expiry beyond this many days'),
    /**
     * Fields stripped from every response served via a share token,
     * regardless of audience. Use for prompts, raw model output,
     * internal metadata, PII, etc. The owner's normal API access is
     * unaffected — redaction is applied only when the request principal
     * is `kind:'share-link'`.
     */
    redactFields: z.array(z.string()).optional().describe('Field names removed from records served via a share token'),
    /**
     * Optional CEL/JSONLogic predicate evaluated against the candidate
     * record when a link is created. When the predicate returns false,
     * the create call fails with 422 (e.g. "draft records cannot be
     * shared"). Evaluator is the same one used by sharing rules.
     */
    eligibility: z.string().optional().describe('CEL expression that must evaluate to true on the target record'),
  }).optional().describe('Public share-link policy (Notion/Figma-style link sharing)'),

  // [ADR-0085] The former `detail: { … }.passthrough()` UI-hints block is
  // REMOVED. Presentation intent lives in the cross-surface semantic roles
  // above (nameField / highlightFields / stageField / fieldGroups); per-page
  // control is an assigned Page. The passthrough block bred silently-inert
  // keys (9 read by renderers vs 3 typed; the typed `hideReferenceRail` was
  // itself a no-op for spec authors) — see the ADR for the full inventory.
  // `renderViaSchema` — the block's last-surviving key, kept only as the
  // legacy monolith detail renderer's kill-switch — retired with that
  // renderer in objectui#2546 (ADR-0085 PR4).

  /**
   * Object Actions
   * 
   * Actions associated with this object. Populated automatically by `defineStack()`
   * when top-level actions specify `objectName` matching this object.
   * Can also be defined directly on the object.
   * 
   * Aligns with Salesforce/ServiceNow patterns where actions are part of the
   * object schema, so API responses (e.g., `/api/v1/meta/objects/:name`)
   * include the action list without requiring downstream merge.
   */
  actions: z.array(ActionSchema).optional().describe('Actions associated with this object (auto-populated from top-level actions via objectName)'),

  /**
   * ADR-0010 §3.7 — Package-level protection envelope. Package
   * authors declare lock policy here; the loader translates it
   * into the private `_lock` envelope at registration time and
   * strips this block before persistence. See
   * `shared/protection.zod.ts`.
   */
  protection: ProtectionSchema.optional().describe(
    'Package author protection block — lock policy for this object.',
  ),

  // ADR-0010 — runtime protection envelope (internal — set by loader).
  ...MetadataProtectionFields,
});

/**
 * Converts a snake_case name to a human-readable Title Case label.
 * @example snakeCaseToLabel('project_task') → 'Project Task'
 */
function snakeCaseToLabel(name: string): string {
  return name
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Levenshtein edit distance — backs the "did you mean" hint for typo'd keys. */
function editDistance(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

/** Closest known key within a small edit distance, for typo hints (`indexs` → `indexes`). */
function suggestKey(unknown: string, knownKeys: string[]): string | undefined {
  let best: string | undefined;
  let bestDist = Infinity;
  for (const key of knownKeys) {
    const d = editDistance(unknown.toLowerCase(), key.toLowerCase());
    if (d < bestDist) {
      bestDist = d;
      best = key;
    }
  }
  // Only suggest when the keys are genuinely close (guards against noise).
  return best !== undefined && bestDist <= Math.max(2, Math.floor(unknown.length / 3))
    ? best
    : undefined;
}

/**
 * Builds a precise, fixable error for unknown top-level keys on
 * `ObjectSchema.create()` — the metadata-shape analogue of ADR-0032's "no
 * silent failure" (issue #1535). Because authored `*.object.ts` modules call
 * `create()`, this surfaces as a located build error instead of a silently
 * stripped field.
 */
function unknownKeyError(objectName: unknown, unknownKeys: string[], knownKeys: string[]): Error {
  const name = typeof objectName === 'string' && objectName.length > 0 ? objectName : '<unnamed>';
  const lines = unknownKeys.map((key) => {
    const guidance = UNKNOWN_KEY_GUIDANCE[key];
    if (guidance) return `  • ${guidance}`;
    const suggestion = suggestKey(key, knownKeys);
    return suggestion
      ? `  • \`${key}\` is not an ObjectSchema field — did you mean \`${suggestion}\`?`
      : `  • \`${key}\` is not an ObjectSchema field.`;
  });
  return new Error(
    `ObjectSchema.create('${name}'): unknown key(s) — ${unknownKeys.join(', ')}.\n` +
    'These keys would previously have been stripped silently at build, shipping ' +
    'dead metadata with no diagnostic (ADR-0032 "no silent failure", issue #1535).\n\n' +
    `${lines.join('\n')}\n\n` +
    'Remove the unknown key(s), fix the typo, or move the logic to a supported mechanism.',
  );
}

/**
 * Rejects excess top-level keys at compile time: any key of `T` that is not a
 * key of the ObjectSchema input shape is constrained to `never`, turning the
 * silent strip into a `tsc` error at the authoring site as well as at build.
 */
type NoExcessObjectKeys<T> = T &
  Record<Exclude<keyof T, keyof z.input<typeof ObjectSchemaBase>>, never>;

/** Object names already warned about a generic `password` field (dedup per name). */
const warnedPasswordObjects = new Set<string>();

/**
 * Non-fatal author-time diagnostic (ADR-0100): a `password`-typed field on a
 * generic (non-`better-auth`) object gets defined-but-surprising semantics —
 * masked-on-read but **plaintext at rest**, with no one-way hashing (that lives
 * only in the auth subsystem). Steer authors to `secret` for reversible machine
 * credentials, or to the auth subsystem for real login credentials.
 *
 * A warning, not an error: `password` now has a defined generic-path contract,
 * and the field-zoo example intentionally exercises every field type — a hard
 * error would be self-inflicted breakage. Deduped per object name so a schema
 * imported many times warns once. `managedBy: 'better-auth'` objects are exempt,
 * as are fields that opt in with `ackPlaintextMasking: true` — the author's
 * explicit "this is intended" acknowledgment (#3420), which lets a deliberate
 * demo/design (e.g. the showcase field-zoo) start with zero warnings.
 */
function warnGenericPasswordFields(
  objectName: unknown,
  fields: unknown,
  managedBy: unknown,
): void {
  if (managedBy === 'better-auth') return;
  if (!fields || typeof fields !== 'object') return;
  const passwordFields = Object.entries(
    fields as Record<string, { type?: string; ackPlaintextMasking?: boolean }>,
  )
    .filter(([, def]) => def && def.type === 'password' && def.ackPlaintextMasking !== true)
    .map(([fieldName]) => fieldName);
  if (passwordFields.length === 0) return;
  const name = typeof objectName === 'string' && objectName.length > 0 ? objectName : '<unnamed>';
  if (warnedPasswordObjects.has(name)) return;
  warnedPasswordObjects.add(name);
  console.warn(
    `ObjectSchema.create('${name}'): field(s) ${passwordFields.map((f) => `\`${f}\``).join(', ')} ` +
    "use type 'password' on a non-auth object. The generic CRUD path stores a " +
    'password field as plaintext at rest and masks it to •••••••• on read (ADR-0100) — ' +
    'it is NOT one-way hashed (that is owned by the auth subsystem, for its identity ' +
    "tables only). Use `Field.secret(...)` for reversible machine credentials, or model " +
    'login credentials on the auth user object. If this is intended, the masking contract ' +
    'applies — affirm it with `ackPlaintextMasking: true` on the field to silence this warning.',
  );
}

/**
 * [#3355] Authoring-time refusal for the ONE way `system-data` can be
 * mis-assigned: declaring it on an object that grants no user write at all.
 *
 * The v17 rename fixed a name that lied. This keeps it from lying again. The two
 * halves of `system-data` are "platform-defined SCHEMA" and "admin/user-writable
 * DATA"; an object whose resolved affordances forbid create AND edit AND delete
 * satisfies the first half and contradicts the second, and the value it is
 * actually describing is `engine-owned` (or `append-only` for an audit log).
 * That contradiction is fully computable from the declaration alone — no call
 * graph needed — so it is refused rather than reviewed.
 *
 * This matters more under the v17 defaults than it would have under v16. `system`
 * defaulted LOCKED, so a mislabelled engine-owned object inherited a harmless
 * read-only matrix; `system-data` defaults WRITABLE, so the same mistake now
 * hands a table generic CRUD affordances it should never advertise. The write
 * guard does not cover `system-data` (nothing to fail closed on when the default
 * grants the write), so authoring time is the only place this can be caught —
 * hence a throw, not a `console.warn`.
 *
 * Threshold is "no write verb at all", not "any narrowing": `system-data` +
 * `userActions: { create: false, delete: false }` (an editable-only config grid)
 * is a legitimate NARROW and passes. Only the all-writes-false shape is a
 * contradiction, and it has no honest reading.
 *
 * Lives at `create()` — the authoring surface (ADR-0077) — alongside
 * {@link warnGenericPasswordFields}, rather than in raw `.parse()`: stored rows
 * arriving through the protocol-17 conversion are a 1:1 rename of values that
 * were already writable, and failing a LOAD on metadata already at rest would
 * turn an authoring defect into an outage.
 */
function assertSystemDataIsWritable(
  objectName: unknown,
  managedBy: unknown,
  userActions: unknown,
): void {
  if (managedBy !== 'system-data') return;
  const aff = resolveCrudAffordances({ managedBy, userActions } as never);
  if (aff.create || aff.edit || aff.delete) return;
  const name = typeof objectName === 'string' && objectName.length > 0 ? objectName : '<unnamed>';
  throw new Error(
    `ObjectSchema.create('${name}'): \`managedBy: 'system-data'\` declares "platform-defined `
    + 'schema, admin/user-writable DATA", but this object\'s resolved affordances grant no '
    + 'create, edit or delete — so nothing about it is user-writable and the bucket name is '
    + 'false. Use `managedBy: \'engine-owned\'` for rows a platform service owns end to end '
    + '(written via `isSystem` / a service SYSTEM_CTX), or `append-only` for an immutable '
    + 'audit log. If the object IS user-writable, drop the `userActions` entries closing '
    + 'create/edit/delete — the `system-data` default already grants create, edit, delete and '
    + 'exportCsv, so `userActions` is for NARROWING those (#3355). The one verb it does not '
    + 'grant is CSV `import`, which is opt-in per object (#4671).',
  );
}

/**
 * [ADR-0079] Back-compat alias normalization: an object authored with the
 * deprecated `displayNameField` key still parses by mapping it onto the
 * canonical `nameField` when `nameField` is absent. `displayNameField` is
 * PRESERVED on the output (cross-repo consumers / older tests still read it).
 * Non-object inputs pass through untouched (Zod raises the real type error).
 */
function normalizeNameFieldAlias(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const obj = input as Record<string, unknown>;
  if (obj.nameField == null && typeof obj.displayNameField === 'string') {
    return { ...obj, nameField: obj.displayNameField };
  }
  return input;
}

/**
 * [ADR-0085] Parse-time alias normalization for the semantic-role renames
 * (same pattern as `normalizeNameFieldAlias`; deprecated keys are PRESERVED
 * on output for cross-repo back-compat):
 *
 * - (`compactLayout` ⇄ `highlightFields` mirrored here during the ADR-0085
 *   deprecation window; RETIRED by framework#2536 once objectui#2168 shipped.)
 * - `fieldGroups[].collapse` derived from the deprecated flags when absent:
 *   the UI-dialect `collapsible`/`collapsed` pair wins over the old
 *   `defaultExpanded` (it is what designer-authored metadata actually
 *   carries); mapping: collapsed:true → 'collapsed'; collapsible:true →
 *   'expanded'; collapsible:false → 'none'; defaultExpanded:false →
 *   'collapsed'; defaultExpanded:true → 'expanded'.
 */
function normalizeSemanticRoleAliases(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const obj = input as Record<string, unknown>;
  let out = obj;

  if (Array.isArray(obj.fieldGroups)) {
    let changed = false;
    const groups = (obj.fieldGroups as unknown[]).map((g) => {
      if (!g || typeof g !== 'object' || Array.isArray(g)) return g;
      const grp = g as Record<string, unknown>;
      if (grp.collapse != null) return g;
      let collapse: string | undefined;
      if (typeof grp.collapsible === 'boolean' || typeof grp.collapsed === 'boolean') {
        collapse = grp.collapsed === true ? 'collapsed' : grp.collapsible === true ? 'expanded' : 'none';
      } else if (typeof grp.defaultExpanded === 'boolean') {
        collapse = grp.defaultExpanded ? 'expanded' : 'collapsed';
      }
      if (collapse === undefined) return g;
      changed = true;
      return { ...grp, collapse };
    });
    if (changed) out = { ...out, fieldGroups: groups };
  }

  return out;
}

/**
 * Enhanced ObjectSchema with Factory
 */
export const ObjectSchema = lazySchema(() => {
  // Capture the ORIGINAL ZodObject parse/safeParse before `Object.assign`
  // mutates `ObjectSchemaBase` in place (assign returns the same object, so
  // overriding `.parse` on the result would otherwise recurse into itself).
  const baseParse = ObjectSchemaBase.parse.bind(ObjectSchemaBase);
  const baseSafeParse = ObjectSchemaBase.safeParse.bind(ObjectSchemaBase);
  return Object.assign(ObjectSchemaBase, {
  /**
   * [ADR-0079] Parse with deprecated-`displayNameField`→`nameField` alias
   * normalization applied first. Wraps the captured original ZodObject parse,
   * so `.shape` / `.create()`'s internal `ObjectSchemaBase.parse` keep working.
   */
  parse(data: unknown, params?: Parameters<typeof ObjectSchemaBase.parse>[1]) {
    return baseParse(normalizeSemanticRoleAliases(normalizeNameFieldAlias(data)), params);
  },
  safeParse(data: unknown, params?: Parameters<typeof ObjectSchemaBase.safeParse>[1]) {
    return baseSafeParse(normalizeSemanticRoleAliases(normalizeNameFieldAlias(data)), params);
  },
  /**
   * Type-safe factory for creating business object definitions.
   * 
   * Enhancements over raw schema:
   * - **Auto-label**: Generates `label` from `name` if not provided (snake_case → Title Case).
   * - **Validation**: Runs Zod `.parse()` to validate the config at creation time.
   * - **No silent strip** (ADR-0032 / #1535): unknown top-level keys (e.g. a
   *   typo'd `validation`, or an object-level `workflows[]`) are rejected with a
   *   precise, fixable error instead of being discarded by Zod's `.strip()`.
   *
   * @example
   * ```ts
   * const Task = ObjectSchema.create({
   *   name: 'project_task',
   *   // label auto-generated as 'Project Task'
   *   fields: {
   *     subject: { type: 'text', label: 'Subject', required: true },
   *   },
   * });
   * ```
   */
  create: <const T extends z.input<typeof ObjectSchemaBase>>(config: NoExcessObjectKeys<T>): Omit<ServiceObject, 'fields'> & Pick<T, 'fields'> => {
    // ADR-0032 "no silent failure" for schema shape (issue #1535): an unknown
    // top-level key here used to be discarded silently by Zod's `.strip()`. We
    // reject it with a located, fixable message *before* parsing so authors get
    // a build error instead of vanished metadata.
    const cfg = config as T & Record<string, unknown>;
    const knownKeys = Object.keys(ObjectSchemaBase.shape);
    const unknownKeys = Object.keys(cfg).filter((k) => !knownKeys.includes(k));
    if (unknownKeys.length > 0) {
      throw unknownKeyError(cfg.name, unknownKeys, knownKeys);
    }
    // ADR-0100: warn (non-fatally) when a `password` field is declared on a
    // generic, non-better-auth object — it is masked-on-read but plaintext at
    // rest, not hashed. `create()` is the authoring surface (ADR-0077), so the
    // steer lives here rather than in raw `.parse()`.
    warnGenericPasswordFields(cfg.name, cfg.fields, cfg.managedBy);
    // [#3355] `system-data` on an object that grants no user write is a
    // contradiction with no honest reading — refuse it here, where it is cheap
    // to fix, rather than shipping a bucket whose name lies again.
    assertSystemDataIsWritable(cfg.name, cfg.managedBy, cfg.userActions);
    const withDefaults = {
      ...cfg,
      label: cfg.label ?? snakeCaseToLabel(cfg.name as string),
    };
    // [ADR-0079] `ObjectSchemaBase.parse` here is the alias-normalizing override
    // assigned just below (Object.assign mutates the base in place), so the
    // deprecated `displayNameField`→`nameField` mapping is applied for create()
    // too — no need to normalize again at this call site.
    return ObjectSchemaBase.parse(withDefaults) as Omit<ServiceObject, 'fields'> & Pick<T, 'fields'>;
  },
  });
});

export type ServiceObject = z.input<typeof ObjectSchemaBase>;
/** Post-parse shape of {@link ServiceObject} — defaults applied, transforms run (ADR-0122). */
export type ServiceObjectParsed = z.infer<typeof ObjectSchemaBase>;
export type ObjectCapabilities = z.input<typeof ObjectCapabilities>;
/** Post-parse shape of {@link ObjectCapabilities} — defaults applied, transforms run (ADR-0122). */
export type ObjectCapabilitiesParsed = z.infer<typeof ObjectCapabilities>;
export type ObjectIndex = z.input<typeof IndexSchema>;
/** Post-parse shape of {@link ObjectIndex} — defaults applied, transforms run (ADR-0122). */
export type ObjectIndexParsed = z.infer<typeof IndexSchema>;
export type TenancyConfig = z.input<typeof TenancyConfigSchema>;
export type ObjectAccessConfig = z.input<typeof ObjectAccessConfigSchema>;
/** Post-parse shape of {@link ObjectAccessConfig} — defaults applied, transforms run (ADR-0122). */
export type ObjectAccessConfigParsed = z.infer<typeof ObjectAccessConfigSchema>;
export type LifecycleClass = z.input<typeof LifecycleClassSchema>;
export type Lifecycle = z.input<typeof LifecycleSchema>;

/**
 * Resolved CRUD affordance matrix for an object — what generic
 * lifecycle actions UI clients should expose in their toolbars.
 *
 * Use {@link resolveCrudAffordances} to compute this from a schema; the
 * `managedBy` flag drives the defaults, and the optional `userActions`
 * block per-flag-overrides them. UI clients (`ObjectView`,
 * `RecordDetailView`, `RecordFormPage`, …) gate their buttons on this
 * matrix in combination with the user's permissions.
 *
 * The presence of an affordance here means "the *object* permits this
 * action conceptually"; the user still needs the matching permission
 * grant to execute it.
 */
export interface CrudAffordances {
  /** Generic "New" button (single record creation form). */
  create: boolean;
  /**
   * CSV bulk-import wizard. `platform` is the only bucket that grants it by
   * default; every other bucket — `config`, `system-data`, `engine-owned`,
   * `append-only`, `better-auth` — makes it opt-in via
   * `userActions: { import: true }`.
   */
  import: boolean;
  /** Inline + form editing of existing rows. */
  edit: boolean;
  /** Row-level + bulk delete. */
  delete: boolean;
  /** CSV / clipboard export. Allowed even on append-only audit tables by default. */
  exportCsv: boolean;
  /**
   * Per-record CEL predicates for the built-in row Edit action, present only
   * when `userActions.edit` used the object form (objectui#2614). Evaluate
   * per row against `record.*`; see {@link RowCrudActionOverrideSchema}.
   */
  editPredicates?: RowCrudPredicates;
  /** Per-record CEL predicates for the built-in row Delete action. */
  deletePredicates?: RowCrudPredicates;
  /**
   * CEL predicates for the generic New button, present only when
   * `userActions.create` used the object form (#7692). Unlike the row
   * predicates above these evaluate **once per toolbar**, against the record
   * in scope where the toolbar renders — the host record on a related list,
   * and nothing at all on a standalone object list. See
   * {@link RowCrudActionOverrideSchema}.
   */
  createPredicates?: RowCrudPredicates;
  /** Toolbar-scope CEL predicates for the CSV import entry; same binding as {@link createPredicates}. */
  importPredicates?: RowCrudPredicates;
}

/**
 * Per-record gating predicates carried through {@link resolveCrudAffordances}.
 * Kept as authored (`string` shorthand or `{ dialect, source }` envelope) —
 * consumers hand them to the canonical CEL row-predicate evaluator untouched.
 */
export interface RowCrudPredicates {
  visibleWhen?: Expression | ExpressionInput;
  disabledWhen?: Expression | ExpressionInput;
}

/**
 * Default affordance matrix per {@link ObjectSchemaBase.managedBy} bucket.
 * Mirrors how Salesforce / ServiceNow / Workday / Notion expose CRUD on
 * different categories of system tables.
 *
 *   platform     — full CRUD (user-owned business data)
 *   config       — admin authored: New/Edit/Delete OK, no CSV import
 *                  (definitions have nested envelopes; admins should use
 *                  a purpose-built "Import definition" action instead)
 *   system-data  — platform-defined schema holding admin/user-writable data
 *                  (RBAC link tables, prefs, messaging config). DEFAULT is
 *                  WRITABLE — the bucket exists to say "the data is yours" —
 *                  and an object that takes less NARROWS via `userActions`.
 *                  The ONE exception is CSV import, which is opt-IN here:
 *                  the bucket's charter members are the RBAC link tables, and
 *                  a bulk-import entry point on a grant table is a lever a
 *                  bucket default should not hand out by inheritance (#4671).
 *                  An object that genuinely wants the wizard writes
 *                  `userActions: { import: true }`.
 *                  Affordance declaration only; authz stays the delegated-admin
 *                  gate / RLS / permission sets (ADR-0103, renamed from the
 *                  locked-default `system` in v17 — #3355)
 *   engine-owned — runtime rows the engine owns end to end; no user writes.
 *                  The explicit, self-documenting successor to the old
 *                  engine-owned DEFAULT of `system`
 *   append-only  — audit log: View + Export only
 *   better-auth  — identity tables owned by better-auth driver; CRUD
 *                  routed through purpose-built actions (Invite, Reset
 *                  PW, Revoke, …)
 */
const CRUD_AFFORDANCE_DEFAULTS: Record<NonNullable<ServiceObject['managedBy']> | 'platform', CrudAffordances> = {
  platform:       { create: true,  import: true,  edit: true,  delete: true,  exportCsv: true },
  config:         { create: true,  import: false, edit: true,  delete: true,  exportCsv: true },
  'system-data':  { create: true,  import: false, edit: true,  delete: true,  exportCsv: true },
  'engine-owned': { create: false, import: false, edit: false, delete: false, exportCsv: true },
  'append-only':  { create: false, import: false, edit: false, delete: false, exportCsv: true },
  'better-auth':  { create: false, import: false, edit: false, delete: false, exportCsv: true },
};

/**
 * Resolve the effective CRUD affordance matrix for an object schema.
 *
 * Starts from the bucket default keyed off `managedBy` (defaulting to
 * `'platform'` if unset) and applies the per-flag overrides in
 * `userActions`. Returns a fresh object so callers can mutate safely.
 *
 * @example
 * ```ts
 * const aff = resolveCrudAffordances(sysApprovalRequestSchema);
 * // → { create:false, import:false, edit:false, delete:false, exportCsv:true }
 * ```
 */
export function resolveCrudAffordances(
  obj: Pick<ServiceObject, 'managedBy' | 'userActions'> | { managedBy?: string; userActions?: ServiceObject['userActions'] },
): CrudAffordances {
  const bucket = (obj?.managedBy ?? 'platform') as keyof typeof CRUD_AFFORDANCE_DEFAULTS;
  const base = CRUD_AFFORDANCE_DEFAULTS[bucket] ?? CRUD_AFFORDANCE_DEFAULTS.platform;
  const overrides = obj?.userActions ?? {};
  const create = normalizeRowCrudOverride(overrides.create, base.create);
  const imp = normalizeRowCrudOverride(overrides.import, base.import);
  const edit = normalizeRowCrudOverride(overrides.edit, base.edit);
  const del = normalizeRowCrudOverride(overrides.delete, base.delete);
  const out: CrudAffordances = {
    create:    create.enabled,
    import:    imp.enabled,
    edit:      edit.enabled,
    delete:    del.enabled,
    exportCsv: overrides.exportCsv ?? base.exportCsv,
  };
  if (create.predicates) out.createPredicates = create.predicates;
  if (imp.predicates) out.importPredicates = imp.predicates;
  if (edit.predicates) out.editPredicates = edit.predicates;
  if (del.predicates) out.deletePredicates = del.predicates;
  return out;
}

/**
 * Collapse a `userActions` CRUD override — bare boolean or
 * `{ enabled, visibleWhen, disabledWhen }` object — onto the bucket default.
 * The predicates pass through as authored; `predicates` is only set when at
 * least one predicate is present, so the boolean-only path stays
 * byte-identical to the pre-#2614 result. Shared by all four predicate-
 * carrying flags: `edit`/`delete` (per row) and `create`/`import` (per
 * toolbar, #7692) — the collapse is the same, only the binding differs.
 */
function normalizeRowCrudOverride(
  override: boolean | { enabled?: boolean; visibleWhen?: unknown; disabledWhen?: unknown } | null | undefined,
  base: boolean,
): { enabled: boolean; predicates?: RowCrudPredicates } {
  if (override == null) return { enabled: base };
  if (typeof override === 'boolean') return { enabled: override };
  const enabled = override.enabled ?? base;
  const visibleWhen = override.visibleWhen as RowCrudPredicates['visibleWhen'];
  const disabledWhen = override.disabledWhen as RowCrudPredicates['disabledWhen'];
  if (visibleWhen == null && disabledWhen == null) return { enabled };
  const predicates: RowCrudPredicates = {};
  if (visibleWhen != null) predicates.visibleWhen = visibleWhen;
  if (disabledWhen != null) predicates.disabledWhen = disabledWhen;
  return { enabled, predicates };
}

// =================================================================
// Object Ownership Model
// =================================================================

/**
 * How a contribution relates to the object it targets — the registry's
 * CONTRIBUTOR-kind vocabulary.
 * 
 * - `own`: This package is the original author/owner of the object.
 *   Only one package may own a given object name. The owner defines
 *   the base schema (table name, primary key, core fields).
 * 
 * - `overlay`: [ADR-0029 D9.1] A TENANT customization layer over the owner's
 *   definition, hydrated from a `sys_metadata` row. It REPLACES the base layer
 *   at resolution time (`base = overlay ?? own`) while owning nothing — no
 *   namespace claim, no package membership, no table — so the single-owner
 *   invariant keeps counting exactly one `own` per object name with no
 *   exemption clause.
 * 
 * - `extend`: This package adds fields, views, or actions to an
 *   existing object owned by another package. Multiple packages
 *   may extend the same object. Extensions are merged at boot time.
 * 
 * ## LOADER-FACING, NEVER AUTHOR-FACING
 * 
 * No author ever writes one of these values. A package author declares
 * `objectExtensions: [{ extend: '…' }]` and the LOADER picks `extend`; the
 * package loader picks `own`; ADR-0029 D9.1 binds `overlay` to the two
 * `sys_metadata` hydration seams and to nothing else. This enum is the shared
 * vocabulary those loaders name their choice with — not an authoring surface —
 * and D9.1 binds it to stay that way, because a new kind that no hand-written
 * or AI-written metadata can reach for adds no way to get metadata wrong.
 * 
 * NOTE: this is the package-CONTRIBUTION kind, DISTINCT from the RECORD
 * -ownership model (`user` | `org` | `none`) that lives on the object schema's
 * own `ownership` property — do not conflate the two despite the shared word.
 * 
 * Follows Salesforce/ServiceNow patterns:
 *   object name = database table name, globally unique, no namespace prefix.
 */
export const ObjectOwnershipEnum = z.enum(['own', 'extend', 'overlay']);
export type ObjectOwnership = z.input<typeof ObjectOwnershipEnum>;

/**
 * Object Extension Entry — used in `objectExtensions` array.
 * Declares fields/config to merge into an existing object owned by another package.
 * 
 * @example
 * ```ts
 * objectExtensions: [{
 *   extend: 'contact',               // target object FQN
 *   fields: { sales_stage: Field.select([...]) },
 * }]
 * ```
 */
export const ObjectExtensionSchema = lazySchema(() => strictObject({
  surface: 'this object extension',
  history:
    'Until #4001 these were dropped silently — the extension still parsed and still ' +
    'registered, so fields or rules an author meant to merge into someone else\'s object ' +
    'simply never arrived, on a surface where the target is owned by another package and ' +
    'the absence is easy to blame on precedence.',
  aliases: {
    object: 'extend',
    objectName: 'extend',
    target: 'extend',
    name: 'extend',
    extends: 'extend',
    order: 'priority',
  },
  guidance: {
    // The merge in `objectql/src/engine.ts` copies EXACTLY the declared keys
    // (extend / fields / label / pluralLabel / description / validations /
    // indexes / priority) onto the extension def. Anything else is not
    // "unsupported yet" — there is no slot for it to arrive through.
    actions:
      '`actions` cannot be contributed through an object extension — the merge carries ' +
      '`fields`, `label`, `pluralLabel`, `description`, `validations` and `indexes` only. ' +
      "Declare a top-level action with `objectName: '<target>'`; `defineStack()` attaches " +
      'it to the object.',
    hooks:
      '`hooks` cannot be contributed through an object extension — declare a top-level ' +
      'hook bound to the target object instead.',
    listViews:
      '`listViews` cannot be contributed through an object extension — declare a ' +
      'top-level `view` bound to the target object instead.',
    fieldGroups:
      '`fieldGroups` cannot be contributed through an object extension — the merge does ' +
      'not carry them. Add the fields here and declare the groups on the owning object, ' +
      'or assign a Page for the layout.',
  },
}, {
  /** The target object name (FQN) to extend */
  extend: z.string().describe('Target object name (FQN) to extend'),
  
  /** Fields to merge into the target object (additive) */
  fields: z.record(z.string(), FieldSchema).optional().describe('Fields to add/override'),
  
  /** Override label */
  label: z.string().optional().describe('Override label for the extended object'),
  
  /** Override plural label */
  pluralLabel: z.string().optional().describe('Override plural label for the extended object'),
  
  /** Override description */
  description: z.string().optional().describe('Override description for the extended object'),
  
  /** Additional validation rules to add */
  validations: z.array(ValidationRuleSchema).optional().describe('Additional validation rules to merge into the target object'),
  
  /** Additional indexes to add */
  indexes: z.array(IndexSchema).optional().describe('Additional indexes to merge into the target object'),
  
  /** Merge priority. Higher number applied later (wins on conflict). Default: 200 */
  priority: z.number().int().min(0).max(999).default(200).describe('Merge priority (higher = applied later)'),
}));

export type ObjectExtension = z.input<typeof ObjectExtensionSchema>;
/** Post-parse shape of {@link ObjectExtension} — defaults applied, transforms run (ADR-0122). */
export type ObjectExtensionParsed = z.infer<typeof ObjectExtensionSchema>;

/**
 * Type-safe factory for an extension to an object owned by another package. Validates at authoring time via
 * `.parse()` and accepts input-shape config (optional defaults, CEL
 * shorthand) — preferred over a bare `: ObjectExtension` literal.
 */
export function defineObjectExtension(config: z.input<typeof ObjectExtensionSchema>): ObjectExtensionParsed {
  return ObjectExtensionSchema.parse(config);
}
