// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The permanent metadata migration chain (ADR-0087 D3).
 *
 * One {@link MigrationStep} per protocol major that carried a break. Each step's
 * mechanical transforms are the D2 conversions that graduated into it (referenced
 * by id, so the transform + fixture pair are never duplicated), and its
 * `semantic` list is the non-lossless residue D2 could not express.
 *
 * The chain is a **forever artifact**: every step back to
 * {@link MIGRATION_SUPPORT_FLOOR} stays replayable, and CI replays the full chain
 * from the oldest supported major's fixtures to current on every release
 * (`migrations.test.ts`). The support floor is an explicit release-policy knob —
 * how far back `migrate meta --from N` reaches — revisitable per major, never an
 * accident of deletion.
 */

import type { MigrationStep } from './types.js';

/**
 * The oldest protocol major the chain guarantees a replayable path from.
 * `objectstack migrate meta --from N` supports any `N >= MIGRATION_SUPPORT_FLOOR`.
 * A release-policy decision (ADR-0087 D3), not an accident of what still exists.
 */
export const MIGRATION_SUPPORT_FLOOR = 10;

/**
 * Protocol 11 step.
 *
 * Mechanical: the four protocol-11 conversions graduated from the D2 load path
 * (`flow-node-http-callout-rename`, `page-kind-jsx-to-html`,
 * `flow-node-crud-filter-alias`, plus the backfilled
 * `object-compactLayout-to-highlightFields` rename that shipped in 11.7.0 before
 * the conversion layer existed). Semantic: the two non-lossless live windows the
 * conversion layer deliberately excludes — a composite `titleFormat` template and
 * SQL-ish RLS predicates — each surfaced as a structured TODO rather than a silent
 * or lossy auto-rewrite.
 */
const step11: MigrationStep = {
  toMajor: 11,
  rationale:
    'Protocol 11 unified the divergent HTTP callout node types to `http`, made ' +
    "`html` the canonical page kind (deprecating the `jsx` alias), canonicalized " +
    'the CRUD flow-node filter key, and renamed object `compactLayout` to ' +
    '`highlightFields` (ADR-0085). These are mechanical and replay losslessly. Two ' +
    'related deprecations are semantic and cannot be auto-applied: a composite ' +
    '`titleFormat` render template has no single canonical `nameField`, and SQL-ish ' +
    'RLS predicates must be rewritten to canonical CEL — both are delegated to the ' +
    'consumer with explicit acceptance criteria.',
  conversionIds: [
    'flow-node-http-callout-rename',
    'page-kind-jsx-to-html',
    'flow-node-crud-filter-alias',
    'object-compactLayout-to-highlightFields',
  ],
  semantic: [
    {
      id: 'object-titleFormat-to-nameField',
      surface: 'object.titleFormat',
      replacement: 'object.nameField',
      reason:
        'A single-field `titleFormat` maps 1:1 to `nameField`, but a composite template ' +
        '(e.g. `{firstName} {lastName}`) has no lossless single-field target — it must ' +
        'become a formula field designated as `nameField`. The choice of formula is a ' +
        'judgment the transform cannot make.',
      acceptanceCriteria:
        'Each object with a `titleFormat` declares a `nameField`; a composite title is ' +
        'backed by a formula field. `objectstack validate` passes and record display ' +
        'names render identically to before.',
    },
    {
      id: 'rls-sql-predicate-to-cel',
      surface: 'security.rls.predicate',
      replacement: 'CEL predicate',
      reason:
        'SQL-ish RLS predicates were deprecated in favor of canonical CEL. Translation ' +
        'is not a pure token rename — operators, functions, and null semantics differ — ' +
        'so it cannot be applied losslessly by the chain.',
      acceptanceCriteria:
        'Every RLS predicate parses as CEL and `objectstack validate` reports no ' +
        'expression errors; row visibility is unchanged for a representative fixture set.',
    },
  ],
};

/**
 * Protocol 12 step.
 *
 * The one metadata-facing break was a **secure-default flip**, not a shape
 * change: `api.requireAuth` went from `false` to `true` (ADR-0056 D2), so
 * anonymous `/data/*` access is denied unless explicitly opted out. Whether a
 * deployment *intends* public data access is a judgment the chain cannot make
 * — surfaced as a structured TODO.
 */
