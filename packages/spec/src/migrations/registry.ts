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
 *
 * ## ⚠️ The three tables below are GENERATED (#7297)
 *
 * Each step's `semantic` list, {@link RETIRED_KEYS_BY_MAJOR} and
 * {@link RETIRED_DEFS_BY_MAJOR} are concatenated into their `<os-generated …>`
 * regions from `./entries/`, **one file per entry**, sorted by entry id. Add an
 * entry by adding a FILE and running
 * `pnpm --filter @objectstack/spec gen:migration-registry` — never by typing
 * between the markers. See `./entries/README.md`.
 *
 * They were three hand-authored APPEND tables, and every retirement card
 * appended to the same tail line of the same two of them: `step17`'s semantic
 * list and `RETIRED_KEYS_BY_MAJOR[17]` conflicted in **6 of 11** contended
 * re-merge laps over 2026-08-06..10, for 613 hand-resolved lines of conflict
 * markers in four days (#6957's measurement, ruling adopted 2026-08-10). The
 * danger was never the wall-clock: **both tables are consumed as sets**, so a
 * resolution that drops a sibling's entry produces no error anywhere and the
 * retirement it declared silently stops being declared.
 *
 * Everything OUTSIDE the markers — this header, each step's `rationale` and
 * `conversionIds`, and the two tables' load-bearing doc comments — is still
 * hand-written and still merges as text.
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
    // One file per entry under `entries/semantic/`, concatenated here sorted by
    // entry id by `gen:migration-registry` (#7297). Add an entry by adding a
    // FILE — never by editing between the markers, which is generated.
    // <os-generated semantic:11>
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
    // </os-generated semantic:11>
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
    // One file per entry under `entries/semantic/`, concatenated here sorted by
    // entry id by `gen:migration-registry` (#7297). Add an entry by adding a
    // FILE — never by editing between the markers, which is generated.
    // <os-generated semantic:12>
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
    // </os-generated semantic:12>
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
    // One file per entry under `entries/semantic/`, concatenated here sorted by
    // entry id by `gen:migration-registry` (#7297). Add an entry by adding a
    // FILE — never by editing between the markers, which is generated.
    // <os-generated semantic:13>
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
    // </os-generated semantic:13>
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
  semantic: [
    // One file per entry under `entries/semantic/`, concatenated here sorted by
    // entry id by `gen:migration-registry` (#7297). Add an entry by adding a
    // FILE — never by editing between the markers, which is generated.
    // <os-generated semantic:14>
    // </os-generated semantic:14>
  ],
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
    // One file per entry under `entries/semantic/`, concatenated here sorted by
    // entry id by `gen:migration-registry` (#7297). Add an entry by adding a
    // FILE — never by editing between the markers, which is generated.
    // <os-generated semantic:15>
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
    // </os-generated semantic:15>
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
    // One file per entry under `entries/semantic/`, concatenated here sorted by
    // entry id by `gen:migration-registry` (#7297). Add an entry by adding a
    // FILE — never by editing between the markers, which is generated.
    // <os-generated semantic:16>
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
    // </os-generated semantic:16>
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
    'The same graduation covers `wait`, whose fallback was not a config-to-config ' +
    'rename (#4045). `wait` keeps its contract in the declared `waitEventConfig` ' +
    'block, not in `config` at all — yet the executor also read six loose `config` ' +
    'keys, two of them (`duration`, `signal`) spellings the spec never declared. ' +
    'The conversion lifts them onto the declared block in the executor\'s own `??` ' +
    'precedence, so a value already declared wins and its loose counterpart is left ' +
    'shadowed. One wrinkle makes this a rewrite rather than a delete: ' +
    '`waitEventConfig.eventType` is required once the block exists, and the loader ' +
    'parses the CONVERTED flow — so a source carrying only `config: { duration }` ' +
    'is stamped with `eventType: \'timer\'`, the exact default the executor applied ' +
    'to that shape. Behaviour-preserving in both directions.\n\n' +
    '`connector_action` gets the same lift for the opposite reason (#4045). Its ' +
    'contract also lives in a declared sibling block (`connectorConfig`), and the ' +
    'executor never read `config` at all — but the node\'s descriptor published a ' +
    '`configSchema` declaring `connectorId`/`actionId`/`input` as `config` keys, and ' +
    'the Studio inspector derives its form from a published schema, so schema-driven ' +
    'authoring wrote the trio to the wrong place and produced nodes that refused to ' +
    'dispatch. The conversion lifts the trio onto the declared block (declared keys ' +
    'win; a lift that cannot complete the required connectorId+actionId pair leaves ' +
    'the node untouched rather than turning a step-time refusal into a load ' +
    'failure), and the descriptor stops publishing the mis-rooted schema.\n\n' +
    'The reconciliation that found those also found `map`, whose executor read a ' +
    'bare `cfg.flowName ?? cfg.flow` for an undeclared `flow` spelling no schema ' +
    'ever described (#4045). A pure rename, graduated the same way, so the ' +
    'executor reads only the canonical `flowName`.\n\n' +
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
    'The AppSchema sheds its seven dead authoring keys (2026-06 liveness audit, ' +
    '#4001 app step): `version` (apps are versioned by manifest.version), `aria`, ' +
    '`objects`/`apis` (the self-described "config file convenience" — nothing read ' +
    'them; the chatbot derives an app\'s objects from its nav items), `sharing`/' +
    '`embed` (a declared-but-unenforced public surface — the only live path is ' +
    'FormView.sharing; ADR-0049), and `mobileNavigation` (fully unimplemented). ' +
    'Pure lossless deletes — none ever had a runtime effect; each key is ' +
    'tombstoned with its prescription.\n\n' +
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
    'tombstoned at its schema with the prescription.\n\n' +
    'One flow key changes WITHOUT a lossless target: `errorHandling.maxRetries` ' +
    '(#4247). It carried two defaults — `.default(0)` in FlowSchema and ' +
    "`maxRetries ?? 3` in the engine's retryExecution — and because `??` fires " +
    'only on `undefined`, an unstated count meant 0 retries for a flow parsed by ' +
    'the schema and 3 for a definition handed to the engine directly: the retry ' +
    "count was a function of the route in, not of the authored flow. The engine's " +
    'copy is deleted (it reads the parsed block, no fallback), which makes an ' +
    "unstated count unambiguously 0 — and `strategy: 'retry'` that retries zero " +
    "times is `strategy: 'fail'` under another name, the declared-not-delivered " +
    'shape ADR-0049 exists to close. The schema therefore requires `maxRetries` ' +
    "at least 1 under `'retry'`, in both spellings (omitted, and an explicit 0). " +
    'This is the one v17 flow change the chain cannot apply for you: choosing the ' +
    'count is a judgment about re-running the WHOLE flow with its side effects, ' +
    'so it is a semantic TODO rather than a rewrite.\n\n' +
    'It also retires `api.requireAuth` (#3963): the deployment-wide opt-out that let a '
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
    + 'change is one semantic TODO for API callers rather than a stack conversion.\n\n'
    + 'The batch response rows converge on their declared schema in the same window (#4793): '
    + 'the per-row results of `/batch`, `/updateMany` and `/deleteMany` used to carry a legacy '
    + 'implementation shape — `error: string`, `record`, no `index` — while '
    + '`BatchOperationResultSchema`, the published client SDK type and the reference docs all '
    + 'declared `errors: ApiError[]` / `data` / `index`. A consumer written against the '
    + 'declaration read `row.errors` and got `undefined` at runtime — the exact "photographed '
    + 'from the schema, dead on the wire" failure the enhanced-api-error rename above records. '
    + 'The wire now delivers the declared shape, and the ADR-0119 D4 rollback marking is '
    + 'structured with it: `ROLLED_BACK:` / `NOT_ATTEMPTED:` message prefixes become '
    + 'first-class `ApiError.code` values, so clients branch on `errors[0].code` instead of '
    + 'regexing message strings. A RESPONSE surface, never stored in stack metadata, so there '
    + 'is no source for the chain to rewrite — one semantic TODO for readers of the old row '
    + 'keys.\n\n'
    + 'It also narrows `QueryAST.fields` to field names (#4196): the `FieldNode` union carried a '
    + 'second `{ field, fields, alias }` nested-select member that nothing produced and nothing '
    + 'consumed — every reader on the path treats the list as `string[]`, so the object form was '
    + 'dropped by the SQL and memory drivers, projected as a column named "[object Object]" by '
    + 'MongoDB, and refused by the REST ingress as an unknown field of that name. `expand` is the '
    + 'one spelling for nested selection (ADR-0049 enforce-or-remove; Prime Directive #12: one '
    + 'capability, one contract). Like the two above it is a request shape, never stored, so the '
    + 'chain has no source to rewrite.\n\n'
    + 'The #4286 sweep applies the same method to the rest of the request surface: `query.joins` '
    + 'and `query.windowFunctions` are tombstoned — no engine or driver ever read either on the '
    + 'query path, so every join and OVER clause a caller declared was silently dropped. Joins '
    + 'were the second, broken spelling of related-record retrieval (`expand` is the live one; '
    + 'the whole JoinNode cluster goes with the key), and window functions only ever ran behind '
    + '`SqlDriver.findWithWindowFunctions()`, a driver-level door whose flat input shape the '
    + 'spec vocabulary never matched (it declared `field`/`over`/`frame` members the door never '
    + 'read — that cluster goes too). Request shapes again: two semantic TODOs, no source '
    + 'rewrite.\n\n'
    + 'The #4286 close-out settles the remaining three. `having` is ENFORCED, not removed — '
    + 'the engine applies it after aggregation on both paths, so the clause every SQL-literate '
    + 'author expects now works (no migration; queries that carried it were silently returning '
    + 'every group and now filter as written). `cursor` and `distinct` are tombstoned WITH '
    + 'their shipped SDK producers (`QueryBuilder.cursor()` / `.distinct()` are deleted): no '
    + 'driver ever implemented keyset pagination or SELECT DISTINCT, `cursor` re-served page 1 '
    + "forever, and `distinct`'s only observable effect was mis-wired — it suppressed the REST "
    + 'list count, which is now truthful again. Both are request shapes; two more semantic '
    + 'TODOs, no source rewrite.\n\n'
    + 'The same kind of retirement covers `wait`\'s timeout pair (#4158). `waitEventConfig.onTimeout` '
    + 'had ZERO readers — no path ever inspected it, so neither `fail` nor `continue` ever '
    + 'happened, while its `.default(\'fail\')` stamped a decision nothing made onto every wait '
    + 'node. `waitEventConfig.timeoutMs` said "maximum wait time before timeout" and its only '
    + 'reader used it as the timer DURATION when `timerDuration` was absent: it did something, '
    + 'just not what it said. Together they declared a timeout `wait` does not have — the run '
    + 'resumes when its timer elapses or its signal arrives, never on a deadline. Rather than '
    + 'retrofit an implementation to fit two keys that happened to be declared, the pair is '
    + 'retired and real timeout semantics are left to be built to a requirement. `timeoutMs` '
    + 'converts to `timerDuration` (stringified — the target is `z.string()` and '
    + '`parseIsoDuration` reads a bare numeric string as milliseconds, so the wait is unchanged); '
    + 'with `timerDuration` already set it is dropped, having been dead metadata. Like the other '
    + 'keys retired for MISDESCRIBING themselves rather than for being renamed, both leave the '
    + 'load path: absorbing them silently would let an author keep believing they configured a '
    + 'timeout.\n\n'
    + 'Closing the same audit on the data side, `datasource.readReplicas` is removed (#4468). '
    + 'It described replica connections nothing ever opened: `ConnectableDatasource` and '
    + '`DatasourceConnectionSpec` carry no replicas field, the driver factory never reads the '
    + 'key, and no query path distinguishes a read from a write — read/write splitting does not '
    + 'exist in the platform, so every statement always went to the primary. A lossless delete '
    + 'with no target to move to; front replicas behind one endpoint (pgpool, ProxySQL, an RDS '
    + 'reader endpoint) and point `config` at it. Notable as the case that shows how a key gets '
    + 'MORE convincing as it stays dead: #4410, closing the datasource-config gap, taught the '
    + 'schema to validate each replica entry against the declared driver\'s config contract, so '
    + 'sources written in between carry replica blocks that were genuinely checked — precise '
    + 'hosts, correct port types, typos rejected. Precision applied to an inert slot reads as '
    + 'evidence the slot is live, which is why ADR-0049 asks for a consumer rather than for '
    + 'rigor. Retired from the load path with the rest of the keys that misdescribed themselves.\n\n'
    + 'The datasource close-out also graduates the four legacy `datasource.config` spellings the '
    + 'shared driver factory still tolerated via undeclared read-side `??` fallbacks (#4456, the '
    + '#4410 follow-up): sqlite `file`/`database` (use `filename`), postgres/mysql '
    + '`connectionString` (use `url`) and `user` (use `username`), and mongo `uri` (use `url`) '
    + 'and `user` (use `username`). #4410 made the authoring gate reject each with a rename '
    + 'hint, but a runtime datasource persisted in `sys_metadata` before the gate kept working '
    + 'only because the factory read leniently — and deleting that tolerance without a '
    + 'conversion would have silently moved data (a stored sqlite `file:` row falls back to '
    + '`:memory:`). The `datasource-config-driver-key-aliases` conversion rewrites the stored '
    + 'shape to the canonical keys at every rehydration seam, the factory now reads exactly one '
    + 'spelling per key, and the four `??` chains are deleted. Driver-aware by construction: '
    + '`database` renames only under sqlite, where it aliased the file path — for every other '
    + 'driver it is a canonical key and is untouched. Retired from the load path not for lying '
    + 'but because the authoring gate already rejects the spellings loudly; the chain and the '
    + 'stored-row replay are the seams that accept them.\n\n'
    + 'Finishing the same datasource surface, the canonical driver id `mongo` is renamed to '
    + '`mongodb` (#6345). The two spellings have both been accepted since #4410 and both still '
    + 'are, so no boot breaks and no data moves — what changed is which one is CANONICAL, and '
    + 'that string is published as `DRIVER_CATALOG.id` and is what the Studio connection form '
    + 'writes into `datasource.driver`. Every row written before the rename therefore carries '
    + '`mongo` while the form now emits `mongodb`, leaving one deployment with two spellings of '
    + 'one driver and any reader that matches a stored driver against the published catalog id '
    + 'silently missing the older rows. The `datasource-driver-mongo-to-mongodb` conversion '
    + 'converges the stored value at every rehydration seam; it stays on the LIVE load path '
    + '(unlike the config-key aliases beside it) precisely because `mongo` is still legal — '
    + 'there is no loud rejection for it to pre-empt, and nothing to lose by converging early. '
    + 'The rename is what let the driver-selection id and the config-contract id become one '
    + 'string: `packages/spec`\'s driver vocabulary is now a single table both boot hosts read, '
    + 'which closed the last fork where `OS_DATABASE_DRIVER=pg` booted under `os start` and was '
    + 'refused by `os migrate`. `turso`/libSQL joins the same table with a real config contract, '
    + 'so a libSQL `config` is validated instead of waved through.\n\n'
    + 'The `script` flow node converges on its one real path (#4343). It had four ways to name '
    + 'what it ran and only one of them ran anything: `config.actionType: \'email\' | \'slack\'` '
    + 'were logger-backed stubs that wrote a line, reported success and delivered nothing under '
    + 'any configuration — with `config.template` / `.recipients` / `.variables` feeding a '
    + 'message no channel ever sent; inline `config.script` was recognized and never executed '
    + '(the built-in runtime has no server-side JS sandbox), so the node warned and no-op\'d; and '
    + 'every other `actionType` value was shorthand for a registered-function name, a second '
    + 'spelling of `config.function`. All five keys are retired and `function` becomes required, '
    + 'which is also what finally made the contract PARSEABLE: while the legal key set depended '
    + 'on `actionType`, a flat parse would either reject valid shapes or wave everything through, '
    + 'so `script` (with `subflow`) now runs through the same execute-time contract parse #4277 '
    + 'gave the flat builtins. A shorthand `actionType` CONVERTS into `function` — that is what '
    + 'it meant — unless `function` is already set, in which case it was dead metadata the '
    + 'executor never reached. The other four are dropped outright: nothing read them, so there '
    + 'is no value to preserve, and rebuilding the intent is an authoring decision the tombstones '
    + 'prescribe per branch (a `notify` node for mail — it delivers through the messaging '
    + 'service, the in-app inbox by default and real email once `@objectstack/plugin-email` is '
    + 'installed; a `connector_action` with the Slack connector, or an `http` node posting to a '
    + 'webhook, for Slack; a registered function for an inline body). Retired from the load path '
    + 'for the same reason as the rest: absorbing `actionType: \'email\'` silently would let an '
    + 'author keep believing the flow sends mail.\n\n'
    + 'The same audit reaches the driver contract itself: `IDataDriver.findStream` is removed '
    + '(#4484). It was REQUIRED — every driver and every test double had to implement it — and '
    + 'documented as the read "optimized for large datasets to avoid memory overflow", while '
    + 'two of its three implementations awaited `find()` for the whole result set and then '
    + 'yielded it row by row, reaching exactly the peak it promised to avoid; the third '
    + 'streamed for real but was the one read in that driver that skipped `buildFindOptions`, '
    + 'so it dropped `query.fields`. Nothing anywhere called it, which is why a contract '
    + 'method could carry an inverted guarantee for this long and why ~20 test doubles could '
    + 'satisfy it by throwing `not implemented`. Paged `find()` is the read that exists and is '
    + 'enforced (its total-order guarantee is checked by the shared pagination-conformance '
    + 'cases); a cursor-based read is worth building when a caller asks for one, which is the '
    + 'honest order. A TS/API surface, never stored — one semantic TODO for driver authors, no '
    + 'source rewrite, and no tombstone: `DriverInterfaceSchema` describes a contract that '
    + 'code IMPLEMENTS and nothing ever `.parse()`d a driver, so tsc is the only channel that '
    + 'could carry the prescription, and it carries it where it matters — at a call site.\n\n'
    + 'Separately, `object.managedBy: \'system\'` is retired in favour of `\'system-data\'` (#3355), '
    + 'finishing the split ADR-0103 began in v16. That split was deliberately ADDITIVE: the 20 '
    + 'engine-owned objects moved to the new explicit `engine-owned`, and the 8 admin/user-'
    + 'writable ones — the RBAC link tables, `sys_user_preference`, the three messaging config '
    + 'grids — stayed behind on `system`. What was left is a value whose name describes the half '
    + 'that had already moved out: "system" sitting on precisely the objects a user writes. That '
    + 'is not a cosmetic complaint. An author choosing between `system` and `engine-owned` had '
    + 'nothing in the vocabulary to choose on, so the bucket was re-overloadable by anyone '
    + 'reading the name in good faith — a model author most of all. `system-data` states both '
    + 'boundaries: the SCHEMA is the platform\'s (versus `platform`, which is tenant-modelled), '
    + 'the DATA is the admin\'s or the user\'s (versus `engine-owned`, where the engine owns both). '
    + 'Reusing `config` was considered and rejected — `sys_user_preference` is user-owned rather '
    + 'than admin-authored, and `config` suppresses CSV import — as was `platform-data`, which '
    + 'sits one word away from the unrelated `platform` in the same closed enum and would '
    + 'reintroduce the confusion at the point of choosing. Because v16 already drained the '
    + 'engine side, the conversion is a ONE-TO-ONE mechanical value rename with no judgement '
    + 'call. One deliberate consequence: `system` defaulted LOCKED and each object re-opened its '
    + 'writes through `userActions`, while `system-data` defaults WRITABLE on create, edit, '
    + 'delete and exportCsv, so those blocks become redundant and are deleted (keep '
    + '`userActions` only to NARROW). CSV `import` is the one verb that default deliberately '
    + 'withholds (#4671): it stays opt-in per object via `userActions: { import: true }`, so a '
    + 'v16 `system` object — which resolved `import: false`, because the re-open blocks only '
    + 'ever named create/edit/delete — keeps resolving `import: false` after the rename. The '
    + 'reason is leverage, not authorization: three of the eight members are the RBAC link '
    + 'tables, and a bulk-grant entry point on the permission model\'s grant surface should be '
    + 'a per-object declaration rather than something inherited by being filed in the right '
    + 'bucket. No enforcement '
    + 'moves — the engine write guard, the DelegatedAdminGate, RLS and permission sets all '
    + 'adjudicate off resolved affordances and the principal, never off the bucket name; '
    + '`system-data` simply joins `platform`/`config` as a bucket the guard does not cover, '
    + 'because a writable default has nothing to fail closed on. Retired from the load path: '
    + 'the enum rejection is what teaches the new spelling, and absorbing `\'system\'` silently at '
    + 'load would leave every author writing the name this rename exists to retire.\n\n'
    + 'Finally, five keys retire because the advisory lint could never have warned about them '
    + '(#4509): mapping `extractQuery` / `errorPolicy` / `batchSize`, and app '
    + '`contextSelectors[].includeAll` / `.placement`. Four of the five carry schema DEFAULTS, '
    + 'and a default materialises at parse time — so the liveness lint cannot tell a value the '
    + 'author wrote from one the schema supplied, and marking them would have warned on every '
    + 'mapping and every selector in existence. For a key in that state removal is not the '
    + 'escalation after a warning; it is the only channel that ever reaches the author, which '
    + 'is why they ship inside the 17.0.0 window rather than after a deprecation cycle. What '
    + 'they claimed: `extractQuery` promised an export path no exporter implements (exports go '
    + 'through the ordinary query API); `errorPolicy` offered skip/abort/retry where error '
    + 'handling belongs to the import REQUEST; `batchSize` sized batches the write path sizes '
    + 'itself; `placement` offered a topbar that places nothing. `includeAll` is the one worth '
    + 'reading twice — it was not unread but deliberately DISOBEYED, because context selectors '
    + 'are mandatory-scope and an "All" row would clear the scope: on Studio\'s package selector '
    + 'that means listing the platform\'s own system/cloud kernel packages to a developer who '
    + 'scoped to their package. `STUDIO_APP` authored `includeAll: true` against a renderer that '
    + 'ignored it. The mapping prescription for `batchSize` deliberately offers no rename: '
    + 'bulk-action, connector, sync, offline, seed-loader and NoSQL-cursor `batchSize` are all '
    + 'live, but each is a different key sizing its own path — the same trap `datasource.'
    + 'retryPolicy` vs `hook`/`job` `retryPolicy` had to defuse one issue earlier.\n\n'
    + 'The sharpest removal in this step is two keys wide: `app.areas[].visible` and '
    + '`app.areas[].requiredPermissions` (#4651). Read the class before the count — these were '
    + 'not inert authoring keys but FAIL-OPEN access gates. At the time of the retirement the '
    + 'server-side authority (`filterAppForUser`) checked the app\'s `requiredPermissions` and '
    + 'then walked ONLY the top-level `navigation` tree; it never read `item.areas` at all, and '
    + 'the client rendered every area in the switcher. So an author writing '
    + '`requiredPermissions: [\'sales.admin\']` on an area got a clean parse, a stored value, and '
    + 'an area visible to everybody — and had every reason to believe otherwise, because the SAME '
    + 'key names are genuinely enforced one '
    + 'level up and one level down: app-level `requiredPermissions` drops the whole app '
    + 'server-side, and a navigation ITEM\'s `requiredPermissions` / `requiresService` are '
    + 'stripped server-side and re-checked in the shell, whose item-level `visible` is a real '
    + 'CEL gate. Three layers, of which the middle one was theatre. Enforcing instead was '
    + 'weighed and deliberately not taken here: it needs semantics decided first (does '
    + 'filtering an area remove its items everywhere? does the server bind `user` for area '
    + 'CEL?), and a retirement must not invent an authorization mechanism — while shipping a '
    + 'major with the gate still declared would have kept authors writing it for all of 17.x. '
    + 'The rewrite is lossless in outcome (the keys changed nothing), so what an upgrading '
    + 'author has to re-decide is only where the gate really goes: onto the items inside the '
    + 'area, or onto the app — and BOTH of those destinations are server-enforced. The caveat '
    + 'this prescription used to carry, that per-item gating INSIDE an area was enforced by the '
    + 'shell only because the server did not walk `areas`, was CLOSED by #4722 inside this same '
    + '17.0.0 window: `filterAppForUser` now runs the SAME `filterNav` over every '
    + '`areas[].navigation`, so an ITEM\'s `requiredPermissions` / `requiresService` is stripped '
    + 'server-side in BOTH trees and a gated entry never ships in the `/meta` body at all. Read '
    + 'that as the boundary closing, NOT as the area-LEVEL keys coming back: those stay retired '
    + 'and #4722 gave an area no gate of its own — what it enforces are the items inside one. '
    + 'The other half of the asymmetry is unchanged and is why `requiredPermissions` is the key '
    + 'to reach for: `visible` (CEL) and `requiresObject` are still evaluated client-side ONLY '
    + 'at every level, because server-side CEL needs a bound `user` context the read layer does '
    + 'not have — so anything that must never reach the browser goes in `requiredPermissions`, '
    + 'never in `visible`.\n\n'
    + 'The same window converges the retry policy (#4661). `@objectstack/spec/automation` and '
    + '`@objectstack/spec/system` each exported a `RetryPolicy`/`RetryPolicySchema` resolving '
    + 'to a DIFFERENT declaration, so which shape a consumer got depended only on the import '
    + 'path (#4411) — yet both computed `delay = base * multiplier^(retry-1)` and both '
    + 'executors implemented that same formula. One declaration now serves both entries with '
    + 'the union of their capabilities, so `job.retryPolicy` gains the `maxRetryDelayMs` ceiling '
    + 'and `jitter` (both enforced in `runWithPolicy`, not merely declared — jitter is what stops '
    + 'a fleet of jobs that failed on one outage from retrying in lockstep). The single '
    + 'authorable casualty is the automation spelling of the base delay: `retryDelayMs` → '
    + '`backoffMs`, a pure rename that replays losslessly and is what the already-enforced '
    + 'retry policies (`job.retryPolicy`, `hook.retryPolicy`) call it.\n\n'
    + 'The subtle half is the defaults, and it is worth stating because no gate can see it: '
    + '`job.retryPolicy` defaulted `maxRetries: 3` / `backoffMultiplier: 2` while the automation '
    + 'shape defaulted 0 / 1, and the authorable-surface gate compares KEY SETS — a changed '
    + 'default is invisible to it, to the tombstone mechanism and to `spec_changes` alike. The '
    + 'merged declaration takes 0 / 1 (retry replays side effects, so it is opt-in — the same '
    + 'reading already recorded in `flow-retry-max-retries-required`), and the conversion writes '
    + 'the pre-17 numbers into every existing `job.retryPolicy` that omitted them. Deployed '
    + 'stacks therefore keep their exact behaviour; what changes is only what a NEWLY authored '
    + 'omission means.\n\n'
    + 'That convergence then had to be finished twice more, and WHY it was incomplete is the '
    + 'part worth carrying forward (#4964, #4962). It was driven by the dual-source instrument, '
    + 'which asks "how many declarations publish the same exported NAME?" — so it could not see '
    + 'the two encodings of the identical policy that have no exported name at all, being '
    + 'anonymous inline blocks nested in a bigger schema: `flow.errorHandling` and '
    + '`ETLPipeline.retry`. The instrument was not broken and answered its own question exactly; '
    + 'that question was simply not "how many shapes does this ONE concept have?", which is what '
    + 'everybody read off it. The cost of the gap is concrete and falls on the author who did the '
    + 'right thing: `shared/retry-policy.zod.ts` tombstoned `retryDelayMs` and told them to write '
    + '`backoffMs`, and `flow.errorHandling` then rejected `backoffMs` and demanded `retryDelayMs` '
    + '— reading the newer file was punished. Both blocks now build from one shared shape. '
    + '`flow.errorHandling` costs nothing beyond the same `retryDelayMs` → `backoffMs` rename '
    + '(every other key, bound and default already matched, which is exactly why it looked '
    + 'reviewed), and the conversion covers it. `ETLPipeline.retry` costs a rename of the COUNT '
    + '— `maxAttempts` → `maxRetries`, same number, do NOT subtract one: that adjustment belongs '
    + "to `integration/connector.zod.ts`'s identically-spelled `RetryConfig.maxAttempts`, which "
    + 'INCLUDES the first attempt — plus the same default flip (3 → 0) and three keys it never '
    + 'had (`backoffMultiplier` / `maxRetryDelayMs` / `jitter`, so a nightly warehouse pipeline '
    + 'can stop retrying flat, uncapped and unjittered every 60s). The ETL half gets a tombstone '
    + 'and no conversion step, deliberately: an ETL pipeline is not a `defineStack` collection '
    + 'and `etl.zod.ts` has no parse site in any of the three repos, so there is no stored '
    + 'document to walk and a step for it would advertise coverage it does not have. Nothing '
    + 'deployed moves; the migration surface is empty and this is the cheapest this convergence '
    + 'will ever be.\n\n'
    + 'The same enforce-or-remove pass reaches the event vocabulary: `DataEventType` drops '
    + '`data.field.changed` (#4673). It had no producer anywhere — the engine emits '
    + '`data.record.{created,updated,deleted}` and, since #4639, `data.records.{updated,'
    + 'deleted}` — so a subscriber switching on it held a branch that could never run, and '
    + 'the `switch` still compiled, which is why an empty member could sit in a public enum '
    + 'this long. It could not have been implemented against this contract as written: '
    + '`DataEventSchema` is record-shaped and has no `field` / `oldValue` / `newValue` slot, '
    + 'so the member advertised a granularity the payload has no room for. Nothing is lost — '
    + 'per-field detail already rides on `data.record.updated` as `changes` (with `before` / '
    + '`after`), one event per write instead of N on a wide table. Like the driver contract '
    + 'above it is a runtime surface, never stored in stack metadata, so it is one semantic '
    + 'TODO for event consumers rather than a source rewrite, and it carries no tombstone: a '
    + 'removed enum VALUE cannot hold a fix-it error, exactly as the sharing-rule `full` '
    + 'retirement noted. Should a real per-field stream ever be wanted, it earns its own '
    + 'contract on the #4639 precedent rather than reclaiming this slot.\n\n'
    + 'The object capability block closes out the same ADR-0049 pass: `enable.trash` and '
    + '`enable.mru` left the schema in the 16.x line (#3207, the #2377 close-out — every '
    + 'delete has always been a hard delete and MRU tracking was never implemented, so both '
    + 'default-true flags gated nothing), and the `.strict()` capabilities block rejects them '
    + 'with the prescription. This step registers the migration surface that removal was '
    + 'missing: stored 16.x rows replay clean instead of flagging `metadata_spec_invalid`, '
    + 'and `os migrate meta --from 16` rewrites authored sources. Soft delete stays parked at '
    + '#3146; if built it returns as a live enforced flag rather than by reviving these keys.\n\n'
    + 'The same enforce-or-remove pass retires the `RestServerConfig.openApi31` block (#4579): '
    + '`OpenApi31ExtensionsSchema` (`webhooks` / `callbacks` / `jsonSchemaDialect` / '
    + '`pathItemReferences`) with `OpenApiWebhookEventSchema` and `CallbackSchema` under it. '
    + "Declared-but-unenforced end to end: the REST server's `normalizeConfig` forwards only "
    + '`api`/`crud`/`metadata`/`batch`/`routes`, the served /openapi.json is the pre-generated '
    + 'contract enriched with the live server URL and registered objects, and `gen:openapi` '
    + 'never read a webhook or callback — so a definition authored under `openApi31.webhooks` '
    + 'never appeared in any served document, and zero import-level consumers existed across '
    + 'objectstack / cloud / objectui. `RestServerConfig` is plugin TS configuration (the REST '
    + 'plugin constructor / `plugin-hono-server` `restConfig`), never a stored metadata shape: '
    + "the stack tree's own `api` block declares only its four scoping/auth knobs, so no "
    + '`sys_metadata` row can carry `openApi31` and there is no source for the chain to '
    + 'rewrite — one semantic TODO for config authors rather than a stack conversion, the '
    + '`validateOnly` shape. The key itself is tombstoned (the schema is not `.strict()`; a '
    + 'plain delete would strip it silently), and a config-driven webhooks/callbacks synthesis, '
    + 'if ever wanted, returns via the enforce route of ADR-0049 through a new ADR.\n\n'
    + 'The same pass closes `activationEvents` (#4657): both keys that carried it — '
    + '`DynamicLoadRequest.activationEvents` on the kernel side and '
    + '`StudioPluginManifest.activationEvents` on the studio side — declared lazy plugin '
    + 'activation ("plugins remain dormant until an activation event fires") that no runtime '
    + 'in any repo ever implemented: every plugin has always activated immediately on '
    + "load/registration, and cloud-v1's own ROADMAP recorded the capability as "
    + 'unimplemented, planned for v0.4.0. #4653 had just converged the two '
    + '`ActivationEventSchema` declarations onto one structured `{ type, pattern }` '
    + "vocabulary in this same unreleased major; with the maintainer's enforce-or-remove "
    + 'ruling landing on REMOVE, that converged vocabulary retires before ever shipping — '
    + 'composed across the two changes, a v16 author simply deletes the key in whichever '
    + 'form they carried. Neither parent is stored metadata (`StudioPluginManifest` is TS '
    + 'configuration parsed by `defineStudioPlugin`; `DynamicLoadRequest` is a runtime '
    + 'request shape with no caller in any repo), so there is no source for the chain to '
    + 'rewrite — one semantic TODO, the `validateOnly` shape. The kernel key is tombstoned '
    + '(its schema is not `.strict()`; a plain delete would strip it silently), the studio '
    + 'key is rejected by the strict manifest parse with its own guidance prescription, and '
    + 'the orphaned `ActivationEventSchema` def is removed with them. Behaviour is '
    + 'byte-identical: eager activation was always the only behaviour.\n\n'
    + 'That kernel-side tombstone was then SUPERSEDED inside the same unreleased major by '
    + '#4834, which finished the enforce-or-remove pass one level up: the entire '
    + '`plugin-runtime.zod` family — `DynamicLoadRequest`, `DynamicUnloadRequest`, '
    + '`DynamicPluginResult`, `PluginSource`, `DynamicPluginOperation` — is removed, because '
    + 'the "Dynamic Loading" capability it described (runtime load / unload / reload without '
    + 'a kernel restart, with sandboxing, integrity hashes, drain strategies and '
    + 'dependent-cascade policy) has no server anywhere: no runtime in objectstack, cloud or '
    + 'objectui ever received one of these requests or produced one of these results. #3896 '
    + 'had suspended the call on these five deliberately — "operation contracts, not security '
    + 'promises" — in a changeset paragraph no issue carried; #4834 is that decision, '
    + 'answered REMOVE. So a v16 author who wrote `activationEvents` inside a '
    + '`DynamicLoadRequest` value does not delete a key: the whole value has no shape and no '
    + 'recipient, and importing `DynamicLoadRequestSchema` at all is TS2305 in v17. The '
    + 'studio half of the `activationEvents` retirement is untouched and still rejects the '
    + 'key with its own prescription — `defineStudioPlugin` remains a live authoring surface. '
    + 'Behaviour is again byte-identical: nothing ever executed a dynamic plugin operation.\n\n'
    + "Finally it removes the script-body capability token 'crypto.hash' (#4391). Four layers "
    + 'declared it — the `HookBodyCapability` enum, the doc table beside it, the CLI extractor '
    + 'and `ScriptContext.crypto.hash` — and none implemented it: `installCtx` wired only '
    + '`randomUUID`, so the one call the token authorised threw inside the VM every time. The '
    + 'build-time inference made it worse than an ordinary declared-but-unenforced key: writing '
    + '`ctx.crypto.hash(...)` made the CLI ADD the capability for you, so `os build` went green '
    + 'on the body that was guaranteed to fail at the first record write. Removed rather than '
    + 'implemented (ADR-0049) — hashing inside the sandbox widens its capability and '
    + 'security-review surface, and a capability that throws on every use yet drew zero '
    + 'complaints in its whole life is its own liveness verdict. This is an enum VALUE, not a '
    + 'key, so there is no `retiredKey()` tombstone: the enum error map carries the '
    + 'prescription, keyed on the received value so that only the spelling which used to be '
    + 'legal is told it "was removed". The conversion strips the dead token from '
    + '`body.capabilities` on hooks and actions; it deliberately does NOT touch the '
    + '`ctx.crypto.hash(...)` call the body made under it, which never returned a value and '
    + 'which the author must delete. Hashing returns only WITH an implementation, through the '
    + 'capability admission process.\n\n'
    + "It also removes `connector.rateLimitConfig` and its whole shape (#4911). This one is not "
    + '"declared but unread" — it is declared but UNIMPLEMENTED, one step worse. The only token '
    + "bucket the platform owns (runtime `security/rate-limit.ts`) is INBOUND: the dispatcher "
    + 'calls `consume(key)` on a request fingerprint and answers 429. Nothing anywhere throttles '
    + 'the calls a connector makes OUT, and no provider — `connector-rest`, `connector-openapi`, '
    + '`connector-mcp`, `connector-slack` — reads the key or has a seam that could. So '
    + '`strategy`, `maxRequests`, `windowSeconds`, `burstCapacity`, `respectUpstreamLimits` and '
    + '`rateLimitHeaders` parsed cleanly and capped nothing, on a surface where the author '
    + "believed they had bounded their spend against a third party's quota. `ConnectorRateLimit"
    + 'Config` and the `RateLimitStrategy` enum it embedded had no other consumer and are removed '
    + 'with the key, so importing either is TS2305 in v17 — the #4834 shape, and the same '
    + 'implementation-first ruling: the vocabulary comes back WITH the engine, in one change. '
    + 'It is deliberately NOT converted to `shared` `RateLimitConfig`, which limits the calls '
    + 'others make to US; #4684 split their names for precisely this confusion, and rewriting an '
    + 'outbound cap into an inbound one would throttle the wrong direction. Delete the key and '
    + 'rate-limit where the calls are actually made — the connector provider or upstream gateway.\n\n'
    + 'Last, it removes `dashboard.widgets[].responsive` (#4876) — the straggler of the #3896 '
    + 'sweep above, which retired the literally same-named `view.responsive` on the same '
    + 'evidence four days earlier. Re-measured before removal: no objectui code reads '
    + '`widget.responsive` (DashboardRenderer, DashboardEditor and plugin-designer name it only '
    + 'in comments), and there are zero authored instances repo-wide, so the conversion is '
    + 'expected to be a no-op on every real source — it exists so that a stored dashboard '
    + 'carrying the key is cleaned deterministically rather than meeting the tombstone at load. '
    + 'What kept it alive was not evidence but a hole in the instrument: the liveness ledger '
    + 'declares no `children` on `dashboard.widgets`, and the walk only drills one level through '
    + 'an explicit `children`, so no widget-level key has ever been classified at all (filed as '
    + '#4956, fixed separately). The removal is deliberately narrow — it takes the widget EMBED, '
    + 'not the shape. `ResponsiveConfig` stays exported and stays live on '
    + '`page.components[].responsive`, which objectui `useResponsiveConfig` genuinely reads, so '
    + 'no import breaks and authors who need breakpoint behaviour today have somewhere real to '
    + 'put it. Per-widget responsive layout returns if and when a renderer implements it.\n\n'
    + 'Finally it CONVERGES `dashboard.widgets[].compareTo` (#5011) — the one entry in this step '
    + 'that is not a removal but a vocabulary merge, and the one whose defect was worst-shaped. '
    + 'The widget declared three arms with confident TSDoc; the analytics executor implements one '
    + 'contract, `DatasetSelection.compareTo` = `{ kind, dimension? }`, which has no `offset` in '
    + 'it. On the ADR-0021 dataset path the two string arms were DROPPED by the renderer (a '
    + 'comparison silently absent from a widget whose author asked for one) and `{ offset }` was '
    + 'forwarded into that contract with no dimension, so the executor threw '
    + '`compareTo requires a timeDimension "undefined"` and errored the whole widget. All three '
    + 'arms worked on the legacy inline chart path. Same key, two fates — and the failing one was '
    + 'the path the spec itself calls canonical, which is why this ranks above an ordinary '
    + 'declared-but-unread key: the documentation was actively teaching a shape that crashes. '
    + 'The widget now declares the executor\'s own words, so `declared = enforced` holds by '
    + 'construction with no second vocabulary left to drift. `dimension` is optional and resolved '
    + 'by the EXECUTOR (one dated time dimension → that one; zero or several → a loud error '
    + 'naming the candidates), which is a producer-side resolution rule, not the consumer-side '
    + 'tolerance PD #12 forbids. The bare strings and `{ offset: \'1y\' }` replay mechanically; '
    + 'every other `{ offset }` duration is a semantic TODO below, because `previousPeriod` '
    + 'shifts by the resolved window\'s own length and rewriting `7d` into it would change which '
    + 'rows the comparison counts. The converged slot is also union-free, which is not cosmetic: '
    + 'zod collapses a failed union into one bare `Invalid input` and #5014 showed that curated '
    + 'guidance inside a union arm never reaches the author at all.\n\n'
    + 'The same widget drill retires four more keys (#5010): the action trio '
    + '`actionUrl`/`actionType`/`actionIcon`, and `aria`. The trio described a per-widget action '
    + 'BUTTON that no renderer in either repo has ever drawn — all 14 `actionUrl` reads in '
    + 'DashboardRenderer are scoped to `header.actions[]`, a different schema — and `actionIcon` '
    + 'had zero references anywhere outside its own declaration. `aria` is the dashboard-level '
    + '`aria` removed by the #3896 sweep, one level down: declared ARIA attributes that never '
    + 'reached the DOM, i.e. an accessibility guarantee an author could state and nothing '
    + 'honoured. It survived that sweep for the same reason `responsive` did — `widgets` had no '
    + 'ledger drill until #4956 — not on evidence. This removal also settles a second-order cost '
    + 'the trio was carrying: `packages/lint`\'s dashboard action-ref rule enforced '
    + 'ERROR-severity reference integrity on `widgets[].actionUrl`, its docblock calling the key '
    + '"the per-widget button" and claiming to mirror a runtime dispatch that does not exist, so '
    + 'an author could FAIL A BUILD because a control that cannot render pointed at an action '
    + 'that also did not. That widget branch is deleted with the keys. Lossless deletes in every '
    + 'case — the keys contributed nothing to any rendered output — and the shared `AriaProps` '
    + 'shape is untouched, staying live on `page.aria` / `page.components[].aria` and the list '
    + 'view `aria` — not on `app.aria`, which this same major retires (see '
    + '`app-dead-authoring-keys-removed`, which strips it). Move a '
    + 'dashboard-wide affordance to `header.actions[]` (where `icon` is the header spelling of '
    + '`actionIcon`); for per-row click-through use a dataset-bound `table`/`pivot`, whose rows '
    + 'drill through the semantic layer already.\n\n'
    + '⚠️ One protocol-17 change turns metadata ON rather than off, and it is the one to read '
    + 'first: declarative `apis:` endpoints EXECUTE from 17 (#5040). The surface used to be inert '
    + 'end to end — no route mounted, no matcher, every key including `authRequired` parsed and '
    + 'enforced nothing — which is why #4936 refused a non-empty `apis:` outright. 17 ships the '
    + 'executor and narrows that refusal to a per-endpoint publish gate, so an endpoint that '
    + 'passes the gate is MOUNTED and serves traffic the moment it is published. Any historical '
    + '`apis:` block therefore changes meaning without changing a byte. Review every entry before '
    + 'upgrading, and pay particular attention to an explicit `authRequired: false`: the schema '
    + 'default is `true`, so an omission is safe, and only that explicit `false` opens anonymous '
    + 'access — which ADR-0121 D6 now pairs with a mandatory armed `rateLimit` '
    + '(`enabled: true`; the key defaults to `false`, so a budget written without it meters '
    + 'nothing). Paths also move under the namespace carve-out `/api/v1/apps/<manifest.namespace>/'
    + '<subpath>` (ADR-0121 D1/D2). The full checklist is the `declarative-apis-endpoints-live` '
    + 'semantic entry below; it is a security review, not a rename, so nothing about it is '
    + 'applied for you.\n\n'
    + 'Finally, the theme token scales retire (#5021, ADR-0049): `typography.fontSize`, '
    + '`typography.fontWeight`, `typography.lineHeight`, `typography.letterSpacing`, '
    + '`typography.fontFamily.heading`, `typography.fontFamily.mono`, `animation` and `zIndex`. '
    + 'These are the reverse of the usual inert key and the distinction is the point: the theme '
    + 'engine DID emit them — `--font-size-*`, `--font-weight-*`, `--line-height-*`, '
    + '`--letter-spacing-*`, `--duration-*`, `--timing-*`, `--z-*`, `--font-heading`, '
    + '`--font-mono` all reached the document exactly as authored — and no first-party component '
    + 'or stylesheet has ever read one, so a declared type scale was real CSS that styled '
    + 'nothing. That is why the earlier theme sweep (#3494) left them standing: its criterion was '
    + '"never emitted", and these are emitted. `colors`, `borderRadius`, `shadows` and '
    + '`typography.fontFamily.base` have live consumers and are untouched. The prescription is '
    + '`customVars`, which emits `--<key>: <value>` verbatim — so a tenant stylesheet that really '
    + 'was reading `--z-modal` reproduces it byte for byte and loses no capability. The '
    + 'conversion DELETES the keys and emits a notice per key rather than auto-populating '
    + '`customVars`: a rewrite would hand back two dozen variables that still nothing reads, '
    + 'turning a dead semantic slot into a dead literal one. Deciding which of them you actually '
    + 'consume is yours to make; the notice names each one. Retired from the load path with the '
    + 'other keys that misdescribed themselves.\n\n'
    + 'It closes the enforce-or-remove line with two `./ui` vocabulary shapes that never '
    + 'had a key to be written into (#5015): `NotificationActionSchema` / `NotificationAction` '
    + 'and `EmbedConfigSchema` / `EmbedConfig`. This is the class BELOW a declared-but-unread '
    + 'key — there was no key at all. No schema anywhere declared a carrier, a BFS from all 24 '
    + 'metadata-type roots plus `ObjectStackSchema` reached neither (with `Page` / `Action` / '
    + '`DashboardWidget` / `Webhook` / `SharingConfig` as positive controls in the same run, and '
    + 'a synthetic carrier flipping both), and no repo parsed either outside its own unit test. '
    + 'Each was left behind by an earlier retirement one level up: the notification action by '
    + '#4610, which deleted the two wrapper shapes that could have carried it, and the embed '
    + 'config by 17.0.0\'s own `App.embed` tombstone. #4001 批 14 measured both and deliberately '
    + 'declined to close them with `.strict()`, because strictness on a shape nothing parses '
    + 'enforces nothing and only makes a dead slot look load-bearing (#4583); #5015 is that '
    + 'deferred call, answered REMOVE. Nothing is applied for you and nothing needs to be — '
    + 'there is no key in any source to rewrite; the change is visible only as TS2305 on an '
    + 'import. ⚠️ Read the scope precisely, because one of the two modules SPLITS: '
    + '`ui/sharing.zod` keeps `SharingConfigSchema` and it stays LIVE — `FormView.sharing` '
    + 'carries it and `rest-server.ts` mounts the anonymous form routes on '
    + '`allowAnonymous` + `publicLink`, so public form sharing is untouched — and '
    + '`ui/notification.zod` keeps `NotificationType` / `NotificationSeverity` / '
    + '`NotificationPosition`. Only the two named shapes go.\n\n'
    + 'The same is true of the protocol-17 retirement that closes this list, and the pair is '
    + 'worth reading together (#4988, ADR-0049): the five `@objectstack/spec/ui` interaction-config '
    + 'modules — `touch.zod.ts`, `dnd.zod.ts`, `keyboard.zod.ts`, `animation.zod.ts` and '
    + '`offline.zod.ts`, 22 `z.object` sites and 64 exported names — are deleted whole, with '
    + 'their reference docs. They were never reachable: no schema in the protocol declared a '
    + '`touch:` / `dnd:` / `keyboard:` / `animation:` / `offline:` key, so no metadata document '
    + 'could carry one and none needs rewriting now. The defect was on the DOCUMENTATION side, '
    + 'which is the half that made it urgent — `authorable-surface.json` carried 109 keys under '
    + 'these defs and the generated `references/ui/*` pages rendered them as authoring tables, '
    + 'so an AI author reading `dnd.mdx` wrote a `dnd:` block that `PageComponentSchema` then '
    + 'rejected as an unknown key. That is a published capability the runtime does not deliver '
    + '(Prime Directive #10), not a strictness gap: closing the shapes would have validated a '
    + 'slot nobody can reach. Business reading behind the ruling: these five are RENDERER '
    + 'BUILT-IN behaviour, decided by the component library rather than authored per page; '
    + 'offline is a platform capability whose vocabulary belongs on a sync engine that has not '
    + 'been built. ⚠️ The `animation` here is `ui/animation.zod.ts` '
    + '(`ComponentAnimation` / `MotionConfig` / `PageTransition` / `AnimationTrigger`), a '
    + 'DIFFERENT surface from the theme `animation` block retired above by #5021 — that one had '
    + 'a carrier key and got a tombstone; this one had none and gets deletion. The one name '
    + 'worth checking on upgrade is the bare `ConflictResolution` type: it left with '
    + '`ui/offline.zod.ts` and is now published by nobody. `ConnectorConflictResolution` '
    + '(`@objectstack/spec/integration`, connector sync) and `ConflictResolutionStrategy` '
    + '(`@objectstack/spec/api`, route merge policy) are different concepts under their own '
    + 'names and are untouched.\n\n'
    + 'The last enforce-or-remove entry of this step is on the RUNTIME context rather than on '
    + 'anything authorable: `HookContext.session.roles` (#5050). It was declared in '
    + '`data/hook.zod.ts`, read by exactly two consumers — the approvals record lock and the '
    + 'delegation write guard, each opening with `session.roles?.includes(\'admin\')` — and '
    + 'produced by nobody on the hook path: ObjectQL\'s `buildSession()` writes the session '
    + 'field by field (`userId`, `organizationId`, `accessToken`, `isSystem`, `actor`, the skip '
    + 'flags) and has no `roles` write, here or in `cloud`, whose hook consumers read '
    + '`hookContext?.session?.userId` and nothing else (an ACTION body\'s `ctx.session` is a '
    + 'different untyped object that does carry one, tracked apart). So both branches were dead '
    + 'on every real '
    + 'engine path: an authorization decision in shape only, and — worse for a reader — a SECOND '
    + 'admin dialect competing with the one ADR-0095 D3 sanctions. #4839 (PR #5049) deleted the '
    + 'two readers on the maintainer\'s ruling; this step removes the declaration that outlived '
    + 'them, which is what ADR-0049 asks for once a key has neither end. Nothing observable '
    + 'changes: a key nobody wrote and nothing read cannot alter a single decision. It is '
    + 'tombstoned rather than deleted because `HookContextSchema` is deliberately NOT `.strict()` '
    + '(strictness there would make an engine-internal enrichment a breaking change for anyone '
    + 'parsing a context they were handed, as `provenance` was in #3712), so a plain delete would '
    + 'strip the key in silence — the #3733 / ADR-0104 failure this whole pass exists to end. '
    + 'There is NO conversion and no source rewrite: a HookContext is built per operation by the '
    + 'engine and never stored, so no `sys_metadata` row, example or template can carry the key '
    + '— the `openApi31` / `activationEvents` shape, one semantic TODO for hook authors. The '
    + 'live vocabulary is untouched and deliberately elsewhere: gate on `session.userId` / '
    + '`session.isSystem` in the hook, and judge PRIVILEGE through the security service, which '
    + 'reads capability grants (`permissions`), placements (`positions`) and the derived posture '
    + 'off the execution context.\n\n'
    + 'The same enforce-or-remove reading reaches the storage contract: '
    + '`IStorageService.list(prefix)` is removed (#5540, analysis #5266). It had no '
    + 'consumer — the only in-repo call site was a proxy pass-through — and the two shipped '
    + 'adapters answered it with two different, silently incomplete semantics: the local '
    + 'adapter listed a single level and reported directories as files, the S3 adapter '
    + 'recursed and stopped at 1000 objects without reading `IsTruncated` / '
    + '`ContinuationToken`. Enumerating a prefix without a cursor is the wrong signature to '
    + 'inherit, so nothing replaces it in place: query the file records you wrote, and let a '
    + 'real caller bring back a cursor-shaped `list(prefix, { cursor, limit })` with '
    + 'adapter-conformance cases behind it. Same shape and same disposition as the '
    + '`findStream` retirement above — a TS/API contract, no stored source, no tombstone, '
    + 'tsc at the call site.\n\n'
    + 'Finally it retires the two inert `IndexSchema` keys, `indexes[].type` and '
    + '`indexes[].partial` (#5248, #4943). Neither ever had a DDL consumer: '
    + '`SqlDriver.syncDeclaredIndexes` creates declared indexes through knex\'s `table.index()` / '
    + '`table.unique()`, and the drift differ\'s `DeclaredIndexInput` carries only '
    + '`name`/`fields`/`unique`/`nullSafeColumns` — so an authored `type` selected no access '
    + 'method and an authored `partial` produced a FULL index with its predicate discarded. '
    + '`partial` was the more damaging of the two because it read as a correctness control: the '
    + 'platform\'s own `sys_metadata` declared it for overlay uniqueness, and what the '
    + 'declaration alone materialized was an unrestricted unique index (the active-row scoping '
    + 'is delivered by a runtime migration, `metadata-protocol`\'s `ensureOverlayIndex`, not by '
    + 'the key). `type` was the louder: its `.default(\'btree\')` put an inert knob into every '
    + 'parse output, so it read as live configuration — the ADR-0078 no-silently-inert shape. '
    + 'Remove was chosen over enforce (maintainer ruling, 2026-08-06): enforcing needs '
    + 'per-dialect algorithm mapping (`gin`/`gist` Postgres-only, `fulltext` MySQL-family), '
    + 'raw-SQL `CREATE INDEX … WHERE` on the dialects that have partial indexes at all (MySQL '
    + 'does not), and a redesign of how `isSyncReproducibleIndex` excludes partial indexes from '
    + 'incremental sync — design cost for a capability nothing has asked for. Both are lossless '
    + 'deletes: no DDL changes, because no DDL ever depended on them. Drift detection is '
    + 'untouched — the `partial` flag it consumes is parsed back out of the database\'s OWN '
    + '`CREATE INDEX` DDL and never came from this key.\n\n'
    + 'It also retires the field-mapping `transform` key and the whole five-member '
    + '`FieldMappingTransform` union behind it (#5552): `constant` / `cast` / `lookup` / '
    + '`javascript` / `map`, declared on `shared/FieldMapping` and inherited by '
    + '`integration/ConnectorFieldMapping` and `data/ExternalFieldMapping`. Nothing ever '
    + 'executed one. `fieldMappings` is spelled only inside `packages/spec` itself — the '
    + 'connector packages, the automation engine, REST and objectui never read it, and no '
    + 'code anywhere switches on `transform.type` — so all five members were '
    + 'declared-but-unenforced together, not just the one that got the bug filed. That one '
    + 'is the sharpest evidence though: `javascript`\'s `.describe()` recommended the '
    + 'dialect `js`, which `ExpressionDialect` retired at #3278 (ADR-0058 addendum), so the '
    + 'envelope the documentation taught was rejected by the enum; the only spelling that '
    + 'parsed was the bare string, which `ExpressionInputSchema` wraps as `cel`; and the CEL '
    + 'that resulted could not evaluate the `value.toUpperCase()` the same line offered as '
    + 'its example. Three surfaces disagreeing about a capability with no implementation '
    + 'under any of them. Fixing the sentence alone was rejected (maintainer, 2026-08-06) as '
    + 'gilding a member that cannot run. The key is tombstoned rather than deleted because '
    + 'the schema and both extenders are plain `z.object`s and `ConnectorSchema.parse` is a '
    + 'live receiver, so a bare deletion would strip silently. What is NOT affected, despite '
    + 'the shared word: the import mapping\'s `mapping.fieldMapping[].transform`, a flat '
    + 'string enum applied row by row by the REST import path and live in the liveness '
    + 'ledger — including its own `javascript` value, which that path rejects with a 400 '
    + 'rather than pretending to run.\n\n'
    + 'The last of the #4001 enforce-or-remove batch lands on two more `ui/` files (#5055, '
    + 'ADR-0049 — read it next to #4988 above, it is the same shape one batch later). '
    + '`ui/widget.zod.ts` published a whole widget-REGISTRATION vocabulary — `WidgetManifest` '
    + 'with `WidgetLifecycle` hooks, `WidgetEvent`s, `WidgetProperty` knobs and a '
    + '`WidgetSource` npm/remote/inline implementation union — and `ui/i18n.zod.ts` published '
    + '`I18nObject`, `PluralRule`, `NumberFormat`, `DateFormat` and `LocaleConfig`. Ten defs, '
    + 'twenty exported names, and not one carrier key between them: nothing under '
    + '`packages/spec/src` imported `widget.zod` at all, the only live imports of `i18n.zod` '
    + 'name `I18nLabelSchema` / `AriaPropsSchema`, the BFS from all 24 metadata-type roots '
    + 'plus `defineStack` reached none of them, and no repo ever parsed one. So again nothing '
    + 'is applied for you and nothing needs to be — the change is TS2305 on an import, and a '
    + '`field.widget: "my_picker"` string is untouched, because that key names a component the '
    + 'RENDERER registered and never referenced `WidgetManifest`. ⚠️ Read this scope precisely '
    + 'too, because BOTH files split. `ui/i18n.zod.ts` keeps `I18nLabelSchema` (the label '
    + 'primitive the whole `ui/` tree imports) and `AriaPropsSchema` — a REAL door, carried as '
    + '`aria:` on ~30 live shapes and closed by 批 16, untouched here. And `ui/widget.zod.ts` '
    + 'keeps `FieldWidgetPropsSchema`, the one site of the nine whose evidence differs: it is '
    + 'a React props contract rather than authorable metadata (it never appeared in the '
    + 'authorable surface or the schema manifest — `onChange` is a `z.function()`), so having '
    + 'no parse is its design; and objectui PR #3289 (2026-08-03) made it a live compile-time '
    + 'consumer, renaming `@object-ui/fields`\' validation slot onto this contract\'s `error` '
    + 'with no alias and pinning it as a deliberate tripwire. Retiring it would have broken '
    + 'the one consumer the batch had, one day after it appeared. The measurement that decides '
    + 'a site is the CURRENT one, not the one in the issue body.\n\n'
    + 'Last, it reconciles the SDUI component-props surface with the renderers that serve it '
    + '(#5775). #5068 wired the first parse `ComponentPropsMap` ever had, and the corpus it '
    + 'landed on diverged in BOTH directions: keys objectui honours that the schema never '
    + 'declared, and keys the schema declared — one of them REQUIRED — that no renderer reads. '
    + 'The maintainer ruled direction A (2026-08-06), the #5611 rule again: the delivered and '
    + 'authorized shape is the contract. So the honoured keys are declared '
    + '(`element:record_picker` `labelField`/`valueField`/`label`/`emptyText`, `record:path` '
    + '`stages[].terminal`, `page:tabs` `items[].value`/`items[].count`, `page:card` `children`, '
    + 'and `children` on `page:section`/`page:footer`/`page:sidebar`, which were declared '
    + '`EmptyProps` while their renderers rendered a child list), and four keys retire. Two are '
    + 'synonym renames: `element:record_picker.displayField` → `labelField` (the required key no '
    + 'renderer read, while `labelField ?? \'name\'` is what actually renders the row — so an '
    + 'author who followed the schema got a picker listing `name` with no diagnostic, the '
    + 'ADR-0078 shape), and `page:card.body` → `children` (one composition key across every '
    + 'container; the card renderer already reads both, and the showcase authors `children`). '
    + 'Two are enforce-or-remove deletions: `element:record_picker.searchFields` and '
    + '`.multiple` — the control is a shadcn single-select with no search input, binding ONE '
    + 'record id into a page variable, so `searchFields` narrowed nothing and `multiple: true` '
    + 'selected nothing extra while reporting success. Either returns the day the capability '
    + 'is implemented (#5021 / #4988). Not in scope, and deliberately: `page:card.visible` is a '
    + 'component-level visibility predicate written into `properties` and hoisted by the '
    + 'renderer — a page to rewrite onto the ADR-0089 `visibleWhen`, not a key to declare.\n\n'
    + 'That count turned out to be incomplete, and #6776 finishes it: five more keys the '
    + 'renderers read were still undeclared. Four are plain additions with no behaviour change '
    + '(`page:header` `recordChrome`/`showStar`/`showCopyId`, which select between the '
    + 'record-chip header and the bare heading a dashboard wants, and `page:accordion.variant`, '
    + 'which decides whether the accordion draws its own dividers or leaves the border to each '
    + 'panel). The fifth is a rename, and the only one in the family whose defect is structural '
    + 'rather than an oversight: the tab strip\'s visual style was declared as '
    + '`page:tabs.type`, which collides with the page component\'s OWN dispatch key. objectui\'s '
    + '`SchemaRenderer` refuses to hoist `properties.type` for exactly that reason, '
    + '`sdui-parser`\'s `BASE_PROPS` contains `type` and skips it before any validation runs, '
    + 'and in a flat or JSX carrier the node reads `{ type: \'page:tabs\', … }` so the name is '
    + 'already taken. The key was therefore unauthorable in every carrier but the nested '
    + '`properties` object, and unvalidated even there. It becomes `tabStyle` — the spelling '
    + 'objectui publishes and the renderer already reads first in the flat carriers — which is '
    + '`displayField` → `labelField` again: converge on the spelling that works, not the one '
    + 'that declares well, and keep one spelling rather than two (Prime Directive #12).\n\n'
    + '#6946 closes that reconciliation from the other side, on three keys the two earlier '
    + 'passes left standing (maintainer ruling 2026-08-09, decision-inbox round: objectui#3829 '
    + 'route (c) and objectui#3818). Two are the plain B class — declared here, read NOWHERE. '
    + '`page:header.icon` is resolved by objectui only per header ACTION (`action.icon`); the '
    + "header's own props bag is never asked for one, and `@object-ui/layout`'s `<PageHeader>` "
    + 'takes an `icon` React prop from a host with no schema fallback beside the '
    + '`schema?.actions ?? schema?.properties?.actions` fallback four lines away. '
    + '`page:card.actions` has no actions area to render into at all: the card renderer builds '
    + 'its `<Card>` from `title`, `bordered`, `children` and `footer`, full stop. Both sat in '
    + "objectui's own unpublished-exemption map as \"spec declares it, NO renderer read point\", "
    + 'which is what put the contract decision — wire it, publish it with a KNOWN GAP marker, or '
    + 'retire it — in front of the maintainer; the ruling retired it. Neither has a lossless '
    + 'rewrite target (a header has no second icon slot, and moving a card\'s action ids into '
    + '`children` as components is a page rewrite, not a mechanical one), so both are pure '
    + 'strips. ⚠️ `page:header.actions` is LIVE and untouched — the strip is scoped by component '
    + 'type, never by key name.\n\n'
    + 'The third, `record:details.layout`, is a sharper shape and the one worth reading twice: '
    + 'it IS read. The renderer computes '
    + "`schema.layout === 'inline' || schema.layout === 'compact' ? 'horizontal' : 'vertical'`, "
    + 'while the declared enum is `auto | custom` — so neither legal value can match, both take '
    + 'the same branch, and a key that was accepted and read still selected nothing, under a '
    + '`.describe()` promising "auto uses object highlightFields, custom uses explicit sections". '
    + 'The behaviour that prose describes is real, but the renderer keys it off whether '
    + '`sections` was authored, never off this flag. Every gate stayed green because '
    + '`check:react-declaration-parity` compares two DECLARATIONS and objectui declared the same '
    + '`auto | custom` enum — perfect agreement over a key nothing honoured — while a THIRD '
    + "spelling (`stacked | inline | compact`) sat in `@object-ui/types`' mirror. A pure strip "
    + 'for the same reason: `auto`, `custom` and omission were behaviourally identical, so there '
    + 'is no value to carry. ⚠️ `record:highlights.layout` is a different, live, honoured key '
    + 'and is untouched. objectui#3829 and objectui#3818 drop the exemptions, the input and the '
    + 'dead branch on the next pin bump.\n\n'
    + 'Finally it narrows the aggregation vocabulary: `array_agg` and `string_agg` leave '
    + '`AggregationFunction` (#6188, ADR-0049). The enum declared eight functions and the SQL '
    + 'family compiles five — `SqlDriver.mapAggregateFunc` and the Turso '
    + '`RemoteTransport.aggregate` each lower `count`/`sum`/`avg`/`min`/`max` and route the rest '
    + 'to one refusal — so three were declared-but-unenforced against the backends this platform '
    + 'targets. What makes these two worse than an ordinary inert declaration is that another '
    + 'package had to carry a denylist for them: `service-analytics` subtracted `array_agg` and '
    + '`string_agg` by name in `UNSUPPORTED_AGGREGATES`, because without that subtraction they '
    + "reached the Cube strategy's `default` and returned `COUNT(*)` — a row count in place of "
    + 'the requested value, with no error and no log. The maintainer SPLIT the three rather than '
    + 'retiring them as a block (2026-08-07), and the split is the point: `count_distinct` STAYS '
    + 'and takes the enforce leg — one portable lowering (`COUNT(DISTINCT x)`), a dashboard '
    + 'staple, already lowered by `service-analytics` — with its SQL implementation following on '
    + 'its own card, so that declaration leads its implementation by decision rather than by '
    + 'drift. These two take the remove leg: display conveniences with no measured pull, and '
    + '`string_agg` never had one shape to lower to (the delimiter is a second argument in '
    + 'PostgreSQL, a `SEPARATOR` clause in MySQL, a differently named function in SQL Server). '
    + 'This is an enum VALUE, not a key, so — as with `crypto.hash` above — there is no '
    + '`retiredKey()` tombstone: the enum error map carries the prescription, keyed on the '
    + 'received value so only the two spellings that used to be legal are told they "were '
    + 'removed". Of the two authoring surfaces only one is stored metadata: the conversion '
    + 'rewrites `dataset.measures[].aggregate`, dropping the measure outright (a measure with '
    + 'neither `aggregate` nor `derived` fails the dataset\'s own refinement, so stripping just '
    + 'the key would emit an item that cannot parse) plus any derived measure the drop strands, '
    + 'with a notice each. Nothing is lost: `compileDataset` refused both by name already, so '
    + 'such a measure never produced a number. `QueryAST.aggregations[].function` is a request '
    + 'surface with no stored source — one semantic TODO below. The mongodb and in-memory '
    + 'backends that implemented these two are inside the #5499 freeze and are untouched; their '
    + 'code is simply no longer reachable through a spec-valid request.\n\n'
    + 'The same aggregation node loses one more member, and it is the sharper class of the two: '
    + '`aggregations[].distinct` is removed (#6815, ADR-0049, maintainer ruling 2026-08-09). '
    + 'The functions above were declared and UNLOWERED — a caller on a SQL datasource got a '
    + 'refusal. This flag was declared and lowered by exactly ONE of the six faces that read an '
    + 'aggregation: the engine\'s in-memory fallback deduplicated the values before applying the '
    + 'function, while `SqlDriver.aggregate`, the Turso `RemoteTransport.aggregate`, '
    + '`driver-mongodb`\'s `buildAggregationStage`, `driver-memory`\'s `computeAggregate` and '
    + 'service-analytics\' `AGGREGATE_SQL` all ignored it. So the same query answered a '
    + 'deduplicated `sum` on the fallback path and an ordinary `sum` on every SQL datasource, '
    + 'with the engine choosing between the two per query — by driver, by a non-UTC date bucket, '
    + 'by whether the driver aggregates natively at all. That is the divergence class #6203 and '
    + '#5907 each closed on this axis, still open on this key, and it is worse to sit on because '
    + 'the wrong answer is a PLAUSIBLE NUMBER rather than a refusal: no error, no log, nothing '
    + 'for a dashboard author to notice. It survived the #4286 sweep of this very schema because '
    + 'that sweep asked which members no executor reads, and this one had a reader — the wrong '
    + 'question for a key whose defect is WHICH executor reads it. Remove rather than enforce, '
    + 'per the ruling: `count_distinct` (which just took the enforce leg above, and whose SQL '
    + 'lowering #6409 landed) already covers the only deduplicating spelling with measured '
    + 'demand, while `SUM(DISTINCT …)` / `AVG(DISTINCT …)` are near-universally a modelling '
    + 'mistake and would have to be lowered across five faces, two of them frozen under #5499, '
    + 'to buy it. The blast radius inside the fallback is narrower than the key suggests and was '
    + 'measured rather than assumed: only `sum` and `avg` ever changed answer — `count` returned '
    + 'from its own branch before reaching the dedupe, `count_distinct` fed a Set, and dedupe '
    + 'does not move `min`/`max`. `AggregationNodeSchema` is non-strict, so the key is '
    + '`retiredKey()`-tombstoned rather than bare-deleted: a plain deletion would have made zod '
    + 'silently STRIP what callers still send, trading a divergent flag for an ignored one '
    + '(#3733, ADR-0104). One tombstone covers every aggregation door, because '
    + '`QuerySchema.aggregations` and `EngineAggregateOptionsSchema.aggregations` reuse that one '
    + 'schema by reference. No conversion: a request surface with no stored source — one '
    + 'semantic TODO below, the disposition every other `data.query.*` retirement in this major '
    + 'already takes.\n\n'
    + 'One entry in this step is not a removal at all but a SECURE-DEFAULT FLIP, the shape '
    + "protocol 12 last used for `api.requireAuth`: an omitted `ActionDescriptor.resumeAuthority` "
    + "resolves to `'service'` instead of `'any'`, so a pausing node type that never states who "
    + 'may continue its pauses is refused on the generic resume route rather than open to it '
    + '(#5561, ADR-0044\'s 2026-07-28 amendment). Nothing is removed and no metadata shape '
    + 'changes — the field has been optional since step one of the same issue — so tsc reports '
    + 'nothing and only the MEANING of silence moved. That is exactly why it needs a ledger '
    + 'entry: a third-party plugin author has no compile error to discover it with, and the '
    + 'one-line prescription (declare `resumeAuthority` on the descriptor) has to arrive before '
    + 'a user meets a run that will not continue.\n\n'
    + 'The same descriptor loses a key in this step, and the pairing is the point (#6748, '
    + 'ADR-0049). `ActionDescriptor.isAsync` and `ActionDescriptor.supportsPause` were two '
    + 'spellings of one capability — "this node type can suspend the run" — and #6667 split '
    + 'them by evidence rather than by preference: `supportsPause` took the ENFORCE leg (the '
    + 'engine now refuses a suspension the descriptor never declared, at the one seam every '
    + 'suspension passes through), and `isAsync` takes the REMOVE leg, because a fresh '
    + 'three-repo measurement found zero readers and no consumer it could grow into. What '
    + 'makes the duplicate worse than an ordinary inert key is that five shipped descriptors '
    + 'WROTE it, so the platform itself modelled a declaration that decided nothing — and a '
    + 'plugin author copying `screen` (which declared BOTH) had no way to tell which of the '
    + 'two the runtime honoured. It is tombstoned rather than deleted, so the answer arrives '
    + 'as a rejection carrying the fix; and because a descriptor lives in executor TypeScript '
    + 'rather than in stored metadata, its prescription is a semantic entry below rather than '
    + 'a conversion `os migrate meta` could replay.\n\n'
    + 'The plugin manifest loses its whole `loading` block in this step (#4914, ADR-0049, '
    + 'maintainer ruling 2026-08-04) — the same enforce-or-remove question asked of a block '
    + 'rather than a key, and answered REMOVE on measurement: every reference to '
    + '`manifest.loading.*` in objectstack, cloud and objectui lived inside `packages/spec` '
    + 'itself, so a full loading policy parsed, entered the manifest, and configured nothing. '
    + 'The reason it outranked ordinary inert-key cleanup is that one of its members was '
    + '`sandboxing`, declaring process / vm / iframe / web-worker isolation and a service ACL: '
    + 'an inert SECURITY control is worse than an absent one, because an author (very often an '
    + 'AI, ADR-0033) reads the vocabulary as proof the isolation exists and stops looking. Hot '
    + 'reload was a two-source defect on top of that — the retired `PluginHotReloadSchema` was '
    + 'the dead one of two vocabularies, and the ruling converges on the live one, '
    + '`HotReloadConfigSchema`, which `HotReloadManager` actually reads and which is KEPT '
    + 'unenforced as the starting point for a separate future decision. Like `isAsync`, its '
    + 'prescription is a semantic entry rather than a conversion: a manifest is not a stack '
    + 'collection, so `os migrate meta` has no seam at which to rewrite one.\n\n'
    + 'The action LOCATION vocabulary loses `global_nav` in this step (#6888, ADR-0049, '
    + 'maintainer ruling 2026-08-09). It was declared from the day `ACTION_LOCATIONS` was '
    + 'written and no product surface ever served it: the console command palette composes its '
    + 'groups from nav items, objects, dashboards, pages, reports, recent items and record '
    + 'search, and reads no action metadata at all — so an action declaring this location never '
    + 'reached a user. What lifts it above ordinary inert-declaration cleanup is that the '
    + 'authoring tool PROMISED the surface: the Studio designer previewed a mock '
    + '`⌘K · Command palette` frame for exactly this value, so an author (very often an AI, '
    + 'ADR-0033) declared it, watched it "render", shipped it, and got nothing — the ADR-0078 '
    + 'shape arriving through a location vocabulary rather than through a missing key. It was '
    + 'retired rather than implemented because the demand evidence is empty: no user has asked '
    + 'for command-palette actions and the only two declarers were our own showcase corpus, so '
    + 'wiring the palette would have been capability expansion with no pull. This is an enum '
    + 'VALUE, not a key, so — as with `crypto.hash` and the two aggregate functions above — '
    + 'there is no `retiredKey()` tombstone: the enum error map carries the prescription, keyed '
    + 'on the received value so only the spelling that used to be legal is told it "was '
    + 'removed". The conversion strips the value from `action.locations` and KEEPS the key even '
    + 'when the array empties, because on this surface `locations: []` and an absent '
    + '`locations` are different declarations: the empty array is the documented headless shape '
    + '(callable over REST/MCP/AI, capability gate and audit trail intact), while an absent key '
    + "means nobody placed the action — which is what `packages/lint`'s `action-no-placement` "
    + 'warns about. An object-less action, whose only reason for declaring `global_nav` was that '
    + 'it has no row and no record header to render on, is therefore migrated to the '
    + 'declaration it always meant.',
  conversionIds: [
    'action-execute-to-target',
    'field-conditionalRequired-to-requiredWhen',
    'agent-tools-to-skills',
    'sharing-rule-access-level-full-to-edit',
    'flow-node-crud-object-alias',
    'flow-node-notify-config-aliases',
    'flow-node-wait-event-config-lift',
    'flow-node-connector-config-lift',
    'flow-node-map-flow-alias',
    'flow-node-subflow-flow-alias',
    'flow-node-script-config-aliases',
    'permission-rls-priority-removed',
    'tool-inert-authoring-keys-removed',
    'app-dead-authoring-keys-removed',
    'app-area-fail-open-gates-removed',
    'field-required-notnull-explicit',
    'action-inert-keys-removed',
    'flow-inert-keys-removed',
    'view-inert-keys-removed',
    'dashboard-inert-keys-removed',
    'agent-knowledge-removed',
    'skill-trigger-phrases-removed',
    'stack-api-require-auth-removed',
    'datasource-capabilities-removed',
    'datasource-inert-blocks-removed',
    'mapping-inert-keys-removed',
    'book-translations-removed',
    'job-id-removed',
    'translation-validation-messages-removed',
    'flow-node-wait-timeout-keys-removed',
    'datasource-read-replicas-removed',
    'datasource-config-driver-key-aliases',
    'datasource-driver-mongo-to-mongodb',
    'flow-node-script-branch-keys-removed',
    'object-managed-by-system-to-system-data',
    'retry-policy-converged',
    'object-enable-trash-mru-removed',
    'hook-body-crypto-hash-removed',
    'connector-rate-limit-config-removed',
    'dashboard-widget-responsive-removed',
    'dashboard-widget-action-aria-removed',
    'dashboard-widget-compareto-converged',
    'theme-inert-token-scales-removed',
    'page-header-subtitle-alias',
    'object-index-type-partial-removed',
    'field-mapping-transform-removed',
    'record-picker-display-field-to-label-field',
    'record-picker-inert-keys-removed',
    'page-card-body-to-children',
    'dataset-measure-array-string-agg-removed',
    'inline-action-api-params-to-body-extra',
    'page-tabs-type-to-tab-style',
    'page-structure-inert-keys-removed',
    'record-details-layout-removed',
    'app-hidden-to-unpublished',
    'action-global-nav-location-removed',
  ],
  semantic: [
    // One file per entry under `entries/semantic/`, concatenated here sorted by
    // entry id by `gen:migration-registry` (#7297). Add an entry by adding a
    // FILE — never by editing between the markers, which is generated.
    // <os-generated semantic:17>
    {
      id: 'action-descriptor-is-async-retired',
      surface: 'ActionDescriptor.isAsync (the descriptor an executor publishes via `registerNodeExecutor` / `defineActionDescriptor`)',
      replacement:
        'nothing to re-declare — delete the key. Suspension is `execute()` RETURNING '
        + '`suspend: true`, and permission to suspend is `supportsPause: true` on the same '
        + 'descriptor (with the `resumeAuthority` its pauses need)',
      reason:
        'ADR-0049 enforce-or-remove. `isAsync` declared "this action suspends the flow '
        + 'awaiting an external reply" and NOTHING read it: a fresh three-repo measurement '
        + '(#6748, re-run at pickup) found zero property reads across objectstack, objectui '
        + 'and cloud — every hit was the declaration itself, a generated baseline, one of '
        + 'five shipped descriptors WRITING it, a test fixture pinning the shape, or prose. '
        + 'So declaring it never made a node suspend and omitting it never stopped one, '
        + 'which is the silently-inert declaration ADR-0049 exists to end. It was always a '
        + 'second, weaker spelling of the capability `supportsPause` states, and the two '
        + 'diverged in exactly the way a duplicated declaration does: `screen` declared '
        + 'both, `map` and `wait` declared `isAsync` alongside `supportsPause`, and nothing '
        + 'anywhere reconciled them. The sibling took the ENFORCE leg of the same ruling in '
        + '#6667 — `AutomationEngine` now refuses a suspension whose type does not declare '
        + '`supportsPause: true` — so the capability this key gestured at is now a real, '
        + 'enforced fact under one name. This one had no consumer to grow into and takes '
        + 'the remove leg. '
        + 'Why D3 semantic and not a D2 conversion: an ActionDescriptor is published from '
        + "an executor's TypeScript, never stored in stack metadata — no stack, example or "
        + 'template carries the key — so there is no source for the chain to rewrite and '
        + '`os migrate meta` cannot reach it. The schema tombstones it via `retiredKey()` '
        + 'and descriptor authors delete the key themselves; that rejection (a `tsc` error '
        + 'at the authoring site, and a parse error inside `defineActionDescriptor`) is the '
        + 'channel a third-party plugin author actually meets. The '
        + '`EnhancedApiError.fieldErrors` disposition, one layer down.',
      acceptanceCriteria:
        'No descriptor declares `isAsync` — not the five that shipped it (`screen`, `map`, '
        + '`wait`, `approval`, `approval_revise`), not a plugin\'s. Every node type that '
        + 'returns `suspend: true` from `execute()` declares `supportsPause: true` on its '
        + 'descriptor together with a `resumeAuthority`, and its runs still pause and resume '
        + 'as before: the behaviour never depended on `isAsync`, so deleting the key changes '
        + 'no run. Authoring `isAsync` fails `tsc` at the descriptor literal and fails '
        + '`defineActionDescriptor()` at runtime with the prescription, instead of parsing '
        + 'clean and being stripped.',
    },
    {
      id: 'action-descriptor-resume-authority-default-flip',
      // No backticks in `surface` — build-upgrade-guide.ts renders it inside a code
      // span AND a table cell (see the note on `spec-type-alias-input-suffix-retired`).
      surface:
        'automation.ActionDescriptor.resumeAuthority — an OMITTED value on a pausing '
        + 'node descriptor (supportsPause: true, or any executor whose execute() returns '
        + 'suspend: true)',
      replacement:
        "an explicit resumeAuthority: 'any' on the descriptor, for a pausing node whose "
        + 'pauses really are meant to be continued through the generic resume route '
        + '(POST /automation/:name/runs/:runId/resume) — a screen-style collected-input '
        + "pause, or a signal wait an external producer resumes. Declare 'service' instead "
        + 'if continuing is the tail of a decision your own service must authorize and '
        + 'record first. Either value is a one-line addition; only the silence changed '
        + 'meaning',
      reason:
        'A SECURE-DEFAULT FLIP with no metadata shape to rewrite — the same category as '
        + "protocol 12's `rest-requireauth-default-flip`, and it is registered here for the "
        + 'same reason: whether a given pause is genuinely open to the generic route is a '
        + 'trust judgment no transform can make. The #3801 resume gate keys on the SUSPENDED '
        + "NODE, and `ActionDescriptor.resumeAuthority` used to default to `'any'`, so a "
        + 'pausing node type shipped raw-resumable unless its author remembered the field. '
        + "It now resolves to `'service'` when absent: an unclaimed pause is refused on the "
        + 'generic route with `PERMISSION_DENIED` / 403 until its descriptor states who may '
        + 'continue it. #3823 is the incident that decided the direction — ADR-0044 pointed '
        + "an approval's revise edge at a generic `wait`, `wait` is legitimately `'any'`, and "
        + 'the pause standing in a service-owned position inherited a fail-open value nobody '
        + 'chose; the demonstrated cost was an unaudited resubmit plus a destroyed remote '
        + 'run. The two possible mistakes are asymmetric, which is the whole argument: '
        + "guessing `'any'` walks past a decision nothing recorded and is silent, while "
        + "guessing `'service'` returns a refusal naming the missing field. ⚠️ The surface "
        + 'is a DESCRIPTOR FIELD set in plugin CODE, never stack metadata, so there is no '
        + 'source for a D2 conversion to rewrite and deliberately no schema tombstone — the '
        + 'disposition `data-driver-find-stream-retired` (#4484), `storage-service-list-retired` '
        + '(#5540) and `actor-user-roles-to-positions` (#6011) already carry. It differs from '
        + 'those in one way a reader should not have to infer: nothing is REMOVED, so tsc '
        + 'reports nothing at all — the field was already optional after step one and an '
        + 'omission still compiles. The enforced channels are all run-time: a registration '
        + 'warning naming the node type (once per type per engine), the refusal message on '
        + 'the resume itself, and `check:resume-authority-declared` for executors living in '
        + 'this repo. For a third-party plugin the generated upgrade guide is the only '
        + 'channel that arrives BEFORE a user hits a run that will not continue. In-tree the '
        + 'flip moves nothing: all six shipped pausing types (screen, wait, subflow, map, '
        + 'approval, approval_revise) declare their authority explicitly. ADR-0044 amendment '
        + '(2026-07-28) and its 2026-08-08 landing section, ADR-0019 #3801 addendum, #5561.',
      acceptanceCriteria:
        'Every action descriptor your plugin registers for a node type that can suspend '
        + 'declares `resumeAuthority`. Booting the stack logs no `declares supportsPause but '
        + 'never declares resumeAuthority` warning naming one of your types, and a run parked '
        + 'on each of your pausing nodes can still be continued the way you intend: a resume '
        + "through the generic route succeeds for the ones you declared `'any'`, and answers "
        + "403 (`PERMISSION_DENIED`) for the ones you declared `'service'`, which continue "
        + 'through your own service API instead. ⚠️ `supportsPause` is no longer the '
        + 'declaration nothing enforced (#5703, closed by #6667): an executor whose '
        + '`execute()` returns `suspend: true` while leaving `supportsPause` false is still '
        + 'warned about by neither warning channel, but '
        + '`AutomationEngine.refuseUndeclaredSuspension` now refuses that suspension at the '
        + 'one seam every suspension passes through — a guard-class failure no `fault` edge '
        + 'routes — so it needs no hand-check. The residue that does: an executor registering '
        + 'NO descriptor declares nothing for either warning or the refusal to read, so its '
        + 'pauses are still created and refused only later, on the resume route (#5561).',
    },
    {
      id: 'action-session-roles-to-positions',
      surface: 'ui.actionSession.roles',
      replacement: 'ui.actionSession.positions (an action body reads `ctx.session.positions`)',
      reason:
        'The MIRROR-IMAGE sibling of `actor-user-roles-to-positions`, and the reason both are in this '
        + 'step: the hook `ctx.session` carried `roles` declared-and-never-produced (removed '
        + 'outright, #5050), while the ACTION body\'s `ctx.session` carries it '
        + 'produced-and-really-populated. `buildActionSession()` '
        + '(`packages/runtime/src/action-execution.ts`) copies `ExecutionContext.positions` '
        + 'into a key spelled `roles` — the ADR-0090 D3 vocabulary handed to the author under '
        + 'the one spelling that ADR bans — so a body author met two different answers to one '
        + 'key name on one platform: rejected in a hook, live and full of values in an action. '
        + '#5613 ruled contract-first (maintainer, 2026-08-06: "C skeleton + A semantics"): '
        + 'phase 1 (#5697) declared the previously undeclared shape as `ActionSessionSchema`, '
        + 'and phase 2 renames the key. `positions` is now the canonical key on that schema '
        + 'and `roles` a deprecated alias of it (#5779); the producer emits both for one '
        + 'deprecation window (#5613 runtime half), after which `roles` is removed on the path '
        + 'the v11 session-alias removal already walked (#3280 deprecated → #3290 removed). '
        + 'Why this is a D3 semantic TODO and not a D2 conversion, on two independent grounds: '
        + 'FIRST, there is no source to convert — an action `ctx.session` is constructed per '
        + 'dispatch and never persisted, so no `sys_metadata` row, example or template can '
        + 'carry the key — the `openApi31` (#4579) / `activationEvents` (#4657) / '
        + '`hook-context-session-roles-retired` (#5050) shape. SECOND, the only place the key '
        + 'is ever SPELLED is inside an action body: author-written JS/TS, or a sandboxed '
        + 'script whose `ScriptContext.session` is still `unknown`. A declarative transform '
        + 'cannot safely rewrite an identifier inside free-form code — exactly the reason the '
        + 'ADR-0090 wave delegated `current_user.roles` to the author at step 13 '
        + '(`cel-current-user-roles-to-positions`) instead of substituting text. '
        + 'Note what is deliberately NOT done here: the alias is not tombstoned. A '
        + '`retiredKey()` REJECTS the key, and a deprecation window exists precisely so the '
        + 'old spelling keeps working while its readers move — tombstoning during the window '
        + 'would be the removal it is meant to defer. The tombstone (or the plain deletion the '
        + 'authorable-surface ratchet adjudicates) belongs to the release that closes the '
        + 'window. Until then this entry IS the channel: `spec-changes.json` and the generated '
        + 'upgrade guide are how a reader learns the rename before the removal reaches them. '
        + 'ADR-0090 D3, ADR-0087, #5613 / #5779.',
      acceptanceCriteria:
        'No action body reads `ctx.session.roles`; every such read is `ctx.session.positions` '
        + 'and observes the same array (the rename is a rename — the VALUE is '
        + '`ExecutionContext.positions` on both sides, which the runtime pin '
        + '`action-session-shape-contract.test.ts` asserts independently of the key name). '
        + 'Privilege is NOT re-derived from either spelling: a read that was '
        + '`roles.includes(\'admin\')` as an access check is rewritten to ask the security '
        + 'service (capability grants / placements / derived posture, ADR-0095), never '
        + 'renamed to `positions.includes(\'admin\')` — renaming that read migrates the defect '
        + 'rather than the code. Verify against a real dispatch, not a fixture: invoke an '
        + 'action as a caller holding positions and assert the body observed them under the '
        + 'canonical key. During the window both keys are present and equal, so a reader can '
        + 'be migrated and verified before the alias is removed; after it, `roles` is absent '
        + 'and a body still reading it sees `undefined` — which is why the read must be moved '
        + 'inside the window rather than at its close.',
    },
    {
      id: 'actor-user-roles-to-positions',
      surface: 'action body / AI route: ctx.user.roles (req.user.roles)',
      replacement:
        'ctx.user.positions (an AI route handler reads `req.user.positions`) — the same array, '
        + 'under the one spelling ADR-0090 D3 sanctions',
      reason:
        'The THIRD face of the ADR-0090 `roles` → `positions` rename, and the only one whose '
        + 'surface the spec never declared. `ActorUser` '
        + '(`packages/runtime/src/security/actor-user.ts`) is the ONE producer of the `user` '
        + 'envelope handed to an action body as `ctx.user` and to an AI route handler as '
        + '`req.user`; it declared `positions` and `roles` side by side and filled them from a '
        + 'SINGLE assignment (`roles: core.positions`), so the two keys were verbatim identical '
        + 'on every dispatch — a second spelling of the vocabulary ADR-0090 D3 reserves and bans, '
        + 'published straight into author-written code. The maintainer ruled it closed IMMEDIATELY '
        + '(2026-08-06 14:49Z, #6011): no deprecation window, no dual-emit, the alias simply gone '
        + 'in 17 (PR #6048). '
        + '⚠️ Do not read this entry across to its sibling `action-session-roles-to-positions`: '
        + '`action-session-roles-to-positions` governs `ctx.session`, a DIFFERENT object reached '
        + 'through the same `ctx`, and that one KEEPS its one-window dual-emit (#5613). Same word, '
        + 'same dispatch, two faces, two schedules — `ctx.user.roles` is absent in 17 while '
        + '`ctx.session.roles` still answers for the length of its window. '
        + 'What makes this entry different in KIND from both session-side siblings: `ctx.user` has '
        + 'no spec schema and never had one. It is a runtime TS interface, so unlike '
        + '`HookContext.session.roles` (tombstoned on a deliberately non-strict `HookContextSchema`, '
        + '#5050) and unlike `ActionSessionSchema` (declared contract-first at #5697 precisely so '
        + 'its key could be renamed), there is no schema key here to tombstone and no '
        + '`retiredKey()` prescription that could reach anybody — nothing ever ran an `ActorUser` '
        + 'through a `.parse()`, so a prescription there would have no one to reach. The enforced '
        + 'channel is tsc, and it reports at the READ site inside the author\'s own body; for an '
        + 'untyped or sandboxed body there is no enforced channel at all, which is exactly why '
        + 'this ledger entry has to exist — `spec-changes.json` and the generated upgrade guide '
        + 'are the ONLY way such a reader learns of the rename. It is the `findStream` (#4484) / '
        + '`IStorageService.list` (#5540) disposition — a TS/API contract, no stored source, no '
        + 'tombstone, tsc at the call site — applied to a surface that lives one layer further '
        + 'out than either: those two are at least DECLARED in `packages/spec/src/contracts`, '
        + 'this one only in `packages/runtime`. '
        + 'Why it is a D3 semantic TODO and not a D2 conversion, on the same two independent '
        + 'grounds as its session sibling: FIRST, there is no source to convert — an `ActorUser` '
        + 'is constructed per dispatch and never persisted, so no `sys_metadata` row, example or '
        + 'template can carry the key (the `openApi31` (#4579) / `activationEvents` (#4657) / '
        + '`hook-context-session-roles-retired` (#5050) shape). SECOND, the only place the key is '
        + 'ever SPELLED is inside an action body or an AI route handler: author-written JS/TS, or '
        + 'a sandboxed script. A declarative transform cannot safely rewrite an identifier inside '
        + 'free-form code — the same reason the ADR-0090 wave delegated `current_user.roles` to '
        + 'the author at step 13 (`cel-current-user-roles-to-positions`) instead of substituting '
        + 'text. '
        + 'The removal\'s hard precondition was met before it landed, and the result is recorded '
        + 'here because the ledger is where an upgrading consumer meets it: the declaration\'s own '
        + 'comment claimed the alias was "kept for the REST/AI shapes", and that claim was '
        + 'DISPROVEN face by face against `origin/main` — repo-wide `user.roles` was 4 hits, all '
        + 'of them in the pins PR #6048 flipped; the four `ActorUser` construction sites build '
        + 'server-side envelopes that never enter a response body; objectui\'s `.roles` reads '
        + 'belong to two unrelated producers (the better-auth session, and the '
        + '`/auth/me/permissions` payload). The `cloud` repo was NOT reachable in that session and '
        + 'is the one consumer face left unverified — this entry, and the changeset\'s FROM/TO '
        + 'prescription, are its disposition. ADR-0090 D3 / ADR-0049 / ADR-0087, #6011 (PR #6048).',
      acceptanceCriteria:
        'No action body reads `ctx.user.roles` and no AI route handler reads `req.user.roles`; '
        + 'every such read is `.positions` and observes the SAME array — the value was '
        + '`ExecutionContext.positions` on both sides, so this is a pure key rename and no value '
        + 'has to be re-derived. Privilege is NOT re-derived from either spelling: a read that was '
        + '`roles.includes(\'admin\')` as an access check is rewritten to ask the security service '
        + '(capability grants / placements / derived posture, ADR-0095), never renamed to '
        + '`positions.includes(\'admin\')` — renaming that read migrates the defect rather than the '
        + 'code. Unlike `ctx.session` there is NO window to migrate inside: in 17 the key is '
        + 'already absent, so a typed body fails `tsc` at the read while an untyped or sandboxed '
        + 'one silently sees `undefined` — move the read AS you upgrade, not after it. Verify '
        + 'against a real dispatch rather than a fixture: invoke an action (and an AI route) as a '
        + 'caller holding positions, assert the body observed them under the canonical key, and '
        + 'assert the old key is ABSENT by key existence (`\'roles\' in ctx.user === false`) rather '
        + 'than by `undefined`, which cannot tell a removed key from one left behind holding '
        + 'nothing — the runtime pin `action-ctx-user-shape.test.ts` asserts both halves that way.',
    },
    {
      id: 'aggregation-node-distinct-retired',
      surface: 'data.query.aggregations[].distinct',
      replacement:
        'the `count_distinct` aggregation FUNCTION for a deduplicated count — the one '
        + 'deduplicating spelling every face computes, lowered to `COUNT(DISTINCT field)` on '
        + 'both SQL faces since #6409. `SUM(DISTINCT …)` / `AVG(DISTINCT …)` get no '
        + 'replacement: no backend ever computed them here, and a per-row measure that needs '
        + 'deduplicating before summing is a modelling problem to fix in the data',
      reason:
        'A DIVERGENCE, not an inert declaration — which is why it outlived the #4286 sweep '
        + 'that dispositioned every other `data.query.*` member. That sweep asked which keys '
        + 'no executor reads; this one HAD an executor, exactly one out of six. The engine\'s '
        + 'in-memory fallback (`objectql/src/in-memory-aggregation.ts`) deduplicated the '
        + 'values before applying the function, while `SqlDriver.aggregate`, the Turso '
        + '`RemoteTransport.aggregate`, `driver-mongodb`\'s `buildAggregationStage`, '
        + '`driver-memory`\'s `computeAggregate` and service-analytics\' `AGGREGATE_SQL` all '
        + 'ignored the key. So `{ function: \'sum\', field: \'amount\', distinct: true }` '
        + 'answered a deduplicated sum when the engine fell back in memory and an ordinary sum '
        + 'on every SQL datasource: one query, two numbers, chosen by which backend happened '
        + 'to serve it — and unlike the #6203 / #5907 divergences closed on the same axis, the '
        + 'wrong answer here is a plausible NUMBER rather than a refusal, so nothing surfaced '
        + 'it to the author. Measured blast radius inside the fallback: `sum` and `avg` only — '
        + '`count` returned from its own branch before reaching the dedupe, `count_distinct` '
        + 'fed the values into a Set (dedupe-then-Set is Set), and dedupe does not move '
        + '`min`/`max`. ENFORCE was weighed and rejected (maintainer ruling 2026-08-09): '
        + '`count_distinct` already covers the only spelling anyone has measured demand for, '
        + 'and lowering `SUM(DISTINCT …)` across five faces — two of them frozen under #5499 — '
        + 'buys a shape that is near-universally a modelling mistake. A REQUEST surface — '
        + '`QueryAST` is the client SDK builder\'s output and the `POST /data/:object/query` '
        + 'body, never stored in stack metadata — so there is no source for the chain to '
        + 'rewrite and callers move their own queries: the #4286 disposition for '
        + '`joins`/`cursor`/`distinct`/`windowFunctions`, applied verbatim one level down. '
        + 'ADR-0049, #6815.',
      acceptanceCriteria:
        'No caller sends `distinct` inside an `aggregations[]` entry, on the wire or through '
        + 'the SDK; a deduplicated count is written as `{ function: \'count_distinct\', field }` '
        + 'and reads the same number on every backend. A query still carrying the key fails to '
        + 'parse with the removal prescription — including through '
        + '`EngineAggregateOptionsSchema`, which reuses `AggregationNodeSchema` by reference — '
        + 'and `POST /api/v1/data/:object/query` answers `400 VALIDATION_FAILED` with a '
        + '`fields[]` entry at `aggregations.<i>.distinct` instead of serving a number. '
        + 'Authoring it is a `tsc` error at the call site. ⚠️ The observable NUMBERS change on '
        + 'exactly one path and that is the point of the change: a `sum`/`avg` that used to be '
        + 'deduplicated by the in-memory fallback now answers what every SQL face has always '
        + 'answered for the same query. Verify against the SQL answer, not against the '
        + 'pre-upgrade fallback answer — the two disagreed, which is why the key is gone.',
    },
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
    {
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
    },
    {
      id: 'apimethod-enum-shrink',
      surface: 'data.object.enable.apiMethods (the eight legacy non-primitive values)',
      replacement:
        'the six primitives only — `get` / `list` / `create` / `update` / `delete` / `bulk`: '
        + 'replace each legacy value with the primitives it derives from, de-duplicate, and '
        + 'delete the key entirely if the result names all six',
      reason:
        'The authored `enable.apiMethods` enum is now exactly the six primitives. The eight '
        + 'legacy values — `upsert`, `aggregate`, `history`, `search`, `restore`, `purge`, '
        + '`import`, `export` — are no longer authorable, because they are DERIVED effective '
        + 'operations resolved by the server\'s single derivation table, and an enum that lets an '
        + 'author name both a primitive and something derived from it has two spellings for one '
        + 'fact. The FROM → TO is a table rather than a rename: `upsert` → `create` + `update`; '
        + '`import` → `create` + `update`; `export`, `aggregate` and `search` → `list`; '
        + '`history` → `get`; and `restore` / `purge` map to NOTHING — they never derived, '
        + 'because `enable.trash` was retired in #2377, so the value is deleted outright. That '
        + 'last row is why this is a semantic entry and not a mechanical conversion, and the '
        + 'reason is a security one: the mapping WIDENS. An allowlist naming `history` was '
        + 'granting read of one record\'s audit trail; rewritten to `get` it grants ordinary '
        + 'record reads, and an allowlist naming `search` becomes a grant of full `list`. A '
        + 'transform that applied the table silently would broaden real API permissions without '
        + 'anyone reading the diff, so the rewrite is delegated to the author with the widening '
        + 'flagged. The reporter codemod exists for exactly that shape: `node '
        + 'scripts/codemod/apimethods-legacy-to-primitives.mjs` scans, reports the exact '
        + 'replacement per site, and FLAGS the allowlists the mapping would widen so the edit '
        + 'stays reviewable — it reports, it does not rewrite. Stored metadata keeps parsing '
        + '(permanent tolerance, narrowing only), so nothing breaks at rest; what changes is what '
        + 'an author may newly write. Registered by the #6350 stock reconciliation; #3543 (P2 of '
        + '#3391) predates the #6148 completeness gate. ADR-0087, #3543 (backfilled #6350).',
      acceptanceCriteria:
        'No authored `enable.apiMethods` array names a legacy value; `objectstack validate` '
        + 'passes. Run the reporter codemod first and read its widening flags before applying '
        + 'anything — ⚠️ the migration is only correct if each widened grant was INTENDED. For '
        + 'every object where `history` became `get` or `search` became `list`, confirm the '
        + 'broader operation is one the API should genuinely expose; where it is not, the answer '
        + 'is not a different value in this enum but a permission set that withholds the '
        + 'operation. Where the six primitives are all present, prefer deleting the key: that is '
        + 'equivalent to default-open and it tracks future primitives, whereas a hand-listed six '
        + 'silently stops granting anything added later. `restore` / `purge` are deleted with no '
        + 'replacement — if trash-like behaviour was being relied on, that capability left in '
        + '#2377 and this entry is not where it returns.',
    },
    {
      id: 'auth-config-unadvertised-reserved-features',
      surface: 'api.authConfig.features.passkeys / api.authConfig.features.magicLink',
      replacement: '(removed — no replacement flag; the capabilities are not advertised)',
      reason:
        'Both flags were served by `GET /api/v1/auth/config` from introduction and read by no '
        + 'client: no login UI anywhere renders a passkey or magic-link affordance off them, so '
        + 'the payload advertised two sign-in methods a user could never reach, and a deployer '
        + 'setting `plugins.passkeys` / `plugins.magicLink` flipped a switch with no observable '
        + 'effect (ADR-0049 enforce-or-remove; maintainer ruling 2026-08-11 on #7481 chose remove '
        + 'over keep-as-reserved). The two are not equally empty: nothing at all is wired behind '
        + '`passkeys`, whereas `magicLink`\'s better-auth endpoints are live and only their '
        + 'advertisement was withdrawn. This is a RESPONSE surface — nobody authors or persists '
        + 'an `AuthFeaturesConfig` — so there is no source for the chain to rewrite; the schema '
        + 'tombstones both keys via retiredKey() and consumers drop their read. The withdrawal is '
        + 'conditional: both return to the payload in the change that ships the login UI '
        + '(objectui#4179). ADR-0049, #7481.',
      acceptanceCriteria:
        'No client reads `features.passkeys` or `features.magicLink` off `/api/v1/auth/config`; '
        + 'a client that gated UI on either now treats the capability as absent rather than '
        + 'reading `undefined` as false by accident, and constructing an `AuthFeaturesConfig` '
        + 'with either key fails to parse with its own prescription instead of being silently '
        + 'stripped. Magic-link deployments keep working: `plugins.magicLink` still mounts '
        + '`/api/v1/auth/magic-link/send` and `/magic-link/verify`, which a custom UI may call '
        + 'directly.',
    },
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
    {
      id: 'batch-row-result-schema-shape',
      surface:
        'api.batchOperationResult — the per-row `results` entries of BatchUpdateResponse '
        + '(`POST /data/:object/batch`, `/updateMany`, `/deleteMany`)',
      replacement:
        '`errors: ApiError[]` (was `error: string` — read `row.errors?.[0]?.message`, branch on '
        + '`row.errors?.[0]?.code`), `data` (was `record`), and `index` (new — the row\'s position '
        + 'in the request array)',
      reason:
        'The rows the three bulk-write endpoints emitted had drifted from the schema that '
        + 'declared them: `BatchOperationResultSchema`, the client SDK\'s exported '
        + '`BatchOperationResult` type and the reference docs all said `errors: ApiError[]` / '
        + '`data` / `index`, while the wire carried `error: string` / `record` and never sent '
        + '`index` at all. A TypeScript consumer written against the published type compiled, '
        + 'validated and read `undefined` at runtime — the declared-but-not-delivered shape this '
        + 'registry exists to close, on the response envelope (ADR-0119 D4 deferred the '
        + 'reconciliation off a bug fix; this is that tracked change, shipped in the 17 major '
        + 'window). The ADR-0119/#4620 rollback marking is structured in the same move: the '
        + '`ROLLED_BACK:` / `NOT_ATTEMPTED:` message-string prefixes become registered '
        + '`ApiError.code` values (message keeps the human-readable cause and causal row index), '
        + 'so "attempted and undone" vs "never ran" is machine-readable instead of a regex '
        + 'convention. A RESPONSE surface — nothing stored in stack metadata carries a batch '
        + 'row, so there is no source for the chain to rewrite; consumers of the legacy keys '
        + 'move their reads themselves. Off-contract readers only: the legacy keys were never '
        + 'in the schema or the SDK types, so a typed consumer needs no change. #4793.',
      acceptanceCriteria:
        'No consumer reads `row.error` or `row.record` on a batch result row; failures are read '
        + 'from `row.errors` (message via `errors[0].message`, rollback state via '
        + '`errors[0].code` — ROLLED_BACK / NOT_ATTEMPTED), records from `row.data`, and rows '
        + 'correlate to the request via `row.index`. Every row the three endpoints emit parses '
        + 'under `BatchOperationResultSchema` with those keys present.',
    },
    {
      id: 'client-delete-result-success',
      surface: 'client.DeleteDataResult.deleted (the return of `client.data.delete()`)',
      replacement: '`success` — `r.deleted` → `r.success`. Same call, same wire body, declared name',
      reason:
        '`DeleteDataResult` carried the comment `Spec: DeleteDataResponseSchema` above a '
        + 'declaration that contradicted it: the interface declared `deleted: boolean` while '
        + '`DeleteDataResponseSchema` declares `{ object, id, success }`. `deleted` has never '
        + 'been declared by any schema and no server path has ever returned it on '
        + '`/data/:object/:id`. Both delete surfaces — `client.data.delete()` and the '
        + 'project-scoped `client.project(id).data.delete()` — are pure `unwrapResponse` / '
        + '`_unwrap` passthroughs, so the interface is a CLAIM about the wire, never a rewrite of '
        + 'it, and the claim was false in the one direction that matters: the compiler endorsed '
        + 'the wrong spelling. `if (r.deleted)` compiled, read `undefined` at runtime, and the '
        + 'branch was never taken; `if (r.success)` was rejected by the compiler and correct on '
        + 'the wire. So this rename REVEALS a defect rather than breaking working code — every '
        + 'reader of the old key was already reading `undefined`, on every deployment and not '
        + 'just some, because the protocol path has always answered `success`. It is registered '
        + 'as a semantic entry rather than a mechanical conversion for the reason the rewrite '
        + 'itself does not capture: the key is one token, but a call site that branched on '
        + '`r.deleted` has been taking the FALSE branch unconditionally since it was written, and '
        + 'whatever that branch did — or skipped — is what actually has to be re-read. There is '
        + 'no authored source for the chain to rewrite either; this is a published TypeScript '
        + 'surface whose enforced channel is tsc at the call site, and for an untyped JS caller '
        + 'there is no constrained channel at all, which is why the ledger entry is the only '
        + 'notification that reaches them. ⛔ Do not write `r.success ?? r.deleted`: there is one '
        + 'producer shape, and a consumer accepting two spellings is what contract-first exists '
        + 'to prevent (the same ruling #5581 applied on the producer side). No deprecated '
        + '`deleted?: boolean` transition key ships, for the same reason — a transition period is '
        + 'for keys that WORKED, and this one never did. Registered by the #6350 stock '
        + 'reconciliation. ADR-0087, #5638 (backfilled #6350).',
      acceptanceCriteria:
        'No code reads `.deleted` off a `client.data.delete()` / `client.project(id).data.'
        + 'delete()` result; `tsc` names every site for a typed caller, and an untyped JS caller '
        + 'must be swept by hand because nothing will report it. Nothing about the request, the '
        + 'route, the status codes or the error shapes changes, and no server needs upgrading — '
        + 'the value you may now read is the one that was already arriving. ⚠️ The real work is '
        + 'behavioural: every `if (r.deleted)` has been false since it was written, so re-read '
        + 'what each of those branches was supposed to do. Post-delete cleanup, cache '
        + 'invalidation, audit writes and UI refreshes guarded that way have never run, and '
        + 'switching to `r.success` turns them ON for the first time — verify that is what you '
        + 'want rather than assuming it restores prior behaviour. Any test that passed while '
        + 'asserting on `deleted` was asserting on `undefined` and needs rewriting, not renaming.',
    },
    {
      id: 'dashboard-widget-compareto-offset',
      surface: "dashboard.widgets[].compareTo: { offset: '7d' | '1M' | … } (every duration except '1y')",
      replacement: "compareTo: { kind: 'previousPeriod' } plus an explicit window on the widget's own `filter`",
      reason:
        'The widget declared three comparison arms; the analytics executor implements one shape, '
        + '`{ kind, dimension? }`, with no `offset` concept in it at all. On the ADR-0021 dataset '
        + 'path — the spec\'s single author-facing analytics shape — `{ offset }` was forwarded '
        + 'verbatim into that contract and threw `compareTo requires a timeDimension "undefined"`, '
        + 'taking the widget down; the arm ever only ran on the legacy inline chart path (#5011). '
        + "The conversion rewrites `{ offset: '1y' }`, which IS `previousYear` by definition. Every "
        + 'other duration has NO faithful target: `previousPeriod` shifts by the length of whatever '
        + "window the widget's filter resolves to, which equals `7d` only when that window happens "
        + 'to be seven days long. Rewriting mechanically would silently change which rows the '
        + 'comparison column counts — a wrong number rather than a missing one, which is strictly '
        + 'worse and exactly the class this convergence exists to end. Re-stating the intended '
        + 'window is a judgment about the presentation, not a transform.',
      acceptanceCriteria:
        'No dashboard widget declares `compareTo.offset`. Each former offset comparison states its '
        + "window on the widget's `filter` and compares with `compareTo: { kind: 'previousPeriod' }` "
        + "(or `'previousYear'`), and `dimension` is named wherever the selection dates more than one "
        + 'time dimension. `objectstack validate` passes, and each affected widget renders a '
        + '`<measure>__compare` column over the window its author intended.',
    },
    {
      id: 'data-driver-find-stream-retired',
      surface: 'contracts.IDataDriver.findStream / data.DriverInterfaceSchema.findStream',
      replacement:
        'find() with limit/offset — the paged read whose determinism IS enforced '
        + '(IDataDriver.find, data/pagination-conformance.ts)',
      reason:
        '`findStream` was a REQUIRED contract method documented as "optimized for large '
        + 'datasets to avoid memory overflow", and in two of its three implementations it '
        + 'delivered the opposite: `SqlDriver` and `InMemoryDriver` both awaited `find()` for '
        + 'the ENTIRE result set and then yielded it row by row, so the peak memory a caller '
        + 'was promised protection from was already reached before the first yield. The third '
        + '(`MongoDBDriver._findStream`) did walk a cursor, but it was the one read path in '
        + 'that driver never routed through `buildFindOptions`, so it hardcoded '
        + '`projection: { _id: 0 }` and silently discarded `query.fields`. None of it was ever '
        + 'observed, because the method had NO caller in either repository: the engine exposes '
        + 'no stream entry, and the REST export, import and bulk-read paths all go through '
        + '`find()`. The ~20 driver test doubles that existed only to satisfy a required '
        + 'method almost all threw `not implemented`, and nothing ever noticed — which is the '
        + 'proof, not the anecdote. Being REQUIRED, it also taxed every new driver and every '
        + 'test double with an implementation of a capability the platform does not have. '
        + 'Rather than build a caller to justify three implementations, the method is retired; '
        + 'a real cursor-based read should return WITH the caller that needs it (ADR-0049 '
        + 'enforce-or-remove). This is a TS/API contract surface — a driver is CODE, never '
        + 'stack metadata — so there is no source for the chain to rewrite, and deliberately '
        + 'no schema tombstone either: nothing ever ran a driver object through '
        + '`DriverInterfaceSchema.parse()`, so a prescription there would have no one to '
        + 'reach. The enforced channel is tsc, and it points at callers. ADR-0049 / '
        + 'ADR-0078, #4484.',
      acceptanceCriteria:
        'No code calls `driver.findStream(...)`; large reads page through `find()` with '
        + '`limit`/`offset` (which guarantees a total order across the whole walk) or go '
        + 'through the export surface. Drivers and test doubles no longer implement the '
        + 'method — one left behind still compiles and is simply never reached, so removing '
        + 'it is cleanup rather than a break, while a CALLER of it no longer type-checks.',
    },
    {
      id: 'data-driver-query-omit-object',
      surface:
        'contracts.IDataDriver query parameter — find / findOne / count / updateMany / '
        + 'deleteMany / explain',
      replacement:
        '`DriverQuery` (`Omit<QueryAST, "object">`): delete the redundant `object:` key from the '
        + 'query literal at the call site — the object name is already the FIRST argument',
      reason:
        'Every one of these methods takes the object name as its first argument, and then '
        + 'required a `QueryAST` that lists `object` as mandatory — the same fact demanded twice, '
        + 'with two places for it to disagree. The layers above had already paid for that '
        + 'ambiguity: the objectql engine deliberately writes its key order as `{ ...query, '
        + 'object }` so a smuggled `query.object` cannot override the resolved name, and the wire '
        + 'layer spends a named 400 (`QUERY_OBJECT_MISMATCH`) refusing the inconsistency. The '
        + 'driver side paid in blanket casts: a direct caller holding only a `where` could not '
        + 'name the type, wrote `as any`, and switched off checking for `where` / `orderBy` / '
        + '`fields` along with it — 20 such sites measured in cloud#1053, and cloud#1030\'s '
        + '`$like` reached runtime through exactly that hole. This is a TS contract surface with '
        + 'no authored source for the chain to rewrite, which is why it is a semantic entry and '
        + 'not a D2 conversion; for a typed caller the compiler names every site (TS2353 '
        + '`\'object\' does not exist in type \'DriverQuery\'`), and for an untyped JS caller '
        + 'there is no constrained channel at all, which is exactly why this ledger entry must '
        + 'exist. Neither side is forced to move: a caller holding a `QueryAST` VALUE passes it '
        + 'unchanged (excess properties are only rejected on fresh literals), and an '
        + 'implementation still declaring `query: QueryAST` keeps compiling under parameter '
        + 'bivariance. What an implementation may no longer do is READ `query.object` — callers '
        + 'are now entitled to omit it. Registered by the #6350 stock reconciliation. #5181 was '
        + 'the audit\'s CONTROL sample, drawn to show that not every flagged candidate is an '
        + 'omission, and it was one: the seven `IDataDriver` hits in the ledger are all prose '
        + 'inside other entries, and the only subject-level hit on this interface is '
        + '`data-driver-find-stream-retired` — a DIFFERENT member. Two later, smaller driver '
        + 'call-parameter changes (#6321, #6083) both registered, and both cite #5181 as '
        + 'background; the larger sibling they derive from never got its own entry. ADR-0087, '
        + '#5181 (backfilled #6350).',
      acceptanceCriteria:
        'No `IDataDriver` call site passes an inline literal carrying `object:` — `driver.find('
        + '"account", { object: "account", where: … })` becomes `driver.find("account", { where: '
        + '… })`. `tsc` is the verify loop for typed callers and reports every remaining site by '
        + 'name; an untyped JS caller must be swept by hand, because nothing will report it. Any '
        + 'driver IMPLEMENTATION that read `query.object` is rewritten to use the object-name '
        + 'argument instead — that read now yields `undefined` whenever a caller exercises its '
        + 'new right to omit the key, and it fails at runtime rather than at compile time, so it '
        + 'is the one change on this surface a type check cannot find for you.',
    },
    {
      id: 'data-engine-batch-retired',
      surface: 'contracts.IDataEngine.batch / data.DataEngineBatchRequestSchema',
      replacement:
        '`IObjectQLEngine.transaction(cb)` for in-process multi-write atomicity; the metadata '
        + "protocol's `batchData` with `options.atomic: true` for a batch over one object; "
        + '`POST {basePath}/batch` on the wire',
      reason:
        '`batch?` was declared on `IDataEngine` for as long as that contract existed and was '
        + 'never implemented by any engine: `ObjectQL` has no `batch` method and there is no '
        + 'other engine in the tree. It also had no caller — `DataEngineRequest` was imported '
        + 'by exactly one file, the contract declaring the member. Its entire specification '
        + 'was a three-word doc comment ("Batch Operations (Transactional)"), which settles '
        + 'nothing about partial failure, ordering, cross-object references, rollback scope, '
        + 'or what `transaction: false` was supposed to mean — the questions a batch API '
        + 'exists to answer. Contrast its neighbours `getDefaultDriverName?` / '
        + '`getDriverByName?`, whose optionality is evidenced: each names its implementer and '
        + 'its probing caller. The tell that nobody ever designed against it is in the schema: '
        + '`DataEngineBatchRequestSchema.requests` nested the request union RECURSIVELY, so a '
        + 'batch could contain batches, with no statement anywhere about what that meant for '
        + 'ordering or rollback. The only test was a type pin — an ad-hoc object literal '
        + 'carrying a `batch` property, asserting the property was defined — which could not '
        + "fail while the declaration existed and would have passed unchanged for the "
        + "member's whole life with no engine implementing it. What it claimed is now covered "
        + 'by members that are real, so the removal deletes a false affordance rather than a '
        + 'capability: ADR-0119 D1 made `transaction` reachable through the contract and D4 '
        + "made `batchData`'s `atomic` honest, while the wire batch has always validated with "
        + '`CrossObjectBatchRequestSchema` / `BatchUpdateRequestSchema` from '
        + '`api/batch.zod.ts` — a different schema entirely, untouched here. TS/API surfaces '
        + 'only: an engine is CODE, never stack metadata, so there is no source for the chain '
        + 'to rewrite. Deliberately no schema tombstone either — nothing ever parsed '
        + '`DataEngineBatchRequestSchema`, so a `retiredKey()` prescription would have no one '
        + 'to reach; its three `authorable-surface.json` baseline lines and its '
        + '`json-schema.manifest.json` entry are dropped in the same change, deliberately. '
        + 'The enforced channel is tsc. ADR-0049 / ADR-0078, #4618.',
      acceptanceCriteria:
        'No code calls `engine.batch(...)` and no type references `DataEngineBatchRequest`; '
        + 'in-process multi-write atomicity goes through `IObjectQLEngine.transaction(cb)`, a '
        + 'batch over one object through `batchData` with `options.atomic: true`, and a '
        + 'cross-object batch over the wire through `POST {basePath}/batch`. Because no engine '
        + 'implemented the member, an implementation left behind still compiles and is simply '
        + 'never reached; a CALLER of it no longer type-checks — and there were none.',
    },
    {
      id: 'data-field-changed-event-retired',
      surface: "api.DataEventType 'data.field.changed'",
      replacement:
        "the `data.record.updated` event, whose payload already carries the per-field "
        + 'detail: `changes` (the changed fields), plus `before` / `after`',
      reason:
        '`data.field.changed` was declared in `DataEventType` and emitted by nothing — the '
        + 'engine\'s `publishDataEvent` sends `data.record.{created,updated,deleted}` and (since '
        + '#4639) `data.records.{updated,deleted}`, and no other producer exists in either '
        + 'repository. A subscriber that switched on it was waiting on an event no producer '
        + 'sends: the branch never ran, and because the surrounding `switch` still compiled, '
        + 'nothing anywhere reported the gap (ADR-0078\'s silently-inert declaration, on the '
        + 'event vocabulary). `DataEventSchema` could not have carried the semantics even if '
        + 'something had emitted it — the payload is record-shaped (`recordId`, `changes`, '
        + '`before`, `after`) with no `field` / `oldValue` / `newValue` slot — so the member '
        + 'promised a granularity the contract has no room for. Per-field detail is therefore '
        + 'not lost: it has always ridden on `data.record.updated` as `changes`, which is one '
        + 'event per write rather than N events on a wide table. This is a runtime EVENT '
        + 'surface — no stack, example or template authors an event name (webhooks subscribe '
        + 'through the separate authorable `WebhookTriggerType`, whose vocabulary was already '
        + 'trimmed to producers that exist, #3196) — so there is no source for the chain to '
        + 'rewrite, and deliberately no schema tombstone: a removed ENUM MEMBER cannot carry a '
        + 'retiredKey() fix-it error the way an authorable object key can (the same limit the '
        + 'sharing-rule `full` retirement `owd-full-alias-removed` hit). The enforced channels are tsc, '
        + 'which '
        + 'fails any consumer still naming the value in a `DataEventType` position, and the '
        + 'enum parse, which now rejects the name instead of accepting an event that never '
        + 'arrives. A genuine per-field stream, if one is ever wanted, gets its own honest '
        + 'contract the way #4639 gave bulk writes theirs. ADR-0049 / ADR-0078, #4673.',
      acceptanceCriteria:
        'No consumer subscribes to or switches on `data.field.changed`; per-field change '
        + 'detail is read from a `data.record.updated` event\'s `changes` map (with `before` / '
        + '`after` for the surrounding state). Deleting the dead branch changes no observable '
        + 'behaviour — it never executed — so the migration is removing code that could not '
        + 'run, not rebuilding a capability.',
    },
    {
      id: 'declarative-apis-endpoints-live',
      surface: 'stack.apis[] (every declared ApiEndpoint — REVIEW REQUIRED BEFORE UPGRADING)',
      replacement:
        'the same declarations, re-read as LIVE HTTP routes: `path` moved under '
        + '`/api/v1/apps/<manifest.namespace>/<subpath>`, and every entry that declares '
        + '`authRequired: false` re-confirmed as an intentionally anonymous endpoint carrying '
        + '`rateLimit: { enabled: true, … }`',
      reason:
        'This is the one protocol-17 entry that turns metadata ON rather than off, so read it '
        + 'as a SECURITY review item and not as a rename. Before 17 the declarative endpoint '
        + 'surface executed NOTHING: no route was mounted for a declared `path`, no matcher '
        + 'existed, and every key — `authRequired` included — parsed green and gated nothing '
        + '(#4936, which refused a non-empty `apis:` outright for exactly that reason). '
        + 'Protocol 17 ships the executor (#5040) and narrows that refusal to a per-endpoint '
        + 'publish gate: an endpoint that PASSES the gate is mounted and serves real traffic as '
        + 'soon as the stack is published. So an `apis:` block written against an older major — '
        + 'or one restored from a pre-#4936 source, or authored from a doc that predates the '
        + 'refusal — changes meaning without changing a byte: what used to be inert '
        + 'documentation becomes an execution entry point into the data and automation '
        + 'pipelines. Nothing about that transition can be applied mechanically, because the '
        + 'judgment it needs is "did the author of this endpoint mean for the internet to reach '
        + 'it?" — and the one key where a wrong answer is unrecoverable is `authRequired`. Its '
        + 'schema default is `true`, so an omission is SAFE and needs no review; an EXPLICIT '
        + '`authRequired: false` is the only thing that opens anonymous access, and under '
        + 'ADR-0121 D6 it now also requires an armed `rateLimit` (`enabled: true` — the key '
        + 'defaults to `false`, so a budget written without it meters nothing) or the stack '
        + 'refuses to publish. ⚠️ If you author endpoints in TypeScript, annotate them with '
        + '`ApiEndpoint` — the AUTHOR state — so that omitting `authRequired` compiles: '
        + '`const e: ApiEndpoint = { name, path, method, type, target }` is legal and is the '
        + 'safe shape this paragraph prescribes. `ApiEndpointParsed` is the POST-parse type '
        + '(defaults materialized, ADR-0122), where `authRequired` is required — annotating a '
        + 'declaration with it forces you to write the key out, and being made to think about a '
        + 'key whose only unrecoverable value is `false` is the one thing this entry is trying '
        + 'to avoid (#5227). Hold a parse RESULT with `ApiEndpointParsed`; write declarations '
        + 'as `ApiEndpoint`. Grep every `apis:` entry for `authRequired: false` before you '
        + 'upgrade, delete the ones that were never meant to be public, and arm a budget on the '
        + 'ones that were. The path move is the mechanical-looking half and is still yours: '
        + 'ADR-0121 D1/D2 confine a declared path to your own namespace carve-out '
        + '(`/api/v1/apps/<namespace>/…`), the namespace comes from an explicit '
        + '`manifest.namespace` with no derivation fallback, and the subpath is the only part '
        + 'you name — rewriting it for you would silently change a URL third parties call.',
      acceptanceCriteria:
        'You have READ every entry of every `apis:` block, not just the ones that fail to '
        + 'publish. Concretely: (1) each declared `path` is '
        + '`/api/v1/apps/<your manifest.namespace>/<subpath>` and the stack declares that '
        + '`manifest.namespace` explicitly; (2) every entry declaring `authRequired: false` is '
        + 'one you INTEND to be reachable without a session, and each carries '
        + '`rateLimit: { enabled: true, windowMs, maxRequests }` — entries that were not '
        + 'intended to be anonymous have the key removed so the safe default (`true`) applies; '
        + '(3) `objectstack validate` passes, which also proves no endpoint declares a shape '
        + '17.x cannot execute (`type: script` / `proxy`, mapping `transform`, an '
        + '`object_operation` missing `objectParams`, `cacheTtl` on a non-GET method, '
        + '`inputMapping` on find/get/delete, or two endpoints claiming one METHOD + path); and '
        + '(4) after publishing, each endpoint answers as you expect — an anonymous request to '
        + 'a session-only endpoint returns 401 rather than data.',
    },
    {
      id: 'delete-by-id-before-hook-repoint-retired',
      surface:
        'a `beforeDelete` handler on a BY-ID `delete()` assigning `ctx.input.id` a DIFFERENT id, '
        + 'to move the delete onto that row',
      replacement:
        'delete the other row explicitly — `ctx.ql.delete(object, otherId)` / `ctx.api` — and let '
        + 'the addressed delete proceed or `throw` from the handler to stop it; to delete MANY rows, '
        + "have the CALLER pass `{ multi: true, where: … }`. Writing the SAME id back is unaffected "
        + 'and stays legal.',
      reason:
        'The by-id target of an `update()` or `delete()` is now IMMUTABLE inside a `before*` '
        + 'handler, on both verbs, cleared or rebound. `delete()` was the last cell of that table '
        + 'still answering differently: it HONOURED a repoint, re-resolving the new target by '
        + "re-reading its pre-image and rebinding `previous` (#5272), so `afterDelete` and the "
        + 'roll-up recompute saw the row actually deleted. It now refuses with '
        + '`HookTargetRebindError` / `ERR_HOOK_TARGET_REBIND`, `path: \'by-id\'`, exactly as the '
        + '`update()` twin and both per-row paths (ADR-0058 Amendment II.1 / D4) already did.\n\n'
        + 'Read this as a RULING, not a defect report — that distinction is the reason the entry '
        + 'is worth its length. #5272\'s re-resolution was internally CORRECT and nothing stale '
        + 'ever leaked from it; the case that retires a rebind on `update()` (the write landing on '
        + 'a row whose pre-image, `readonlyWhen` locks and validation rules were never evaluated) '
        + 'simply did not apply to it. #5574\'s engine half (PR #6697) therefore left the asymmetry '
        + 'standing on purpose rather than folding a behaviour removal into an ordering change, and '
        + 'filed it as #6752. The 2026-08-09 maintainer ruling on that card closed it on three '
        + 'measured axes instead: compatibility cost zero (a repository-wide grep for assignments '
        + "into a hook's `input.id`, re-run on the implementing PR's base, found six sites and ALL "
        + 'SIX are this family\'s own pins — no consumer anywhere repoints); one rule across both '
        + 'verbs beats two individually-correct rules an author has to memorize, since the '
        + 'justification for the split lived in an ADR rather than at the call site; and "a hook '
        + 'silently redirects which row gets deleted" is a top-grade footgun for authored — '
        + 'especially AI-authored — handlers however correctly the redirect is implemented. '
        + 'Correctness of a mechanism does not justify the surface it exposes. Aligning the other '
        + 'way, by building `update()` the same re-resolution, stays excluded by #5574\'s own '
        + 'recorded ruling ("do not silently pick re-resolution instead").\n\n'
        + 'Why this is a D3 semantic TODO and not a D2 conversion, on the same two grounds as '
        + '`hook-register-empty-object-target-refused` and `hook-context-session-roles-retired` at '
        + 'this step: FIRST, there is no source to convert — a `HookContext` is constructed per '
        + 'write and never persisted, so no `sys_metadata` row, example or template can carry the '
        + 'assignment. SECOND, the only place it is ever SPELLED is inside a handler body: '
        + 'author-written JS/TS, or a sandboxed script whose context is `unknown`. A declarative '
        + 'transform cannot safely rewrite an assignment inside free-form code, and the intent is '
        + 'not recoverable anyway — only the author knows whether the repoint meant "delete that '
        + 'row INSTEAD" or "delete that row TOO".\n\n'
        + 'What makes this one cheaper to meet than its two siblings, and worth saying because it '
        + 'bounds the work: the removed capability has an ENFORCED channel at run time. The refusal '
        + 'throws before anything is written and its message NAMES the retired capability and the '
        + 'three replacement routes, so a handler that still repoints fails loudly and self-'
        + 'describingly on its first execution rather than going quiet. This ledger entry is the '
        + 'channel that reaches an upgrader BEFORE that first execution. #6752, #5272, #5574, '
        + 'PR #6697, ADR-0058 Amendment II.2.',
      acceptanceCriteria:
        'No `beforeDelete` handler assigns `ctx.input.id` anything but the id it arrived with — '
        + 'grep handler bodies for assignments into `input.id` and rewrite each into an explicit '
        + '`ctx.ql.delete()` for the other row, a caller-side `{ multi: true, where: … }`, or a '
        + '`throw`. A delete-heavy smoke run completes with no `HookTargetRebindError` '
        + "(`ERR_HOOK_TARGET_REBIND`, `path: 'by-id'`, `event: 'beforeDelete'`) — and any that does "
        + 'raise names its `expectedId` and `observedId`, which identifies the handler that moved '
        + 'the target.',
    },
    {
      id: 'driver-aggregate-undeclared-key-aliases-removed',
      // No backticks in `surface`: the upgrade-guide renderer wraps this string
      // in a code span of its own, and a nested pair renders as literal ticks.
      surface: "driver aggregate() call argument — query.aggregate and aggregations[].func",
      replacement:
        'query.aggregations and aggregations[].function — the spellings QueryASTSchema and '
        + 'AggregationNodeSchema have always declared',
      reason:
        '`SqlDriver.aggregate` and `RemoteTransport.aggregate` each read two aliases the '
        + 'Query Protocol has never declared: `query.aggregations || query.aggregate` and '
        + '`agg.function || agg.func`. "Never declared" is measured, not assumed — `git log '
        + '-S` over `data/query.zod.ts` finds no commit that ever introduced either name, '
        + 'there is no `retiredKey()` tombstone and no alias-table entry for them (the file\'s '
        + 'only alias table is `SortNode`\'s `direction` → `order`), and neither appears in any '
        + 'upgrade guide or release note. So this entry does not record a declared surface '
        + 'being withdrawn; it records a LENIENCY being withdrawn, which is why it is here '
        + 'rather than behind a tombstone. The only writers in this repository were the two '
        + 'driver packages\' own fixtures — #4984\'s family, where a fixture spelling the alias '
        + 'keeps the tolerant limb green forever and no test in existence can go red on its '
        + 'deletion — so ADR-0049 enforce-or-remove applies once those are re-spelt. ⚠️ Do '
        + 'NOT read this across to `dashboard`/`page` measures: `aggregate` IS the canonical '
        + 'key there and `func` IS a declared, loudly-suggesting alias (`DatasetMeasureSchema`, '
        + 'ui/dataset.zod.ts). That neighbouring vocabulary is untouched, and it is the most '
        + 'likely reason an off-repo caller ever wrote these keys on a QUERY — one habit, two '
        + 'surfaces, only one of which declared it. This is a driver CALL ARGUMENT — code, '
        + 'never stack metadata — so there is no source for the D2 chain to rewrite and '
        + 'deliberately no schema tombstone: nothing ever ran a query through '
        + '`QueryASTSchema.parse()` on this path. The enforced channel is tsc at the call '
        + 'site, once the parameter is `DriverQuery` — and for an untyped JS caller there is '
        + 'no enforced channel at all, which is exactly why this ledger entry has to exist: '
        + 'the generated upgrade guide is the only way such a reader learns of the rename. '
        + 'Same disposition, and the same reason, as `data-driver-find-stream-retired` '
        + '(#4484), `storage-service-list-retired` (#5540) and `actor-user-roles-to-positions` '
        + '(#6011). ADR-0049 / ADR-0087, #6321 (PR #6404).',
      acceptanceCriteria:
        'No caller passes `aggregate:` to a driver\'s `aggregate()`, and no aggregation entry '
        + 'spells its function `func:`; both are written `aggregations:` / `function:`. An '
        + 'inline literal still using either old spelling no longer type-checks (TS2353 at the '
        + 'call site). An untyped JS caller that keeps writing `aggregate:` silently receives '
        + 'no aggregate column — the grouping still happens, the measure is simply absent — '
        + 'and one that keeps writing `func:` receives INVALID_QUERY / 400 naming the '
        + 'undeclared function, identically on the local driver and the Turso remote '
        + 'transport.',
    },
    {
      id: 'driver-capabilities-inert-bits-removed',
      surface:
        'data.DriverCapabilities.create / data.DriverCapabilities.read / '
        + 'data.DriverCapabilities.update / data.DriverCapabilities.delete / '
        + 'data.DriverCapabilities.bulkCreate / data.DriverCapabilities.bulkUpdate / '
        + 'data.DriverCapabilities.bulkDelete / data.DriverCapabilities.transactions / '
        + 'data.DriverCapabilities.savepoints / data.DriverCapabilities.isolationLevels / '
        + 'data.DriverCapabilities.queryFilters / data.DriverCapabilities.queryAggregations / '
        + 'data.DriverCapabilities.querySorting / data.DriverCapabilities.queryPagination / '
        + 'data.DriverCapabilities.queryWindowFunctions / data.DriverCapabilities.querySubqueries / '
        + 'data.DriverCapabilities.queryCTE / data.DriverCapabilities.joins / '
        + 'data.DriverCapabilities.fullTextSearch / data.DriverCapabilities.jsonQuery / '
        + 'data.DriverCapabilities.geospatialQuery / data.DriverCapabilities.streaming / '
        + 'data.DriverCapabilities.jsonFields / data.DriverCapabilities.arrayFields / '
        + 'data.DriverCapabilities.vectorSearch / data.DriverCapabilities.schemaSync / '
        + 'data.DriverCapabilities.migrations / data.DriverCapabilities.indexes / '
        + 'data.DriverCapabilities.connectionPooling / data.DriverCapabilities.preparedStatements / '
        + 'data.DriverCapabilities.queryCache',
      replacement:
        '(removed — delete the keys. A driver advertises a capability by implementing the '
        + 'corresponding IDataDriver method; the three bits that survive because method '
        + 'presence cannot carry the signal are `queryDateGranularity`, `autonumber` and '
        + '`batchSchemaSync`)',
      reason:
        'The #4484 findStream close-out found `DriverCapabilities.streaming` pointing at a '
        + 'capability the contract no longer declares, and the follow-up audit (#4634) checked '
        + 'every bit in the record the same way, across objectstack and cloud (objectui '
        + 'confirmed clean): of 34 declared bits, THREE have a decision-making reader — '
        + '`queryDateGranularity` (engine aggregate dispatch + checkDateBucketParity), '
        + '`autonumber` (engine defers generation to the driver), `batchSchemaSync` (engine '
        + 'ANDs it with method presence, because a subclass can inherit `syncSchemasBatch` '
        + 'from a base whose transport batches while its own cannot) — and THIRTY-ONE were '
        + 'written by every driver and read by nothing. Their `.describe()` strings promised '
        + 'engine adaptation ("if false, ObjectQL will filter/sort/paginate in memory") that '
        + 'was never built, and zero readers let the values go WRONG unnoticed: SqlDriver '
        + 'declared `streaming: false` while implementing `findStream`; InMemoryDriver '
        + 'declared `streaming: true` over a full-table read (ADR-0078 false affordance, on '
        + 'the capability record itself). The real mechanism everywhere else is METHOD '
        + 'presence: transactions gate on `driver.beginTransaction`, aggregate pushdown on '
        + '`typeof driver.aggregate`, schema sync on `typeof driver.syncSchema`, and the '
        + 'REQUIRED CRUD/bulk methods are called unconditionally. A driver is CODE, never '
        + 'stack metadata — `supports` literals live in driver classes and '
        + '`DriverConfig.capabilities` is plugin TS configuration, neither ever a '
        + '`sys_metadata` shape (the stack-tree neighbour, `datasource.capabilities`, was '
        + 'retired separately in #4583) — so there is no source for the D2 chain to rewrite '
        + 'and this entry is the D3 record. The keys are tombstoned rather than deleted '
        + 'because `DriverCapabilitiesSchema` is not `.strict()` and IS parsed '
        + '(DriverConfigSchema / SQLDriverConfigSchema / NoSQLDriverConfigSchema embed it): '
        + 'a plain delete would silently strip a vendor\'s authored bit, replacing one '
        + 'silent no-op with another. `batchSchemaSync` also drops its `.default(false)` '
        + 'for `.optional()` — absence already meant false at both readers, and the default '
        + 'forced every capability object to spell out 30+ bits. ADR-0049 / ADR-0078, #4634.',
      acceptanceCriteria:
        'No `supports` literal or `DriverConfig.capabilities` object authors any of the 31 '
        + 'retired bits — a driver class that still writes one fails tsc against '
        + '`IDataDriver.supports` (the bit is `never`), and a parsed config fails with the '
        + 'per-key prescription. The three in-repo drivers (memory / mongodb / sql) declare '
        + 'only live bits; cloud\'s TursoDriver keeps compiling via its `...super.supports` '
        + 'spread (its stale explicit overrides are cleanup, tracked cloud-side). Engine '
        + 'behaviour is byte-identical: every removed bit had zero readers, and the three '
        + 'live bits keep their readers (engine.ts autonumber defer / aggregate dispatch, '
        + 'plugin.ts + engine.ts batched schema sync, verify date-bucket parity).',
    },
    {
      id: 'driver-sql-distinct-bare-filter-typed',
      // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
      // code span already, and a nested backtick would close it.
      surface: 'SqlDriver.distinct() third argument — any value',
      replacement:
        'a bare FilterCondition (@objectstack/spec/data) — the same value find() carries '
        + 'under query.where, never a query envelope',
      reason:
        'This entry records a TYPE being added, not a surface being withdrawn, and it says '
        + 'so up front because the distinction decides who has to do anything. `distinct` is '
        + 'not declared on `IDataDriver`, so #5181 / #6075 never reached it and it kept '
        + '`filters?: any` while its body said something far more specific — '
        + '`applyFilters(builder, filters)` is handed the ARGUMENT ITSELF, never a `.where` '
        + 'off it. ⚠️ RUNTIME BEHAVIOUR IS UNCHANGED by this entry\'s change: not one '
        + 'statement moved, so no upgrade breaks at run time and nothing that answered '
        + 'correctly stops. What the annotation removes is a compile-time hole, measured '
        + 'rather than assumed: a truthy NON-OBJECT third argument — '
        + '`distinct(\'orders\', \'product\', \'completed\')` — used to type-check and resolve '
        + 'the UNFILTERED set, because `applyFilters` emits no predicate at all for a truthy '
        + 'non-object, non-array filter. A call meaning "which products among completed '
        + 'orders" answered with EVERY product, silently. That spelling is now TS2345 at the '
        + 'call site. This is a driver CALL ARGUMENT — code, never stack metadata — so there '
        + 'is no source for the D2 chain to rewrite and deliberately no schema tombstone, the '
        + 'disposition `data-driver-find-stream-retired` (#4484), `storage-service-list-retired` '
        + '(#5540), `actor-user-roles-to-positions` (#6011) and '
        + '`driver-aggregate-undeclared-key-aliases-removed` (#6321) already carry. ⚠️ It '
        + 'differs from those four in ONE measured way a reader should not have to infer: '
        + 'because nothing changed at run time, an untyped JS caller is not affected BY THE '
        + 'UPGRADE at all. The entry is here for a different reason — such a caller is exactly '
        + 'the one tsc can never reach, and the silent widening above is a defect they may '
        + 'ALREADY be sitting on, before and after this major. The generated upgrade guide is '
        + 'the only channel that reaches them, which is why the fix is written down rather '
        + 'than left to the compiler. ⛔ The reverse mismatch is NOT closed and no type can '
        + 'close it: `FilterCondition` is an open map (`[key: string]: any`) because a filter '
        + 'key IS a field name, so a query envelope `{ object, where }` is structurally a '
        + 'valid filter — one constraining columns named `object` and `where` — and so is a '
        + 'FilterArray. Both reach `distinct` type-checked and are refused at run time, '
        + 'loudly, with INVALID_FILTER / 400. `driver-memory`\'s opposite half — where the '
        + 'BARE spelling returns the unfiltered set in silence — stays open under the #5499 '
        + 'freeze (#6320). ADR-0087, #6320.',
      acceptanceCriteria:
        'No caller passes a non-object to `distinct()`\'s third argument. A scalar there is '
        + 'now a compile error (`TS2345: Argument of type \'string\' is not assignable to '
        + 'parameter of type \'FilterCondition\'`); rewrite it as the bare filter it was '
        + 'always meant to be — `\'completed\'` becomes `{ status: \'completed\' }`. ⚠️ That '
        + 'is NOT an equivalent rewrite: the old spelling returned the UNFILTERED set, so the '
        + 'answer changes once fixed, and the changed answer is the one the call always meant. '
        + 'An untyped JS caller gets no compile error and no behaviour change — for them this '
        + 'entry is the only notice that the spelling never filtered anything. A query '
        + 'envelope or a FilterArray in that slot still compiles and is rejected at run time '
        + 'with INVALID_FILTER / 400.',
    },
    {
      id: 'engine-find-formula-order-by-refused',
      surface:
        'engine.find(object, { orderBy }) and engine.findOne(object, { orderBy }) naming a '
        + '`formula` field — the direct engine path, not the REST ingress',
      replacement:
        'denormalise the value onto the object (a stored field, written when the source '
        + 'changes) and sort by that — the same remedy the REST ingress has prescribed since '
        + '#6924 / #6994; a `summary` field is unaffected and still sorts, because it gets a '
        + 'real maintained column',
      reason:
        '#4226 / #4256 / #6994 closed the SORT axis at the REST ingress '
        + '(`assertSortFieldsExist`, `400 INVALID_SORT`), which covers everything reaching '
        + '`findData`: the list route, `POST /data/:object/query`, the export route and the '
        + 'RPC dispatcher. A caller reaching `engine.find()` / `engine.findOne()` DIRECTLY '
        + 'passed through none of it, and a `formula` ORDER BY there was dropped in silence. '
        + 'Measured on a real driver: `asc` and `desc` came back BYTE-IDENTICAL, in insertion '
        + 'order, under a success, with the rows carrying the very values they were asked to '
        + 'be ordered by. No column exists to order by (a formula is computed on read, so no '
        + 'driver materialises one), so the ORDER BY reached the driver, found nothing, and '
        + 'the unknown-column backstop returned the rows unordered.\n\n'
        + 'Ruled 2026-08-10 on #7095: an ORDER BY the engine cannot apply is a 4xx with '
        + 'guidance prose at the public boundary, never a silent drop — the same direction as '
        + 'the analytics dataset refusal envelope and the #6924 sort-hint prescription. The '
        + "engine's documented internal-caller tolerance (`assertProjectionFieldsExist`'s "
        + 'docblock) was to survive only behind a pinned internal path, and only if a MEASURED '
        + 'internal call site relied on it. The #7095 sweep of every in-tree `orderBy` reaching '
        + 'the engine directly — hooks, flows, reports, queue/job adapters, sharing, metadata '
        + 'loaders, expand sub-reads — found NONE: every hardcoded internal sort names a real '
        + 'stored column (`created_at`, `updated_at`, `version`, `priority`, `scheduled_for`, '
        + '`started_at`, `next_run_at`, `recorded_at`, `id`), and no shipped object in the repo '
        + 'declares a `formula` field at all. So no internal path shipped, and there is no flag '
        + 'to opt back into the drop.\n\n'
        + 'This is a CODE-path API, not stored metadata, so — like '
        + '`hook-register-empty-object-target-refused` at this step — there is no `sys_metadata` '
        + 'row for the D2 chain to rewrite and the ledger entry is the notification channel. '
        + 'No mechanical rewrite exists in either direction: the platform cannot invent the '
        + 'stored column the remedy prescribes, and it must not sort post-hoc instead — '
        + '`driver.find` has already applied `limit` / `offset`, so re-sorting after the '
        + 'formulas are evaluated would reorder an ARBITRARY PAGE, which looks correct on small '
        + 'result sets and is wrong the moment pagination is involved.\n\n'
        + 'ONE AUTHOR-REACHABLE SURFACE reaches this indirectly and is why it is not purely a '
        + "code-side note: a saved report's `query.orderBy` (`sys_saved_report`) is forwarded "
        + 'verbatim into `engine.find` by `plugin-reports`, bypassing the ingress gate. A '
        + 'report authored to sort by a formula field used to run and return rows in an '
        + 'arbitrary order; it now fails loudly, with the remedy in the message. One further '
        + 'path is deliberately NOT a refusal: a nested `expand` sort raises this refusal '
        + 'inside `expandRelatedRecords`, whose pre-existing graceful-degradation `catch` '
        + 'swallows every expand failure and retains the raw foreign keys — so that path moves '
        + 'from silent to OBSERVABLE (a warning naming the field and the fix) rather than '
        + 'refusing. Reversing that backstop is a separate decision on all expand failure '
        + 'modes. #7095, #6994, #6924, #4226, #4256, #3821, ADR-0112.',
      acceptanceCriteria:
        'No `engine.find` / `engine.findOne` call site sorts by a `formula` field, and no saved '
        + "report's `query.orderBy` names one — grep your report definitions for an `orderBy` "
        + 'field whose object declares it as a `formula`, and denormalise it onto a stored '
        + 'column written when the source changes. A `summary` / rollup field needs no action: '
        + 'it has a real maintained column and sorts correctly. Reads complete with no '
        + '`INVALID_SORT` naming a formula field, and no "Failed to expand relationship field" '
        + 'warning whose error text names one.',
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
      id: 'etl-pipeline-layer-retired',
      surface:
        'automation.etlPipeline / automation.etlPipelineRun / automation.etlSource / '
        + 'automation.etlDestination / automation.etlTransformation (the whole L2 layer of '
        + 'automation/etl.zod.ts, its four enums and the `ETL` factory — 9 defs, 27 exported '
        + 'names)',
      replacement:
        '(removed — no protocol surface replaces it, deliberately. Layer by layer: '
        + 'connector-attached synchronisation is `ConnectorSchema.syncConfig` '
        + '(`integration/connector.zod.ts`), which IS parsed and executed; per-field value '
        + 'transformation on import is `shared/mapping.zod.ts`, whose `transform` is applied '
        + 'row by row by the REST import path and recorded key by key in '
        + '`packages/spec/liveness/mapping.json`; scheduling is `system/job.zod.ts`. What has '
        + 'NO replacement is multi-source, multi-stage movement with joins and aggregations — '
        + 'because it never had an implementation either. It returns through the ENFORCE route: '
        + 'the engine first, the vocabulary second)',
      reason:
        'The reading #4738 used to retire L1 `DataSyncConfig`, re-measured one layer up and '
        + 'identical: narrative-only. No engine ever parsed, scheduled or executed an '
        + '`ETLPipeline`. Measured on origin/main immediately before the removal: the only '
        + 'non-spec references in this repo are two fumadocs-generated documentation sources '
        + '(`apps/docs/.source/*.ts`), not executors; objectui has no reference at all; there '
        + 'is no `liveness/etl.json` or `pipeline.json`, so no ADR-0049 gate ever had a reading '
        + 'on it — while the same file family\'s EXECUTED half does have one '
        + '(`liveness/mapping.json`), which is the contrast that makes the absence meaningful '
        + 'rather than an oversight. The `etl` string in this registry was the one untested '
        + 'link the finding named, and it is not a loader path: it was the id of the #4962 '
        + 'retry-vocabulary entry, absorbed here. '
        + 'The layer was ADR-0078\'s asymmetry in its purest form — an author could write a '
        + 'complete ten-stage pipeline, get no error, and get no execution. It was also '
        + 'advertised: `packages/spec/docs/SYNC_ARCHITECTURE.md` named `ETLPipeline` as the '
        + 'recommended destination for authors displaced by the L1 retirement (#4738) and '
        + 'listed ten transformation types with copyable examples down to '
        + '`script | Custom JavaScript/Python`. That document is rewritten in the same change; '
        + 'a retirement whose own doc still recommends the retired layer is self-contradictory, '
        + 'and forwarding L1\'s authors to a second layer with no executor was the defect '
        + 'compounding rather than closing. '
        + '⚠️ `etl-retry-converged-onto-retry-policy` (#4962) is SUBSUMED here, the '
        + '#4657/#4834/#5055 way: both land in the unreleased protocol 17, so composed, a '
        + 'rename of `retry.maxAttempts` on a shape that does not survive the major has no '
        + 'observable effect — and keeping both would tell an upgrader to rewrite a key on a '
        + 'schema the same upgrade deletes. The `maxAttempts` `retiredKey()` tombstone goes '
        + 'with the shape that carried it, which is strictly stronger than the tombstone: there '
        + 'is no longer a `retry` block to author the key into. Route 3 — no carrier key, no '
        + 'parse site, so no D2 conversion and no tombstone; RETIRED_DEFS_BY_MAJOR plus this '
        + 'entry are the declaration. ADR-0049, ADR-0078, #6414.',
      acceptanceCriteria:
        'No source imports `ETLPipeline`, `ETLPipelineParsed`, `ETLPipelineSchema`, '
        + '`ETLPipelineRun(Schema)`, `ETLSource(Schema)`, `ETLDestination(Schema)`, '
        + '`ETLTransformation(Schema)`, `ETLEndpointType(Schema)`, '
        + '`ETLTransformationType(Schema)`, `ETLSyncMode(Schema)`, `ETLRunStatus(Schema)` or '
        + 'the `ETL` factory from `@objectstack/spec/automation`; `tsc` reports TS2724/TS2305 '
        + 'on any that survives. Every author who was pointed at L2 has been re-pointed by '
        + 'name: SYNC_ARCHITECTURE.md no longer lists an L2 row, no longer recommends '
        + '`ETLPipeline` as L1\'s destination and no longer advertises a transformation-type '
        + 'table. The surviving layers still parse unchanged — a connector declaring '
        + '`syncConfig` and an import declaring `mapping.transform` both behave exactly as they '
        + 'did in 16.x.',
    },
    {
      id: 'export-axis-opt-in',
      surface:
        'security.permissionSet.objects[].allowExport (ABSENT — a permission set that never '
        + 'declared the key)',
      replacement:
        'an explicit `allowExport: true` on the object entry (or the `*` wildcard) of every '
        + 'permission set whose holders are meant to keep exporting',
      reason:
        'A secure-default FLIP, not a shape change — the same class as '
        + '`rest-requireauth-default-flip` (ADR-0056 D2, protocol 12) and '
        + '`action-descriptor-resume-authority-default-flip`, and it is registered for the same '
        + 'reason those are: the metadata is UNCHANGED and still parses, so no gate anywhere will '
        + 'tell an upgrader that what it MEANS has inverted. Before 17, `allowExport` unset '
        + 'inherited read; from 17 it denies. Reading a record and taking a bulk '
        + 'machine-readable copy of the whole table are different privileges — Salesforce '
        + '"Export Reports", Dynamics "Export to Excel", NetSuite "Export Lists" and SAP `S_GUI` '
        + '61 all separate them — and the axis now says so. This cannot be a mechanical '
        + 'conversion in either direction: writing `allowExport: true` wherever the key is absent '
        + 'would preserve today\'s behaviour while silently defeating the entire point of the '
        + 'flip, and writing `false` would revoke a capability the deployment may legitimately '
        + 'want. Whether a given set\'s holders SHOULD be able to take a bulk copy is exactly the '
        + 'segregation-of-duties judgement the axis exists to make explicit, and it belongs to '
        + 'the operator. Two details decide who is actually affected: package-shipped sets are '
        + 're-seeded on upgrade, so the built-ins are handled — `admin_full_access` and '
        + '`organization_admin` now carry the grant explicitly — while ENVIRONMENT-AUTHORED sets '
        + 'are not and must be edited by hand. `member_default` deliberately does NOT carry the '
        + 'grant, so ordinary authenticated users lose export until an admin grants it; that is '
        + 'the point of the flip, not an oversight. Merge semantics are unchanged and '
        + 'most-permissive, exactly like the CRUD bits: any set granting `true` grants export, '
        + 'and `false` is authoring intent rather than a veto, because permission sets are '
        + 'additive capability containers (ADR-0090). The super-user bits no longer confer it: '
        + '`viewAllRecords` / `modifyAllRecords` are "may see all data", not "may take a bulk '
        + 'copy". Registered by the #6350 stock reconciliation; #3544 / #3710 predate the #6148 '
        + 'completeness gate. ADR-0087, #3544 / #3710 (backfilled #6350).',
      acceptanceCriteria:
        'Every environment-authored permission set has been READ and decided, not just parsed: '
        + 'each object entry whose holders should keep exporting carries `allowExport: true`, and '
        + 'each one that should not is knowingly left without it. The verify loop is behavioural, '
        + 'because nothing fails at parse time — sign in as a holder of each affected set and '
        + 'confirm an export either succeeds or is refused as intended, including the report '
        + 'export path, which this change brought under the same axis. ⚠️ Silence is not success '
        + 'here: a deployment that upgrades without editing anything is VALID metadata whose '
        + 'ordinary users have quietly lost export, and the first sign will be a user report '
        + 'rather than an error. Check `member_default` explicitly — it is the set most likely to '
        + 'have been carrying export by inheritance.',
    },
    {
      id: 'export-field-meta-constraints-retired',
      surface:
        '@objectstack/rest: ExportFieldMeta.required / .system / .readonly / .hasDefault / '
        + '.min / .max / .minLength / .maxLength (the map built by `buildFieldMetaMap`, '
        + 'reached as `PreparedImport.metaMap` from `prepareImportRequest`)',
      replacement:
        'the object schema you already hold — read `fields[name].required` / `.system` / '
        + '`.readonly` / `.defaultValue` / `.min` / `.max` / `.minLength` / `.maxLength` off '
        + 'the same `ObjectSchema` you passed to `buildFieldMetaMap`, which is where the '
        + 'ENGINE reads them and therefore the only copy that cannot drift',
      reason:
        'ADR-0049 enforce-or-remove. These eight were never a source of truth: '
        + '`buildFieldMetaMap(schema)` DERIVED each one from the very `schema` its caller '
        + 'passed in, so the map carried a second copy of facts the caller already held. '
        + "They existed for exactly one consumer — the import dry run's hand-copied "
        + 'pre-check mirror (`firstMissingRequiredField` / `firstConstraintViolation`, '
        + 'framework#3956) — and #4633 ruling D retired that mirror (PR #6532): the dry run '
        + "now asks `DataProtocol.validateData` for the engine's verdict, which reads the "
        + "object's own schema. That left all eight computed on every import and read by "
        + 'NOTHING, which is the declared-and-unread shape ADR-0049 exists for; a constraint '
        + 'vocabulary standing next to the presentation one with no enforcer behind it is '
        + 'precisely the thing an AI-authored consumer mistakes for a contract. Verified '
        + 'zero-reader before removal, per key and by type, across this repo (`packages/rest` '
        + 'itself, and all five in-repo dependents of `@objectstack/rest`: runtime, cli, '
        + "verify, plugin-auth, plugin-dev) and the `objectui` sibling; plugin-auth's "
        + 'identity import forwards `prepared.metaMap` into `runImport` but reads only the '
        + 'presentation keys through `coerceRow`. '
        + 'Why this needs a ledger entry despite that sweep: it is the `findStream` (#4484) / '
        + '`IStorageService.list` (#5540) / `actor-user-roles-to-positions` (#6011) '
        + 'disposition — a published TS surface with NO spec schema, so there is no '
        + '`retiredKey()` tombstone and no parse rejection that could carry a prescription, '
        + 'and the ledger is the only channel that reaches an upgrader. It is if anything '
        + 'blinder than those three: the keys shipped in a FINAL release (`@objectstack/rest` '
        + '14.5.0) and have been published in every release since, and because they were '
        + 'OPTIONAL keys on an interface that itself survives, a JavaScript consumer reading '
        + '`meta.required` after the upgrade gets `undefined` with no error at all — tsc '
        + 'reports at the read site only for a typed consumer. '
        + 'Why D3 semantic and not a D2 conversion: there is nothing to convert. No authored '
        + 'or stored metadata changes shape — `required` / `min` / `maxLength` and the rest '
        + 'remain fully authorable on a field definition and fully enforced by the engine, '
        + 'which is where they always lived. The only place these eight are ever spelled is '
        + "inside a consumer's own TypeScript, so no `objectstack migrate meta` transform can "
        + 'reach them. ADR-0049 / ADR-0087, #6536 (the sweep PR #6532 deliberately deferred).',
      acceptanceCriteria:
        'No code of yours reads any of the eight off a `buildFieldMetaMap` / '
        + '`prepareImportRequest` result. Grep your sources for `.required` / `.hasDefault` / '
        + '`.minLength` / `.maxLength` / `.min` / `.max` / `.system` / `.readonly` on an '
        + '`ExportFieldMeta`-typed value; each hit moves to the object schema you already '
        + 'passed in. ⚠️ Prove it against a RUN, not against tsc: these were optional keys, '
        + 'so an untyped or `any`-typed read compiles clean and silently becomes `undefined` '
        + '— assert that the constraint your code acts on is still observed on a real import, '
        + 'not merely that the build is green. Note `hasDefault` has no one-to-one '
        + "replacement key: it was the derived predicate `defaultValue != null`, mirroring the "
        + "engine's `applyFieldDefaults` gate, so read `fields[name].defaultValue` and apply "
        + 'that same `!= null` test yourself.',
    },
    {
      id: 'filter-regex-options-retired',
      // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
      // code span already, and a nested backtick would close it.
      surface:
        'data.filter $regex / $options — in a STORED filter (dashboard widget filter and '
        + 'globalFilters, report runtimeFilter, page and component filter, solution-blueprint '
        + 'filter), and equally in the where clause of a query request',
      replacement:
        '$icontains for the case-insensitive substring match this was almost always used '
        + 'for, or $contains for a case-sensitive one — a pattern that genuinely needs a '
        + 'regular expression has no filter-level replacement',
      reason:
        'Like `driver-aggregate-undeclared-key-aliases-removed` and '
        + '`driver-sql-distinct-bare-filter-typed`, this entry records a LENIENCY being '
        + 'withdrawn rather than a declared surface: `$regex` was never in `FILTER_OPERATORS` '
        + 'and never a key on `StringOperatorSchema`. That is measured, not assumed — `git '
        + 'log -S\'$regex\'` over `packages/spec/src` returns only doc comments describing how '
        + '`$contains` LOWERS to MongoDB (`Contains substring - SQL: LIKE %?% | MongoDB: '
        + '$regex`), plus #5701 itself, which added the name solely as `RETIRED_FILTER_OPERATORS` '
        + 'prescription data. ⚠️ But it differs from those two in the one way that decides the '
        + 'disposition, so a reader should not have to infer it: those were driver CALL '
        + 'ARGUMENTS, code and never stack metadata, whereas a filter IS stored metadata. '
        + '`FilterConditionSchema` is an OPEN RECORD (`z.record(z.string(), z.unknown())`) '
        + 'because a filter key is a field name, so a stored `{ name: { $regex: \'acme.*\' } }` '
        + 'parses GREEN and always will — a `retiredKey()` tombstone cannot exist on an open '
        + 'map, which is exactly why the ledger has to carry this. What such a stack used to '
        + 'get was four different answers from four backends: `driver-sql` and Turso\'s remote '
        + 'transport compiled it to a LIKE-escaped SUBSTRING (so `a.b` matched only the literal '
        + '`a.b` and the regex was silently never a regex), `driver-memory` and objectql\'s '
        + '`having` ran it as a real `RegExp` (so the same filter also matched `axb`, and an '
        + 'INVALID pattern was caught and answered `false` — zero rows, in silence), and '
        + '`driver-mongodb` refused it with a bare `Error` carrying no `code` and no `status`. '
        + 'It is now refused everywhere with INVALID_FILTER / 400 naming the replacement. '
        + 'There is deliberately NO D2 conversion and this sits in `semantic` rather than among '
        + 'the mechanical transforms: rewriting `$regex` to `$icontains` is NOT lossless in '
        + 'either direction — a regex metacharacter becomes a literal — so an auto-applied '
        + 'rewrite would silently change which rows a dashboard, report or permission filter '
        + 'selects, a wrong number rather than a missing one. Choosing the substring the '
        + 'pattern MEANT is a judgment about the query, not a transform. ⚠️ This entry covers '
        + 'BOTH HALVES of the #4706 ruling (B), not just the driver one: the contract half '
        + '(#5701 — the `$icontains` declaration, the `$contains` family pinned '
        + 'case-sensitive, and the `RETIRED_FILTER_OPERATORS` prescriptions) landed before the '
        + 'ADR-0087 disposition gate (#6148) existed and so was never asked for a ledger entry; '
        + 'the driver half (#5702) is where the refusal became executable. One surface, one '
        + 'entry, registered from the half that made it observable. ADR-0049 / ADR-0087, '
        + '#4706 / #5701 / #5702.',
      acceptanceCriteria:
        'No stored filter and no request `where` spells `$regex` or `$options` — grep the '
        + 'stack for both. Each one is rewritten by asking what the pattern MEANT, not by '
        + 'transliterating it: a bare substring pattern becomes `$icontains` (or `$contains` '
        + 'when the match must stay case-sensitive), and its metacharacters are dropped rather '
        + 'than escaped, because they were never honoured as a regex on the SQL family in the '
        + 'first place. ⚠️ Expect the answer to CHANGE on any stack that ran on '
        + '`driver-memory`, `driver-mongodb` or objectql `having`, where the pattern really was '
        + 'evaluated as a regular expression; on the SQL family the rewritten filter returns '
        + 'what it always returned. A pattern that genuinely needs alternation, anchoring or '
        + 'character classes has no filter-level replacement — move that predicate into a '
        + 'formula field or a server-side view, or open an issue for it. Verify by loading the '
        + 'stack: a surviving `$regex` or `$options` is answered INVALID_FILTER / 400 with a '
        + 'message naming the replacement, on every backend.',
    },
    // `etl-retry-converged-onto-retry-policy` (#4962) was registered in this step and
    // ABSORBED by `etl-pipeline-layer-retired` (#6414), the §0 same-major
    // rule: both land in the unreleased protocol 17, and composed, the rename
    // `ETLPipeline.retry.maxAttempts` -> `maxRetries` has no observable effect
    // because the shape carrying it does not survive the major. Leaving both
    // would tell an upgrader to rewrite a key on a schema this same upgrade
    // deletes, and would break the fixture-disjointness the replay contract
    // asserts. The `agent.knowledge` / `WidgetManifest.performance` precedent:
    // a tombstone goes with the shape that carried it, which is strictly
    // stronger than the tombstone.
    {
      id: 'flow-retry-max-retries-required',
      surface: "flow.errorHandling.maxRetries (under strategy: 'retry')",
      replacement: 'an explicit count >= 1 (e.g. maxRetries: 3), or strategy: \'fail\'',
      reason:
        'maxRetries had two defaults — FlowSchema `.default(0)` and the engine\'s ' +
        '`maxRetries ?? 3` — so an unstated count retried 0 times through the schema and 3 ' +
        'times through a hand-built definition (#4247). With the engine\'s copy removed the ' +
        'unstated count is unambiguously 0, and retrying zero times is exactly ' +
        "`strategy: 'fail'`, so the schema now refuses the combination instead of it silently " +
        'doing nothing. There is no lossless rewrite: 0 preserves the behaviour a parsed flow ' +
        'got but contradicts what its author wrote, and any positive count is a NEW decision ' +
        'about re-running the whole flow with its side effects. That choice is the author\'s.',
      acceptanceCriteria:
        "Every flow declaring `errorHandling.strategy: 'retry'` also declares " +
        '`maxRetries` >= 1, and each count was chosen knowing a retry replays the flow FROM ' +
        'THE START (records re-created, callouts re-fired); flows that never actually wanted ' +
        "retries say `strategy: 'fail'`. No flow fails to register with the maxRetries " +
        'prescription.',
    },
    {
      id: 'hook-context-session-roles-retired',
      surface: 'data.hookContext.session.roles',
      replacement:
        '(removed — gate on `session.userId` / `session.isSystem`; for PRIVILEGE ask the '
        + 'security service, which reads `permissions` / `positions` / posture off the '
        + 'execution context, ADR-0095 D3)',
      reason:
        'Declared on the runtime hook context, read by exactly two consumers, produced by '
        + 'nobody. The two readers were the approvals record lock and the delegation write '
        + 'guard, each opening with `session.roles?.includes(\'admin\')`; ObjectQL\'s '
        + '`buildSession()` builds the session field by field and has never written `roles`, '
        + 'and nothing else feeds a HookContext in objectstack, cloud or objectui (cloud\'s hook '
        + 'consumers read `hookContext?.session?.userId`; objectui\'s `roles` are the '
        + '`/auth/me` user payload, a different surface; an ACTION body\'s `ctx.session` is a '
        + 'different untyped object that does carry `roles`, tracked apart and unaffected). '
        + 'Both branches were therefore dead on '
        + 'every real engine path — an authorization decision in shape only, and a second admin '
        + 'dialect competing with the one ADR-0090 D3 / ADR-0095 D3 sanction. #4839 (PR #5049) '
        + 'removed the readers; this removes the declaration, per ADR-0049 enforce-or-remove. '
        + 'This is a RUNTIME context, not stored metadata: the engine builds a HookContext per '
        + 'operation and nothing persists one, so no `sys_metadata` row, example or template '
        + 'can carry the key and there is no source for the D2 chain to rewrite — the '
        + '`openApi31` (#4579) / `activationEvents` (#4657) shape, one semantic TODO rather '
        + 'than a stack conversion. The key IS tombstoned (`HookContextSchema` is deliberately '
        + 'not `.strict()` — a plain delete would strip it silently, #3733 / ADR-0104), so a '
        + 'consumer that parses a context it was handed still meets the prescription. '
        + 'ADR-0049, #5050.',
      acceptanceCriteria:
        'No hook reads `ctx.session.roles`; caller gating uses `ctx.session.userId` / '
        + '`ctx.session.isSystem`, and privilege comes from the security service '
        + '(`permissions` / `positions` / posture). Constructing a HookContext session with '
        + '`roles` fails `tsc` (the input type is `never`) and fails `HookContextSchema.parse` '
        + 'with the retirement prescription instead of being silently stripped. Nothing '
        + 'regresses at runtime: the key had no producer, so no decision anywhere ever saw a '
        + 'value in it.',
    },
    {
      id: 'hook-register-empty-object-target-refused',
      surface:
        "engine.registerHook(event, handler, { object: '' | [] | [''] }), and a scope whose "
        + '`excludeObjects` cancels its `object` entirely',
      replacement:
        "name the object(s) — `object: 'account'` / `object: ['account', 'contact']` — or, for "
        + "a global hook, `object: '*'` or no `object` key at all; for a cancelled scope, widen "
        + '`object` or drop the overlapping names from `excludeObjects`',
      reason:
        '#4281 ruled that an empty hook target is not "no target" and closed the shape at the '
        + "two METADATA doors — `HookSchema.object`'s refine and `hook-binder.ts`'s "
        + '`normalizeObjects`. `engine.registerHook`, the CODE door, goes through neither, so '
        + 'all three spellings still registered, each producing a defect the author did not '
        + "write: `''` is FALSY, so the allow face was skipped entirely and the entry became a "
        + "GLOBAL hook (#4281's headline failure mode — blank intent taking the broadest "
        + "possible blast radius); `[]` and `['']` are truthy but admit no object name, so the "
        + 'entry could never fire. #5928 then added the `excludeObjects` face, which brought a '
        + 'fourth shape reached by arithmetic rather than by one bad name: an `object` list '
        + 'every member of which is also excluded admits nothing, so that entry can never fire '
        + 'either. All four are ADR-0078 silently-inert declarations, and all four are now '
        + 'refused at REGISTRATION.\n\n'
        + 'No mechanical rewrite exists, in either direction. The refused values carry no '
        + "recoverable intent — `object: ''` could have meant `'*'` (what it actually did) or a "
        + 'specific object name the author forgot to fill in, and those are opposite '
        + 'registrations; choosing between them is a judgment the chain cannot make. Nor could '
        + "the MATCHING read be changed instead: teaching the matcher that `''` is an "
        + 'unmatchable name would silently convert a hook firing on every object into one '
        + 'firing on none — the same class of defect pointing the other way, which is why '
        + '#5928 declined to do it in passing.\n\n'
        + 'This is a RUNTIME registration API, not stored metadata, so — like '
        + '`hook-context-session-roles-retired` at this step — there is no `sys_metadata` row '
        + 'for the D2 chain to rewrite and the ledger entry is the notification channel. One '
        + 'metadata surface reaches it INDIRECTLY and is the reason this is not purely a '
        + "code-side note: a `record-change` flow's start node forwards `config.objectName` "
        + 'verbatim into `registerHook` (`RecordChangeTrigger.start`), so a flow authored with '
        + 'a blank `objectName` used to bind a trigger to EVERY object in the tenant. It now '
        + "fails to bind instead, loudly — the automation engine's per-flow bind guard warns "
        + 'and the `kernel:bootstrapped` binding audit re-reports it — which is the correct '
        + 'end state, but it is an observable change for that flow. #6573, #4281, #4001, '
        + '#5928, ADR-0078.',
      acceptanceCriteria:
        'No `registerHook` call site passes an empty `object` target, and none passes an '
        + '`excludeObjects` list covering every name in its `object` list. Every `record-change` '
        + 'flow start node declares a non-blank `config.objectName`, or omits the key if the '
        + 'flow is genuinely meant to fire on every object. Boot completes with no '
        + '"[ObjectQL] Hook ... declares an empty `object` target" throw and no '
        + '"[record-change] ... not bound" warning naming a flow you expect to fire.',
    },
    {
      id: 'http-server-runtime-vocabulary-retired',
      surface:
        'system.serverEvent / system.serverEventType / system.serverCapabilities / '
        + 'system.serverStatus (the lifecycle-event, capability-report and status vocabulary of '
        + 'system/http-server.zod.ts — 4 defs, 8 exported names)',
      replacement:
        '(removed — there is no replacement key, because there was never a key. Server lifecycle '
        + 'is the transport plugin\'s own start/stop seam; per-request and per-server '
        + 'observability is `system/metrics.zod.ts` and `system/logging.zod.ts` (plus '
        + '`OS_SERVER_TIMING` for timings), and liveness is the `/health` endpoint. What a '
        + 'transport plugin can DO it states by implementing the kernel plugin contract — the '
        + 'seams it registers are the capability statement, and a self-described capability '
        + 'record can only disagree with them. Server-level configuration that IS authorable '
        + 'lives on `defineStack({ server })` / `StackServerConfigSchema`, which is unaffected)',
      reason:
        'The second and final ADR-0049 pass over `system/http-server.zod.ts`. #4938 removed the '
        + 'CONFIG half (`HttpServerConfigSchema`, nine keys, zero readers, zero authoring '
        + 'entry); this removes the RUNTIME half — a 7-member lifecycle event union with a '
        + 'timestamped envelope, an eight-boolean capability report, and a five-state status '
        + 'record with connection and request counters. Nothing ever emitted, consumed or '
        + 'parsed any of them. '
        + 'This card was HELD for four days rather than queued, on a specific and legitimate '
        + 'doubt: a response/capability vocabulary can be a REFERENCE surface for host '
        + 'implementers, so "zero consumers in this repo" is weaker evidence for one of those '
        + 'than for an authorable key (the CSS-variable rebuttal). The hold was lifted by '
        + 'measuring the reference reader itself rather than by re-running the same grep: '
        + '`plugin-hono-server`, the one in-tree host implementation, neither implements nor '
        + 'reports any of the three — it names no capability record, no status shape and no '
        + 'event union, and what it registers is routes and middleware through the kernel '
        + 'plugin contract. A declaration-site grep put every declaration in this one file, a '
        + 'quoted-name sweep across objectstack and objectui found no reader outside it, and '
        + 'the control passed in the SAME run: `MiddlewareConfig`, declared twelve lines away, '
        + 'resolves to `packages/runtime/src/middleware.ts`. So the sweep could see a reader in '
        + 'this file when there was one. '
        + 'With no carrier key there is nothing to tombstone, and with no author there is no '
        + 'source or `sys_metadata` row for a D2 conversion to rewrite: RETIRED_DEFS_BY_MAJOR '
        + 'plus this entry are the declaration — route 3, the same shape as #4938 in this very '
        + 'file, #4834, #4988 and #5055. If host-implementer conformance becomes a real '
        + 'requirement it returns through the ENFORCE route: an adapter contract with a checker '
        + 'behind it, vocabulary second. ADR-0049, #5295.',
      acceptanceCriteria:
        'No source imports `ServerEvent`, `ServerEventType`, `ServerEventSchema`, '
        + '`ServerCapabilities`, `ServerCapabilitiesSchema`, `ServerCapabilitiesParsed`, '
        + '`ServerStatus` or `ServerStatusSchema` from `@objectstack/spec/system` — a grep over '
        + 'consumer code resolves none of them, and `tsc` reports TS2724/TS2305 on any that '
        + 'survives. The route-registration half of the same module still resolves '
        + '(`RouteHandlerMetadataSchema`, `MiddlewareType`, `MiddlewareConfigSchema`, '
        + '`MiddlewareConfig`), and `StackServerConfigSchema` — the one authorable server '
        + 'surface — is untouched: a stack declaring `server: { trustProxy, security }` parses '
        + 'exactly as it did in 16.x.',
    },
    {
      id: 'import-run-automations-declared-default-corrected',
      // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
      // code span AND a table cell (see the note on `spec-type-alias-input-suffix-retired`).
      surface:
        'api.ImportRequest runAutomations — the declared default of the key on BOTH import '
        + 'bodies, POST /api/v1/data/:object/import (ImportRequest) and its async twin POST '
        + '/api/v1/data/:object/import/jobs (CreateImportJobRequest, which IS the same schema '
        + 'object). It was declared default(false) and described as "off by default for '
        + 'bulk"; it is now default(true), which is what the server has always done',
      replacement:
        'an explicit runAutomations: false on any import request that is meant to load rows '
        + 'without firing triggers/hooks. That spelling is unchanged and has always been the '
        + 'only one the server read — what changes is that omitting the key now DECLARES what '
        + 'it already DID. Callers who want automations on need write nothing',
      reason:
        'A DECLARATION corrected to match a runtime that did not move — the inverse of a '
        + "behaviour flip, and registered here for the reason protocol 12's "
        + '`rest-requireauth-default-flip` and this major\'s '
        + '`action-descriptor-resume-authority-default-flip` are: whether a given import was '
        + 'meant to fire triggers is a judgment no transform can make, so the prescription is '
        + 'a TODO rather than a rewrite. The server decides in import-prepare.ts with '
        + '`body?.runAutomations !== false`, i.e. an omitted flag runs automations, and has '
        + 'since #2922 — automations always ran on import historically (the engine ignored '
        + 'the flag entirely before then), so opt-out was made the explicit act, matching '
        + 'platform convention. The schema said the opposite in both machine-readable and '
        + "human-readable form, and both SHIPPED: `.default(false)` in `@objectstack/spec`'s "
        + 'JSON Schema, and the describe prose in the published reference tables for both '
        + 'defs. '
        + '⚠️ Nothing in this repo reconciled the two and NO deployed caller changes '
        + 'behaviour: no request path parses an import body through this schema — the route '
        + 'reads the raw body, and the sole reference to `CreateImportJobRequestSchema` is '
        + 'the declarative `ImportJobApiContracts` catalog entry, a declaration and not a '
        + 'parse. That is exactly why this needed a ruling rather than a docs edit: the '
        + 'divergence was unobservable in-tree and observable only to a consumer OUTSIDE it. '
        + 'A client or SDK that validated its request through the published schema '
        + 'materialised `runAutomations: false` from the declared default and sent it '
        + 'explicitly, and the server honoured it — so the same request body produced '
        + 'opposite behaviour depending on whether the caller validated before sending, with '
        + 'the validating caller silently losing its triggers. Nothing rejected it, nothing '
        + 'warned, and the reference page told an author the wrong thing in the other '
        + 'direction. There is deliberately NO schema tombstone and no D2 conversion: no key '
        + 'is removed, and an HTTP request body is neither authored nor persisted — the same '
        + 'disposition `notification-list-cursor-retired` (#6361) takes for the sibling '
        + 'default on this major, and `batch-options-validate-only-retired` before it. The '
        + 'declared move itself is recorded mechanically, per key, in '
        + 'DEFAULT_CHANGES_BY_MAJOR[17] (#4666), whose `from`/`to` fingerprints are '
        + 're-derived on every build. Maintainer ruling 2026-08-09 (#6704, disposition A: '
        + 'the spec follows the runtime). ADR-0049 / ADR-0078.',
      acceptanceCriteria:
        'Every import request of yours that must NOT fire triggers sends `runAutomations: '
        + 'false` explicitly, rather than omitting the key and trusting the old declared '
        + 'default. The check is worth doing precisely where it looks unnecessary: if you '
        + 'build the body by parsing it through `ImportRequestSchema` (or the published JSON '
        + 'Schema) and then send the PARSED object, your bulk loads were running with '
        + 'automations OFF and will now run with them ON — that is the only class whose '
        + 'behaviour changes, and it changes toward what an unvalidated caller always got. '
        + '⚠️ Behaviour on the wire is deliberately UNCHANGED and should be verified as '
        + 'such: a body that omits `runAutomations` fired triggers before this change and '
        + 'fires them after, and `runAutomations: false` turns them off before and after. '
        + 'Nothing starts being refused — the route never validated this body against the '
        + 'schema and does not begin to. `dryRun` is unaffected and still runs NO automations '
        + 'whatever the flag says (#6037).',
    },
    {
      id: 'job-retry-policy-constraints-tightened',
      surface: 'job.retryPolicy.maxRetries (> 10) / job.retryPolicy.backoffMultiplier (< 1)',
      replacement: 'maxRetries <= 10, and backoffMultiplier >= 1',
      reason:
        'The converged RetryPolicy (#4661) keeps the automation side\'s bounds, which the job '
        + 'side never had: `maxRetries` is capped at 10 and `backoffMultiplier` floored at 1. '
        + 'Neither has a lossless rewrite. Clamping `maxRetries: 20` to 10 would halve a '
        + 'retry budget its author chose, and a `backoffMultiplier` below 1 describes a delay '
        + 'that SHRINKS on each attempt — retrying a failing dependency ever faster, which is '
        + 'the opposite of backoff and was never a shape the engine meant to offer. Both now '
        + 'fail at parse time with the bound named, rather than being silently reinterpreted. '
        + 'Choosing the replacement count (or accepting the cap) is the author\'s call.',
      acceptanceCriteria:
        'Every job declaring `retryPolicy` parses: no `maxRetries` above 10 and no '
        + '`backoffMultiplier` below 1 remain, and each adjusted value was re-chosen knowing a '
        + 'retry re-runs the handler with its writes and callouts. No job fails to register '
        + 'with the retry-policy bound prescription.',
    },
    {
      id: 'notification-list-cursor-retired',
      // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
      // code span AND a table cell (see the note on `spec-type-alias-input-suffix-retired`).
      surface:
        'api.listNotifications cursor — the key on BOTH halves of GET /api/v1/notifications '
        + '(ListNotificationsRequestSchema and ListNotificationsResponseSchema) and the cursor '
        + 'argument of the client SDK call client.notifications.list(). The same entry covers '
        + 'the limit default: the request schema no longer declares default(20)',
      replacement:
        'a larger `limit` — the route answers the newest N notifications and has no page 2. '
        + 'There is no replacement for `cursor`, deliberately: nothing ever minted one, so no '
        + 'caller holds a value to carry over. Callers that looped on it were re-reading the '
        + 'first window and should read one window sized to what they display (the Console '
        + 'bell polls exactly this way). For the removed `limit` default, send the number you '
        + 'want explicitly if you were relying on 20 — omitting it takes the server window, '
        + 'which is 50 on the platform inbox and clamped into 1..200, and has been since '
        + 'before the declaration existed',
      reason:
        'One capability, both halves, never half-deleted (maintainer ruling 2026-08-07, '
        + 'Option A, ruled jointly with #6363). `cursor` was declared on the request and on '
        + 'the response and honoured on neither: the dispatcher domain reads `read` / `type` / '
        + '`limit` and nothing else, and no emit site has ever written the response key. It '
        + 'was worse than inert because it had a shipped PRODUCER — the SDK appended it to the '
        + 'query string — so a caller paginating by the published contract looped on page 1 '
        + 'forever, with no error and no 400. Measured over a real boot with 60 unread before '
        + 'the removal: page2 === page1, both parsing green against the response schema, which '
        + 'is why no conformance gate could see it. '
        + 'This is `data.query.cursor` (#4286, `query-cursor-retired`) one layer up, with the '
        + 'same verdict for the same reason, down to deleting the SDK producer alongside the '
        + 'key. A first-class inbox cursor, if one is ever designed, will be a '
        + 'response-minted opaque token — a different API — so keeping this one preserved a '
        + 'wrong design rather than a roadmap. '
        + 'The `limit` default goes with it because the FICTION WAS THE MECHANISM, not the '
        + 'number: no request path parses a query string through this schema (#3899 wired the '
        + "catalog's requestSchema to the real entry for BODIES only), so `.default(20)` never "
        + 'stamped anything onto anything, and the server has always applied its own 50. '
        + 'Re-spelling 20 as 50 — the other arm the ruling allowed — would have kept a '
        + 'declaration that does not execute and merely made it coincide with the '
        + 'implementation until someone moved the clamp; `.optional()` plus prose is true '
        + 'about both the schema and the server. No constraint (`.int()` / `.max(200)`) is '
        + 'declared either, because the service CLAMPS an out-of-range limit rather than '
        + 'refusing it, and declaring a rejection the wire does not perform is the same defect '
        + 'mirrored. '
        + 'Route 2, and the split is worth stating exactly because the two halves of the '
        + 'bookkeeping go different ways. There IS a tombstone: both schemas are non-strict, '
        + 'so a bare deletion would have made Zod SILENTLY STRIP whatever a caller kept '
        + 'sending — a clean parse and a parameter that never takes effect, which is this '
        + "issue's own defect re-created one layer down (#3733, ADR-0104). So `cursor` is "
        + '`retiredKey()` on both halves, typed `never` for tsc and raising the prescription '
        + 'at any parse, and both keys are registered in RETIRED_KEYS_BY_MAJOR[17]. There is '
        + 'NO D2 conversion: a conversion rewrites an authored source or a stored '
        + '`sys_metadata` row, and these two shapes are HTTP-only — nobody authors a '
        + '`ListNotificationsRequest` and nothing persists one. Request AND response shapes: '
        + 'two semantic TODOs for API callers, no stack conversion — the same disposition '
        + '`BatchOptions.validateOnly` (#4052) and the `AnalyticsQueryRequest` envelope keys '
        + 'already take in this major. The `limit` default is declared separately and '
        + 'mechanically, in DEFAULT_CHANGES_BY_MAJOR[17] (#4666), whose `from`/`to` '
        + 'fingerprints are re-derived on every build. ADR-0049 / ADR-0078, #6361.',
      acceptanceCriteria:
        'No caller sends `cursor` to `GET /api/v1/notifications` and no SDK call site passes '
        + 'it: `client.notifications.list({ cursor })` is a `tsc` error (TS2353, excess '
        + 'property), which is the enforced channel — the removal is loud at compile time for '
        + 'every TypeScript consumer. Reading `response.cursor` no longer type-checks either, '
        + 'and always answered `undefined` before. ⚠️ Behaviour on the wire is deliberately '
        + 'UNCHANGED and must be verified as such: a request still carrying `?cursor=…` is '
        + 'IGNORED, not refused — the domain reads three named query keys and no route '
        + 'validates this query against a schema, so an unknown key has never produced a 400 '
        + 'and does not start doing so here. The declaration stopped promising what the wire '
        + 'never did; the wire did not change. `unreadCount` is untouched (#6363) and still '
        + 'reports the total across the whole matching inbox rather than the window. A caller '
        + 'that omitted `limit` receives the same 50 rows it always received.',
    },
    {
      id: 'plugin-activation-events-retired',
      surface:
        'kernel.dynamicLoadRequest.activationEvents / studio.studioPluginManifest.activationEvents',
      replacement:
        '(removed — delete the key. Every plugin activates immediately on load/registration, '
        + 'which is the only behaviour that has ever existed; `activate()` still runs at '
        + 'registration time. Lazy activation, if built, returns via the enforce route of '
        + 'ADR-0049 through a new ADR, with a vocabulary its executor actually honours)',
      reason:
        'Both `activationEvents` keys — and the `ActivationEventSchema` trigger vocabulary '
        + 'they embedded (`onCommand` / `onRoute` / … / `onView` after the #4653 convergence) — '
        + 'promised lazy plugin activation ("plugins remain dormant until an activation event '
        + 'fires") that no runtime in objectstack, cloud, cloud-v1 or objectui ever '
        + "implemented: nothing anywhere read the key, every plugin activates immediately, and "
        + "cloud-v1's own ROADMAP recorded lazy activation as unimplemented (planned v0.4.0). "
        + 'That is the ADR-0049 false-compliance shape in the semantically-lying direction: an '
        + 'author writing `activationEvents: [{ type: \'onMetadataType\', pattern: \'flow\' }]` '
        + 'expected deferral and got eager activation with a clean parse. Neither parent shape '
        + 'is stored metadata — `StudioPluginManifest` is TS configuration parsed by '
        + '`defineStudioPlugin` (a root schema, never part of a stack tree) and '
        + '`DynamicLoadRequest` is a runtime request shape with no caller — so no '
        + '`sys_metadata` row can carry the key and there is no source for the D2 chain to '
        + 'rewrite; this entry is the D3 record. The kernel key is tombstoned via '
        + '`retiredKey()` (its schema is not `.strict()`; a plain delete would strip an '
        + "authored value silently), the studio key is rejected by the strict manifest parse "
        + 'with a guidance prescription (as are its former VS Code-flavoured aliases '
        + '`activation` / `events` / `onActivate`), and the orphaned `ActivationEventSchema` / '
        + '`ActivationEvent` exports are removed from `./kernel` and `./studio` with the keys '
        + '(#3950: an exported schema with no consumer is read as a capability). #4657. '
        + 'SUPERSEDED ON THE KERNEL SIDE by #4834 (same unreleased major): the whole '
        + '`DynamicLoadRequest` shape — and the rest of the plugin-runtime family with it — '
        + 'was removed, which took this key\'s `retiredKey()` tombstone with it. That is '
        + 'strictly stronger than the tombstone, not weaker: there is no longer a '
        + '`DynamicLoadRequest` to author the key INTO, so the prescription an author needs '
        + 'is no longer "delete this key" but "this request shape does not exist" (see '
        + '`plugin-runtime-family-retired`). The studio half of this entry is '
        + 'unaffected and still enforced by the strict manifest parse.',
      acceptanceCriteria:
        'No `defineStudioPlugin` input authors `activationEvents` — authoring it is an '
        + 'unknown key on the strict studio manifest and a parse error carrying the '
        + 'prescription. On the kernel side the stronger #4834 criterion applies instead: '
        + 'there is no `DynamicLoadRequest` type or schema left to author it into at all. No '
        + 'code imports `ActivationEventSchema` / `ActivationEvent` from '
        + '`@objectstack/spec/kernel` or `@objectstack/spec/studio` (TS2305 after upgrade). '
        + 'Runtime behaviour is byte-identical: plugins loaded eagerly before and after.',
    },
    {
      id: 'plugin-manifest-loading-retired',
      surface:
        'manifest.loading (the whole block: strategy / preload / codeSplitting / dynamicImport / '
        + 'initialization / dependencyResolution / hotReload / caching / sandboxing / monitoring)',
      replacement:
        'nothing to re-declare — delete the key. Plugins are composed at boot: `defineStack` '
        + 'registers them and the kernel runs `init` then `start` in an order topologically '
        + "resolved from each composed plugin's own `dependencies` / `optionalDependencies` "
        + '(`resolvePluginOrder` in `packages/core/src/plugin-order.ts`). For the isolation '
        + '`loading.sandboxing` appeared to configure, use the plugin trust tier '
        + '(`manifest.runtime`, ADR-0025 §3.6) and the manifest permission declarations, which '
        + 'are the surfaces the platform actually enforces',
      reason:
        'ADR-0049 enforce-or-remove; maintainer ruling 2026-08-04 on #4914. The block declared a '
        + 'complete plugin loading policy and NOTHING read it. A bare-name scan of all three '
        + 'repos — objectstack, cloud (measured 2026-08-09) and objectui (measured at pickup), '
        + 'each with a control probe proving the scan saw the tree — put every hit inside '
        + '`packages/spec` itself: this module\'s own declaration, its own unit tests, the '
        + '`Manifest.loading` embed and the generated artifacts. `manifest.loading.*` had zero '
        + 'readers in `packages/core`, `packages/runtime` and `packages/metadata`. So the key '
        + 'parsed, entered the manifest, and changed nothing — #3950, at the scale of a whole '
        + 'block. What made it outrank ordinary inert-key cleanup is `sandboxing`: it declared '
        + 'process / vm / iframe / web-worker isolation, IPC transports and an `allowedServices` '
        + 'ACL, so an AI author (ADR-0033) reading that vocabulary concluded the platform '
        + 'isolates plugins, wrote the config, and received a clean parse and zero isolation. An '
        + 'inert security control is worse than an absent one because it is believed. Hot reload '
        + 'was additionally a TWO-SOURCE defect: the docs pointed at this dead '
        + '`PluginHotReloadSchema` while the only implementation body, `HotReloadManager` '
        + '(`packages/core/src/hot-reload.ts`), reads a different vocabulary — '
        + '`HotReloadConfigSchema` in `plugin-lifecycle-advanced.zod.ts`. Ruling §2 converges on '
        + 'the surviving side: that schema is KEPT as the starting point for a future enforce '
        + 'decision (it has an implementation body but no runtime composes it yet), and '
        + 'enforcing it is deliberately a separate decision, not this retirement. '
        + 'Why D3 semantic and not a D2 conversion: the chain walks a normalized STACK and '
        + '`applyConversionsToStoredItem` maps a metadata type onto one of its collections. A '
        + 'package manifest is neither — `PLURAL_TO_SINGULAR` has no `packages` / `plugins` '
        + 'entry, so a manifest is not a stack collection member and a stored manifest row '
        + 'passes that seam through unchanged. A conversion would be a transform with no seam '
        + 'that ever runs.',
      acceptanceCriteria:
        'No `objectstack.plugin.json` and no stored package manifest carries a `loading` key. '
        + 'The enforced channel is the one place a manifest is parsed with an author present: '
        + '`os plugin build` runs `ManifestSchema.safeParse` and exits non-zero, printing the '
        + 'tombstone prescription, so a manifest still declaring `loading` fails its build '
        + 'rather than shipping. TypeScript authors get it earlier still — `loading` is typed '
        + '`never`, so assigning it is a `tsc` error. ⚠️ Runtime behaviour is deliberately '
        + 'UNCHANGED and must be verified as such: nothing ever read the block, so removing it '
        + 'removes no behaviour. A package ALREADY INSTALLED whose stored manifest carries '
        + '`loading` keeps working — the registry\'s `validate()` is an explicit diagnostic and '
        + 'not a gate (it catches, logs `[metadata_spec_invalid]`, and registers the item '
        + 'anyway, deliberately, so bad metadata is never a data outage), so such a row '
        + 'degrades to one log line at registration rather than a boot failure. Clear it by '
        + 'deleting the key from the source manifest and reinstalling.',
    },
    {
      id: 'plugin-runtime-family-retired',
      surface:
        'kernel.dynamicLoadRequest / kernel.dynamicUnloadRequest / kernel.dynamicPluginResult '
        + '/ kernel.pluginSource / kernel.dynamicPluginOperation',
      replacement:
        '(removed — there is no replacement shape, because there is no operation to describe. '
        + 'Plugins are composed at boot: `defineStack` registers them and the kernel runs '
        + 'register → init → start; the set is fixed until the process restarts. Delete the '
        + 'import and the value. Runtime plugin loading, if it is ever built, returns via the '
        + 'enforce route of ADR-0049 through a new ADR — loader first, vocabulary second)',
      reason:
        'The five schemas declared the "Dynamic Loading" capability — runtime load / unload / '
        + 'reload of plugins without a kernel restart, with sandboxing, integrity hashes, '
        + 'drain strategies and dependent-cascade policy — and NOTHING implemented it. A '
        + 'bare-name scan of objectstack, cloud and objectui found zero references outside '
        + "this package's own declaration, its unit tests and the generated artifacts: no "
        + 'runtime ever received a `DynamicLoadRequest`, performed a load/unload, or produced '
        + 'a `DynamicPluginResult`. That is the ADR-0049 false-compliance shape at its most '
        + 'inviting to an AI author (ADR-0033), who reads `DynamicLoadRequestSchema` in the '
        + 'published IDE bundle as proof the platform hot-loads plugins and constructs a '
        + 'request that parses clean and is received by nobody (#3950: an exported schema '
        + 'with no consumer is read as a capability). The #3896 follow-up removed this '
        + "module's discovery/sandbox config island and left these five in place explicitly — "
        + '"operation contracts, not security promises; the enforce-or-remove call on them is '
        + 'a design decision rather than a correction" — but that suspension lived only in a '
        + 'changeset paragraph with no issue carrying it. #4834 is that decision, answered '
        + 'REMOVE. `experimental` was considered and rejected: it is only `.describe()` prose '
        + 'and cannot stop an import, the weakest of the three ADR-0049 channels. None of the '
        + 'five is stored metadata — they are root request/result payload shapes embedded in '
        + 'no parent schema and parsed against no metadata document — so no `sys_metadata` '
        + 'row can carry one and there is no source for the D2 chain to rewrite; this entry '
        + 'is the D3 record. The removal also subsumes the kernel half of '
        + '`plugin-activation-events-retired` (#4657): that tombstone goes with the shape '
        + 'that carried it. ADR-0049, #4834.',
      acceptanceCriteria:
        'No code imports `DynamicLoadRequestSchema`, `DynamicUnloadRequestSchema`, '
        + '`DynamicPluginResultSchema`, `PluginSourceSchema`, `DynamicPluginOperationSchema` '
        + 'or any of their type aliases (`DynamicLoadRequest`, `DynamicUnloadRequest`, '
        + '`DynamicPluginResult`, `PluginSource`, `DynamicPluginOperation`, '
        + '`DynamicLoadRequestInput`, `DynamicUnloadRequestInput`) from '
        + '`@objectstack/spec` or `@objectstack/spec/kernel` — every one is TS2305 after '
        + 'upgrade, on every public entry (pinned by symbol identity in '
        + '`plugin-runtime-retirement.test.ts`). Nothing regresses at runtime, because '
        + 'nothing called anything: a caller that believed it was hot-loading a plugin was '
        + 'already only building an object. Boot-time composition through `defineStack` is '
        + 'unchanged.',
    },
    {
      id: 'query-array-string-agg-retired',
      surface: "data.query.aggregations[].function ('array_agg' / 'string_agg')",
      replacement:
        'an ordinary `fields` query, shaped in the caller — or a stored field that materialises '
        + 'the roll-up. For a deduplicated COUNT the live spelling is unchanged: '
        + '`count_distinct` stays declared',
      reason:
        'The stored half of this retirement is a conversion '
        + '(`dataset-measure-array-string-agg-removed`); this entry is the REQUEST half. '
        + '`QueryAST` is never stored in stack metadata — it is the client SDK builder\'s output '
        + 'and the `POST /data/:object/query` body — so there is no source for the chain to '
        + 'rewrite and callers move their own queries. Both values were declared-but-unlowered '
        + 'on the SQL family: `SqlDriver.mapAggregateFunc` and the Turso '
        + '`RemoteTransport.aggregate` compile five functions and refuse the rest, so a caller '
        + 'following the schema against a SQL datasource got a refusal, not an array. They did '
        + 'run on `driver-mongodb` and on the engine\'s in-memory fallback, which is what makes '
        + 'this the one narrowing in the batch that removes reachable behaviour: an aggregation '
        + 'that worked on one backend and failed on another is exactly the unpredictability the '
        + 'ruling ended, and #5499 has both of those backends frozen. `count_distinct` was '
        + 'deliberately NOT retired with them (maintainer, 2026-08-07) — it takes ADR-0049\'s '
        + 'enforce leg, and its SQL lowering is a separate drivers-side card. ADR-0049, #6188.',
      acceptanceCriteria:
        'No caller sends `array_agg` or `string_agg` in `aggregations[].function`; list-style '
        + 'roll-ups are assembled by the caller from an ordinary `fields` query, or materialised '
        + 'as a stored field. A query still carrying either value fails to parse with the '
        + 'removal prescription naming it, and authoring it is a `tsc` error at the call site; '
        + '`count_distinct` continues to parse and is unaffected.',
    },
    {
      id: 'query-cursor-retired',
      surface: 'data.query.cursor',
      replacement:
        'a `where` predicate on the sort key — `where: { created_at: { $gt: last.created_at } }` '
        + 'with the matching `orderBy` (the documented manual-keyset pattern)',
      reason:
        'The `cursor` key promised keyset pagination and no driver implemented it: the cursor '
        + 'was accepted and ignored, so every page came back identical — a caller looping '
        + '"until hasMore is false" never terminates. Worse than inert, it had a shipped public '
        + 'producer (`QueryBuilder.cursor()`, removed with the key). The caller-built '
        + '`Record<string, unknown>` shape also leaks sort/storage detail and squats on the '
        + 'reserved REST parameter set; a first-class cursor, if ever designed, will be a '
        + 'response-minted opaque token — a different API, so keeping this one preserved a '
        + 'wrong design rather than a roadmap. A REQUEST surface, never stored; nothing to '
        + 'rewrite. ADR-0049 / ADR-0078, #4286.',
      acceptanceCriteria:
        'No caller sends `cursor` and no SDK call site uses `QueryBuilder.cursor()`; deep '
        + 'pagination expresses the keyset as a `where` predicate on the sort key. A query '
        + 'still carrying `cursor` fails to parse with the removal prescription, and authoring '
        + 'it is a `tsc` error.',
    },
    {
      id: 'query-distinct-retired',
      surface: 'data.query.distinct',
      replacement:
        '`groupBy` for unique combinations; the `count_distinct` aggregation for deduplicated '
        + "counts; the SQL/memory drivers' `distinct(object, field)` door for one column's values",
      reason:
        'The `distinct` flag promised SELECT DISTINCT and no driver ever rendered it — but it '
        + 'was MIS-WIRED rather than merely dead (the harsher ADR-0078 class): the REST list '
        + 'path treated a distinct query as not countable and silently degraded '
        + '`total`/`hasMore` to a page-local estimate, so the caller got duplicate rows AND '
        + 'worse pagination metadata, and a side effect that "confirmed" the flag was doing '
        + 'something. It had a shipped public producer (`QueryBuilder.distinct()`, removed with '
        + 'the key). The count suppression is deleted in the same change — `total` is truthful '
        + 'for those queries again. A REQUEST surface, never stored; nothing to rewrite. '
        + 'ADR-0049 / ADR-0078, #4286.',
      acceptanceCriteria:
        'No caller sends `distinct` and no SDK call site uses `QueryBuilder.distinct()`; '
        + 'deduplication goes through `groupBy` / `count_distinct` / the drivers\' `distinct()` '
        + 'door. A query still carrying the key fails to parse with the removal prescription, '
        + 'and the REST list response reports a real `total` for queries that used to send it.',
    },
    {
      id: 'query-field-node-object-form-retired',
      surface: 'data.query.fields',
      replacement: "expand (`expand: { owner: { object: 'user', fields: ['name'] } }`), or a dotted path for a single related column (`fields: ['owner.name']`)",
      reason:
        'The `FieldNode` union declared a nested-select object form `{ field, fields, alias }` that '
        + 'was inert end to end: no producer emitted it, and no consumer read `.fields` or `.alias` '
        + '— objectql\'s formula projection and known-field filters, driver-sql\'s `select()` and '
        + 'driver-memory\'s projection all treat the list as `string[]`, driver-mongodb keyed its '
        + 'projection with the entry itself, and the REST ingress stringified it. Nested selection '
        + 'is `expand`, which the engine resolves via batch `$in` queries. This is a REQUEST '
        + 'surface — `QueryAST` is never stored in stack metadata (no view, dataset or report '
        + 'authors one), so there is no source for the chain to rewrite: the schema narrows to '
        + '`z.string()` and callers move their own select lists. ADR-0049 / ADR-0078, #4196.',
      acceptanceCriteria:
        'No caller puts an object in `fields[]`; related records are read through `expand` and '
        + 'single related columns through dotted paths. A `fields` entry that is not a string '
        + 'fails to parse with the removal prescription, and the list/query/export routes answer '
        + '400 INVALID_FIELD naming the retired form instead of the field `"[object Object]"`.',
    },
    {
      id: 'query-joins-retired',
      surface: 'data.query.joins',
      replacement:
        "expand (`expand: { owner: { object: 'user', fields: ['name'] } }`), or a dotted "
        + "`fields` path for a single related column (`fields: ['owner.name']`)",
      reason:
        'The `joins` array was declared-but-inert: no engine or driver read `query.joins` '
        + 'anywhere on the query path, so a query carrying it behaved exactly as if the key were '
        + 'absent — while the name squatted on the reserved REST parameter set. Related-record '
        + 'retrieval already has a live spelling (`expand`, resolved by the engine via batch '
        + '`$in` queries), so the removal deletes the second, broken spelling rather than the '
        + 'capability, and the orphaned `JoinNode`/`JoinType`/`JoinStrategy` cluster goes with '
        + 'the key. A REQUEST surface — `QueryAST` is never stored in stack metadata — so there '
        + 'is no source for the chain to rewrite; callers move their own queries. '
        + 'ADR-0049 / ADR-0078, #4286.',
      acceptanceCriteria:
        'No caller sends `joins`; related records are read through `expand` and single related '
        + 'columns through dotted `fields` paths. A query that still carries `joins` fails to '
        + 'parse with the removal prescription (even as an empty array), and authoring it is a '
        + '`tsc` error at the call site.',
    },
    {
      id: 'query-window-functions-retired',
      surface: 'data.query.windowFunctions',
      replacement:
        '`aggregations` + `groupBy` for request-level analytics; '
        + '`SqlDriver.findWithWindowFunctions(object, query)` for embedders on a SQL datasource',
      reason:
        'The `windowFunctions` array was declared-but-inert on the query path: `find()` never '
        + 'applied a window function, so every OVER clause a caller declared was silently '
        + 'dropped. The capability only ever ran behind `SqlDriver.findWithWindowFunctions()`, '
        + 'a driver-level door that is not on the `IDataDriver` contract and whose flat input '
        + 'shape (`{ function, alias, partitionBy?, orderBy? }`) the spec vocabulary never '
        + 'matched — `WindowFunctionNodeSchema` declared `field`/`over`/`frame` members the door '
        + 'never read, so that cluster is removed with the key rather than left as a false '
        + 'affordance. A REQUEST surface, never stored; no source to rewrite. '
        + 'ADR-0049 / ADR-0078, #4286.',
      acceptanceCriteria:
        'No caller sends `windowFunctions` in a query; request-level analytics use '
        + '`aggregations` + `groupBy`, and embedders needing OVER-clause SQL call the SQL '
        + "driver's `findWithWindowFunctions` door directly. A query that still carries the key "
        + 'fails to parse with the removal prescription naming that door.',
    },
    {
      id: 'record-details-sections-object-form',
      surface: 'ui.RecordDetailsProps.sections (the `record:details` page component)',
      replacement:
        'an OBJECT array — `sections: [{ label, columns, fields: [...] }]` — replacing the '
        + 'string-ID list; `label` gives the heading, `columns` its grid width, `name` makes the '
        + 'heading translatable, and the new sibling `hideFields` omits named fields from the body',
      reason:
        '`record:details` declared `sections` as a list of section IDs — `["overview", '
        + '"financials"]` — a shape nothing produced and nothing consumed, while every real page '
        + 'authored the object form. This is authorable metadata on the publish/parse path, so it '
        + 'is the D2 class exactly; it is registered as a SEMANTIC step rather than a mechanical '
        + 'conversion because a string ID carries no field list and the chain cannot invent one — '
        + 'only the author knows which fields the section named `overview` was meant to render. '
        + 'The measurement that made the type change safe is also what makes the prescription '
        + 'unambiguous: the ID-list form had zero read paths and zero producers. objectui\'s '
        + '`RecordDetailsRenderer` maps every entry as an object (`s.name` / `s.label` / `s.title` '
        + '/ `s.fields`) with no string branch at all — a string entry spreads into a character '
        + 'map and renders nothing; `@object-ui/types`\' `RecordDetailsComponentProps` mirror '
        + 'already declared `Array<{ name?, label?, fields, ... }>`; the Studio block designer can '
        + 'only author `{ label, columns, fields }`; `packages/lint` has modelled it as '
        + '`nestedSections` all along; and every page in this repo — three showcase pages plus the '
        + '`sys_user` platform page — authors the object form. So the break lands only on stored '
        + 'metadata written against a declaration nothing ever honoured, and it lands at publish '
        + 'time rather than rewriting data at rest. The same change DECLARED `hideFields`, which '
        + 'the `sys_user` platform page had been authoring undeclared. Registered by the #6350 '
        + 'stock reconciliation: #5611 predates the #6148 completeness gate, so nothing asked it '
        + 'what it had done about the ledger, and the sibling key on the same def — '
        + '`ui/RecordDetailsProps:layout`, retired by #6350\'s neighbour — carries a tombstone '
        + 'while this face carried none. ADR-0087, #5611 (backfilled #6350).',
      acceptanceCriteria:
        'Every `record:details` component in authored metadata spells `sections` as an object '
        + 'array: each entry names the fields it renders (`fields: [...]`), optionally with '
        + '`label` / `name` / `columns`. `objectstack validate` passes and each detail page '
        + 'renders the same sections, in the same order, with the same fields as before the '
        + 'upgrade — a page whose sections silently render EMPTY is the signature of an ID list '
        + 'left in place. A section that existed only as an ID, with no field list recoverable '
        + 'from the page it belonged to, is a judgement for the author: name the fields it was '
        + 'meant to show, or delete the entry. Fields previously hidden by a convention outside '
        + 'the schema move onto the declared `hideFields`.',
    },
    {
      id: 'rest-server-openapi31-block-removed',
      surface: 'restServer.openApi31',
      replacement:
        '(removed — no replacement key exists. Delete the key; for a real outbound webhook use '
        + '`Webhook` from `@objectstack/spec/automation`. Config-driven OpenAPI 3.1 '
        + 'webhooks/callbacks documentation returns, if ever, via the enforce route of ADR-0049 '
        + 'through a new ADR)',
      reason:
        'The `openApi31` block (`webhooks` / `callbacks` / `jsonSchemaDialect` / '
        + '`pathItemReferences`, typed by `OpenApi31ExtensionsSchema` with '
        + '`OpenApiWebhookEventSchema` and `CallbackSchema` under it) promised OpenAPI 3.1 '
        + "document synthesis nothing delivered: the REST server's `normalizeConfig` forwards "
        + 'only `api`/`crud`/`metadata`/`batch`/`routes`, and the served /openapi.json is the '
        + 'pre-generated @objectstack/spec contract enriched with the live server URL and the '
        + 'registered objects — a webhook declared here never appeared in any served document '
        + '(ADR-0049; the #3197 connector-webhook shape one layer up). There is no behaviour '
        + 'to preserve and nothing stored to rewrite: `RestServerConfig` is plugin TS '
        + 'configuration (REST plugin constructor / `plugin-hono-server` `restConfig`), never '
        + "a `sys_metadata` shape — the stack tree's `api` block declares only its four "
        + 'scoping/auth knobs. The three schemas are removed with the key (zero import-level '
        + 'consumers in objectstack / cloud / objectui); the key itself is tombstoned because '
        + 'the schema is not `.strict()` and a plain delete would strip it silently. #4579.',
      acceptanceCriteria:
        'No `RestServerConfig` value passed to the REST plugin (or `plugin-hono-server` '
        + '`restConfig`) carries `openApi31` — a config that includes it now fails the parse '
        + 'with the retirement prescription instead of being silently stripped. No code '
        + 'imports `OpenApi31Extensions(Schema)`, `Callback(Schema)` or '
        + '`OpenApiWebhookEvent(Schema)` from `@objectstack/spec/api` (TS2305 after upgrade). '
        + 'The served /openapi.json is byte-identical before and after — the block never '
        + 'reached it.',
    },
    {
      id: 'runtime-httpserver-wrapper-retired',
      surface: 'runtime.HttpServer (the exported delegating wrapper class)',
      replacement:
        'register an `IHttpServer` ADAPTER INSTANCE directly as the `http.server` service — '
        + '`HonoHttpServer` or whatever adapter the host already builds — instead of wrapping one',
      reason:
        '`@objectstack/runtime` exported an `HttpServer` class that took an `IHttpServer` in its '
        + 'constructor, declared `implements IHttpServer`, and forwarded only the contract\'s '
        + 'REQUIRED members (`get` / `post` / `put` / `delete` / `patch` / `use` / `listen` / '
        + '`close`). It forwarded none of the OPTIONAL ones — `getPort?()`, `getRawApp?()`, '
        + '`setFallbackHandler?()`. `packages/spec/src/contracts/http-server.ts` instructs '
        + 'consumers to feature-detect exactly those members with `typeof server.X === '
        + '"function"` and to degrade when absent, so wrapping a capable adapter made every '
        + 'probe answer false and the capability vanish with the adapter underneath providing it '
        + 'the whole time. The sharpest consequence is worth writing down before anyone reaches '
        + 'for a wrapper of the same shape: a host that wrapped `HonoHttpServer` and registered '
        + 'the wrapper as `http.server` would answer 404 to every endpoint its metadata declared, '
        + 'because `setFallbackHandler` — since #5111 the ONLY entry path for declarative `apis:` '
        + 'endpoints — was never forwarded. This is a TS/API contract surface: an HTTP server '
        + 'adapter is CODE, never stack metadata, so there is no authored source for the chain to '
        + 'rewrite and deliberately no schema tombstone — nothing ever ran an adapter through a '
        + '`.parse()`. That is precisely why this entry must exist: for an untyped JS host the '
        + 'ledger is the only notification channel there is, and for a typed one tsc reports at '
        + 'the construction site. Same disposition, and the same reason, as '
        + '`storage-service-list-retired` (#5540) and `data-driver-find-stream-retired` (#4484). '
        + 'Registered by the #6350 stock reconciliation, not by the original change: #5122 landed '
        + 'before the #6148 completeness gate existed, so nothing ever asked it what it had done '
        + 'about the ledger. ADR-0049 / ADR-0087, #5122 (backfilled #6350).',
      acceptanceCriteria:
        'No code constructs `new HttpServer(...)` from `@objectstack/runtime`, and no import of '
        + 'the name resolves — the export is gone, so a typed caller fails to compile at the '
        + 'construction site. A host that was wrapping an adapter registers the ADAPTER INSTANCE '
        + 'as `http.server` instead, and then proves the capability came back: `getPort()` returns '
        + 'the real bound port after `listen(0)`, `getRawApp()` returns the framework-native app, '
        + 'and a declarative `apis:` endpoint declared in metadata answers its route rather than '
        + '404 — the last of which is the failure a wrapper produced silently. An adapter that '
        + 'genuinely needs to intercept calls implements `IHttpServer` in full, forwarding the '
        + 'optional members too, rather than declaring `implements` and dropping them.',
    },
    {
      id: 'sharing-execution-context-retired',
      surface:
        '@objectstack/spec: the exported type `SharingExecutionContext` '
        + '(`contracts/sharing-service`), and its re-export from '
        + '@objectstack/plugin-sharing — the six-field context shape '
        + '(`userId` / `tenantId` / `positions` / `permissions` / `systemPermissions` / '
        + '`isSystem`) that sharing, approval and report enforcement signatures used to name',
      replacement:
        '`ExecutionContext` from `@objectstack/spec` — the complete '
        + '`resolveAuthzContext` envelope the contracts have declared since #6523. Every one '
        + 'of the retired type\'s six fields exists on it under the same name and type, so a '
        + 'value that satisfied the old type already satisfies the envelope: only the '
        + 'annotation is rewritten, never the value',
      reason:
        'ADR-0049 enforce-or-remove, completing the #6206 ruling (2026-08-07: enforcement '
        + 'adjudicates on the WHOLE envelope, never a per-site subset). This type was the '
        + 'declared context parameter of 36 signatures across three contracts — '
        + '`ISharingService` / `ISharingRuleService`, `IApprovalService`, `IReportService` — '
        + 'and it omitted four fields those gates need: `accessible_org_ids` (under the '
        + '`group` tenancy posture this IS the Layer 0 wall, ADR-0105 D2), `org_user_ids`, '
        + '`posture` (ADR-0095 D2) and `tabPermissions`. Its damage ran in the MIRROR '
        + 'direction of the share-link twin (#6430 / PR #6511): nothing trimmed the VALUES — '
        + "the engine middleware always handed the whole context down — it was the declared "
        + 'TYPE that was narrow, so an implementation could not READ what it had been given '
        + 'without casting out of its own contract (`const posture = (context as any).posture` '
        + "in plugin-approvals' privileged-override gate). #6523 / PR #7068 converged the "
        + 'contracts, PR #7140 and PR #7206 re-annotated the four implementations, and this '
        + 'card removes the now-unreferenced declaration (#7070, #7218). '
        + 'Why this needs a ledger entry despite nothing in-repo referencing it: it is the '
        + '`export-field-meta-constraints-retired` / `hook-context-session-roles-retired` '
        + 'disposition — a PUBLISHED TypeScript surface with no spec schema, so there is no '
        + '`retiredKey()` tombstone and no parse rejection that could carry the prescription, '
        + 'and the ledger is the only channel that reaches an upgrader. '
        + 'Why D3 semantic and not a D2 conversion: nothing authored or stored changes shape. '
        + 'The name is only ever spelled inside a consumer\'s own TypeScript, so no '
        + '`objectstack migrate meta` transform can reach it, and no `sys_metadata` row '
        + 'carries it. ADR-0049 / ADR-0087, #7218.',
      acceptanceCriteria:
        'No source of yours imports `SharingExecutionContext` from `@objectstack/spec` or '
        + '`@objectstack/plugin-sharing`; each such import becomes `ExecutionContext` from '
        + '`@objectstack/spec` and the build is green. tsc IS a sufficient detector here, '
        + 'unlike the optional-key retirements at this step: the name is gone outright, so '
        + 'every remaining reference is a hard resolution error rather than a silent '
        + '`undefined`. ⚠️ Then check the direction tsc CANNOT see: widening an annotation '
        + 'never rejects a value, so an enforcement path that only ever received a hand-built '
        + 'six-field object still compiles and still under-adjudicates. Confirm each caller '
        + 'passes the context it was HANDED, unchanged, rather than a literal it assembled — '
        + 'and that any gate of yours reading `posture`, `accessible_org_ids`, `org_user_ids` '
        + 'or `tabPermissions` now reads them declared, with no `as any` in the path.',
    },
    {
      id: 'sharing-rule-recipient-reconcile',
      surface:
        'security.sharingRule.sharedWith.type `group` / `guest`, and owner-type rules '
        + '(`type: owner` + `ownedBy`)',
      replacement:
        '`group` → `team` (the enforced runtime vocabulary); `guest` → delete the rule and expose '
        + 'the records through a public form or a share link; `type: owner` → rewrite as a '
        + '`type: criteria` rule. `business_unit` is newly authorable for the single-unit case',
      reason:
        'The authoring `ShareRecipientType` enum had drifted behind both the ADR-0090 D3 rename '
        + 'and the enforced runtime, in both directions at once. It still offered the pre-rename '
        + '`group`, which the seed path silently SKIPPED, while omitting two recipients the '
        + 'runtime and bootstrap already enforced (`team` via `sys_team` / `sys_team_member`, and '
        + '`business_unit`). It also offered `guest`, which had no runtime recipient mapping at '
        + 'all. Each of those is a rule that validated and then materialised nothing — the '
        + 'ADR-0078 shape, and on a SECURITY surface, where the failure is silent under-sharing: '
        + 'the author sees a valid rule and believes a set of people can reach the records, and '
        + 'no error ever contradicts them. Owner-type rules go for a different and sharper '
        + 'reason: they depend on live team / position membership, which the static materialiser '
        + 'cannot track, so they could not be made to work by fixing a name. They return as an '
        + 'enforced form only if membership-reactive re-materialisation is designed. This is a '
        + 'semantic entry rather than a mechanical conversion because only one of the three '
        + 'rewrites is a rename: `group` → `team` is mechanical, but `guest` and `type: owner` '
        + 'have no target — the author has to decide who was actually meant to reach those '
        + 'records and say so in a form the runtime enforces, and a transform that guessed would '
        + 'be inventing an access grant. After this change every authorable recipient and rule '
        + 'type on the SharingRule surface is enforced; the `queue` recipient stays '
        + 'runtime-reserved and deliberately non-authorable (there is no `sys_queue` yet). Note '
        + 'the two neighbouring conversions cover DIFFERENT faces of this schema and not this '
        + 'one: `sharing-recipient-role-to-position` is the ADR-0090 role → position rename and '
        + '`sharing-rule-access-level-full-to-edit` is the access-level vocabulary. Registered by '
        + 'the #6350 stock reconciliation. ADR-0078 / ADR-0090 D3 / ADR-0087, #1878 (backfilled '
        + '#6350).',
      acceptanceCriteria:
        'No sharing rule names `group` or `guest`, and none carries `type: owner`; stale '
        + 'definitions now FAIL parse with the valid options listed, so the sweep is "fix until '
        + 'nothing raises". ⚠️ Parsing clean is the weaker half — verify the SHARES, because a '
        + 'rule that was silently materialising nothing looked exactly like one that worked. For '
        + 'every rule that named `group`, confirm the `sys_team` it now resolves to has the '
        + 'membership you expected, and that records reach the people the rule was written for. '
        + 'Each former `guest` rule needs an explicit decision about anonymous access — a public '
        + 'form grant or a share link, or knowingly no access at all — and each former owner-type '
        + 'rule needs a `criteria` predicate that names the same population, checked against a '
        + 'representative record. Where a single business unit was meant, use `business_unit`; '
        + '`unit_and_subordinates` is the subtree and grants strictly more.',
    },
    {
      id: 'sort-node-direction-rejected',
      surface: 'data.query.orderBy[].direction (SortNode)',
      replacement:
        '`order` — `orderBy: [{ field: "updated_at", order: "desc" }]`. One word, same values '
        + '(`asc` / `desc`)',
      reason:
        '`SortNodeSchema` was a plain `z.object`, so zod\'s default `.strip` applied and a sort '
        + 'node spelling its direction `direction` lost the key silently. Measured on `main` '
        + 'before the change: `SortNodeSchema.parse({ field: "updated_at", direction: "desc" })` '
        + 'returned `{ field: "updated_at", order: "asc" }` — the key discarded and `order` '
        + 'falling back to its `asc` default, so the sort ran in the OPPOSITE direction and the '
        + 'request succeeded. Paired with `limit`, which is how a caller asks for "the latest N", '
        + 'that is not a reordered page but a DIFFERENT SET OF ROWS, returned under an ordinary '
        + '200 with nothing in the response to distinguish it from the answer that was asked for. '
        + '`direction` is not a typo: it is the live vocabulary of a neighbouring contract, '
        + '`IReportService.orderBy`, and `plugin-auth/objectql-adapter.ts` already translated '
        + 'between the two by hand — a translation known to be necessary and enforced nowhere, '
        + 'the ADR-0049 shape. Both doors closed in one change: `SortNodeSchema` is now a '
        + '`strictObject` carrying `aliases: { direction: "order" }`, and `normalizeSortNodes` '
        + 'in `metadata-protocol` refuses `{ field, direction }` with `400 INVALID_SORT`. The '
        + 'alias is deliberate rather than left to the edit-distance fallback, because no edit '
        + 'distance bridges `direction` → `order` and a bare "unrecognized key" would leave the '
        + 'caller exactly where the silent strip did. This is registered as a semantic entry '
        + 'rather than a mechanical conversion for one reason worth stating: the rewrite itself '
        + 'is trivially mechanical, but a stored `direction: "asc"` is ambiguous evidence — the '
        + 'author may have written it meaning ascending and been silently GIVEN ascending, so '
        + 'the visible behaviour never contradicted them, and only they can say whether the '
        + 'sort they have been reading was the sort they asked for. Registered by the #6350 stock '
        + 'reconciliation: the in-code alias tombstone shipped with #4721, but the ledger half '
        + 'never did, and a retirement needs both — the tombstone is the proof the removal was '
        + 'declared, the ledger entry is what `spec-changes.json`, the upgrade guide and '
        + '`os migrate meta` project to consumers. ADR-0049 / ADR-0087, #4721 (backfilled #6350).',
      acceptanceCriteria:
        'No authored `orderBy` entry — in metadata, in a saved view\'s `sort[]`, or in a REST / '
        + 'RPC request body — spells the key `direction`. The upgrade\'s own verify loop is that '
        + 'the failure is now LOUD: a stale `direction` raises a named parse error (or `400 '
        + 'INVALID_SORT` at ingress) quoting `order`, so a sweep is "fix until nothing raises" '
        + 'rather than a search. ⚠️ Check the RESULTS, not just the parse: every list, report and '
        + 'paged query that carried `direction: "desc"` has been silently serving ASCENDING order '
        + 'and, wherever it was paired with `limit`, a different set of rows. After the rename '
        + 'those pages change what they return — that is the defect being corrected, not a '
        + 'regression, and any downstream expectation baked against the old output has to be '
        + 're-read rather than restored.',
    },
    {
      id: 'spec-type-alias-input-suffix-retired',
      // Plain text, no markdown: build-upgrade-guide.ts renders this field inside a
      // code span AND inside a table cell, so backticks here break both.
      surface:
        'type alias: the 102 XInput names of @objectstack/spec '
        + '(ConnectorInput, AppInput, PageInput, ActionInput, ServiceObjectInput, '
        + 'ExecutionContextInput, TaskInput, … — 52 files across api/ automation/ data/ '
        + 'identity/ integration/ kernel/ security/ system/ ui/)',
      replacement:
        'the BARE name. ADR-0122 phase 2 moved the author state onto `X`, which makes `XInput` '
        + 'a character-for-character synonym of it — the permanent synonym D3 forbids. Drop the '
        + '`Input` suffix: `ConnectorInput` -> `Connector`. Symmetrically, a consumer that held '
        + 'a PARSE RESULT under the bare name moves to `XParsed`, which phase 1 (16.x) already '
        + 'declared for every schema whose two shapes differ, so the target name has existed for '
        + 'a release. NINE `*Input` names are NOT retired and need no edit: `ExpressionInput`, '
        + '`CronExpressionInput`, `TemplateExpressionInput` and `PredicateInput` are the bare '
        + 'aliases of their own `…InputSchema`, and `FormFieldInput`, `QueryInput`, `FieldInput`, '
        + '`ObjectStackDefinitionInput` and `NavigationItemInput` are composed (recursive or '
        + '`Partial`-shaped) types no bare alias denotes.',
      reason:
        'This entry exists for the reason `data-driver-find-stream-retired` (#4484), '
        + '`storage-service-list-retired` (#5540) and `actor-user-roles-to-positions` (#6011) '
        + 'exist, and it is the same disposition: the surface is a TYPESCRIPT NAME, never stack '
        + 'metadata, so there is no source for a D2 conversion to rewrite and deliberately no '
        + 'schema tombstone — an `XInput` alias never had a carrier key, never emitted a def, '
        + 'and no `.parse()` ever saw it. Measured and verified rather than assumed: '
        + '`json-schema/`, `json-schema.manifest/` and `authorable-surface/` are BYTE-IDENTICAL '
        + 'across this change, because those generators enumerate runtime `z.ZodType` exports '
        + 'and never read a type alias. So nothing left the published metadata surface and '
        + 'RETIRED_DEFS_BY_MAJOR is deliberately untouched — an entry there would falsely claim '
        + 'the metadata contract shrank. The enforced channel is tsc: the name is gone, so every '
        + 'consumer gets TS2724/TS2305 naming the import. That is loud but MUTE about the '
        + 'replacement — a compile error says `ConnectorInput` does not exist, not that '
        + '`Connector` now means what it meant. The generated upgrade guide is the only channel '
        + 'that carries the second half, which is precisely the #6048 gap ADR-0087 registration '
        + 'exists to close. ⚠️ Deliberately NOT registered alongside it: the 1384 bare aliases '
        + 'the same change FLIPPED from `z.infer` to `z.input`. Those names all still exist and '
        + 'still resolve; what moved is which of a schema\'s two shapes they denote, and only '
        + 'where the two differ (663 of 1384 — the rest are isomorphic and the flip is a no-op '
        + 'there, pinned as such). A consumer holding an authored literal is made MORE correct '
        + 'by it, silently; one holding a parse result gets a tsc error at the first defaulted '
        + 'key it reads. Registering that as a rename would misdescribe it — no name was '
        + 'retired — and the changeset carries its own FROM -> TO for it. ADR-0122 D8/D9, '
        + '#6083 (PR #6279).',
      acceptanceCriteria:
        'No source imports a name ending `Input` from `@objectstack/spec` except the nine listed '
        + 'above: `rg "\\b\\w+Input\\b" --type ts` over consumer code resolves only to those. A '
        + 'literal annotated with a bare spec type compiles while listing ONLY the keys the '
        + 'author means — `const c: Connector = { name, label, type }` type-checks, which it did '
        + 'not in 16.x — and a value read out of `XSchema.parse()` annotated with the bare name '
        + 'no longer compiles at the first defaulted key it reads (TS18048/TS2532), the signal '
        + 'that the annotation should be `XParsed`. `pnpm check:spec-parsed-alias` reports every '
        + 'bare alias as `z.input` and refuses both a bare `z.infer` alias and a reintroduced '
        + '`XInput` synonym.',
    },
    {
      id: 'storage-service-list-retired',
      surface: 'contracts.IStorageService.list',
      replacement:
        'track the keys you wrote (sys_file / file-reference records, queryable through '
        + 'ObjectQL with real pagination) instead of enumerating the bucket — and where no '
        + 'such record exists, the cursor-shaped `list(prefix, { cursor, limit })` this '
        + 'entry reserved, restored in #6781',
      reason:
        '`list(prefix)` was an OPTIONAL contract method documented as "List files in a '
        + 'directory/prefix", and the two shipped adapters answered the same call with two '
        + 'different semantics — both of them silently incomplete. `LocalStorageAdapter.list` '
        + 'was a single-level `readdir`, so a nested key `a/b/c` was invisible under '
        + '`list(\'a\')` (only `a/b` came back), and a subdirectory that `stat` succeeded on '
        + 'was pushed into the result as a file, yielding a `StorageFileInfo` whose `size` is '
        + 'a directory inode and which cannot be downloaded at all. `S3StorageAdapter.list` '
        + 'was RECURSIVE (`ListObjectsV2` matches the whole key) and read neither '
        + '`IsTruncated` nor `ContinuationToken`, so past 1000 objects the "all files" a '
        + 'caller received was the first page, with no signal. One contract method, two '
        + 'dialects, both quietly incomplete — and the first feature that genuinely needed to '
        + 'enumerate a prefix (backup, orphan sweep, migration audit) would have got two '
        + 'different answers on two deployments without an error on either. #5172 was nearly '
        + 'that feature: it planned to drive attachment reclamation off '
        + '`list(EMAIL_ATTACHMENT_KEY_PREFIX)`, found the local adapter could not see one '
        + 'level down, and switched to queue-driven deferred work instead. Nothing consumed '
        + 'it afterwards: the only in-repo call site was the `SwappableStorageService` '
        + 'pass-through (which itself rejects when the active adapter has no `list`), and '
        + 'REST, CLI and the storage routes never called it. Remove was chosen over '
        + 'align-and-tighten (maintainer ruling, 2026-08-05, #5266): aligning would grow a '
        + 'conformance surface nobody walks, while a prefix listing that cannot paginate is '
        + 'the wrong signature to inherit — when a real caller needs enumeration it returns '
        + 'cursor-shaped, `list(prefix, { cursor, limit })`, with adapter-conformance cases '
        + '(nested keys, directory entries, >1000 objects) proving both backends agree. This '
        + 'is a TS/API contract surface — a storage adapter is CODE, never stack metadata — '
        + 'so there is no source for the chain to rewrite, and deliberately no schema '
        + 'tombstone: nothing ever ran an adapter through a `.parse()`, so a prescription '
        + 'there would reach no one. The enforced channel is tsc, and it reports at the call '
        + 'site. Same disposition, and the same reason, as '
        + '`data-driver-find-stream-retired` (#4484). ADR-0049 / ADR-0087, #5540 '
        + '(analysis #5266).',
      acceptanceCriteria:
        'No code calls `storage.list(...)` on the `file-storage` service or on any '
        + '`IStorageService` value. Code that needed "which files are under this prefix" '
        + 'reads the records it wrote — `sys_file` / file-reference rows carry the storage '
        + 'key and page deterministically through ObjectQL — rather than asking the bucket, '
        + 'which is also the only form that stays correct past 1000 objects and across both '
        + 'adapters. An adapter that still IMPLEMENTS `list` keeps compiling (an extra '
        + 'method is not an error on a class) and is simply unreachable through the '
        + 'contract, so deleting it is cleanup that can follow. The break is on the CALLER '
        + 'side: `storage.list(...)` no longer type-checks, and a PROXY typed against '
        + '`IStorageService` that forwards to `inner.list` is exactly such a caller — the '
        + 'one in `@objectstack/service-storage` goes with the adapters (#5541). '
        + '⚠️ AMENDED 2026-08-09 (#6781, maintainer ruling on cloud#1203, option B): the '
        + 'RESERVED route in the paragraph above was taken. `list` exists again on the '
        + 'contract, cursor-shaped — `list(prefix, { cursor, limit })` returning '
        + '`{ items, nextCursor }` — because cloud had two first-party callers this repo '
        + 'could not see when the measurement said "nothing calls it" (tenant attachment '
        + 'reclamation, marketplace snapshot GC). This does NOT un-retire anything and the '
        + 'acceptance criterion above is unchanged for what it actually governs: the '
        + 'single-argument `list(prefix): StorageFileInfo[]` is gone for good, a call written '
        + 'against it still fails to compile, and the two dialects it had are now pinned '
        + 'against each other in `storage-adapter-list.conformance.test.ts` rather than left '
        + 'to diverge. What changed for an upgrader is only the destination: prefer the '
        + 'records you wrote, and reach for the restored member when there are none.',
    },
    {
      id: 'tool-requires-confirmation-retired',
      surface: 'ai.tool.requiresConfirmation',
      replacement:
        'put the operation behind an ACTION and set `ai.requiresConfirmation: true` there — that '
        + 'is the flag the HITL approval queue actually reads, and the only path that stops '
        + 'execution',
      reason:
        '`ToolSchema.requiresConfirmation` accepted `true` and no execution path ever read it: '
        + 'not the LLM tool set (a tool reaches the model as name / description / parameters '
        + 'only), not `ToolRegistry.execute`, not `POST /ai/tools/:name/execute`, and not the MCP '
        + 'bridge, which derives `destructiveHint` from a hardcoded name list. Setting it on a '
        + 'destructive tool produced NO PAUSE. For an ordinary dead property that is untidy; for '
        + 'a SAFETY property it is false compliance, the case ADR-0049 exists for — an author '
        + 'gates a destructive tool, sees the flag accepted, and ships believing a human is in '
        + 'the loop. It is made worse by the near-miss: `action.ai.requiresConfirmation` carries '
        + 'the same name and DOES work, so the mistake reads as correct in review. This is '
        + 'registered as a semantic entry rather than a mechanical conversion because the rewrite '
        + 'is not a rename at all — the replacement lives on a different metadata object at a '
        + 'different layer, and deciding which action should carry the gate (or whether the '
        + 'operation should be an action at all) is a judgement the chain cannot make. Deleting '
        + 'the key mechanically would be the worst possible transform here: it would leave the '
        + 'metadata parsing green while silently completing the removal of a safety gate the '
        + 'author believed was in place. `ToolSchema` was made `.strict()` in the same change, '
        + 'which is load-bearing rather than tidying — removing a key from a non-strict schema '
        + 'swaps one silent no-op for another, so the retired key now REJECTS and the parse error '
        + 'carries the prescription, that being the one channel every consumer bumping '
        + '`@objectstack/spec` is guaranteed to hit. Registered by the #6350 stock '
        + 'reconciliation: the `retiredKey()` tombstone shipped with #3715 and still stands in '
        + '`ai/tool.zod.ts`, but the ledger half never did. A retirement needs both — the '
        + 'tombstone is the proof the removal was declared, this entry is what `spec-changes.json`'
        + ', the upgrade guide and `os migrate meta` project to consumers. ADR-0033 §2 / '
        + 'ADR-0049 / ADR-0087, #3715 (backfilled #6350).',
      acceptanceCriteria:
        'No tool definition carries `requiresConfirmation`; the key now raises a located parse '
        + 'error naming the replacement, so the sweep is "fix until nothing raises". ⚠️ The '
        + 'load-bearing half is what happens NEXT, and no gate can check it for you: for every '
        + 'tool that carried the flag, decide whether that operation genuinely needs a human in '
        + 'the loop. If it does, move it behind an action carrying `ai.requiresConfirmation: '
        + 'true` and prove the pause exists — invoke it and observe the approval queue hold it, '
        + 'rather than assuming the declaration. If it does not, delete the key knowingly. '
        + 'Deleting it without that decision leaves exactly the state the retirement exists to '
        + 'end: a destructive tool nobody is approving, now without even the false flag to show '
        + 'that somebody once meant to.',
    },
    {
      id: 'ui-interaction-config-family-retired',
      surface:
        'ui.touchInteraction / ui.gestureConfig / ui.dndConfig / ui.keyboardNavigationConfig '
        + '/ ui.componentAnimation / ui.motionConfig / ui.pageTransition / ui.offlineConfig '
        + '(the whole export surface of ui/touch.zod.ts, ui/dnd.zod.ts, ui/keyboard.zod.ts, '
        + 'ui/animation.zod.ts and ui/offline.zod.ts — 32 defs, 64 exported names)',
      replacement:
        '(removed — there is no replacement key, because there was never a key. Touch targets, '
        + 'drag-and-drop, focus management, keyboard shortcuts and motion are RENDERER BUILT-IN '
        + 'behaviour: the component library decides them, not a per-page metadata author. '
        + 'Offline is a platform capability, and its vocabulary belongs on the sync engine that '
        + 'owns the queue, the conflict policy and the cache — none of which exists yet. Delete '
        + 'the import and the value. Whichever of these earns real product pull returns WITH its '
        + 'own vocabulary and its executor, the #4910 way, not by un-retiring a declaration)',
      reason:
        'Five `@objectstack/spec/ui` modules declared a full interaction-configuration '
        + 'vocabulary — 22 `z.object` sites across touch/gesture, drag-and-drop, '
        + 'focus/keyboard, animation/motion and offline/sync — and NOTHING in the protocol '
        + 'carried them. This is the ADR-0049 false-compliance shape in its most inviting form '
        + 'for an AI author (ADR-0033), and worse than the ordinary declared-but-unread defect: '
        + '`authorable-surface.json` listed 109 keys under these defs and '
        + '`content/docs/references/ui/{touch,dnd,keyboard,animation,offline}.mdx` rendered them '
        + 'as authoring tables, so the published documentation advertised a vocabulary with no '
        + 'carrier key anywhere. An author following `dnd.mdx` and writing a `dnd:` block onto a '
        + 'page component was rejected by `PageComponentSchema` for an unrecognized key — the '
        + 'docs and the schema disagreeing about the platform (Prime Directive #10). Three '
        + 'independent measurements, each with its controls passing in the same run: (1) no '
        + 'module under `packages/spec/src` imported any of the five except the `ui/index.ts` '
        + 'barrel, so no schema declared a carrier key; (2) a BFS over the in-memory Zod graph '
        + 'from all 24 metadata-type roots plus `defineStack`\'s `ObjectStackSchema` (25 roots, '
        + '4742 nodes) reached none of the 21 named object shapes, while `PageSchema`, '
        + '`WebhookSchema` and `StateMachineSchema` all resolved `direct` and a synthetic '
        + 'carrier flipped all 21 — so unreachability was a fact about the graph, not a broken '
        + 'walker; (3) zero `.parse()` / `.safeParse()` in objectstack, objectui or cloud '
        + 'outside these modules\' own unit tests. objectui holds TYPE re-exports and parity '
        + 'ratchets, never validators, and says so (#2561). The 2026-08-04 ruling weighed '
        + 'wiring a carrier key (option B) and rejected it: that is a feature with a renderer '
        + 'behind it, not ledger clean-up. It also weighed tightening the shapes to '
        + '`strictObject` and rejected that explicitly — strictness is a property of a PARSE and '
        + 'there is no parse, so it would spend a breaking change to leave "a precisely '
        + 'validated dead slot, the more convincing lie" (#4583). Because there was no carrier '
        + 'key there is nothing to tombstone and no `sys_metadata` row or source file for a D2 '
        + 'conversion to rewrite: this entry is the D3 record, the same route 3 as #4834 (kernel '
        + 'plugin-runtime family) and #4938 (`HttpServerConfig`). ⚠️ Not to be confused with '
        + '#5021, which retired the THEME `animation` block — a different file, different defs, '
        + 'and that one did have a carrier key and therefore a tombstone. ADR-0049, #4988.',
      acceptanceCriteria:
        'No code imports any of the 64 retired names from `@objectstack/spec` or '
        + '`@objectstack/spec/ui` — `TouchTargetConfig(Schema)`, `GestureType(Schema)`, '
        + '`SwipeDirection(Schema)`, `SwipeGestureConfig(Schema)`, `PinchGestureConfig(Schema)`, '
        + '`LongPressGestureConfig(Schema)`, `GestureConfig(Schema)`, `TouchInteraction(Schema)`, '
        + '`TransitionPreset(Schema)`, `EasingFunction(Schema)`, `TransitionConfig(Schema)`, '
        + '`AnimationTrigger(Schema)`, `ComponentAnimation(Schema)`, `PageTransition(Schema)`, '
        + '`MotionConfig(Schema)`, `DragHandle(Schema)`, `DropEffect(Schema)`, '
        + '`DragConstraint(Schema)`, `DropZone(Schema)`, `DragItem(Schema)`, `DndConfig(Schema)`, '
        + '`FocusTrapConfig(Schema)`, `KeyboardShortcut(Schema)`, `FocusManagement(Schema)`, '
        + '`KeyboardNavigationConfig(Schema)`, `OfflineStrategy(Schema)`, '
        + '`ConflictResolution(Schema)`, `SyncConfig(Schema)`, `PersistStorage(Schema)`, '
        + '`EvictionPolicy(Schema)`, `OfflineCacheConfig(Schema)`, `OfflineConfig(Schema)` — '
        + 'every one is TS2305 after upgrade, on every public entry (pinned by resolved symbol '
        + 'identity in `ui/interaction-config-retirement.test.ts`). No metadata document needs '
        + 'editing, because none could ever carry one of these blocks: a stack that parsed '
        + 'before parses byte-for-byte the same after. If you consumed the bare '
        + '`ConflictResolution` from `@objectstack/spec/ui` as a TYPE for your own offline code, '
        + 'declare that union locally — it is your client\'s policy, not the platform\'s. '
        + '`@objectstack/spec/integration`\'s `ConnectorConflictResolution` (connector sync) and '
        + '`@objectstack/spec/api`\'s `ConflictResolutionStrategy` (route merge policy) are '
        + 'different concepts and are untouched.',
    },
    {
      id: 'ui-notification-action-embed-config-retired',
      surface: 'ui.notificationAction / ui.embedConfig',
      replacement:
        '(removed — there is no replacement shape, because there was never a key to write '
        + 'either into. Delete the import and the value. Notification presentation is still '
        + 'described by the surviving `NotificationType` / `NotificationSeverity` / '
        + '`NotificationPosition` vocabulary; public access to a form is granted by the LIVE '
        + '`FormView.sharing` block (`SharingConfig`), which is untouched. Notification action '
        + 'buttons as metadata, and iframe embedding, return via the enforce route of ADR-0049 '
        + 'through a new ADR — carrier key and renderer first, vocabulary second)',
      reason:
        'Both shapes were published `@objectstack/spec/ui` vocabulary with NO AUTHORING DOOR. '
        + '#4001 批 14 measured them three ways on 2026-08-03 and this retirement re-ran all '
        + 'three against `origin/main` before removing anything, each with a positive control '
        + 'that passed in the same run: (1) CARRIER — no schema in `packages/spec/src` declared '
        + 'a key of either type (`ui/notification.zod`\'s only non-test importer was the '
        + 'barrel; `ui/sharing.zod`\'s were the barrel and `ui/view.zod.ts`, which names its '
        + 'SIBLING `SharingConfigSchema`), measured by resolving specifiers rather than '
        + 'substring-matching, because the repo holds two `sharing.zod` modules and a substring '
        + 'test miscredits `stack.zod.ts` to the UI one; (2) REACHABILITY — a BFS from the 24 '
        + 'metadata-type roots plus `defineStack`\'s `ObjectStackSchema`, over '
        + '`build-schemas.ts`\'s own walk including its derived-clone bridge, never reached '
        + 'either, while `Page` / `Action` / `DashboardWidget` / `Webhook` and `SharingConfig` '
        + 'itself all resolved `root-graph` in the same run and an injected synthetic carrier '
        + 'flipped both; (3) PARSE — zero `.parse()` in objectstack, cloud or objectui outside '
        + 'their own unit tests. So nobody could author one and nothing ever validated one: '
        + 'the #3950 shape, an exported schema with no consumer read as a capability, and the '
        + 'ADR-0033 trap where an AI author takes `EmbedConfigSchema` in the published bundle '
        + 'as proof the platform serves iframes. Neither is stored metadata and neither has a '
        + 'carrier, so no `sys_metadata` row can hold one and there is no source for the D2 '
        + 'chain to rewrite; this entry is the D3 record. 批 14 deliberately did NOT close them '
        + 'with `.strict()` — strictness is a property of a PARSE, and closing a shape nothing '
        + 'parses buys only "a precisely-validated dead slot, the more convincing lie" (#4583) '
        + '— and filed the disposition as #5015, ruled REMOVE on 2026-08-04. Each was orphaned '
        + 'by an earlier retirement one level up: `NotificationAction` lost its wrappers at '
        + '#4610 (`NotificationSchema` / `NotificationConfigSchema`, the #4535 C3 dual-source '
        + 'cleanup — that retirement\'s published "zero consumers" evidence was later falsified '
        + 'for objectui and is corrected on `ui/notification.zod`\'s tombstone; the removal '
        + 'itself stands, #5781), and `EmbedConfig` lost its key at 17.0.0 when the 2026-06 '
        + 'liveness audit retired `App.embed` (no iframe route ever read it) — that key still '
        + 'stands as a `retiredKey()` tombstone in `app.zod.ts`, so an author who wrote the KEY already '
        + 'meets a prescription; this removes the value shape that outlived it. ⚠️ The '
        + 'retirement is per SCHEMA, not per file: `ui/sharing.zod` KEEPS `SharingConfigSchema`, '
        + 'a live door carried by `FormViewSchema.sharing` and read by `rest-server.ts` to mount '
        + 'the anonymous form routes, and `ui/notification.zod` keeps its three presentation '
        + 'enums. objectui consumed `NotificationActionSchema.shape.variant` as a VOCABULARY '
        + '(never a parse) to pin its own hand-written `NotificationActionButton` interface — '
        + 'which is exactly why "has a consumer" never meant "has an authoring door" here; that '
        + 'pin is adapted objectui-side when it refreshes this dependency. ADR-0049, #5015.',
      acceptanceCriteria:
        'No code imports `NotificationActionSchema`, `NotificationAction`, `EmbedConfigSchema` '
        + 'or `EmbedConfig` from `@objectstack/spec` or `@objectstack/spec/ui` — both are '
        + 'TS2305 after upgrade, on every public entry (pinned by resolved symbol identity in '
        + '`notification-embed-retirement.test.ts`). The same pin asserts the SURVIVORS in the '
        + 'same run, and that half is equally load-bearing: `NotificationTypeSchema` / '
        + '`NotificationSeveritySchema` / `NotificationPositionSchema` and `SharingConfigSchema` '
        + 'must still be exported from `./ui`, and both modules must still load — a retirement '
        + 'that deleted either file would satisfy the absence half while destroying working '
        + 'surface. Nothing regresses at runtime, because nothing ever ran: no notification '
        + 'action was ever parsed from metadata and no iframe route ever read an embed config. '
        + 'Public form sharing is unaffected — `FormView.sharing` still gates the anonymous '
        + 'endpoints on `allowAnonymous` + `publicLink`.',
    },
    {
      id: 'ui-widget-i18n-family-retired',
      surface:
        'ui.widgetManifest / ui.widgetLifecycle / ui.widgetEvent / ui.widgetProperty '
        + '/ ui.widgetSource / ui.i18nObject / ui.pluralRule / ui.numberFormat / ui.dateFormat '
        + '/ ui.localeConfig (the widget-registration vocabulary of ui/widget.zod.ts, and the '
        + 'five doorless shapes of ui/i18n.zod.ts — 10 defs, 26 exported names)',
      replacement:
        '(removed — there is no replacement key, because there was never a key. A custom field '
        + 'widget is still named the same way it always was: `field.widget` is a plain string '
        + 'naming a component the RENDERER has registered, and objectui\'s registry has always '
        + 'carried its own runtime manifest for that (`RuntimeWidgetManifest` / '
        + '`RuntimeWidgetSource` in `@object-ui/types`, objectui#3161 / #4115), which models '
        + 'different keys and never derived from these. For localisation: write the '
        + 'default-language string on `label` / `description` — the framework generates the '
        + 'translation key at registration time from the naming convention — and put '
        + 'translations in translation files, which is the LIVE `system/translation.zod.ts` '
        + 'surface. Widget registration and locale formatting as authorable protocol metadata '
        + 'return via the ENFORCE route of ADR-0049 through a new ADR — the registry / loader / '
        + 'formatter first, the vocabulary second)',
      reason:
        '`ui/widget.zod.ts` published a complete widget-registration vocabulary — a manifest '
        + 'with lifecycle hooks, custom events, configurable properties and an '
        + 'npm/remote/inline implementation-source union — and `ui/i18n.zod.ts` published a '
        + 'structured-label, plural-rule and locale-formatting vocabulary. NOTHING in the '
        + 'protocol carried either. Three independent measurements, re-run on `origin/main` '
        + 'immediately before the removal with their controls passing in the SAME run: (1) no '
        + 'module under `packages/spec/src` imported `widget.zod` at all, and the only imports '
        + 'of `i18n.zod` anywhere name `I18nLabelSchema` / `AriaPropsSchema` (both KEPT), so no '
        + 'schema declared a carrier key — `field.widget` is a `z.string()` naming a registered '
        + 'component and has never referenced `WidgetManifest`; (2) a BFS over the in-memory '
        + 'Zod graph from all 24 metadata-type roots plus `defineStack`\'s `ObjectStackSchema` '
        + 'reached none of them, while `PageSchema` / `ObjectListViewSchema` resolved `direct` '
        + 'in the same run and a synthetic carrier flipped every one of them; (3) zero '
        + '`.parse()` / `.safeParse()` in objectstack, objectui or cloud outside these files\' '
        + 'own unit tests. `NumberFormat` / `DateFormat` DID have a carrier key '
        + '(`LocaleConfig.numberFormat` / `.dateFormat`) but the carrier was itself doorless, '
        + 'so the subtree was `no door` rather than `no gate` and goes whole — leaving the two '
        + 'leaves behind would strand exported schemas with no consumer (#3950). '
        + '`I18nObjectSchema` was additionally superseded by its own file-neighbour: '
        + '`I18nLabelSchema`\'s documentation already says translation keys are generated at '
        + 'registration time and translations live in translation files, and the live '
        + 'translation surface is `system/translation.zod.ts`, which uses none of these shapes. '
        + 'The 2026-08-06 ruling weighed giving them a carrier (option B) and rejected it: that '
        + 'is a feature with a registry and a renderer behind it, not ledger clean-up. '
        + 'Tightening them to `strictObject` was rejected earlier and explicitly (#4001 批 16) '
        + '— strictness is a property of a PARSE and there is no parse, so it would spend a '
        + 'breaking change to leave "a precisely validated dead slot, the more convincing lie" '
        + '(#4583). With no carrier key there is nothing to tombstone and no `sys_metadata` row '
        + 'or source file for a D2 conversion to rewrite: this entry is the D3 record, route 3, '
        + 'the same shape as #4988 (the ui/ interaction config family), #4834 (kernel '
        + 'plugin-runtime family) and #4938 (`HttpServerConfig`). '
        + '⚠️ `WidgetManifest.performance`\'s own `retiredKey()` tombstone (#3896 close-out) is '
        + 'SUBSUMED here, the #4657/#4834 way: it goes with the shape that carried it, which is '
        + 'strictly stronger than the tombstone, because there is no longer a manifest to '
        + 'author the key INTO. '
        + '⚠️ One of the nine widget sites is deliberately NOT retired. '
        + '`FieldWidgetPropsSchema` survives: it is a REACT PROPS CONTRACT rather than '
        + 'authorable metadata (it never appeared in `authorable-surface/` or '
        + '`json-schema.manifest/` — its `onChange` is a `z.function()`), so "zero parse" is its '
        + 'design and not its defect, and it acquired a live cross-repo compile-time consumer '
        + 'one day before 批 16 measured: objectui PR #3289 (2026-08-03) renamed '
        + '`@object-ui/fields`\' validation slot onto the spec\'s `error` with no alias, the '
        + 'form renderer began producing it, and '
        + '`packages/fields/src/__tests__/spec-symbol-batch7.test.ts` pins the shape against '
        + '`import type { FieldWidgetProps } from \'@objectstack/spec/ui\'` as an intentional '
        + 'tripwire. Re-verified on objectui `origin/main` 2026-08-07. ADR-0049, #5055.',
      acceptanceCriteria:
        'No code imports `WidgetManifest(Schema|Parsed)`, `WidgetLifecycle(Schema)`, '
        + '`WidgetEvent(Schema|Parsed)`, `WidgetProperty(Schema|Parsed)`, '
        + '`WidgetSource(Schema|Parsed)`, `I18nObject(Schema)`, `PluralRule(Schema)`, '
        + '`NumberFormat(Schema|Parsed)`, `DateFormat(Schema)` or '
        + '`LocaleConfig(Schema|Parsed)` from `@objectstack/spec` or `@objectstack/spec/ui` — '
        + 'every one is TS2305 after upgrade, on every public entry (pinned by resolved symbol '
        + 'identity in `ui/widget-i18n-retirement.test.ts`). No metadata document needs '
        + 'editing, because none could ever carry one of these shapes: a stack that parsed '
        + 'before parses byte-for-byte the same after, and a `field.widget: "my_picker"` string '
        + 'is untouched. `FieldWidgetProps` / `FieldWidgetPropsSchema` / '
        + '`FieldWidgetPropsParsed`, `I18nLabel(Schema)` and `AriaProps(Schema)` all still '
        + 'resolve on `@objectstack/spec/ui` and are asserted to. ⚠️ objectui needs a companion '
        + 'PR in the same window: `packages/types/src/__tests__/page-nav-misc-spec-parity.test.ts` '
        + 'asserts the spec STILL owns `WidgetManifest` / `WidgetSource` (it is the '
        + '"a workaround should not outlive its reason" half of the objectui#3169 tripwire, '
        + 'designed to go red exactly here), and `packages/types/src/widget.ts`\'s '
        + '"Renamed off the spec\'s `WidgetManifest` name" comments now point at names that no '
        + 'longer exist. Both are prescribed responses to this removal, not collateral damage.',
    },
    {
      id: 'view-filter-rule-value-shaped-by-operator',
      // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
      // code span already, and a nested backtick would close it.
      surface:
        'ui.ViewFilterRule value — the third key of a view filter rule, on every carrier of '
        + 'ViewFilterRuleSchema: ListView.filter, a list view tab filter, Page.filterBy, a '
        + 'related-list component filter and a lookup picker filter. It accepted any declared '
        + 'scalar or array for EVERY operator; the accepted shape is now decided by the rule '
        + 'operator — in / not_in require an array, between requires exactly two bounds, and '
        + 'every other operator is unchanged',
      replacement:
        'an ARRAY for in / not_in (a single value becomes a one-element list: value: "won" '
        + 'becomes value: ["won"]), and a two-element [min, max] array for between. The empty '
        + 'list [] stays legal for in / not_in and keeps its meaning. Nothing else moves: a '
        + 'scalar operator carrying an array, a string operator carrying a number, and a unary '
        + 'operator carrying an ignored value all still parse',
      reason:
        'A publish-time gate catching up to a query-time one, not a new rule. #5869 / PR '
        + '#6209 closed the RUNTIME half: `assertListComparandShapes` '
        + '(@objectstack/objectql, filter-comparand-shape.ts) refuses a lowered '
        + '`{ stage: { $nin: "won" } }` with a named 400 INVALID_FILTER, and before that it '
        + 'was a 500. The authoring surface stayed silent, so the failure was two-stage: the '
        + 'view published cleanly and only broke when someone opened it. That file names this '
        + 'very schema as the reachable authoring source of the defect. The tightening MIRRORS '
        + 'that gate exactly — three constraints, one for one — and deliberately goes no '
        + 'further, because #5685 already ruled on the opposite error: a schema stricter than '
        + 'the runtime "in ways the runtime deliberately allows" was the WRONG side and was '
        + 'widened to match. So `in: []` is still accepted (a declared predicate both drivers '
        + 'implement), `equals: ["a","b"]` is still accepted (it lowers to a deep-equality '
        + 'comparand), and `is_empty: ""` is still accepted (the null predicates take their '
        + 'direction from the operator NAME — convertComparison ignores the value position, '
        + 'and the ObjectUI client deliberately sends a truthy placeholder there). '
        + '⚠️ Metadata AT REST is deliberately NOT rewritten, and there is no D2 conversion. '
        + 'A D2 entry replays a shape the platform once WROTE and renamed; this shape was '
        + 'never written by any first-party producer (every in / not_in rule in this repo, in '
        + 'objectui and in the cloud repo already carries an array — measured) and has never '
        + 'EXECUTED, since it 400s on first render today. Coercing it at load would be the '
        + 'platform guessing intent rather than replaying a rename, and it cannot guess '
        + 'honestly: value: "" would become the predicate [""] (a real filter on the empty '
        + 'string) rather than the "not filled in yet" a console row means, and between: 5 has '
        + 'no defensible second bound at all. The read path does not re-validate stored rows '
        + '(applyConversionsToStoredItem never validates, by its own contract), so no stored '
        + 'view becomes unreadable; what changes is that RE-SAVING such a view is refused at '
        + 'the write gate naming `value`, instead of storing a filter that 400s. '
        + 'ADR-0049 / ADR-0078 / ADR-0112.',
      acceptanceCriteria:
        'Grep your authored views, pages and related-list components for a filter rule whose '
        + 'operator is in, not_in or between (including the alias spellings nin / notIn / '
        + 'notin) and whose value is not an array of the right arity, then wrap or complete '
        + 'it. `os validate` / `os lint` now report each one by path with the operator, the '
        + 'received shape and the corrected shape, so the sweep is mechanical rather than by '
        + 'eye. Two checks are worth doing where it looks unnecessary: a rule reading '
        + '`operator: "in", value: ""` is an UNFINISHED row, not a filter — decide what it was '
        + 'meant to select rather than mechanically rewriting it to [""], which is a real and '
        + 'different predicate. And a view that already carried one of these shapes was never '
        + 'returning filtered rows: it answered 400 INVALID_FILTER on render (#5869), so '
        + 're-check what the view is supposed to show rather than assuming the old result set '
        + 'was correct.',
    },
    {
      id: 'view-management-protocol-retired',
      surface:
        'api.listViews / api.getView / api.createView / api.updateView / api.deleteView '
        + '(the ViewProtocol interface and its ten Request/Response schemas in '
        + 'api/protocol.zod.ts — 10 defs, 25 exported names)',
      replacement:
        'the two view surfaces that are actually routed. For a view\'s STORED definition, the '
        + 'generic metadata methods with `type: \'view\'` — `getMetaItem` / `getMetaItems` / '
        + '`saveMetaItem` / `deleteMetaItem`, served at `/api/v1/meta/view/:name`. For the '
        + 'RESOLVED render-time view, `getUiView` (`GetUiViewRequest` / `GetUiViewResponse`), '
        + 'served at `/api/v1/ui/view/:object/:type`. Neither is addressed by a `viewId`, which '
        + 'is the one thing the retired surface offered and the one thing nothing implemented',
      reason:
        'A complete viewId-addressed CRUD surface — list (with a list/form filter), read, '
        + 'create, patch, delete — with none of the three things a protocol method needs. '
        + 'Measured on origin/main immediately before the removal: no implementation '
        + '(`packages/metadata-protocol/src/protocol.ts` declares no `listViews` / `getView` / '
        + '`createView` / `updateView` / `deleteView`; its only view resolver is `getUiView`), '
        + 'no route (`packages/rest/src/rest-server.ts` never mentions `viewId`, so nothing '
        + 'viewId-addressed is reachable over HTTP at all), and no caller (the only '
        + '`ViewProtocol` mention outside its own file was the services checklist, which '
        + 'already recorded the five as declared-and-unrouted). The look-alike hits a bare-name '
        + 'grep turns up are all different contracts: `metadata-manager.ts`\'s '
        + '`getView(name: string)` is another class, and objectui\'s '
        + '`getView(objectName, viewId)` resolves through `client.meta.getItem(\'view\', …)`, '
        + 'i.e. the metadata route. '
        + 'What makes this worth a removal rather than a note is that the cost is already '
        + 'measured. A declared surface that is name-identical and semantics-adjacent to a real '
        + 'one is an attractive nuisance in every grep, and it mis-directed a decision once: '
        + '#5948\'s issue body AND its 2026-08-07 maintainer ruling both read '
        + '`GetViewResponseSchema` (zero implementations) as the contract of '
        + '`GET /ui/view/:object/:type`, whose declared response is `GetUiViewResponseSchema` — '
        + 'one word apart, 250 lines up. That ruling\'s reasoning happened to survive the '
        + 'mix-up ("nobody can consume `{object, view}` successfully today" was true, though '
        + 'not for the stated reason), which is the luck this removal stops relying on. '
        + 'Route 3: none of the ten was a key on an authorable shape, nothing parsed them, so '
        + 'there is no tombstone and no D2 conversion — RETIRED_DEFS_BY_MAJOR plus this entry '
        + 'are the declaration. If reading and writing ONE view by id becomes a real '
        + 'requirement it returns implementation-first. ADR-0049, ADR-0087, maintainer ruling '
        + '2026-08-07, #6239.',
      acceptanceCriteria:
        'No source imports `ListViewsRequest(Schema)`, `ListViewsResponse(Schema)`, '
        + '`GetViewRequest(Schema)`, `GetViewResponse(Schema)`, `CreateViewRequest(Schema)`, '
        + '`CreateViewResponse(Schema)`, `UpdateViewRequest(Schema)`, '
        + '`UpdateViewResponse(Schema)`, `DeleteViewRequest(Schema)` or '
        + '`DeleteViewResponse(Schema)` from `@objectstack/spec/api`, and no host declares a '
        + '`ViewProtocol` member. Reading and writing views still works end to end through the '
        + 'surfaces that were always the live ones: `GET /api/v1/meta/view/:name` returns the '
        + 'stored definition and `GET /api/v1/ui/view/:object/:type` returns the resolved view, '
        + 'both unchanged by this removal. `GetUiViewRequestSchema` / `GetUiViewResponseSchema` '
        + 'still resolve — they are the shapes #5948 meant.',
    },
    {
      id: 'workflow-service-slot-retired',
      surface:
        "CoreServiceName 'workflow' / IWorkflowService / WorkflowProtocol / "
        + 'discovery routes.workflow / RestApiRouteCategory workflow',
      replacement:
        'the live mechanisms the slot only ever pointed at: `state_machine` validation rules '
        + 'for record state machines, approval flow nodes on the approvals runtime (ADR-0019) '
        + 'for approvals, lifecycle hooks + `record_change` flows (service-automation) for '
        + 'record-triggered automation',
      reason:
        'The workflow slot was declared end to end and implemented nowhere: no code in either '
        + 'repository ever registered or resolved it (ADR-0115 Evidence 5 — the only touches '
        + 'were plugin-dev\'s retired stub probe and the generic discovery walk), no '
        + 'implementation of any WorkflowProtocol method ever existed, and no host ever '
        + 'mounted `/api/v1/workflow` (the pre-#3586 DEFAULT_DISPATCHER_ROUTES listed it among '
        + 'routes that never existed). Every part of it was ADR-0078\'s silently-inert '
        + 'declaration: a CoreServiceName nothing filled, a contract nothing implemented, a '
        + 'protocol nothing served, a discovery route field no builder could truthfully '
        + 'populate. These are TS/API surfaces and a discovery RESPONSE field — never stored '
        + 'in stack metadata, so there is no source for the chain to rewrite; consumers of the '
        + 'deleted types move their imports themselves. ADR-0049 / ADR-0078, #4451.',
      acceptanceCriteria:
        'No import of IWorkflowService, WorkflowProtocol or the Get/WorkflowState/Config/'
        + 'Transition types resolves; no code calls getService(\'workflow\') or reads '
        + 'discovery `routes.workflow` / `services.workflow`; record state machines, '
        + 'approvals and record-triggered automation go through the replacement mechanisms. '
        + 'Discovery output on a default boot is unchanged (the slot was always reported '
        + 'unavailable; now it is simply absent).',
    },
    // </os-generated semantic:17>
  ],
};

