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
    + 'writes through `userActions`, while `system-data` defaults WRITABLE, so those blocks '
    + 'become redundant and are deleted (keep `userActions` only to NARROW). No enforcement '
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
    + 'shape is untouched, staying live on `app.aria` and `page.components[].aria`. Move a '
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
    + '`CREATE INDEX` DDL and never came from this key.',
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
  ],
  semantic: [
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
      id: 'etl-retry-converged-onto-retry-policy',
      surface: 'etlPipeline.retry.maxAttempts (and any count above 10)',
      replacement: 'maxRetries, same number — plus an explicit count if you relied on the old default of 3',
      reason:
        'An ETL pipeline\'s `retry` was a THIRD retry vocabulary that #4661\'s convergence never '
        + 'reached, because that pass was driven by duplicated exported NAMES and this block is an '
        + 'anonymous inline object (#4962). It now carries the shared `RetryPolicySchema` contract, '
        + 'which changes three things with no single lossless rewrite between them. The rename '
        + '`maxAttempts` → `maxRetries` IS lossless and the tombstone performs it — both keys '
        + 'counted the retries AFTER the initial attempt, so the number does not change, and '
        + 'subtracting one (correct for `integration/connector.zod.ts`\'s identically-spelled '
        + '`RetryConfig.maxAttempts`, which includes the first attempt) would silently run one '
        + 'attempt fewer than asked. What needs a human: the count now DEFAULTS TO 0 instead of 3, '
        + 'so a pipeline that wrote `retry: {}` or omitted the count bought three silent re-runs '
        + 'and now buys none. That is deliberate and the business case is the destination — an ETL '
        + 'destination is a foreign system by definition, and an implicit retry against a '
        + 'non-idempotent one is a duplicate write (a second invoice, a second export, a second '
        + 'webhook). Retrying is now something an author states and thereby claims idempotency for. '
        + 'The shared contract also caps `maxRetries` at 10, which this block never did; clamping '
        + 'a larger budget would silently halve a number its author chose, so it fails at parse '
        + 'with the bound named instead.',
      acceptanceCriteria:
        'No ETL pipeline declares `retry.maxAttempts`; every one that wants retries declares '
        + '`maxRetries` >= 1 explicitly (the number carried over unchanged from `maxAttempts`), and '
        + 'every pipeline that was relying on the old implicit 3 has either written `maxRetries: 3` '
        + 'or been re-decided against the duplicate-write risk at its destination. No count exceeds '
        + '10. Pipelines that want the old flat 60s backoff state `backoffMs: 60000` explicitly, '
        + 'since the shared default is 1000.',
    },
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
        + 'sharing-rule `full` retirement hit above). The enforced channels are tsc, which '
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
        + '`plugin-runtime-family-retired` below). The studio half of this entry is '
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
        + 'refuses to publish. Grep every `apis:` entry for `authRequired: false` before you '
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
        + '#4610 (`NotificationSchema` / `NotificationConfigSchema`, deleted for zero '
        + 'consumers), and `EmbedConfig` lost its key at 17.0.0 when the 2026-06 liveness audit '
        + 'retired `App.embed` (no iframe route ever read it) — that key still stands as a '
        + '`retiredKey()` tombstone in `app.zod.ts`, so an author who wrote the KEY already '
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