const step12: MigrationStep = {
  toMajor: 12,
  rationale:
    'Protocol 12 flipped the REST data-API default to authenticated ' +
    '(`api.requireAuth: true`, ADR-0056 D2). No metadata shape changed, so there ' +
    'is nothing to rewrite mechanically; a deployment that intentionally serves ' +
    'data anonymously must now declare that posture explicitly.',
  conversionIds: [],
  semantic: [
    {
      id: 'rest-requireauth-default-flip',
      surface: 'api.requireAuth',
      replacement: "explicit `api: { requireAuth: false }` (intentionally-public deployments only)",
      reason:
        'The global default flipped from `false` to `true` in protocol 12: anonymous ' +
        'requests to the `/data/*` CRUD and batch endpoints are rejected with 401 ' +
        'unless the stack opts out. Whether anonymous access was intentional (demo / ' +
        'kiosk) or an accident is a security judgment no transform can make.',
      acceptanceCriteria:
        'A deployment that relies on anonymous data access declares ' +
        '`api: { requireAuth: false }` on the stack config (and accepts the boot ' +
        'warning); every other consumer verifies its clients authenticate. ' +
        '`objectstack validate` and the consumer test suite pass.',
    },
  ],
};

/**
 * Protocol 13 step — the ADR-0090 permission-model-v2 breaking wave.
 *
 * ADR-0090 shipped these as **pre-launch one-step renames with no alias
 * window** (its D3/D4 explicitly supersede the alias discipline). The lossless
 * subset is preserved here as retired conversions so the chain replays it; the
 * judgment-laden remainder (profiles, hierarchy re-homing, CEL rewrites,
 * postures) is delegated as structured TODOs.
 */
const step13: MigrationStep = {
  toMajor: 13,
  rationale:
    'Protocol 13 (ADR-0090 P1) converged the permission model: Role became ' +
    'Position (flat; hierarchy lives on the business-unit tree), the Profile ' +
    'concept was removed, the OWD enum shrank to its canonical four values, and ' +
    'a custom object with an owner field and no `sharingModel` now defaults to ' +
    '`private` instead of public. Key renames replay mechanically; everything ' +
    'that changes *meaning* (profile → position/permission-set design, hierarchy ' +
    're-homing, CEL identifier rewrites, sharing postures) is delegated with ' +
    'acceptance criteria.',
  conversionIds: [
    'stack-roles-to-positions',
    'owd-legacy-read-aliases',
    'sharing-recipient-role-to-position',
  ],
  semantic: [
    {
      id: 'permission-set-profile-removed',
      surface: 'permissionSet.kind / permissionSet.isProfile',
      replacement: 'position-based assignment + permission-set grants (ADR-0090 D2)',
      reason:
        'The Profile concept was removed: `isProfile` is gone from ' +
        '`PermissionSetSchema` and the `profile` metadata kind folded into ' +
        '`position`. Mapping a profile onto positions and permission-set grants is ' +
        'an authorization-design decision, not a rename.',
      acceptanceCriteria:
        'No permission set declares `isProfile` or kind `profile`; the intended ' +
        'assignees hold equivalent grants via positions/permission sets. The access ' +
        'matrix (`os compile` access-matrix gate, where enabled) is reviewed and ' +
        '`objectstack validate` passes.',
    },
    {
      id: 'position-hierarchy-flattened',
      surface: 'position.parent / sharingRule recipient role_and_subordinates',
      replacement: 'business-unit tree + `unit_and_subordinates` (ADR-0090 D3)',
      reason:
        'Positions are flat in v2 — `parent` was removed and the ' +
        '`role_and_subordinates` recipient with it; hierarchy lives on the ' +
        'business-unit tree, which expands a DIFFERENT structure than the retired ' +
        'role tree. Re-homing an org hierarchy is a judgment call.',
      acceptanceCriteria:
        'No position declares `parent`; former `role_and_subordinates` rules are ' +
        're-expressed with `unit_and_subordinates` over an equivalent business-unit ' +
        'tree. Row visibility is unchanged for a representative fixture set.',
    },
    {
      id: 'cel-current-user-roles-to-positions',
      surface: 'CEL/formula: current_user.roles',
      replacement: 'current_user.positions',
      reason:
        'The EvalUser/CEL contract renamed `current_user.roles` to ' +
        '`current_user.positions`. The token lives inside free-form expression ' +
        'strings, where a blind textual substitution could corrupt string literals ' +
        'or comments — so the rewrite is delegated to the author.',
      acceptanceCriteria:
        'No expression references `current_user.roles`; formula validation and ' +
        '`objectstack validate` report no unknown-identifier errors; predicate ' +
        'behavior is unchanged for representative users.',
    },
    {
      id: 'owd-full-alias-removed',
      surface: "object.sharingModel: 'full'",
      replacement: "'public_read_write' or explicit sharing rules",
      reason:
        "The legacy `'full'` OWD alias implied full access (including transfer/ " +
        'delete) — wider than any canonical OWD value, so it has no lossless ' +
        "target ('read'/'read_write' converted mechanically; this one did not). " +
        'Choosing between `public_read_write` and explicit sharing rules is a ' +
        'security-posture decision.',
      acceptanceCriteria:
        "No object declares sharingModel 'full'; the chosen replacement posture is " +
        'verified against the intended access (who can read/write/delete) for a ' +
        'representative fixture set.',
    },
    {
      id: 'sharing-model-secure-default',
      surface: 'object.sharingModel (absent, custom object with owner field)',
      replacement: 'an explicit `sharingModel` declaration',
      reason:
        'ADR-0090 D1 secure default: a custom object with an owner field and NO ' +
        '`sharingModel` now resolves `private` (it used to fall through to fully ' +
        'public). Restoring the old exposure must be a deliberate, visible ' +
        'declaration — the chain must not silently re-open data.',
      acceptanceCriteria:
        'Every custom object that relied on the implicit public posture declares ' +
        'an explicit `sharingModel`; row visibility is verified for a ' +
        'representative fixture set (owners, non-owners, admins).',
    },
  ],
};