/** All migration steps, keyed by the major they migrate into. */
export const MIGRATIONS_BY_MAJOR: Readonly<Record<number, MigrationStep>> = {
  11: step11,
  12: step12,
  13: step13,
  14: step14,
  15: step15,
  16: step16,
  17: step17,
};

/** The majors that have a step, ascending. */
export const MIGRATION_MAJORS: readonly number[] = Object.keys(MIGRATIONS_BY_MAJOR)
  .map(Number)
  .sort((a, b) => a - b);

/**
 * Every authorable key TOMBSTONED at each protocol major, named EXACTLY.
 *
 * One entry per key, spelled `${defKey}:${name}` — the same string
 * `packages/spec/authorable-surface.json` records, minus its `[RETIRED]` mark
 * (`'automation/Event:type'`, `'ui/App:sharing'`). Not a surface path, not a
 * prose clause, not a prefix: the literal key.
 *
 * ## What reads it
 *
 * Two gates in `scripts/build-schemas.ts` (`check:authorable-surface`), and
 * nothing infers an entry for either — the author writes the key down or the
 * gate stays red:
 *
 * - **Check (b)**, the retirement gate: a key that flips live → retired must
 *   appear here, by exact set membership, or the build fails. (Check (b2) is its
 *   inverse: an entry naming a key this build still emits as LIVE is rejected.)
 * - **Check (c)**, the baseline-deletion gate (#4650): the major recorded here
 *   is what starts a tombstone's ~two-major aging clock, so it is also what
 *   eventually lets its `authorable-surface/` line be deleted. Since #5898 —
 *   before that, (c) dated the clock by matching the key's LEAF against the
 *   conversion registry, and took the `Math.min` of the matches.
 *
 * ## Why exact keys, and not the conversion `surface`
 *
 * Check (b) used to satisfy itself by matching the key's LEAF against every
 * `surface` registered in {@link CONVERSIONS_BY_MAJOR} / {@link
 * MIGRATIONS_BY_MAJOR} — `endsWith('.' + name)`, across all majors, ignoring
 * which def the key belonged to. Any unrelated registration ending in the same
 * leaf therefore registered a tombstone for free: measured in #4658, tombstoning
 * `automation/Event:type` passed silently because protocol 11's
 * `flow-node-http-callout-rename` had registered `flow.node.type`. The exposure
 * grew with the vocabulary — `type`, `name`, `config`, `filter`, `schema`,
 * `description` (#5509) are ordinary leaves on hundreds of authorable shapes —
 * so the gate's whole guarantee had lapsed for the most common keys (#4659).
 *
 * A `surface` is deliberately PROSE: it addresses authors in the shape they
 * write metadata (`flow.nodes[].outputSchema`), which no rule can map back onto
 * a def key. So the registration moved here instead of being encoded into the
 * surface — the conversion keeps its prose, and this table carries the machine
 * fact.
 *
 * ## What it does NOT replace
 *
 * The D2 conversion (`src/conversions/registry.ts`) and D3 semantic entry stay
 * the *documentation* channel: `spec-changes.json` (ADR-0087 D4), the generated
 * upgrade guide and `os migrate meta` are projections of those, not of this
 * table. An entry here is the *proof the retirement was declared*; the
 * conversion is the *prescription a consumer follows*. A retirement needs both.
 *
 * ## Historical tombstones: absent, and therefore not deletable
 *
 * Check (b) fires only on a NEW live → retired transition — measured against the
 * committed `authorable-surface.json` baseline, which already records every
 * older tombstone as `[RETIRED]`. The 97 retirements that landed before this
 * table existed therefore never re-trigger it and are deliberately absent: this
 * reads "retirements registered under the exact-key gate", not "every retirement
 * ever".
 *
 * #5898 measured what it would take to backfill them, and neither available
 * source can date a row honestly:
 *
 * - **Leaf-matching the conversion registry** is precisely the inference #4659
 *   removed. It is also demonstrably wrong in both directions on this very data:
 *   of the two rows it dated as aged-out, `data/Index:type` was dated by
 *   `flow.node.type` (an unrelated cluster) and `api/RestApiConfig:requireAuth`
 *   by `api.requireAuth` at major 12 — which is the secure-default FLIP, a
 *   different kind of change to the same surface, not its retirement.
 * - **The git history of `authorable-surface.json`** begins at 17.0.0-rc.0, so
 *   every one of the 97 rows first carries `[RETIRED]` at major 17. That is an
 *   artifact of the baseline file's birth, not archaeology.
 *
 * So the rows stay undeclared, and check (c) is fail-closed about it: a
 * tombstone with no entry here cannot prove its age and its baseline line may
 * not be deleted. Deleting one is a deliberate, reviewable act — establish the
 * true major for that key, add it below, and check (b2) verifies the entry still
 * names a key this build tombstones. Do NOT add a row you cannot date; an
 * estimate written down here reads as a fact to every later gate.
 *
 * ## Lifecycle
 *
 * Entries are permanent. A declared tombstone ages out after ~two majors and its
 * line may then leave `authorable-surface.json` (check (c)); its entry here
 * stays, and then names a key the build no longer emits — the expected steady
 * state, not an error. The one state the gate rejects is an entry naming a key
 * that is still LIVE: a registration nothing consumed, pre-approving a
 * retirement that has not happened.
 *
 * @see scripts/build-schemas.ts — checks (b)/(b2)/(c), the only consumers
 */
