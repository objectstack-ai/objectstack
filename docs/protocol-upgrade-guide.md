<!-- GENERATED (ADR-0087 D4) — do not edit by hand. -->
<!-- Regenerate: pnpm --filter @objectstack/spec gen:upgrade-guide -->

# Metadata protocol upgrade guide

Current protocol: **17.0.0** · chain support floor: **protocol 10** · generated from the ADR-0087 registries (`@objectstack/spec` `conversions/` + `migrations/`).

## How to upgrade — from any past major

```bash
objectstack migrate meta --from <your-major>   # replays every step below, in order
objectstack migrate meta --from 10 --step      # checkpoint after each major (bisect a failure)
objectstack validate && tsc --noEmit && <your tests>   # your own verify loop is the acceptance test
```

Mechanical rewrites are applied for you and reported as a diff; **semantic TODOs** are printed with acceptance criteria and are yours to resolve — the chain never auto-applies a change that requires judgment. Arriving several majors late is the designed-for case: timeliness is never load-bearing (ADR-0087).

## Protocol 10 → 11

Protocol 11 unified the divergent HTTP callout node types to `http`, made `html` the canonical page kind (deprecating the `jsx` alias), canonicalized the CRUD flow-node filter key, and renamed object `compactLayout` to `highlightFields` (ADR-0085). These are mechanical and replay losslessly. Two related deprecations are semantic and cannot be auto-applied: a composite `titleFormat` render template has no single canonical `nameField`, and SQL-ish RLS predicates must be rewritten to canonical CEL — both are delegated to the consumer with explicit acceptance criteria.

### Mechanical (applied for you)

| Conversion | Surface | Change | Load window |
|---|---|---|---|
| `flow-node-http-callout-rename` | `flow.node.type` | flow callout node types 'http_request' / 'http_call' / 'webhook' → 'http' | live — protocol 11 loader accepts the old shape |
| `page-kind-jsx-to-html` | `page.kind` | page kind 'jsx' → 'html' (ADR-0080 canonical spelling) | live — protocol 11 loader accepts the old shape |
| `flow-node-crud-filter-alias` | `flow.node.config.filter` | CRUD flow-node config key 'filters' → 'filter' | live — protocol 11 loader accepts the old shape |
| `object-compactLayout-to-highlightFields` | `object.compactLayout` | object key 'compactLayout' → 'highlightFields' (ADR-0085 semantic roles) | retired — `migrate meta` only |

### Semantic (delegated to you, with acceptance criteria)

- **`object-titleFormat-to-nameField`** — `object.titleFormat` → object.nameField
  - Why not automatic: A single-field `titleFormat` maps 1:1 to `nameField`, but a composite template (e.g. `{firstName} {lastName}`) has no lossless single-field target — it must become a formula field designated as `nameField`. The choice of formula is a judgment the transform cannot make.
  - Done when: Each object with a `titleFormat` declares a `nameField`; a composite title is backed by a formula field. `objectstack validate` passes and record display names render identically to before.
- **`rls-sql-predicate-to-cel`** — `security.rls.predicate` → CEL predicate
  - Why not automatic: SQL-ish RLS predicates were deprecated in favor of canonical CEL. Translation is not a pure token rename — operators, functions, and null semantics differ — so it cannot be applied losslessly by the chain.
  - Done when: Every RLS predicate parses as CEL and `objectstack validate` reports no expression errors; row visibility is unchanged for a representative fixture set.

## Protocol 11 → 12

Protocol 12 flipped the REST data-API default to authenticated (`api.requireAuth: true`, ADR-0056 D2). No metadata shape changed, so there is nothing to rewrite mechanically; a deployment that intentionally serves data anonymously must now declare that posture explicitly.

### Semantic (delegated to you, with acceptance criteria)

- **`rest-requireauth-default-flip`** — `api.requireAuth` → explicit `api: { requireAuth: false }` (intentionally-public deployments only)
  - Why not automatic: The global default flipped from `false` to `true` in protocol 12: anonymous requests to the `/data/*` CRUD and batch endpoints are rejected with 401 unless the stack opts out. Whether anonymous access was intentional (demo / kiosk) or an accident is a security judgment no transform can make.
  - Done when: A deployment that relies on anonymous data access declares `api: { requireAuth: false }` on the stack config (and accepts the boot warning); every other consumer verifies its clients authenticate. `objectstack validate` and the consumer test suite pass.

## Protocol 12 → 13