/**
 * Protocol 14 step.
 *
 * One metadata-facing break: the book audience gated arm renamed `{ profile }`
 * → `{ permissionSet }` (ADR-0090 D2 fallout, shipped one-step pre-launch).
 * Fully lossless → one retired conversion, no semantic residue.
 */
const step14: MigrationStep = {
  toMajor: 14,
  rationale:
    'Protocol 14 renamed the book audience gated arm from `{ profile }` to ' +
    '`{ permissionSet }` (packages own permission sets, never positions — ' +
    'ADR-0090 D9). A pure key rename, preserved as a retired conversion; there ' +
    'is no semantic residue.',
  conversionIds: ['book-audience-profile-to-permission-set'],
  semantic: [],
};

/**
 * Protocol 15 step.
 *
 * Mechanical: the ADR-0089 conditional-visibility unification — `visibleOn`
 * (view forms) and `visibility` (page components) → canonical `visibleWhen`.
 * These are LIVE D2 windows (the 15 loader still accepts the old keys); the
 * chain replays the same transforms against source. Semantic: the `.strict()`
 * flip on the three UI schemas — an unknown key is now a parse error, and only
 * the author can say whether it was a typo, a wrong layer, or dead metadata.
 */
const step15: MigrationStep = {
  toMajor: 15,
  rationale:
    'Protocol 15 unified the conditional-visibility predicate under ' +
    '`visibleWhen` (ADR-0089): view-form `visibleOn` and page-component ' +
    '`visibility` are deprecated aliases, accepted and converted at load for ' +
    'this major. It also flipped `FormFieldSchema`, `FormSectionSchema`, and ' +
    '`PageComponentSchema` to `.strict()` — a key those schemas do not declare ' +
    'is now a loud parse error instead of a silent strip (ADR-0049/0078).',
  conversionIds: ['view-visibleOn-to-visibleWhen', 'page-component-visibility-to-visibleWhen'],
  semantic: [
    {
      id: 'ui-schemas-strict-unknown-keys',
      surface: 'view form fields/sections · page components (undeclared keys)',
      replacement: 'declared keys only (`visibleWhen` for visibility predicates)',
      reason:
        'The `.strict()` flip (ADR-0089 D3a) turns a previously silently-stripped ' +
        'unknown key into a parse error. There is no mapping target for an ' +
        'arbitrary unknown key — auto-deleting it would be exactly the silent data ' +
        'loss ADR-0078 bans — so each occurrence needs the author to decide: fix ' +
        'the typo, move it to the right layer, or delete dead metadata.',
      acceptanceCriteria:
        '`objectstack validate` passes with no unknown-key parse errors on form ' +
        'fields, form sections, or page components.',
    },
  ],
};