export const RETIRED_KEYS_BY_MAJOR: Readonly<Record<number, readonly string[]>> = {
  // The first entries since #4659 built this table (#5552). ONE tombstone
  // produces THREE keys: `transform` is declared on `shared/FieldMapping` and
  // `integration/ConnectorFieldMapping` / `data/ExternalFieldMapping` are
  // `.extend()`s of it, so the retired property is copied into all three walked
  // shapes and `authorable-surface.json` marks each `[RETIRED]` separately.
  // Registered per key, as the gate reads them — nothing radiates from the base.
  17: [
    // One file per entry under `entries/retired-keys/`, concatenated here sorted by
    // entry id by `gen:migration-registry` (#7297). Add an entry by adding a
    // FILE — never by editing between the markers, which is generated.
    // <os-generated retired-key:17>
    // #7481 — the sibling of `api/AuthFeaturesConfig:passkeys`, retired in the same
    // maintainer ruling (2026-08-11) and for the same reason, but with one
    // difference a reader of this table must not lose: what was inert here is the
    // ADVERTISEMENT, not the capability. `AuthPluginConfig.plugins.magicLink` still
    // wires better-auth's magic-link plugin and `/api/v1/auth/magic-link/{send,verify}`
    // still answer — no client just renders anything off the served flag, so the
    // flag alone was the false promise. The prescription says so explicitly rather
    // than reusing its sibling's string.
    //
    // Same response-surface disposition as its sibling: no D2 conversion (nothing
    // authors an `AuthFeaturesConfig`), prescription carried by this tombstone plus
    // the D3 semantic entry `auth-config-unadvertised-reserved-features`.
    'api/AuthFeaturesConfig:magicLink',
    // #7481 — the `/api/v1/auth/config` `features` payload stops advertising the
    // two capabilities no client can act on (maintainer ruling 2026-08-11,
    // declared = enforced: a deployer must not be able to flip a flag that does
    // nothing anywhere). `passkeys` is the emptier of the pair — no login UI reads
    // it AND no better-auth passkey plugin is wired behind it.
    //
    // Registered here but NOT in `src/conversions/registry.ts`, for the same reason
    // as the `api/ListNotifications{Request,Response}:cursor` pair: this is a
    // RESPONSE surface — the server mints it on every `GET /auth/config` and
    // nobody authors or persists an `AuthFeaturesConfig` — so there is no source
    // for `os migrate meta` to rewrite. The prescription reaches consumers as the
    // D3 semantic entry `auth-config-unadvertised-reserved-features` plus this
    // tombstone, the `EnhancedApiError.fieldErrors` disposition.
    //
    // The withdrawal is conditional, not permanent: the flags return in the change
    // that ships the login UI (objectui#4179). Until then the standing record is
    // `PUBLIC_AUTH_FEATURES_NOT_ADVERTISED` in `kernel/public-auth-features.ts`.
    'api/AuthFeaturesConfig:passkeys',
    // #6361 — the notification-inbox pagination key, tombstoned on BOTH halves
    // of `GET /api/v1/notifications` because one capability is never half-
    // deleted (maintainer ruling 2026-08-07, ruled jointly with #6363). Two
    // keys, one prescription: `NOTIFICATIONS_CURSOR_REMOVED` in
    // `api/protocol.zod.ts` is the single string both rejection sites raise.
    //
    // Registered here but NOT in `src/conversions/registry.ts`, and that
    // asymmetry is the point rather than an omission: a D2 conversion rewrites
    // an authored source or a stored `sys_metadata` row, and these two shapes
    // are HTTP-only — nobody authors a `ListNotificationsRequest` and nothing
    // persists one. The prescription reaches consumers as the D3 semantic entry
    // `notification-list-cursor-retired` plus this tombstone, which is the
    // disposition `BatchOptions.validateOnly` and the `AnalyticsQueryRequest`
    // envelope keys already take in this major ("a semantic TODO for API
    // callers rather than a stack conversion").
    'api/ListNotificationsRequest:cursor',
    'api/ListNotificationsResponse:cursor',
    // #6748 — ADR-0049 enforce-or-remove on the action-descriptor capability
    // block. `isAsync` was a second spelling of `supportsPause` with ZERO
    // readers on a fresh three-repo measurement; its sibling took the enforce
    // leg in #6667 and this one takes the remove leg. Descriptors are published
    // from executor TypeScript, not from stack metadata, so the D2 side is a D3
    // `SemanticMigration` (`action-descriptor-is-async-retired`) rather than a
    // MetadataConversion — there is no stored source for `os migrate meta` to
    // rewrite. The `EnhancedApiError.fieldErrors` precedent.
    'automation/ActionDescriptor:isAsync',
    // #6815 — the per-aggregation DISTINCT flag, retired under ADR-0049 by
    // maintainer ruling 2026-08-09. ONE key, and one entry, because
    // `AggregationNodeSchema` is reused BY REFERENCE rather than `.extend()`ed:
    // `QuerySchema.aggregations` and `EngineAggregateOptionsSchema.
    // aggregations` are both `z.array(AggregationNodeSchema)`, so the walked
    // shape has a single `data/AggregationNode` def and the baseline marks one
    // line `[RETIRED]`. Contrast the `shared/FieldMapping:transform` trio in
    // this same table, where two `.extend()`s copied the property into three
    // walked shapes and each needed its own registration.
    //
    // Registered here but NOT in `src/conversions/registry.ts`, for the same
    // reason as the `api/ListNotifications{Request,Response}:cursor` pair:
    // `QueryAST` is a REQUEST surface —
    // the client SDK builder's output and the `POST /data/:object/query` body
    // — never stored in stack metadata, so there is no authored source or
    // `sys_metadata` row for a D2 conversion to rewrite. The prescription
    // reaches consumers as the D3 semantic entry
    // `aggregation-node-distinct-retired` plus this tombstone, which is the
    // disposition every other `data.query.*` retirement in this major already
    // takes (`query-joins-retired` / `query-cursor-retired` /
    // `query-distinct-retired` / `query-window-functions-retired`, #4286).
    'data/AggregationNode:distinct',
    'data/ExternalFieldMapping:transform',
    'integration/ConnectorFieldMapping:transform',
    // #4914 — ADR-0049 enforce-or-remove on the plugin manifest's whole
    // `loading` block (maintainer ruling 2026-08-04). ONE tombstoned key here,
    // because `loading` was the single carrier: every schema underneath it
    // (`PluginLoadingConfig` and the ten members it combined) leaves the
    // published set as a whole-def removal and is registered in
    // `RETIRED_DEFS_BY_MAJOR` below, not as ~27 individual key entries.
    //
    // Registered here but NOT in `src/conversions/registry.ts`, for the reason
    // `automation/ActionDescriptor:isAsync` gives: the conversion chain
    // walks a normalized STACK (`mapCollection(stack, 'objects' | 'views' | …)`)
    // and `applyConversionsToStoredItem` maps a metadata type onto one of those
    // collections. A package manifest is neither — there is no `packages` /
    // `plugins` entry in `PLURAL_TO_SINGULAR`, so a manifest is not a stack
    // collection member and a stored manifest row passes that seam through
    // unchanged. A MetadataConversion here would be a transform with no seam
    // that ever runs. The prescription reaches authors instead through the
    // tombstone at the one place a manifest is parsed with an author present
    // (`os plugin build` → `ManifestSchema.safeParse`, which exits non-zero),
    // and through the D3 semantic entry `plugin-manifest-loading-retired`.
    'kernel/Manifest:loading',
    'shared/FieldMapping:transform',
    // #5775 — the SDUI component-props reconciliation. Three keys on the record
    // picker (`displayField` was the REQUIRED one, and the synonym of the key
    // the renderer actually reads) and the card's second spelling of the
    // composition slot every other container calls `children`.
    'ui/ElementRecordPickerProps:displayField',
    'ui/ElementRecordPickerProps:multiple',
    'ui/ElementRecordPickerProps:searchFields',
    // #6946 — three SDUI page-component props, retired by maintainer ruling
    // 2026-08-09 (decision-inbox round, 「全部接受」): objectui#3829 route (c)
    // for the first two, objectui#3818 for the third. Registered per key, as
    // gate (b) reads them — nothing radiates from a neighbouring key, and this
    // family needs that literally: `ui/PageHeaderProps:actions` and
    // `ui/RecordHighlightsProps:layout` are LIVE keys sharing these leaf names.
    //
    // The first two are the B class — declared here, read NOWHERE in objectui
    // (the header resolves icons per action; the card renders
    // title/bordered/children/footer and has no actions area), and carried in
    // that repo's own `UNPUBLISHED_EXEMPTIONS` map as exactly that.
    'ui/PageCardProps:actions',
    'ui/PageCardProps:body',
    'ui/PageHeaderProps:icon',
    // #6776 — #5775's count was incomplete. The tab strip's visual style is the
    // one prop whose declared spelling collides with the page component's own
    // dispatch key, so `type` could never be authored in a flat or JSX carrier
    // and was skipped unvalidated by `sdui-parser`'s `BASE_PROPS`. Renamed to
    // the `tabStyle` every carrier can express and the renderer already reads.
    'ui/PageTabsProps:type',
    // The third is a sharper shape: `layout` IS read, but only against
    // `inline`/`compact` — values its `auto | custom` enum never permitted — so
    // both legal values took the same branch. Declared on BOTH sides with the
    // same enum, which is why the declaration-parity ratchet (two declarations,
    // never a declaration vs an implementation) reported agreement over it.
    'ui/RecordDetailsProps:layout',
    // </os-generated retired-key:17>
  ],
};