Protocol 13 (ADR-0090 P1) converged the permission model: Role became Position (flat; hierarchy lives on the business-unit tree), the Profile concept was removed, the OWD enum shrank to its canonical four values, and a custom object with an owner field and no `sharingModel` now defaults to `private` instead of public. Key renames replay mechanically; everything that changes *meaning* (profile → position/permission-set design, hierarchy re-homing, CEL identifier rewrites, sharing postures) is delegated with acceptance criteria.

### Mechanical (applied for you)

| Conversion | Surface | Change | Load window |
|---|---|---|---|
| `stack-roles-to-positions` | `stack.roles` | stack collection key 'roles' → 'positions' (ADR-0090 D3) | retired — `migrate meta` only |
| `owd-legacy-read-aliases` | `object.sharingModel` | object sharingModel 'read' → 'public_read', 'read_write' → 'public_read_write' (ADR-0090 D4) | retired — `migrate meta` only |
| `sharing-recipient-role-to-position` | `sharingRule.sharedWith.type` | sharing-rule recipient type 'role' → 'position' (ADR-0090 D3) | retired — `migrate meta` only |

### Semantic (delegated to you, with acceptance criteria)

- **`permission-set-profile-removed`** — `permissionSet.kind / permissionSet.isProfile` → position-based assignment + permission-set grants (ADR-0090 D2)
  - Why not automatic: The Profile concept was removed: `isProfile` is gone from `PermissionSetSchema` and the `profile` metadata kind folded into `position`. Mapping a profile onto positions and permission-set grants is an authorization-design decision, not a rename.
  - Done when: No permission set declares `isProfile` or kind `profile`; the intended assignees hold equivalent grants via positions/permission sets. The access matrix (`os compile` access-matrix gate, where enabled) is reviewed and `objectstack validate` passes.
- **`position-hierarchy-flattened`** — `position.parent / sharingRule recipient role_and_subordinates` → business-unit tree + `unit_and_subordinates` (ADR-0090 D3)
  - Why not automatic: Positions are flat in v2 — `parent` was removed and the `role_and_subordinates` recipient with it; hierarchy lives on the business-unit tree, which expands a DIFFERENT structure than the retired role tree. Re-homing an org hierarchy is a judgment call.
  - Done when: No position declares `parent`; former `role_and_subordinates` rules are re-expressed with `unit_and_subordinates` over an equivalent business-unit tree. Row visibility is unchanged for a representative fixture set.
- **`cel-current-user-roles-to-positions`** — `CEL/formula: current_user.roles` → current_user.positions
  - Why not automatic: The EvalUser/CEL contract renamed `current_user.roles` to `current_user.positions`. The token lives inside free-form expression strings, where a blind textual substitution could corrupt string literals or comments — so the rewrite is delegated to the author.
  - Done when: No expression references `current_user.roles`; formula validation and `objectstack validate` report no unknown-identifier errors; predicate behavior is unchanged for representative users.
- **`owd-full-alias-removed`** — `object.sharingModel: 'full'` → 'public_read_write' or explicit sharing rules
  - Why not automatic: The legacy `'full'` OWD alias implied full access (including transfer/ delete) — wider than any canonical OWD value, so it has no lossless target ('read'/'read_write' converted mechanically; this one did not). Choosing between `public_read_write` and explicit sharing rules is a security-posture decision.
  - Done when: No object declares sharingModel 'full'; the chosen replacement posture is verified against the intended access (who can read/write/delete) for a representative fixture set.
- **`sharing-model-secure-default`** — `object.sharingModel (absent, custom object with owner field)` → an explicit `sharingModel` declaration
  - Why not automatic: ADR-0090 D1 secure default: a custom object with an owner field and NO `sharingModel` now resolves `private` (it used to fall through to fully public). Restoring the old exposure must be a deliberate, visible declaration — the chain must not silently re-open data.
  - Done when: Every custom object that relied on the implicit public posture declares an explicit `sharingModel`; row visibility is verified for a representative fixture set (owners, non-owners, admins).

## Protocol 13 → 14

Protocol 14 renamed the book audience gated arm from `{ profile }` to `{ permissionSet }` (packages own permission sets, never positions — ADR-0090 D9). A pure key rename, preserved as a retired conversion; there is no semantic residue.

### Mechanical (applied for you)

| Conversion | Surface | Change | Load window |
|---|---|---|---|
| `book-audience-profile-to-permission-set` | `book.audience` | book audience gated arm '{ profile }' → '{ permissionSet }' (ADR-0090 D2/D9) | retired — `migrate meta` only |

## Protocol 14 → 15