/**
 * Protocol 16 step.
 *
 * Mechanical: none — the pre-ADR-0021 inline analytics shape
 * (`object`+`categoryField`+`valueField`+`aggregate`, pivot
 * `rowField`/`columnField`) was already removed at protocol 9 (the single-form
 * cutover), below the chain floor, so there is no key to rewrite. Semantic: the
 * `.strict()` flip on `DashboardWidgetSchema` (framework#3251) turns a
 * previously silently-stripped undeclared widget key into a parse error — a
 * class of error that must move from fallible human review to deterministic CI,
 * with no lossless auto-target for an arbitrary unknown key.
 */
const step16: MigrationStep = {
  toMajor: 16,
  rationale:
    'Protocol 16 flipped `DashboardWidgetSchema` to `.strict()` (framework#3251, ' +
    'ADR-0021 endpoint): an undeclared top-level widget key is now a loud parse ' +
    'error instead of a silent strip (ADR-0049 enforce-or-remove, ADR-0078 ' +
    'no-silently-inert). The inline analytics shape it most often catches ' +
    '(`object`+`categoryField`+`valueField`+`aggregate`, pivot ' +
    '`rowField`/`columnField`) was already removed at protocol 9, so no mechanical ' +
    'rewrite applies; the residue is the strictness itself, delegated to the author ' +
    'because an arbitrary unknown key has no lossless canonical target.',
  conversionIds: [],
  semantic: [
    {
      id: 'dashboard-widget-strict-unknown-keys',
      surface: 'dashboard widgets (undeclared top-level keys — legacy inline ' +
        'analytics, objectui-internal `component`/`data`, or typos)',
      replacement: 'declared keys only (`dataset` + `dimensions` + `values` for ' +
        'analytics; `options` for renderer-specific extras)',
      reason:
        'The `.strict()` flip turns a previously silently-stripped unknown key into a ' +
        'parse error. There is no mapping target for an arbitrary unknown key — ' +
        'auto-deleting it would be exactly the silent data loss ADR-0078 bans — so ' +
        'each occurrence needs the author to decide: bind a `dataset` and select ' +
        '`dimensions`/`values`, move a renderer setting under `options`, or delete ' +
        'the dead key.',
      acceptanceCriteria:
        '`objectstack validate` passes with no unknown-key parse errors on dashboard ' +
        'widgets.',
    },
  ],
};

/**
 * Protocol 17 step.
 *
 * Mechanical, and mechanical only: the three deprecated aliases that a schema
 * transform used to fold into a canonical key and drop from the parsed output
 * (`action.execute`, `field.conditionalRequired`, `agent.knowledge.topics`) are
 * removed from the spec. Each is a pure key rename with an unchanged value, so
 * the whole break replays losslessly — there is no semantic residue and the
 * `semantic` list is deliberately empty.
 *
 * The three conversions are `retiredFromLoadPath` from the day they land: 17
 * gives the aliases no acceptance window at all, and each schema tombstones its
 * key with a fix-it error instead. This step is what makes that affordable —
 * `os migrate meta --from <N>` rewrites the consumer's source rather than
 * leaving them to hand-edit against a changelog.
 */