/**
 * Every whole JSON Schema **def** UNPUBLISHED at each protocol major, named
 * EXACTLY.
 *
 * One entry per def, spelled `${category}/${SchemaName}` — the same string
 * `packages/spec/json-schema.manifest.json` records (`'identity/Session'`,
 * `'data/ValidationRule'`). The sibling of {@link RETIRED_KEYS_BY_MAJOR} one
 * level up: that table registers a single authorable KEY being tombstoned, this
 * one registers a whole SCHEMA leaving the published set.
 *
 * ## What reads it
 *
 * The manifest deletion gate in `scripts/build-schemas.ts`
 * (`check:authorable-surface`): a def listed in `json-schema.manifest.json` at
 * the merge base with origin/main that this build no longer emits must appear
 * here, by exact set membership, or the build fails. Nothing else consumes the
 * table, and nothing infers an entry.
 *
 * ## Why the manifest line alone was not a declaration
 *
 * The #2978 ratchet asks for one, in a comment: "remove a key ONLY for a
 * deliberate retirement". Nothing checked it. The ratchet's `missing` set is
 * `manifest − emitted` with the manifest read from the SAME commit, so a PR that
 * deleted the export and the manifest line together produced an empty `missing`
 * and a silent gate — the exact shape #4650 had just closed one level down, for
 * authorable keys. Worse, the two gates deferred to each other: the #4650
 * deletion gate waives every baseline key under a def the build stopped emitting
 * ("adjudicated by json-schema.manifest.json"), and the manifest said nothing.
 * Measured on #4725 by dropping one barrel re-export: 7 defs and 116 authorable
 * keys left the contract with `gen:schema`, `check:authorable-surface` and
 * `check:api-surface` all green.
 *
 * The fix is the #4650 structure: the removal is judged against the manifest at
 * the merge base — which the commit under test cannot rewrite — and the deleted
 * line has to be answered by a declaration written down HERE, under a major.
 *
 * ## Why not reachability
 *
 * #4650's per-key gate lets a deletion prove itself by showing the def is
 * unreachable from the metadata-type roots, computed by BFS over the build's own
 * Zod graph. That proof is unavailable one level up, and unavailable in the
 * dangerous direction: reachability is keyed by `zodByDefKey`, which only holds
 * defs this build EMITS, so a def that just stopped being emitted answers
 * "unreachable" — a waiver for exactly the removals the gate exists to catch.
 * Declaration is therefore the only honest proof at def granularity.
 *
 * ## What it does NOT replace
 *
 * A rename is not a retirement: a def published under a new name is declared in
 * `scripts/lib/renamed-defs.ts` (`RENAMED_DEFS`), which the gate consults first,
 * and an entry here would be a false claim that the contract shrank. And as with
 * {@link RETIRED_KEYS_BY_MAJOR}, the D2 conversion (`src/conversions/registry.ts`)
 * plus its D3 chain step stay the *documentation* channel that `spec-changes.json`,
 * the upgrade guide and `os migrate meta` project; an entry here is the *proof
 * the removal was declared*. A retirement needs both.
 *
 * ## Not a backfill of history
 *
 * The gate fires only on a def that leaves the published set relative to the
 * merge base, so removals that landed before this table existed never re-trigger
 * it and are deliberately absent. This reads "whole-schema removals registered
 * under the manifest deletion gate", not "every schema ever unpublished".
 *
 * ## Lifecycle
 *
 * Entries are permanent, and after the removal merges they name a def no build
 * emits — the expected steady state. The one state the gate rejects is an entry
 * naming a def this build STILL publishes: a registration nothing consumed,
 * pre-approving a removal that has not happened.
 *
 * @see scripts/build-schemas.ts — the manifest deletion gate, the only consumer
 */