Protocol 15 unified the conditional-visibility predicate under `visibleWhen` (ADR-0089): view-form `visibleOn` and page-component `visibility` are deprecated aliases, accepted and converted at load for this major. It also flipped `FormFieldSchema`, `FormSectionSchema`, and `PageComponentSchema` to `.strict()` — a key those schemas do not declare is now a loud parse error instead of a silent strip (ADR-0049/0078).

### Mechanical (applied for you)

| Conversion | Surface | Change | Load window |
|---|---|---|---|
| `view-visibleOn-to-visibleWhen` | `view.form.visibleOn` | view form section/field key 'visibleOn' → 'visibleWhen' (ADR-0089) | live — protocol 15 loader accepts the old shape |
| `page-component-visibility-to-visibleWhen` | `page.component.visibility` | page component key 'visibility' → 'visibleWhen' (ADR-0089) | live — protocol 15 loader accepts the old shape |

### Semantic (delegated to you, with acceptance criteria)

- **`ui-schemas-strict-unknown-keys`** — `view form fields/sections · page components (undeclared keys)` → declared keys only (`visibleWhen` for visibility predicates)
  - Why not automatic: The `.strict()` flip (ADR-0089 D3a) turns a previously silently-stripped unknown key into a parse error. There is no mapping target for an arbitrary unknown key — auto-deleting it would be exactly the silent data loss ADR-0078 bans — so each occurrence needs the author to decide: fix the typo, move it to the right layer, or delete dead metadata.
  - Done when: `objectstack validate` passes with no unknown-key parse errors on form fields, form sections, or page components.

## Protocol 15 → 16