const step17: MigrationStep = {
  toMajor: 17,
  rationale:
    'Protocol 17 removes the last three deprecated authorable aliases: action ' +
    '`execute` (use `target`), field `conditionalRequired` (use `requiredWhen`), and ' +
    'agent `knowledge.topics` (use `knowledge.sources`). Each was already lowered into ' +
    'its canonical key at parse time and dropped from the parsed output, so no runtime ' +
    'behaviour changes — only the authorable surface shrinks to one spelling per slot. ' +
    'All three are pure key renames with unchanged values and replay losslessly; the ' +
    'schemas reject the removed spellings with a fix-it error naming the replacement.\n\n' +
    'It also removes the sharing-rule access level `full` (#3865): declared as ' +
    '"Full Access (Transfer, Share, Delete)" but never enforced as anything but ' +
    '`edit` — both gates matched `edit`/`full` alike, so Setup promised admins a ' +
    'delete grant it never issued (ADR-0078). Unlike the OWD `sharingModel: \'full\'` ' +
    'alias retired at step 13, this one HAS a lossless target precisely because it ' +
    'was inert — old and new shapes are behaviourally identical — so it converts ' +
    'mechanically and leaves no semantic residue. It is the one protocol-17 ' +
    'conversion that keeps a load-path acceptance window: it had no prior ' +
    'deprecation, and a removed enum value cannot carry the fix-it error the three ' +
    'key renames tombstone theirs with.\n\n' +
    'Finally it removes agent `tools` (#3894): the legacy inline ' +
    '`{type,name,description}[]` fallback, which the runtime resolved against the ' +
    'FULL tool registry with no surface check — the one seam that broke ADR-0064\'s ' +
    '"an agent reaches exactly its surface-compatible skills\' tools, nothing falls ' +
    'through to the global registry". Unlike the renames above this has NO lossless ' +
    'target: each entry has to become a reference inside a skill, which is a human ' +
    'decision about which skill. The conversion therefore drops the dead key (the ' +
    'runtime stopped reading it in cloud#910, so it already contributes nothing) and ' +
    'emits a notice per agent so the author knows where capability must be ' +
    're-declared; the schema tombstones the key with a fix-it error naming `skills`.\n\n' +
    'Beyond those spec-surface removals, it graduates the seven flow-node config key ' +
    'aliases the executors still ' +
    'tolerated (#3796): the CRUD nodes\' `object` (use `objectName`) — the last tenant ' +
    'of the `readAliasedConfig` executor shim, which is deleted with it — plus the six ' +
    'open-coded fallbacks that never went through that shim: notify `to`/`subject`/' +
    '`body`/`url` (use `recipients`/`title`/`message`/`actionUrl`) and script ' +
    '`functionName`/`input` (use `function`/`inputs`). All are pure key renames with ' +
    'unchanged values and replay losslessly. Like the sharing-rule access level above ' +
    'they keep a load-path acceptance window: none carried a prior deprecation ' +
    'warning, and `FlowNodeSchema.config` is an unconstrained record, so no schema ' +
    'tombstone can reject them — the conversion layer is the only seam that can ' +
    'declare, convert, and retire them.\n\n' +
    'And it removes the RLS-policy key `priority` (#3896 security audit): promised ' +
    '"conflict resolution" that cannot exist, because applicable policies OR-combine ' +
    '(most permissive wins) — there is never a conflict to order, and nothing ever ' +
    'read the key (call graph closed across the collection site, the projection ' +
    'round-trip and the compiler). A pure lossless delete: outcomes are identical ' +
    'with or without it; the schema tombstones the key with the same prescription.\n\n' +
    'The same close-out retires the four inert tool authoring keys (`category`, ' +
    '`permissions`, `active`, `builtIn`): none is part of AIToolDefinition and no ' +
    'execution path read them. Two were misleading in the dangerous direction — ' +
    '`permissions` promised an invocation gate nothing enforced, and `active: false` ' +
    'read as "withdrawn" while the tool kept reaching the LLM tool set. Lossless ' +
    'deletes; the strict ToolSchema rejects each with its prescription.\n\n' +
    'ADR-0113 splits the `required` tri-binding: post-17, `required` is ONLY the ' +
    'write-time contract (insert must provide; update may not null out; legacy null ' +
    'rows rest), and the physical NOT NULL is the explicit `storage.notNull`. The ' +
    '`field-required-notnull-explicit` conversion preserves every pre-17 source ' +
    'verbatim-in-meaning by stamping `storage.notNull: true` onto each required ' +
    'field — under the old semantics that column WAS created NOT NULL, so the ' +
    'rewrite writes down what the text already meant. Migration-chain-only ' +
    '(retired from the load path): this is a default flip, not a rename, and a ' +
    'loader that auto-applied it would stamp the constraint onto 17-authored ' +
    'sources that deliberately omit it.\n\n' +
    'On the wire contract it also retires the `/analytics/query` request ENVELOPE ' +
    '(#3878): `AnalyticsQueryRequestSchema` used to describe `{ cube, query: {...}, ' +
    'format }` — the dialect of the retired degraded analytics shim (#3891) that the ' +
    'real engine never understood (an envelope body inferred a column-less cube and ' +
    'died as an SQL syntax error). The canonical request body is now the BARE ' +
    'AnalyticsQuery — `cube` + `measures` at the top level — which is what every ' +
    'real caller already sends; the schema tombstones `query`/`format`, and the ' +
    'dispatcher entry validates bodies and answers 400 with the prescription. No ' +
    'stored metadata carries this shape (it was HTTP-only), so the change is two ' +
    'semantic TODOs for API callers rather than a stack conversion.\n\n' +
    'The close-out sweep finishes the enforce-or-remove worklist across the ' +
    'remaining types: action `shortcut`/`bulkEnabled` (no keydown path; the ' +
    "multi-select toolbar reads the view's bulkActions), flow `active`/`template`/" +
    'node `outputSchema`/errorHandling `fallbackNodeId` (`active: false` never ' +
    'stopped a flow — `status` is the enforced lifecycle; faults route via ' +
    'per-node fault edges), the inert view keys (list `responsive`/`performance`, ' +
    'form `data`/`defaultSort`/`aria` — list aria/data stay live), dashboard and ' +
    'widget `aria`/`performance`, `agent.knowledge` (declaring sources never ' +
    'scoped retrieval — absorbs the former topics→sources rename), and ' +
    "`skill.triggerPhrases` (phrases were never matched; routing is " +
    'triggerConditions + the agent allowlist). All pure lossless deletes, each ' +
    'tombstoned at its schema with the prescription.',
  conversionIds: [
    'action-execute-to-target',
    'field-conditionalRequired-to-requiredWhen',
    'agent-tools-to-skills',
    'sharing-rule-access-level-full-to-edit',
    'flow-node-crud-object-alias',
    'flow-node-notify-config-aliases',
    'flow-node-script-config-aliases',
    'permission-rls-priority-removed',
    'tool-inert-authoring-keys-removed',
    'field-required-notnull-explicit',
    'action-inert-keys-removed',
    'flow-inert-keys-removed',
    'view-inert-keys-removed',
    'dashboard-inert-keys-removed',
    'agent-knowledge-removed',
    'skill-trigger-phrases-removed',
  ],
  semantic: [
    {
      id: 'analytics-query-request-envelope-retired',
      surface: 'api.analyticsQueryRequest.query',
      replacement: 'bare AnalyticsQuery body (top-level cube/measures/dimensions/where/...)',
      reason:
        'The { cube, query: {...} } envelope was an HTTP-wire dialect of the retired degraded ' +
        'analytics shim (#3891), never stored in stack metadata — there is no source for the ' +
        'chain to rewrite. Callers of POST /analytics/query and /analytics/sql must move the ' +
        'query.* fields to the body top level themselves.',
      acceptanceCriteria:
        'Every /analytics/query and /analytics/sql call sends the bare AnalyticsQuery shape and ' +
        'succeeds; no request answers 400 VALIDATION_FAILED with the envelope prescription.',
    },
    {
      id: 'enhanced-api-error-field-errors-renamed',
      surface: 'api.enhancedApiError.fieldErrors',
      replacement: 'fields',
      reason:
        'The wire has always carried `fields` — the validators, import coercion, ' +
        'validation-failure.ts, @objectstack/client and the console\'s field-error extractor ' +
        'all say `fields`, and nothing ever emitted `fieldErrors`, so a reader keying on it ' +
        'was reading a field no server sent (ADR-0078\'s silently-inert declaration, on the ' +
        'error envelope). This is a RESPONSE surface: no stack, example or template carries ' +
        'the key, so there is no source for the chain to rewrite — the schema tombstones it ' +
        'via retiredKey() and consumers move their read themselves. ADR-0114 D4, #3977.',
      acceptanceCriteria:
        'No consumer reads `error.fieldErrors`; per-field validation detail is read from ' +
        '`error.fields`, and constructing an EnhancedApiError with `fieldErrors` fails to parse ' +
        'with the rename prescription instead of silently losing the array.',
    },
    {
      id: 'analytics-query-request-format-retired',
      surface: 'api.analyticsQueryRequest.format',
      replacement: '(removed — responses are always the JSON envelope; use the export surface for CSV/XLSX)',
      reason:
        'The `format` key was declared but never implemented (declared ≠ enforced): every ' +
        'response is the JSON envelope regardless of the requested value, so there is no ' +
        'behaviour to preserve and nothing stored to rewrite.',
      acceptanceCriteria:
        'No /analytics/query or /analytics/sql call sends `format`; exports go through the ' +
        'export surface.',
    },
  ],
};