export const RETIRED_DEFS_BY_MAJOR: Readonly<Record<number, readonly string[]>> = {
  // The first entry since #4725 built this table (#5552). The `transform` key's
  // value schema had no other consumer, so it goes with the key rather than
  // surviving as an exported union nothing references — an exported schema with
  // no consumer reads as a capability to whoever finds it (#3950).
  //
  // The ten that follow are #5055 (ADR-0049 enforce-or-remove, maintainer ruling
  // 2026-08-06, window moved to protocol 17 on 2026-08-07): `ui/widget.zod.ts`'s
  // widget-registration vocabulary and the five doorless shapes of
  // `ui/i18n.zod.ts`. None had a carrier key, none was reachable from the
  // metadata-type roots, and none was ever parsed in objectstack / objectui /
  // cloud — so there is no tombstone and no D2 conversion (route 3 of the
  // retirement playbook), and this table plus the D3 `SemanticMigration`
  // `ui-widget-i18n-family-retired` IS the declaration. Same shape as #4988.
  //
  // ⚠️ `ui/FieldWidgetProps` is deliberately NOT here — it was never in the
  // manifest to begin with (its `onChange` is a `z.function()`, so no JSON
  // Schema is emitted) and it survives the retirement: it is a React props
  // contract, not authorable metadata, and it has a live compile-time consumer
  // in objectui (`packages/fields/src/__tests__/spec-symbol-batch7.test.ts`,
  // landed by objectui PR #3289).
  //
  // The 2026-08-08 ADR-0049 sweep (#6486) adds twenty-three more across three
  // members (4 + 10 + 9), all route 3 and all whole-def: `system/http-server.zod.ts`'s
  // runtime vocabulary (#5295, D3 `http-server-runtime-vocabulary-retired`),
  // `api/protocol.zod.ts`'s viewId-addressed view CRUD (#6239, D3
  // `view-management-protocol-retired`) and the whole L2 ETL layer (#6414, D3
  // `etl-pipeline-layer-retired`). None had a carrier key and none was ever
  // parsed outside its own unit tests, so again there is no tombstone and no D2
  // conversion — this table plus those three entries ARE the declaration.
  //
  // ⚠️ `system/ServerRateLimitConfig` is deliberately NOT here. It sits four
  // lines from the retired `system/ServerCapabilities` in the same manifest and
  // shares its prefix, but it belongs to `StackServerSecurity.rateLimit` — the
  // LIVE server surface #5006 admitted, with an executor. Prefix adjacency is
  // not evidence.
  17: [
    // One file per entry under `entries/retired-defs/`, concatenated here sorted by
    // entry id by `gen:migration-registry` (#7297). Add an entry by adding a
    // FILE — never by editing between the markers, which is generated.
    // <os-generated retired-def:17>
    // #6239 — api/protocol.zod.ts view-management operations
    'api/CreateViewRequest',
    'api/CreateViewResponse',
    'api/DeleteViewRequest',
    'api/DeleteViewResponse',
    'api/GetViewRequest',
    'api/GetViewResponse',
    'api/ListViewsRequest',
    'api/ListViewsResponse',
    'api/UpdateViewRequest',
    'api/UpdateViewResponse',
    // #6414 — automation/etl.zod.ts, the whole L2 layer
    'automation/ETLDestination',
    'automation/ETLEndpointType',
    'automation/ETLPipeline',
    'automation/ETLPipelineRun',
    'automation/ETLRunStatus',
    'automation/ETLSource',
    'automation/ETLSyncMode',
    'automation/ETLTransformation',
    'automation/ETLTransformationType',
    // #4914 — the plugin manifest's `loading` block (ADR-0049 enforce-or-remove,
    // maintainer ruling 2026-08-04). `PluginLoadingConfig` was reachable from
    // authored metadata ONLY through `Manifest.loading`, and the ten members
    // registered with it were embedded only by it, so retiring the carrier key
    // unpublishes the whole closure. The carrier itself is a `retiredKey()` tombstone
    // registered one level up in `RETIRED_KEYS_BY_MAJOR`.
    //
    // ⚠️ `kernel/PluginLoadingEvent` and `kernel/PluginLoadingState` are
    // deliberately NOT here. They live in the same module and share its prefix,
    // but neither was ever embedded in `PluginLoadingConfig` — they are the
    // observational half (a lifecycle event and a per-plugin state), they are
    // not authorable, and they still emit. Module adjacency is not evidence,
    // the `system/ServerRateLimitConfig` note above applies verbatim.
    'kernel/PluginCaching',
    'kernel/PluginCodeSplitting',
    'kernel/PluginDependencyResolution',
    'kernel/PluginDynamicImport',
    'kernel/PluginHotReload',
    'kernel/PluginInitialization',
    'kernel/PluginLoadingConfig',
    'kernel/PluginLoadingStrategy',
    'kernel/PluginPerformanceMonitoring',
    'kernel/PluginPreloadConfig',
    'kernel/PluginSandboxing',
    'shared/FieldMappingTransform',
    // #5295 — system/http-server.zod.ts runtime vocabulary
    'system/ServerCapabilities',
    'system/ServerEvent',
    'system/ServerEventType',
    'system/ServerStatus',
    'ui/DateFormat',
    'ui/I18nObject',
    'ui/LocaleConfig',
    'ui/NumberFormat',
    'ui/PluralRule',
    'ui/WidgetEvent',
    'ui/WidgetLifecycle',
    'ui/WidgetManifest',
    'ui/WidgetProperty',
    'ui/WidgetSource',
    // </os-generated retired-def:17>
  ],
};