Protocol 16 flipped `DashboardWidgetSchema` to `.strict()` (framework#3251, ADR-0021 endpoint): an undeclared top-level widget key is now a loud parse error instead of a silent strip (ADR-0049 enforce-or-remove, ADR-0078 no-silently-inert). The inline analytics shape it most often catches (`object`+`categoryField`+`valueField`+`aggregate`, pivot `rowField`/`columnField`) was already removed at protocol 9, so no mechanical rewrite applies; the residue is the strictness itself, delegated to the author because an arbitrary unknown key has no lossless canonical target.

### Semantic (delegated to you, with acceptance criteria)

- **`dashboard-widget-strict-unknown-keys`** — `dashboard widgets (undeclared top-level keys — legacy inline analytics, objectui-internal `component`/`data`, or typos)` → declared keys only (`dataset` + `dimensions` + `values` for analytics; `options` for renderer-specific extras)
  - Why not automatic: The `.strict()` flip turns a previously silently-stripped unknown key into a parse error. There is no mapping target for an arbitrary unknown key — auto-deleting it would be exactly the silent data loss ADR-0078 bans — so each occurrence needs the author to decide: bind a `dataset` and select `dimensions`/`values`, move a renderer setting under `options`, or delete the dead key.
  - Done when: `objectstack validate` passes with no unknown-key parse errors on dashboard widgets.

## Protocol 16 → 17

Protocol 17 removes the last three deprecated authorable aliases: action `execute` (use `target`), field `conditionalRequired` (use `requiredWhen`), and agent `knowledge.topics` (use `knowledge.sources`). Each was already lowered into its canonical key at parse time and dropped from the parsed output, so no runtime behaviour changes — only the authorable surface shrinks to one spelling per slot. All three are pure key renames with unchanged values and replay losslessly; the schemas reject the removed spellings with a fix-it error naming the replacement.

It also removes the sharing-rule access level `full` (#3865): declared as "Full Access (Transfer, Share, Delete)" but never enforced as anything but `edit` — both gates matched `edit`/`full` alike, so Setup promised admins a delete grant it never issued (ADR-0078). Unlike the OWD `sharingModel: 'full'` alias retired at step 13, this one HAS a lossless target precisely because it was inert — old and new shapes are behaviourally identical — so it converts mechanically and leaves no semantic residue. It is the one protocol-17 conversion that keeps a load-path acceptance window: it had no prior deprecation, and a removed enum value cannot carry the fix-it error the three key renames tombstone theirs with.

Finally it removes agent `tools` (#3894): the legacy inline `{type,name,description}[]` fallback, which the runtime resolved against the FULL tool registry with no surface check — the one seam that broke ADR-0064's "an agent reaches exactly its surface-compatible skills' tools, nothing falls through to the global registry". Unlike the renames above this has NO lossless target: each entry has to become a reference inside a skill, which is a human decision about which skill. The conversion therefore drops the dead key (the runtime stopped reading it in cloud#910, so it already contributes nothing) and emits a notice per agent so the author knows where capability must be re-declared; the schema tombstones the key with a fix-it error naming `skills`.

Beyond those spec-surface removals, it graduates the seven flow-node config key aliases the executors still tolerated (#3796): the CRUD nodes' `object` (use `objectName`) — the last tenant of the `readAliasedConfig` executor shim, which is deleted with it — plus the six open-coded fallbacks that never went through that shim: notify `to`/`subject`/`body`/`url` (use `recipients`/`title`/`message`/`actionUrl`) and script `functionName`/`input` (use `function`/`inputs`). All are pure key renames with unchanged values and replay losslessly. Like the sharing-rule access level above they keep a load-path acceptance window: none carried a prior deprecation warning, and `FlowNodeSchema.config` is an unconstrained record, so no schema tombstone can reject them — the conversion layer is the only seam that can declare, convert, and retire them.

The same graduation covers `wait`, whose fallback was not a config-to-config rename (#4045). `wait` keeps its contract in the declared `waitEventConfig` block, not in `config` at all — yet the executor also read six loose `config` keys, two of them (`duration`, `signal`) spellings the spec never declared. The conversion lifts them onto the declared block in the executor's own `??` precedence, so a value already declared wins and its loose counterpart is left shadowed. One wrinkle makes this a rewrite rather than a delete: `waitEventConfig.eventType` is required once the block exists, and the loader parses the CONVERTED flow — so a source carrying only `config: { duration }` is stamped with `eventType: 'timer'`, the exact default the executor applied to that shape. Behaviour-preserving in both directions.

`connector_action` gets the same lift for the opposite reason (#4045). Its contract also lives in a declared sibling block (`connectorConfig`), and the executor never read `config` at all — but the node's descriptor published a `configSchema` declaring `connectorId`/`actionId`/`input` as `config` keys, and the Studio inspector derives its form from a published schema, so schema-driven authoring wrote the trio to the wrong place and produced nodes that refused to dispatch. The conversion lifts the trio onto the declared block (declared keys win; a lift that cannot complete the required connectorId+actionId pair leaves the node untouched rather than turning a step-time refusal into a load failure), and the descriptor stops publishing the mis-rooted schema.

The reconciliation that found those also found `map`, whose executor read a bare `cfg.flowName ?? cfg.flow` for an undeclared `flow` spelling no schema ever described (#4045). A pure rename, graduated the same way, so the executor reads only the canonical `flowName`.

And it removes the RLS-policy key `priority` (#3896 security audit): promised "conflict resolution" that cannot exist, because applicable policies OR-combine (most permissive wins) — there is never a conflict to order, and nothing ever read the key (call graph closed across the collection site, the projection round-trip and the compiler). A pure lossless delete: outcomes are identical with or without it; the schema tombstones the key with the same prescription.

The same close-out retires the four inert tool authoring keys (`category`, `permissions`, `active`, `builtIn`): none is part of AIToolDefinition and no execution path read them. Two were misleading in the dangerous direction — `permissions` promised an invocation gate nothing enforced, and `active: false` read as "withdrawn" while the tool kept reaching the LLM tool set. Lossless deletes; the strict ToolSchema rejects each with its prescription.

The AppSchema sheds its seven dead authoring keys (2026-06 liveness audit, #4001 app step): `version` (apps are versioned by manifest.version), `aria`, `objects`/`apis` (the self-described "config file convenience" — nothing read them; the chatbot derives an app's objects from its nav items), `sharing`/`embed` (a declared-but-unenforced public surface — the only live path is FormView.sharing; ADR-0049), and `mobileNavigation` (fully unimplemented). Pure lossless deletes — none ever had a runtime effect; each key is tombstoned with its prescription.

ADR-0113 splits the `required` tri-binding: post-17, `required` is ONLY the write-time contract (insert must provide; update may not null out; legacy null rows rest), and the physical NOT NULL is the explicit `storage.notNull`. The `field-required-notnull-explicit` conversion preserves every pre-17 source verbatim-in-meaning by stamping `storage.notNull: true` onto each required field — under the old semantics that column WAS created NOT NULL, so the rewrite writes down what the text already meant. Migration-chain-only (retired from the load path): this is a default flip, not a rename, and a loader that auto-applied it would stamp the constraint onto 17-authored sources that deliberately omit it.

On the wire contract it also retires the `/analytics/query` request ENVELOPE (#3878): `AnalyticsQueryRequestSchema` used to describe `{ cube, query: {...}, format }` — the dialect of the retired degraded analytics shim (#3891) that the real engine never understood (an envelope body inferred a column-less cube and died as an SQL syntax error). The canonical request body is now the BARE AnalyticsQuery — `cube` + `measures` at the top level — which is what every real caller already sends; the schema tombstones `query`/`format`, and the dispatcher entry validates bodies and answers 400 with the prescription. No stored metadata carries this shape (it was HTTP-only), so the change is two semantic TODOs for API callers rather than a stack conversion.

The close-out sweep finishes the enforce-or-remove worklist across the remaining types: action `shortcut`/`bulkEnabled` (no keydown path; the multi-select toolbar reads the view's bulkActions), flow `active`/`template`/node `outputSchema`/errorHandling `fallbackNodeId` (`active: false` never stopped a flow — `status` is the enforced lifecycle; faults route via per-node fault edges), the inert view keys (list `responsive`/`performance`, form `data`/`defaultSort`/`aria` — list aria/data stay live), dashboard and widget `aria`/`performance`, `agent.knowledge` (declaring sources never scoped retrieval — absorbs the former topics→sources rename), and `skill.triggerPhrases` (phrases were never matched; routing is triggerConditions + the agent allowlist). All pure lossless deletes, each tombstoned at its schema with the prescription.

### Mechanical (applied for you)

| Conversion | Surface | Change | Load window |
|---|---|---|---|
| `action-execute-to-target` | `action.execute` | action key 'execute' → 'target' (the deprecated handler alias, #3713) | retired — `migrate meta` only |
| `field-conditionalRequired-to-requiredWhen` | `field.conditionalRequired` | field key 'conditionalRequired' → 'requiredWhen' (the deprecated predicate alias, #3754) | retired — `migrate meta` only |
| `agent-tools-to-skills` | `agent.tools` | agent key 'tools' removed — declare capability in a skill (ADR-0064, #3894) | retired — `migrate meta` only |
| `sharing-rule-access-level-full-to-edit` | `sharingRule.accessLevel` | sharing-rule accessLevel 'full' → 'edit' (#3865 — `full` never granted more than `edit`) | live — protocol 17 loader accepts the old shape |
| `flow-node-crud-object-alias` | `flow.node.config.objectName` | CRUD flow-node config key 'object' → 'objectName' (#3796 — `readAliasedConfig` shim graduation) | live — protocol 17 loader accepts the old shape |
| `flow-node-notify-config-aliases` | `flow.node.notify.config` | notify flow-node config keys 'to' → 'recipients', 'subject' → 'title', 'body' → 'message', 'url' → 'actionUrl' (#3796), and nested 'source: {object, id}' → 'sourceObject' / 'sourceId' (#4045) | live — protocol 17 loader accepts the old shape |
| `flow-node-wait-event-config-lift` | `flow.node.wait.waitEventConfig` | wait flow-node loose config keys → the declared `waitEventConfig` block: 'eventType', 'timerDuration'/'duration' → 'timerDuration', 'signalName'/'signal' → 'signalName', 'timeoutMs' (#4045) | live — protocol 17 loader accepts the old shape |
| `flow-node-connector-config-lift` | `flow.node.connector_action.connectorConfig` | connector_action flow-node loose config keys 'connectorId' / 'actionId' / 'input' → the declared `connectorConfig` block (#4045) | live — protocol 17 loader accepts the old shape |
| `flow-node-map-flow-alias` | `flow.node.map.config.flowName` | map flow-node config key 'flow' → 'flowName' (#4045 — undeclared executor fallback graduation) | live — protocol 17 loader accepts the old shape |
| `flow-node-script-config-aliases` | `flow.node.script.config` | script flow-node config keys 'functionName' → 'function', 'input' → 'inputs' (#3796) | live — protocol 17 loader accepts the old shape |
| `permission-rls-priority-removed` | `permission.rowLevelSecurity.priority` | RLS-policy key 'priority' removed (#3896 audit — policies OR-combine, so the promised conflict-resolution semantics cannot exist; dropping it changes no outcome) | retired — `migrate meta` only |
| `tool-inert-authoring-keys-removed` | `tool.category / tool.permissions / tool.active / tool.builtIn` | tool keys 'category'/'permissions'/'active'/'builtIn' removed (#3896 close-out — authorable and inert; permissions gated nothing, active:false withdrew nothing) | retired — `migrate meta` only |
| `app-dead-authoring-keys-removed` | `app.version / app.aria / app.objects / app.apis / app.sharing / app.embed / app.mobileNavigation` | app keys 'version'/'aria'/'objects'/'apis'/'sharing'/'embed'/'mobileNavigation' removed (2026-06 liveness audit — never read; sharing/embed declared a public surface no route enforced, mobileNavigation was fully unimplemented) | retired — `migrate meta` only |
| `field-required-notnull-explicit` | `object.fields.*.required / object.fields.*.storage.notNull` | required fields gain explicit 'storage.notNull: true' (ADR-0113 — pre-17 'required' implied the column constraint; post-17 it is only the write contract) | retired — `migrate meta` only |
| `action-inert-keys-removed` | `action.shortcut / action.bulkEnabled` | action keys 'shortcut'/'bulkEnabled' removed (#3896 close-out — no keydown path dispatches shortcuts; the multi-select toolbar reads the view's bulkActions) | retired — `migrate meta` only |
| `flow-inert-keys-removed` | `flow.active / flow.template / flow.nodes[].outputSchema / flow.errorHandling.fallbackNodeId` | flow keys 'active'/'template', node 'outputSchema' and errorHandling 'fallbackNodeId' removed (#3896 close-out — active:false never stopped a flow; status is the enforced lifecycle) | retired — `migrate meta` only |
| `view-inert-keys-removed` | `view.list.responsive / view.list.performance / view.form.defaultSort / view.form.aria` | view keys removed (#3896 close-out): list 'responsive'/'performance', form 'defaultSort'/'aria' — no renderer read them (list aria/data and form data stay live) | retired — `migrate meta` only |
| `dashboard-inert-keys-removed` | `dashboard.aria / dashboard.performance / dashboard.widgets[].performance` | dashboard keys 'aria'/'performance' and widget 'performance' removed (#3896 close-out — no renderer applied any of them) | retired — `migrate meta` only |
| `agent-knowledge-removed` | `agent.knowledge` | agent key 'knowledge' removed (#3896 close-out — declaring sources/indexes never scoped retrieval; restrict at the knowledge-service level) | retired — `migrate meta` only |
| `skill-trigger-phrases-removed` | `skill.triggerPhrases` | skill key 'triggerPhrases' removed (#3896 close-out — activation is triggerConditions + the agent's skills[] allowlist; phrases were a dead-end projection) | retired — `migrate meta` only |

### Semantic (delegated to you, with acceptance criteria)

- **`analytics-query-request-envelope-retired`** — `api.analyticsQueryRequest.query` → bare AnalyticsQuery body (top-level cube/measures/dimensions/where/...)
  - Why not automatic: The { cube, query: {...} } envelope was an HTTP-wire dialect of the retired degraded analytics shim (#3891), never stored in stack metadata — there is no source for the chain to rewrite. Callers of POST /analytics/query and /analytics/sql must move the query.* fields to the body top level themselves.
  - Done when: Every /analytics/query and /analytics/sql call sends the bare AnalyticsQuery shape and succeeds; no request answers 400 VALIDATION_FAILED with the envelope prescription.
- **`enhanced-api-error-field-errors-renamed`** — `api.enhancedApiError.fieldErrors` → fields
  - Why not automatic: The wire has always carried `fields` — the validators, import coercion, validation-failure.ts, @objectstack/client and the console's field-error extractor all say `fields`, and nothing ever emitted `fieldErrors`, so a reader keying on it was reading a field no server sent (ADR-0078's silently-inert declaration, on the error envelope). This is a RESPONSE surface: no stack, example or template carries the key, so there is no source for the chain to rewrite — the schema tombstones it via retiredKey() and consumers move their read themselves. ADR-0114 D4, #3977.
  - Done when: No consumer reads `error.fieldErrors`; per-field validation detail is read from `error.fields`, and constructing an EnhancedApiError with `fieldErrors` fails to parse with the rename prescription instead of silently losing the array.
- **`analytics-query-request-format-retired`** — `api.analyticsQueryRequest.format` → (removed — responses are always the JSON envelope; use the export surface for CSV/XLSX)
  - Why not automatic: The `format` key was declared but never implemented (declared ≠ enforced): every response is the JSON envelope regardless of the requested value, so there is no behaviour to preserve and nothing stored to rewrite.
  - Done when: No /analytics/query or /analytics/sql call sends `format`; exports go through the export surface.

---

*Machine-readable equivalents: `spec-changes.json` (shipped in `@objectstack/spec` and attached to each GitHub Release) and the structured output of `objectstack migrate meta --json`.*