/** All migration steps, keyed by the major they migrate into. */
const step18: MigrationStep = {
  toMajor: 18,
  rationale:
    'Protocol 18 retires `api.requireAuth` (#3963): the deployment-wide opt-out that let a '
    + 'stack serve its ENTIRE data plane anonymously with one boolean. Auth is a kernel '
    + 'concern, not a deployment posture — anonymous access to object data is now denied '
    + 'unconditionally on every HTTP surface. Every surface that legitimately serves a '
    + 'session-less caller derives its own narrow authorization from a DECLARATION instead: '
    + 'the control-plane allowlist, `publicFormGrant` (public form views), share-link tokens '
    + "(read as SYSTEM), and `book.audience: 'public'` (ADR-0046 §6.7). The key is dropped "
    + 'with a notice rather than mapped — there is no replacement value, only a different '
    + 'way to publish (by declaration). A stack that mounts no auth at all now fails at boot '
    + 'when it would serve a data API, instead of receiving an implicit fail-open.\n\n'
    + 'The same major retires `BatchOptions.validateOnly` (#4052): a batch "dry-run" flag that '
    + 'was declared but never implemented — every batch surface (`updateManyData` / '
    + '`deleteManyData` / `batchData`) persisted regardless, so a caller sending it to PREVIEW a '
    + 'mutation got it executed. That is the dangerous direction of declared ≠ enforced: a flag '
    + 'lying about a data-safety guarantee. No dry-run exists today; the schema tombstones the '
    + 'key with the prescription. It is HTTP-only (never stored in stack metadata), so the '
    + 'change is one semantic TODO for API callers rather than a stack conversion.',
  conversionIds: ['stack-api-require-auth-removed'],
  semantic: [
    {
      id: 'batch-options-validate-only-retired',
      surface: 'api.batchOptions.validateOnly',
      replacement: '(removed — no dry-run today; open an issue to design a no-commit batch preview)',
      reason:
        'The `validateOnly` key promised a dry-run ("validate records without persisting") but no '
        + 'batch surface ever read it — updateManyData / deleteManyData / batchData persist '
        + 'regardless. There is no behaviour to preserve and nothing stored to rewrite (it only '
        + 'ever appeared in an HTTP request body). Callers must stop sending it.',
      acceptanceCriteria:
        'No /batch, /updateMany or /deleteMany call sends `options.validateOnly`; a request that '
        + 'includes it answers 400 VALIDATION_FAILED with the retirement prescription.',
    },
  ],
};

export const MIGRATIONS_BY_MAJOR: Readonly<Record<number, MigrationStep>> = {
  11: step11,
  12: step12,
  13: step13,
  14: step14,
  15: step15,
  16: step16,
  17: step17,
  18: step18,
};

/** The majors that have a step, ascending. */
export const MIGRATION_MAJORS: readonly number[] = Object.keys(MIGRATIONS_BY_MAJOR)
  .map(Number)
  .sort((a, b) => a - b);
