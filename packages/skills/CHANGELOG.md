# @objectstack/skills

## 18.4.0

### Minor Changes

- d59a1eb: feat(spec): a `page:header` declares `placedActions: true`, the explicit opt-in to draw every action of the bound object placed at `record_header` / `record_more`, read live (#30018)
  
  Clause-②: yes (widening)
  Metadata-protocol: added
  
  - **`placedActions`** on a `page:header` component's `properties` (`PageHeaderProps`, the `ComponentPropsMap['page:header']` row): `true` asks the header to draw every action of the page's object whose `locations` include `record_header` or `record_more`, read live from the object's metadata, in place of an authored `actions` id list. An action another package places on the object is then drawn without editing the page. Optional with no default: an unset key stays unset in the parsed output.
  - **The `actions` list keeps its meaning.** An authored list is the whole set the header draws, and a header with neither `actions` nor `placedActions: true` draws none of the object's actions. `placedActions: false` beside a list is accepted and changes nothing.
  - **Refused together.** `placedActions: true` beside an authored `actions` list, an empty one included, is refused at `properties.placedActions` by `os validate`, `os build`, `os lint` and the page save door (`component-props-invalid`, an error). The message names both keys and asks the author to keep one: `actions` for a curated list that is the whole set, or `placedActions: true` for every placed action. Nothing that parsed before is refused: until this release `placedActions` was an unknown key on the closed shape.
  - **Declared ahead of its reader.** The console's header renderer does not read the key yet, so a header that sets it draws what the same header without it draws (none of the object's actions unless `actions` names them). The key's describe opens with `[PLANNED — not yet rendered]` until the renderer reads it.
  - The published JSON Schema `ui/PageHeaderProps` still accepts the pair: the rule depends on the value `true`, which no projected refinement pattern states, so the parse refuses it and `dropped-refinements.baseline.json` records the site.
  - `@objectstack/skills`: `objectstack-ui` `rules/pages.md` names the key in the component catalogue, marked not drawn yet, and drops a refused-shape clause from the print-page paragraph that the sentence before it already states.

### Patch Changes

- 1c34fd7: docs(skills): an objectstack-data eval checks that a vendor field is relabelled with `fieldPatches`, never redeclared in `fields`
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-data/evals/objects-fields-relationships.json` gains case 7: an author wants HotCRM's `crm_account.industry` to read "Sector" instead of "Industry". The accept set requires `fieldPatches` on a `defineObjectExtension` authored in `hotcrm.custom` (an option's label keyed by its stored value where the field declares its own options); it refuses `industry` redeclared in `fields`, which takes the field over and cuts it off from HotCRM's upgrades. No skill text changes.
- 7c1eeb1: docs(skills): the objectstack-data skill now leads a hook author to the save notice
  
  Clause-②: no
  Metadata-protocol: none
  
  The `objectstack-data` rule index described `rules/lifecycle.md` as retention-only, and `references/data-hooks.md` listed no `notice` member, so an author writing a save hook from this skill never found `ctx.notice(message)`. The index entry now names the save notice, and the sandbox `ctx.*` table and the `HookContext` listing each carry a `notice` row that points at `rules/lifecycle.md` § Save Notice. Growth is paid by same-file deletions of restated prose; both token-ratchet rows are re-locked down at the landed counts.
- bc9eaf6: docs(skills): the automation skill's OAuth recipe teaches the installer-supplied client
  
  Clause-②: no
  Metadata-protocol: none
  
  Recipe 6 of `objectstack-automation/references/integration-recipes.md` now shows `clientSource: 'installer'` beside a declared `clientId` + `credentialRef`, with when to use which: a declared client for an app its publisher deploys, the installer form for one installed on deployments the publisher never sees. The administrator registers a client with the vendor against the `redirectUri` the connection's status read answers, connects with `{ clientId, clientSecret }` (no secret for a public client; a reconnect naming no client keeps the stored one), and the connection reads back `client: { source: 'installer', clientId, hasSecret }`, never the secret.
- 0d40aa1: docs(skills): with no `searchableFields` declared, a field marked `searchable: true` joins the default search set
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `objectstack-data`, `objectstack-query` and the `objectstack-ui` list-views rule taught the record-search auto-default as type-only: the name field plus the text-like and `select` columns. A field marked `searchable: true` was described as doing nothing, and a `$searchFields` override naming one as refused.
  - **Now.** Each says what the platform resolves: with no `searchableFields` declared, the set `search` scans, and the set a `$searchFields` override may name, is the type-based default plus every field marked `searchable: true`, of any type except `secret`, `password`, `vector` or a virtual `formula`. Each also says what does not change: `searchable: false`, the default, never removes a field the type default scans, and declaring `searchableFields` chooses the set. The enum half of the type default is spelled `select` alone, as the resolver has it.
  - No schema, key or behaviour changes.
- 89803c5: docs(skills): the platform skill teaches the `contributions` member of the package customizations read
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-platform/SKILL.md` now names `contributions` beside the overrides, extensions and switched-off items that `GET /packages/<id>/customizations` lists: one entry per item another package adds to the base, stamped with its `packageId`; a `field` or `flow` entry names the base's `object` it is on, a `nav` entry names the base's `app`, its `group` when it targets one, and the item id as `name`; `counts.contributions` counts items, not packages. The text is paid for by deleting three restatements in the same file, so the token ceiling is unchanged.
- 322b6bf: docs(skills): objectstack-automation says a flow's record nodes treat a computed filter operand as a value, never as a query operator
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Now.** § Filter operands states the rule from the service-automation change: a computed operand is a string, number, bigint, boolean or date, or at an `$in` / `$nin` / `$between` comparand a list of them with no empty entry. Anything else fails the node as a guard before the query runs. The fix: make the expression evaluate to the compared value (for a record, its `id`), and write conditions in the filter itself. The table of failures a `fault` edge does not route now names that refusal beside the `null` operand.
  - `SKILL.md` stays under its token ceiling (no ceiling moves). No schema, key, command or behaviour changes.
- dd9add6: docs(skills): objectstack-platform says the D11 close refuses a package-less write only where the row moves as a declared override, and an added email-template locale keeps that write
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The ADR-0146 customization paragraph said a pre-D11 unbound Setup row's package-less save, reset and rollback are refused once it is movable. That is false for a row of an email-template locale the base does not ship: `os migrate packageless-overlays` moves it as the pair's own member (`addedMember`, no `overrides`), and the close judges only the declared-override move, so that row's package-less write stays open before and after its move. The clause also left out publish, which the close refuses too.
  - **Now.** The clause says the close covers a row movable as a declared override, lists save, publish, reset and rollback, and says an email-template row at a locale the base does not ship moves as the pair's own member and keeps that write. The file stays at its token ceiling: a duplicate "CLI Commands" pointer section is cut, its home the Part 3 pointer to `references/operations.md`. No rule is removed; no schema or behaviour changes.
- 987ff33: docs(skills): teach that a save and `os validate` refuse `titleFormat`
  
  Clause-②: no
  Metadata-protocol: none
  
  - `objectstack-data` (object properties table) and `objectstack-formula` (template carriers) no longer call `titleFormat` deprecated: since #29499 the metadata save gate and `os validate` refuse an object that declares it (`title-format-retired`), and it moves to `nameField`. The formula skill drops the sentence that restated the template grammar cell beside it.
  - ADR-0079 D3 gains a dated amendment note citing ruling 6574393684 and #29499; the decision is unchanged.
- cde9a80: docs(skills): the automation skill teaches that an approval's decision outputs are enforced at the decision
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `skills/objectstack-automation/references/state-machines-and-approvals.md` said only that a typed `decisionOutputs` entry renders the matching record picker in the decision dialog (`multiple` collects an id array). An agent writing an approval flow from it could read `type` and `multiple` as widget hints and not know that a value the next step cannot use is refused.
  - **Now.** The *Recording a decision* section says what the approvals service enforces, on approve and reject alike and before any write: a picker value must resolve through the `expression` approver's resolvers (`user` by any account's record id, `department` by record id in the request's organization, `team` by record id not owned by another organization, `position` by the machine name of a position someone in that organization holds); `multiple: true` takes a list of distinct values for every kind, bare keys included, and without it one value; any other non-blank value is refused with `400 VALIDATION_FAILED` naming `outputs.KEY`. The Console sends a list for a `multiple: true` text output. The existing `lead_review` node is the example. The file stays within its token ceiling (5724 of 5730).
- 3abe011: docs(skills): the automation skill's OAuth recipe names a stdio MCP server's credential route as `transport.credentialEnv`
  
  Clause-②: no
  Metadata-protocol: none
  
  Recipe 6 of `objectstack-automation/references/integration-recipes.md` said a `stdio` server's credentials ride `transport.env` — the literal-in-metadata route the `connector-credential-literal` advisory warns against. It now says what the `mcp` provider does: the grant-bearing kinds stay `http` only; a `stdio` server takes a static `auth: { type: 'bearer', credentialRef }`, handed to the child process in the variable `transport.credentialEnv` names, never a literal in `transport.env`. Paid inside the file's token ceiling by dropping the opening paragraph's restatement of two facts that keep their homes: the packaged spec (SKILL.md § Integrations are declared, not coded) and where an `api` hook's secret goes (SKILL.md's `secretRef` row and recipe 4). No eval asserted the old route; none changes.
- 6a4737a: docs(skills): objectstack-data teaches `relatedList` placement by each value's role, not by record-page tabs or columns
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `rules/relationships.md` said `relatedList: 'primary'` draws "a full-width table in the details column after the first field section (in the Details tab, no tab of its own)" and that `true` / omitted is "a side card (the shared **Related** tab)". The spec's `relatedList` describe no longer names any tab or column, so the skill taught a page layout the record page does not draw.
  - **Now.** The three bullets follow the spec describe: `'primary'` is part of the record's main content, a full-width table in the record's detail body (still the default for an inline-edited `master_detail` FK); `false` means the child object is not shown on the parent record page; `true` or omitted is an auxiliary panel on the record page. Layout stays ADR-0085's to define.
  - The file gets smaller and stays under its token ceiling; no ceiling moves, no schema, key or behaviour changes.
- 7bafab3: docs(skills): `objectstack-ui` no longer says `page:header`'s `placedActions: true` is not drawn, and an eval exercises it (#29951)
  
  Clause-②: no
  Metadata-protocol: none
  
  - `rules/pages.md`: the component catalogue's `page:header` row says `placedActions: true` draws every placed action, read live. The console's header renderer reads the key since #29951's ui half, so the "not drawn yet" qualifier #30018 wrote is dropped.
  - `evals/record-page.json`: a third case asks for a custom full record page whose header shows every action packages place on the object; the expected answer keeps the page and its tab strip and sets `placedActions: true` on the `page:header` node, with no `actions` id list beside it.
- b83e1d0: test(skills): the platform skill's evals ask for push notifications on an `os serve` deployment
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-platform/evals/config-plugins-ops.json` gains case 12: the prompt asks to turn on push notifications for an `os serve` deployment, and the expected answer declares `requires: ['push']` with a top-level `push:` key on the stack definition and writes no secret inline (the APNs signing key and the Firebase service-account JSON are named by reference). The assertions stay with what `objectstack-platform/SKILL.md` teaches today, the `push` token and the top-level key; the push block's transport and vendor shape are not asserted until the skill teaches them.
- 0ce44c9: docs(skills): the i18n skill lists a lookup or master-detail field's translatable `relatedListTitle`
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The `objectstack-i18n` object-level table listed `label`, `help`, `placeholder`, `options` and `inlineTitle` under `fields.{field_name}`, so an author had no word that the related-list title on a parent's record page is translatable.
  - **Now.** The row adds `relatedListTitle`: the title of the related list a `lookup` or `master_detail` field draws on its parent's record page. The key sits on the child object's field, and an untranslated title keeps its authored text, never the child's label.
  - The paragraph under *Diff & Coverage Schemas* saying `getCoverage()` / `suggestTranslations()` have no shipped implementation is cut; *Service Contract* in the same file says the same, and the section's opening sentence now names the two schemas as those methods' return shapes. No schema, key or behaviour changes.
- f9e5bef: feat(trigger-api): an `api` hook verifies the vendor signature its start node declares (`config.signature`)
  
  Clause-②: yes (widening)
  Metadata-protocol: none
  
  - **`@objectstack/trigger-api`.** `start()` reads the hook's one verifier with `apiTriggerVerifierOf(binding.config)` (`@objectstack/spec/automation`). A start node that declares its sender's scheme (`config.signature`: DocuSign Connect's base64 `X-DocuSign-Signature-1`, a Stripe-style `t=…,v1=…`, a GitHub-style `sha256=`) now admits a correctly signed post that was answered `401` before. That scheme REPLACES the `x-objectstack-signature` check for its hook: the declared header is read on both faces of the door (the self-hosted mount and `handleInboundHook`) with `Headers.get`, so a repeated field is its one joined value; the HMAC-SHA256 is computed under the key `config.secretRef` names (read at every post through the engine's reader, `503` while it has no value), over the raw body or `<t>.<raw body>`; each digest is decoded strictly to 32 bytes and compared with `timingSafeEqual`, any one of several `v1` elements matching (a key roll); and a timestamped scheme is held to `HTTP_SIGNATURE_TOLERANCE_SECONDS` from `@objectstack/core`. A body-only scheme has no replay window, as the contract states. A valid `x-objectstack-signature` admits nothing on such a hook, and a post without the declared header is refused. A declaration the spec answers `unusable` arms a hook that refuses every post before any secret is read and never falls back to `x-objectstack-signature`; a declared scheme bound without the engine's `config.secretRef` reader is refused at `start()`. Every failure is the same `401 INVALID_SIGNATURE` with its own cause in the server log (`declared-header-absent`, `declared-header-malformed`, `declared-prefix-missing`, `declared-no-digest`, `declared-mismatch`, `declared-outside-window`, `declared-unusable`), never the key, the header value or the body. A hook that declares no scheme is verified exactly as before.
  - **`@objectstack/lint`.** `validateFlowApiTriggerSecret` grades an `api` hook by that same reader: a usable declaration is ready on its `config.secretRef` alone, and an unusable one is the new error `flow-api-trigger-signature-unusable` (with its `os explain` entry), located at the key the spec refuses. It fires only on a declaration the flow parse already refuses, so no stack that passed before is refused now.
  - **`@objectstack/skills`.** The automation and api skills teach `config.signature` where they said a vendor-signed callback cannot be admitted.
- 07595c0: docs(skills): the `page:header` title row drops the retired `breadcrumb` and names the live `placedActions: true`
  
  Clause-②: no
  Metadata-protocol: none
  
  - `skills/objectui/guides/page-builder.md`: the `page:header` sentence named `breadcrumb` among the title row's keys. `PageHeaderProps.breadcrumb` is a `retiredKey` tombstone since @objectstack/spec 17 (ADR-0087 D2), and the props lint refuses an authored one. The row now lists `title`, `subtitle`, `actions` or `placedActions: true`; the last two are refused together.
- 1f92c72: docs(skills): objectstack-platform teaches the stack's `push` block in `references/operations.md` (Mobile push): `transport: 'direct'` with `apns` / `fcm` blocks is the transport served today, each secret is named by `credentialRef` and never written inline, and the hosted relay (also what `{}` reads as) is refused at boot until its sender ships; the `requires` table points `push` at it, and the push eval case asserts the shape
  
  Clause-②: no
  Metadata-protocol: none
- 0e42aef: docs(skills): the platform skill names every type a pair's declared override is served for, and that removing the pair's item serves the base's again
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-platform/SKILL.md`, the "Customizing an installed package (ADR-0146)" paragraph: a `.custom` pair's declared override is served for a view, dashboard, report, email_template, translation, flow, page, app, dataset, doc, book or mapping (the paragraph named six), and removing the pair's item (`DELETE …?package=hotcrm.custom`) serves the base's document again (ADR-0146's revert, which the paragraph did not say). The package's evals gain a dataset-and-page override case and a removal case.
- 83fc231: docs(skills): a `notify` node that writes no link opens the record that started the run
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The `objectstack-automation` skill's `notify` example commented its click-through keys as "a PAIR, else dropped", so a record-triggered flow's notification looked like it linked nowhere unless the author wrote `sourceObject` + `sourceId: record.id`.
  - **Now.** The example says what the runtime does: a node that writes none of `sourceObject`, `sourceId` and `actionUrl` links to the run's trigger record when it has one (a record change other than a delete, a time-relative sweep's row, an action started on a record). An explicit pair or `actionUrl` wins; half a pair is still dropped; a run with no trigger record links nowhere. A new eval asks for a record-triggered notification that opens its record and expects no source keys written.
  - No schema, key or behaviour changes.
- 43ae284: docs(skills): `objectstack-platform`'s plugin-development reference no longer teaches the removed `feature_flags` settings namespace
  
  Clause-②: no
  Metadata-protocol: none
  
  The "Feature Flags" section listed a `feature_flags` settings manifest with `ai_enabled` / `beta_*` toggles and `OS_FEATURE_FLAGS_*` env overrides. That namespace was removed from `@objectstack/service-settings` (reading it is refused with `SETTINGS_UNKNOWN_NAMESPACE`, and the env vars do nothing). The bullet now gives the live answer: a plugin that needs an org toggle declares its own `SettingsManifest` and registers it on the `settings` service.
- 4cfb351: docs(skills): an object extension that renames `label` without `pluralLabel` clears the base plural
  
  Clause-②: no
  Metadata-protocol: none
  
  `objectstack-data` § Object Extension Model still says an extension can add but never remove, and now names the one exception the object fold has: an extension that sets a new `label` and no `pluralLabel` takes the base's `pluralLabel` off the served object unless a tenant authored that plural, so an author who renames an object sets both to keep a plural. An extension that repeats the label it extends removes nothing. The Lifecycle Hooks pointer line drops its second link to `references/data-hooks.md`, which the catalog list and the backfill paragraph already link. No schema, key or behaviour changes.
- 6a983a1: docs(skills): the platform skill teaches the declared action override and its access-widening refusal
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `objectstack-platform`'s customization paragraph (ADR-0146) listed the types a `.custom` pair's declared override is honoured for without `action`, and `content/docs/concepts/metadata-lifecycle.mdx` said an `action` override was not served yet. Both have been false since `action` opened (ADR-0146 D9).
  - **Now.** The skill lists `action` and says what an action override may change: it keeps the base's `objectName` (the doors match the base's action as `OBJECT:NAME`, and moving it to another object is refused `declared_package_ships_no_such_item`), and it replaces the behaviour (`type`, `body`, `label`, `visible`, …) whole for whoever could already run the base. Dropping a `requiredPermissions` entry, turning `ai.exposed` on or `ai.requiresConfirmation` off is refused `403 NOT_OVERRIDABLE` with rule `declared_action_widens_access`. The docs page says the same, and the skill's evals gain a case for it.
  - No schema, key or behaviour changes.
- a4c3246: docs(skills): teach an action param's `widget` key in the action dialog
  
  Clause-②: no
  Metadata-protocol: none
  
  - `objectui` (`rules/protocol.md`, inline params): the widget-config list gains `widget`. It names a registered field widget that draws the param instead of its `type` widget (`'permission-ref'` on a `text` param is the permission-set picker); an unregistered name keeps the `type` widget, and the selection bar's bulk dialog does not read it. The server still validates the submitted value by `type`.
  - `objectstack-ui` (`rules/actions.md`, field-backed params): a field-backed param inherits the field's `widget` only while it keeps the field's `type` or restates it; a param that overrides `type` names its own `widget`.
  - Paid inside the token ceilings by removing restatements in the same files. No schema, key or behaviour changes.
- 6b2129f: docs(skills): the objectui project-setup guide names where uploads live now that `@object-ui/providers` is gone
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `objectui/guides/project-setup.md` sent a third-party app to `@object-ui/providers` for `UploadProvider` / `useUpload`, in the provider-stack list and in the decision matrix. That package is retired and gets no further release.
  - **Now.** `UploadProvider` / `useUpload` come from `@object-ui/fields`; the ObjectStack storage adapter `createObjectStackUploadAdapter` comes from `@object-ui/data-objectstack`; the `UploadAdapter` / `UploadOptions` / `UploadResult` contract is `@object-ui/types`'s, re-exported by `@object-ui/fields`.
  - The troubleshooting section drops two monorepo-only tips (the Turbo cache block and the "downstream packages need built `dist/`" line), which a third-party app consuming published packages never needs.
  - No schema, key or behaviour changes.
- 254f2ec: docs(skills): objectstack-i18n teaches the five-step locale ladder that `resolveLocaleAmong` runs (exact, case-insensitive, same platform-table language, base language, first registered variant), so a `zh-TW` request is taught to reach a registered `zh-Hant` bundle rather than the first `zh-*` one
  
  Clause-②: no
  Metadata-protocol: none
- af1d59b: docs(skills): objectstack-api's Metadata API section teaches the `/meta/:type` list door's `?names=a,b,c` filter (one comma-separated value; an unknown name absent, an empty value refused `400`, the `package` list refuses the key) and its closed query set (`package`, `preview`, `object`, `include`, `id`, `names`, `locale`; any other key `400 VALIDATION_ERROR`)
  
  Clause-②: no
  Metadata-protocol: none
- dfa179a: docs(skills): the automation skill teaches the mail `option` formatter for a notice's select label, and that a user target owns a row only while an active member
  
  Clause-②: no
  Metadata-protocol: none
  
  Two lines in `objectstack-automation/SKILL.md`, each following a platform change that landed before it. In the `notify` section: an option label in a notice is written in the mail `template` as `{{ stage | option:opportunity.stage }}`, which prints the label in each recipient's language and is mail-only (refused in an inline `title` / `message`) — never `label()` in `templateData`, which is evaluated once per run, before recipients fan out. In "Assignment rules": `assignTo: { type: 'user', value: '<id>' }` names an owner who holds the row only while an active member of its organization, else the row is written ownerless. Eval 15 of `evals/flows-triggers-approvals.json` grades the notice case. The docs page `automation/queues-and-assignment-rules` gains the organization-authored `sys_assignment_rule` rules beside the declared ones: evaluated first, by `sort_order` then name, first match wins, a failed read of the organization's rules routes nothing, and the active-member rule for a `user` target. Paid inside the skill by deleting the CRM Automation Blueprint section (the `src/flows` layout objectstack-platform's bootstrap reference carries) and two restatements.
- 8ddb6b7: docs(skills): the `objectstack-data` record-currency backfill hint names `--org` and `--all-organizations`
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-data/rules/field-types.md` pointed an agent that switched a stored currency field to `'record'` at `os migrate record-currency-codes` with no flag. Since #30737 that command fills one organization's rows with `--org ID`, writes the one code into every organization only with `--all-organizations`, and refuses a run with neither on a database whose rows belong to more than one organization. The hint now says so. To stay inside the file's token ceiling, a sentence in the autonumber delimiter rule that restated the rule's own heading is removed.
- 3479c33: docs(automation): the notify click-through default says a before-create run links to its record only when the caller wrote the id
  
  Clause-②: no
  Metadata-protocol: none
  
  A `notify` node that writes none of `sourceObject`, `sourceId` and `actionUrl` links to the run's trigger record when the run has one. Four texts enumerated that run as "a record change other than a delete", which includes a before-create run (`record-before-create`, or the insert leg of `record-before-write`). On that run the record is the write's input, and the driver issues the id at the write, after the hook, so the input carries an id only when the caller wrote one; with no id the notification links nowhere. The runtime is unchanged. The texts now say "a record change other than a delete or a before-create", and that a before-create run links only when the caller wrote the id:
  
  - the `NotifyConfigSchema` docblock and the `sourceObject` / `sourceId` descriptions in `@objectstack/spec`, and the reference page generated from them;
  - the `notify` node's docblock and config descriptions in `@objectstack/service-automation`, which is the wording source;
  - the Flows guide and the automation skill's `notify` example.
  
  The same texts said that a `sourceId` evaluating to `null` "leaves the key unset". It is a written key: the node then writes a half pair, which is dropped rather than defaulted to the trigger record. The node's failure text, the guide and the schema say so.
  
  A test pins that a notify on a `beforeInsert` run whose record carries no id writes no `source_object` / `source_id`, and that one whose caller wrote the id links to it. No key, shape, default or refinement changes.
- 1120389: docs(skills): objectstack-platform's `references/operations.md` spells `os package install`'s server flag `-u/--url` (in place of the removed `-r/--runtime`) and names the new `-t/--token` (env `OS_RUNTIME_TOKEN`) beside `--email/--password` as the target runtime's credential, matching the CLI
  
  Clause-②: no
  Metadata-protocol: none
- 0e73de8: docs(skills): the authoring skills teach one naming rule, every metadata name a package authors starts with its namespace
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `objectstack-platform` stated the prefix rule for objects only, and claimed `os lint` warns on bare app, page, dashboard, flow, action, report and dataset names whenever a namespace is set. The examples across the skills named flows, actions, hooks, pages, dashboards, reports, datasets, queues, positions, permission sets, assignment rules, agents and skills bare (`lead_conversion`, `sales_rep`, `support_intake`).
  - **Now.** `objectstack-platform` states the rule once, beside the object rule: every metadata name a package authors starts with its namespace (`crm_send_email`, `crm_sales_rep`). The exceptions are fields, object extensions, container views and translations (`<ns>_<locale>`). It also says what is enforced today: `defineStack` refuses a bare object name, `os build` refuses a bare doc name, and `os lint`'s `naming/namespace-prefix` warns only on a name one package declares twice. Every example and eval that showed or generated a bare non-object name now carries `crm_` (or its package's namespace where the snippet has one), cross-references included.
  - Connector ids, the inbound api flow whose name is part of its webhook URL, and the datasource whose name keys its password variable keep their names. No schema, key or behaviour changes.
- 253eab0: docs(skills): the data skill's Field Groups section teaches a group's `visibleWhen` and `requiresFeature`
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-data/references/examples-objects.md` now names the two ways a whole field group (header included) is hidden: `visibleWhen`, a CEL predicate over the record that hides the group when FALSE or when it faults, and `requiresFeature`, a deployment feature flag from the `PUBLIC_AUTH_FEATURES` set, refused when unknown, lowered at parse into the group's `visibleWhen` and stripped, AND-combined after an authored `visibleWhen`; both are presentation only. The real example is `sys_organization`'s Group Structure section, hidden on a single-organization deployment with `requiresFeature: 'multiOrgEnabled'`. The text is paid for by deleting restatements in the same file (the intro sentence, the migrations paragraph, the deprecated-flag aside, the strictness sentence under Metadata Protection, a dangling "see above" and a path comment), so the file's token ceiling moves down, not up.
- 95ba410: docs(skills): the `objectstack-data` field-types formula row says a formula is no dataset or cube dimension (group key) either
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The `formula` row of `skills/objectstack-data/rules/field-types.md` said a formula is virtual and not aggregatable, and that a dataset measure needs a stored field. It said nothing about grouping by one, so an AI author reading the row had nothing telling it not to declare a dataset or `analyticsCubes` dimension over a formula.
  - **Now.** The row says a formula is neither aggregatable nor a dataset or cube dimension (group key), and that both need a stored field — what the platform refuses today: the authoring rule `dimension-virtual-field-refused`, the dataset compile's `400 DATASET_INVALID`, and every analytics query grouping by one, `400 INVALID_FIELD`.
  - `skills/objectstack-ui/rules/dashboards.md` (Dataset-Bound Widgets, the row's pointer): the multi-value breakdown bullet now names a `formula` beside the multi-value types as refused for a dataset or cube dimension and `groupBy`, so the reader lands on the dimension refusal too.
  - No schema, key or behaviour changes; the skill text only states refusals that already ship.
- d0ebb8f: Clause-②: no
  Metadata-protocol: none
  
  The platform skill's operations reference now says what the official image does on `main`: it refuses to start unless `OS_DATABASE_URL`, `OS_AUTH_SECRET` and `OS_SECRET_KEY` are set at runtime (an explicit `file:` URL on a mounted volume passes), and a Common ops pitfalls row tells an upgrade to keep the values an old container generated (`auth-secret`, `dev-crypto-key`, `data/objectstack.db` under `/home/node/.objectstack`) rather than set fresh ones, which would leave every saved credential unreadable.
- dc3adf3: docs(skills): the `objectstack-ai` skill's MCP tools table now teaches that `delete_record` needs `confirm: true` — a call without it is refused with `ACTION_CONFIRMATION_REQUIRED` (428), so the agent asks the human first, then retries. The row said only that `delete_record` is annotated destructive, so an agent following it was refused since the MCP tool started requiring confirmation.
  
  Clause-②: no
  Metadata-protocol: none
- cef3b8f: docs(skills): three skills describe a bare field ref in a predicate as the fault it is today, not a silent `null`
  
  Clause-②: no
  Metadata-protocol: none
  
  `objectstack-platform/references/operations.md`, `objectstack-data` and `objectstack-ui` said a bare field ref (`done` instead of `record.done`) "evaluates to `null`" and silently hides or never fires. It faults. On the server an `error` validation rule and a `requiredWhen` refuse the write and name the rule, an option `visibleWhen` refuses only a write that picks that option (forms still offer it), a `readonlyWhen` field stays editable on the form while the server drops the change with a warning and the save succeeds, and a formula reads `null` with a logged warning. In the console an action's `visible` hides it, its `disabled` greys it out, and a field `visibleWhen` shows the field, each with a console warning. The data skill no longer lists RLS / sharing predicates here: their compiler reads a bare name as the column. The prevention advice (`os validate` / `os build`, `record.<field>`) is unchanged. Growth is paid by same-file deletions of restated prose.
- 33bc8ae: docs(skills): the `fieldPatches` example relabels HotCRM's `industry` and patches options only on a field that declares its own
  
  Clause-②: no
  Metadata-protocol: none
  
  The `objectstack-data` skill's one `fieldPatches` example patched an option of `crm_account.industry`. HotCRM binds that field to the shared `industry` picklist, so a verbatim copy was refused at install and by `os validate` (`picklist-option`). The example now sets `industry`'s `label` only and patches an option of `type`, which declares its own `options` (`customer` → `Client`). The added bytes are paid by deleting a restatement in the same file: the `.custom` paragraph's closing clause "a base field changes only through `fieldPatches`", whose facts the relabel paragraph above it already states. No token ceiling moves. No schema, key or behaviour changes.
- 0306761: docs(skills): objectstack-api no longer teaches that `DELETE` is a hard delete with no recycle bin: a by-id delete keeps a business object's rows in `sys_recycle_bin` (30 days by default; not `multi: true` deletes, platform rows or rows deleted before the bin existed), and nothing lists or restores it over the API yet; eval case 5 expects that teaching instead of a hard delete
  
  Clause-②: no
  Metadata-protocol: none
- 719a502: docs(skills): the objectstack-automation skill names the `save_notice` flow node and points to the save notice's one home
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-automation/SKILL.md` listed no `save_notice` node, so an author designing a "sent for approval" flow from this skill never found it. Its Data Operations table now carries a `save_notice` row that points at `objectstack-data` `rules/lifecycle.md` § Save Notice, which stays the one full teaching. That section gains what the code does and it lacked: a hook's `ctx.notice` message is shown untranslated; a `save_notice` message translates under `flows.<flow>.notices.<node_id>.message` in the saver's locale; the node refuses by name in a `subflow` / `map` child, and a flow with one after a `subflow` / `map` whose child can pause is not armed (`unboundCause: 'notice_after_suspending_subflow'`). `evals/flows-triggers-approvals.json` gains case 16. Growth in both files is paid by same-file deletions of restated text; no ratchet row moves.
- aa3e21c: docs(skills): the data skill teaches `controlled_by_parent` with an optional master
  
  Clause-②: no
  Metadata-protocol: none
  
  `objectstack-data` now teaches "a rep sees the contacts of the accounts they own; a contact need not have an account" as a `controlled_by_parent` detail whose only `master_detail` is declared `required: false` (an optional master), not as an owner field copied by hooks. A row with no master is its owner's: the owner or View All on the detail reads it, the owner or Modify All writes it, an insert naming no master is admitted, setting a master asks edit on it, emptying one asks edit on the stored master (`ownerMayEdit` does not cover that), and a chain hop with no master ends there under the same rule. The `relationship/master-detail-required` lint row names the optional master, and the membership-key notes say a `valueField` cannot be the roster's own `id` (`membership-key-value-field-invalid`). The platform behaviour shipped earlier in `@objectstack/spec`, `@objectstack/lint` and `@objectstack/plugin-security`; this release only teaches it.
- 8acbfab: docs(skills): objectstack-ai's MCP tools table teaches `run_action` / `resume_run`'s confirmation gate and the `delete_records` tool
  
  Clause-②: no
  Metadata-protocol: none
  
  The table taught the `confirm: true` gate for `delete_record` only. It now says that an action flagged `ai.requiresConfirmation` is refused by `run_action` and `resume_run` with `428 ACTION_CONFIRMATION_REQUIRED` unless the call sends `confirm: true`, and lists `delete_records`: up to 200 records of one object per call, by `where` or `recordIds`, whose unconfirmed call is the preview and deletes nothing, and which needs `data:read` and `data:write` over OAuth.
- 226c988: docs(skills): the objectui i18n guide teaches the platform locale table's tags (`zh-Hans`, `zh-Hant`, `pt-BR`) for the built-in packs, a language switcher fed by `PLATFORM_LOCALES`, and the read aliases that keep a stored `zh` / `zh-CN` / `zh-TW` / `pt` resolving
  
  Clause-②: no
  Metadata-protocol: none
- e2b5773: docs(skills): objectstack-data's datasources rule states the organization scope an external object declares under a walled tenancy posture
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The datasources rule taught `external` bindings, `columnMap`, auto-connect and credentials, and said nothing about what an external object's rows are to the organizations of a walled deployment.
  - **Now.** One bullet under *Federated (external) objects*: under `OS_TENANCY_POSTURE` `isolated`/`group` every external object states its organization scope — its own `organization_id` field (or `columnMap` onto it), `tenancy: { enabled: false }` (shared), or `systemFields: { tenant: false }`; none refuses the boot by name, and `tenancy.tenantField` is refused there too. Paid within the file's token ceiling (910 → 908 of 911) by trimming the auto-connect footnote, the managed-datasource sentence and the credentials paragraph; no ceiling moves.
- 2178d80: docs(skills): the objectstack-data seeds reference now teaches the seed modes the loader runs: `ignore` is the default (create-only), `replace` deletes nothing (it inserts into a table the caller cleared), and `insert` duplicates on each replay. It also says that AppPlugin's boot and organization replays do not re-insert a seed row a person deleted (a publish or package install keeps no record, so the row comes back there), and that `seed-replayer` with `{ reseed: true }` restores it. The data-modeling seed guide teaches the same rule and names the loads that keep no record.
  
  Clause-②: no
  Metadata-protocol: none
- cbe20ab: docs(skills): validation examples guard nullable fields, hooks teach `body`, the `requires:` table names `mailbox` and `package-registry`, `os generate` drops `agent`
  
  Clause-②: no
  Metadata-protocol: none
  
  `objectstack-data` `rules/validation.md` now guards every ordering or arithmetic operand in its examples with `!= null` (the due-date, date-range, amount, discount and order-total predicates) and states the rule once: an unguarded `<` or `+` on a field with no `required: true` / `defaultValue` is refused at publish. Its external-validation hook and the `examples-objects.md` lifecycle hook are written as a sandboxed `body`, and the `SKILL.md` index names the inline `handler` only as the deprecated form; the validation section says a `body` has no outbound HTTP, so an external-API check goes through a Connector recipe. `objectstack-platform` lists `mailbox` (`@objectstack/service-mailbox`) and `package-registry` (`@objectstack/service-package`) in the `requires:` table, and `references/operations.md` no longer offers the retired `os generate agent`. The platform behaviour already shipped; this release only teaches it.
- 658d84f: docs(skills): the platform skill's `requires:` table marks the always-on tokens
  
  Clause-②: no
  Metadata-protocol: none
  
  `objectstack-platform`'s `### requires:` no longer calls every listed service opt-in. The table marks each token of `PLATFORM_ALWAYS_ON_CAPABILITIES` (`queue`, `job`, `cache`, `settings`, `email`, `storage`, `sms`, `sharing`, `messaging`, `analytics`, `package-registry`) with °, and the lead says every boot mounts them, listed or not, while `--preset minimal` drops exactly those. The `auth` → `email` rule now says it holds under `--preset minimal` too, and the `triggers` + `job` pairing is scoped to `--preset minimal`. The `queues` / `assignmentRules` paragraph no longer says `sharing` must be in `requires:`. The skill's evals for silent scheduled flows and notifications, and for an ownership queue, no longer expect `job`, `messaging` or `sharing` in `requires:`, and a new eval case asks whether an always-on service must be listed. The platform behaviour already shipped; this release only teaches it.
- e0b8c2c: docs(skills): the platform skill teaches `os deploy`, the managed-package dev loop
  
  Clause-②: no
  Metadata-protocol: none
  
  `objectstack-platform/references/operations.md` gains an `os deploy` row in "Environments & deploy": use it to see an edit on the organization's ObjectOS Cloud environment (also `npm run deploy` in a scaffolded project, or `d` in `os dev`); it builds, publishes `<manifest.version>-dev.<timestamp>`, installs that version and waits until the environment serves it. The row names how the environment is picked (`--env`, else the one `os environments switch` recorded, kept across `os cloud login`, else the organization's only one) and the `--no-wait` and `--wait-timeout` flags. A short paragraph reads an `os deploy` exit 1: a refusal before any write (with no environment at all, create one in the ObjectOS Cloud console), the environment's own build failure, and the wait timeout, each with the next step. `SKILL.md`'s Part 3 pointer names `os deploy`. Eval 17 of `evals/config-plugins-ops.json` asks how to see a change on the environment and expects `os deploy`. Paid inside `operations.md` by deleting four restatements (the `os dev` row's platform-admin sentence, the `os validate` row's gate summary, the "Both run the same gates:" lead-in, the Docker row's list of the official image's three required variables); the remainder raises that file's token ceiling by the measurement.
- 620b6e6: docs(skills): drop the "separate objectui repo" teaching, list objectui in the catalog index, repair three dead anchors, and author `sharingModel` in the object examples
  
  Clause-②: no
  Metadata-protocol: none
  
  - `objectui`: the README installs the skill from `@objectstack/skills` with the pinned `experimental_sync` command the catalog README teaches, instead of `npx skills add objectstack-ai/objectui`, and its source link and `page-builder.md`'s `plugin-gantt` link point at `ui/` in this repository. The catalog README's "Related repositories" entry points there too.
  - The generated skill index in `skills/README.md` and the docs Skills reference now list `objectui` (eleven skills). The generator admits every skill directory with a `SKILL.md` that is not `metadata.internal`, instead of only `objectstack-*` names.
  - Dead links fixed: `data-hooks.md`'s reference to a hooks section the data `SKILL.md` no longer has is removed, and `plugin-lifecycle.md` / `service-registry.md` point at `references/plugin-development.md`, where the Complete Plugin Example and the Well-Known Plugin Names table live.
  - `bootstrap.md`'s starting `package.json` pins `18.3.0`, the version every skill now carries.
  - Every complete `ObjectSchema.create` example in `relationships.md`, `lifecycle.md` and `datasources.md` authors `sharingModel`, because a publish without one is refused with `security-owd-unset`. Master-detail children use `controlled_by_parent`, and the read-only external object uses `public_read`.
  - `indexing.md`: the tenant column is `organization_id`, injected by `systemFields.tenant`, not an authored `tenant_id`.
  - `objectstack-query`: teaches `$empty`, the is-empty-by-declared-type operator that the view filters `is_empty` / `is_not_empty` lower to.
  - `objectstack-upgrade`: the `skills remove` roster also removes a 17.x `objectui` install (sourced from `objectstack-ai/objectui`), and says `objectstack-pm-dispatch` is not in the 18 catalog.
  - New eval cases cover the authored `sharingModel`, the `organization_id` tenant index and `$empty`. The touched files stay inside their token ceilings by removing restatements in the same files. No schema, key or behaviour changes.

## 18.3.0

### Minor Changes

- a9f654e: feat!: ownership queues: records wait in a queue until a member claims them, and assignment rules route new records (ADR-0142)
  
  Clause-②: yes (narrowing)
  Metadata-protocol: narrowed
  
  <!-- adr-0087: registered object-queue-field-reserved -->
  
  **BREAKING** for one shape only: an object whose records have a user owner (`ownership: 'user'`, the default) can no longer declare its own field named `queue`. The platform now injects a `queue` column on every such object, and `registerObject` refuses the declaration with `422 INVALID_METADATA` (`ObjectQueueColumnRefusedError`), naming the object. An `objectExtensions` entry that declares `queue` on such an object is not refused, because an extension is folded over its object at read time: its `queue` is ignored, the platform's column stands, and a warning names the extension. The remedy: rename the business field (for example `support_queue`) and copy its data across, or, when the object's records have no user owner, declare `ownership: 'business_unit'`, `'org'` or `'none'`. The upgrade guide entry is `object-queue-field-reserved`.
  
  Beside that, two enum additions: `ShareRecipientType` gains `queue` (a sharing rule can now name a queue as its recipient), and the `queue` approver type is authorable again (it leaves `NON_AUTHORABLE_APPROVER_TYPES`, so it is no longer marked deprecated). Two metadata types are new: `queue` and `assignment_rule`.
  
  - **`@objectstack/spec`**: new `queue` and `assignment_rule` metadata types (`QueueSchema`, `AssignmentRuleSchema`) and the stack keys `queues` and `assignmentRules`. A declared queue's members are positions. New `IOwnershipQueueService` contract, registered under `ownership-queue`. `queue` joins the injected system columns of `ownership: 'user'` objects and `PUBLIC_FORM_SERVER_MANAGED_FIELDS`. `APPROVER_VALUE_BINDINGS.queue` reads both a declared queue and an organization's `sys_queue` row, and `APPROVER_ORG_SCOPED.queue` is `true`. The explain rule kinds `queue_membership` and `queue_claim` are new. `QUEUE_NOT_FOUND` (422) is registered under plugin-security.
  - **`@objectstack/objectql`**: objects with `ownership: 'user'` get a system-managed `queue` column beside `owner_id`. Declaring your own `queue` field on one is refused at registration (`INVALID_METADATA`), and an extension's own `queue` field on one is ignored with a warning. An update can carry a write precondition: when it no longer matches, the update answers `409 CONCURRENT_UPDATE`. Declared assignment rules run once for each inserted row that has no owner and no queue after the `beforeInsert` hooks. A rule can park the row in a queue, or pick a member by `round_robin` or `least_loaded`. Assignment never refuses an insert. `kernel:ready` refuses to boot a stack that declares queues or assignment rules when no `ownership-queue` service is registered.
  - **`@objectstack/metadata-core`**: `queue` is classified as an injected system column.
  - **`@objectstack/metadata`**: the artifact door registers a stack's `queues` and `assignmentRules`, so an artifact-only runtime serves them.
  - **`@objectstack/plugin-sharing`**: three new objects, `sys_queue`, `sys_queue_member` and `sys_assignment_cursor`, and the `ownership-queue` service. The service resolves a queue name from the registry first, then from the organization's own rows, and has one member expander. A record with no owner that sits in a queue can be read and edited by the queue's members, never deleted. The `queue` sharing recipient grants matched records to the queue's members, and its grants are recomputed when membership changes or the queue is switched on or off.
  - **`@objectstack/plugin-security`**: the owner gate handles `queue`. A **claim** sets `owner_id` from empty to yourself, by id. It is admitted when the sharing model allows you the record, and only one claimant wins: the loser gets `409`. A **release** gives your own record back to its home queue. A **move** to another queue needs the transfer grant, and a queue name that does not resolve is refused with `422 QUEUE_NOT_FOUND`. An insert that names a queue needs the transfer grant or membership of that queue. A guest can supply neither. Explain reports the queue reasons on the sharing layer.
  - **`@objectstack/plugin-approvals`**: a `queue` approver resolves to the queue's members when the step opens. An empty queue adds nobody and logs a warning. The `queue:<name>` placeholder is never written again.
  - **`@objectstack/lint`**: a queue-only approval node is reported `approval-approvers-may-resolve-empty`, and the org-axis red line admits the queue recipient. Two new advisory rules come with `os explain` entries: `assignment-rule-user-target` (warning) and `assignment-rule-queue-unstaffed` (info).
  - **`@objectstack/cli`**: the organization-ownership inventory lists `sys_queue`, `sys_queue_member` and `sys_assignment_cursor`, so `os migrate organization-ownership` plans them instead of refusing.
  - **`@objectstack/runtime`**: `POST /security/_activation/:type/:name` also switches a declared `queue` or `assignment_rule` on and off.
  - **`@objectstack/platform-objects`**: the two new metadata types' labels, and the queue recipient option, are translated in zh-CN, ja-JP and es-ES.
  - **`@object-ui/app-shell`**: the flow designer no longer warns that a queue approver resolves to nobody.
  - **`@objectstack/skills`**: the platform skill lists `queues` and `assignmentRules` among the stack's top-level keys.
  
  What to do: rename any `queue` field on a user-owned object, or in an extension of one, as above. Every other existing stack behaves as before. To use queues, declare `queues` and `assignmentRules` in your stack, and make sure plugin-sharing is installed: it registers the `ownership-queue` service.
- e3470ed: feat(security)!: `current_user.queues` is resolved by the platform from the ownership-queue service, and `queues` joins the reserved `current_user` keys (#27016)
  
  Clause-②: no (narrowing) — `queues` joins `RESERVED_RLS_MEMBERSHIP_KEYS`, so an object's `membershipKeys` may no longer declare a key named `queues`, and a registered membership resolver's `queues` answer is screened off. Nothing is widened past what the platform itself resolves: where no app supplied the key, a policy reading `current_user.queues` matched no rows before, and now it matches the caller's own queues.
  Metadata-protocol: narrowed
  
  <!-- adr-0087: not-required (no-migration-prescription) No key, export or type is removed or renamed: one name is added to the reserved list, which makes a membership key of that name refused at parse. The replacement name is the author's to choose, so there is no mechanical rewrite to prescribe and no tombstone. -->
  
  **BREAKING** accept-set narrowing in `@objectstack/spec` (`MembershipKeyNameSchema`, read through `ObjectSchema.membershipKeys`) and at the membership resolver screen in `@objectstack/plugin-security`.
  
  - **Now.** A row-level security policy can read `current_user.queues`: the machine names of the ownership queues the caller belongs to in the active organization, directly or through a position, team or unit, as each queue's members define. The security plugin resolves it from the ownership-queue service's `queuesOf`, the same membership answer the claim gate's `isMember` reads, once per request and only when a policy about to compile reads the key. For example `owner_id == null && queue in current_user.queues` lets queue members read the unowned records sitting in their queues.
  - **One source.** No other source can supply the key. A registered `rls-membership-resolver` that answers `queues` has that answer dropped with a WARN, a `rlsMembership` bag entry or a `queues` field on the execution context is never read, and a context copied for another user or organization does not carry the set. With no signed-in user, no ownership-queue service, or a membership read that fails, the key stays unresolved and every policy reading it matches no rows.
  - **Who moves.** An object that declares `membershipKeys: { queues: … }`, or a membership resolver that lists `queues` among its keys. Census on this repository at 7eb613c3: none in `packages`, `examples`, `qa`, `skills` or `content`.
  
  **The remedy.** Rename the membership key. `queues` is resolved by the platform; choose a name that says what your set holds.
- 6dbff8e: feat(spec,ui)!: the record page's `slots.tabs` is retired — a slotted page fills six slots, and a page that needs its own tab strip is `kind: 'full'`
  
  Clause-②: no (narrowing)
  
  Metadata-protocol: narrowed (`page.slots.tabs` is a tombstone that refuses every value; `slots.related` / `slots.relatedLists` are refused by name instead of being read as `tabs`)
  
  <!-- adr-0087: registered page-slots-tabs-removed, page-slots-tabs-retired -->
  
  **BREAKING** accept-set narrowing on the record page (`@objectstack/spec`), with the console following it in the same release.
  
  The record page composes its tabs and columns from the object's roles and relationship flags. An authored `tabs` slot replaced that whole strip, so a page that used it lost every synthesized related list and its wide-screen columns. The slot is gone; the six live slots (`header`, `actions`, `alerts`, `highlights`, `details`, `discussion`) are unchanged.
  
  - **FROM → TO.** `slots: { tabs: … }` on a `kind: 'slotted'` page → delete the key. To change which related lists appear or their order, set `relatedList` / `relatedList: 'primary'` on the child's reference field; to replace the Details body, author `slots.details`; a page that needs its own strip is `kind: 'full'` and authors its header, highlights, `page:tabs` strip and `record:discussion` in `regions`, drawn as authored.
  - **The one-line fix.** `os migrate meta --from 17` lists the edit for existing sources, and `--write` applies it. A stored `sys_metadata` page is converted when it is read (the `page-slots-tabs-removed` conversion): the slot is dropped, and a page whose only slot it was becomes an empty slotted page, which renders the synthesized default. Whether such a page should become `kind: 'full'` is a judgement the conversion cannot make; the upgrade guide entry `page-slots-tabs-retired` lists it.
  - **What the parse says.** `slots.tabs` is refused with its prescription ("`page.slots.tabs` was removed in @objectstack/spec 18.3.0 (ADR-0085) — …") at `defineStack` as `STACK_SCHEMA_INVALID` / 422, and at the metadata save door. `slots.related` and `slots.relatedLists` are refused by name with the same remedy. TypeScript rejects `tabs` in a `definePage` slot map.
  - **The pair check.** `checkPageSlotPair` (the `details` + `tabs` refusal) is removed from `@objectstack/spec/ui` with the slot it paired; the `page-slots-details-beside-tabs-refused` upgrade entry is folded into `page-slots-tabs-retired`.
  
  The four in-repo pages that authored `slots.tabs` are rebuilt as `kind: 'full'` pages that render the same nodes in the same order: `sys_user_detail` and `sys_organization_detail` (`@objectstack/platform-objects`), `sys_approval_request_detail` (`@objectstack/plugin-approvals`) and the showcase `showcase_project_detail`.
  
  The console (`@object-ui/*`): `buildDefaultPageSchema` composes from the six slots only, and `RecordDetailView` lays every slotted page out by width (three columns from 1280 px), since none can opt out with an authored strip any more. `@object-ui/types` drops the pair check from its page schemas and types `PageSlotMap.tabs` as `never`. The Studio slot canvas lists six slots.
  
  `@objectstack/skills`: the UI skill says a slotted page has no `tabs` slot and how to shape the strip instead.
- c63ce2a: feat(spec): an object declares the business order of its related lists (`relatedLists`), and `relatedList: 'primary'` places a list instead of ordering it
  
  Clause-②: yes (widening)
  Metadata-protocol: semantic
  
  The order of a record page's related lists was not authorable: owned (`master_detail`) children came first and lookup children after, each in the order the packages declared them, so a lead's related lists were in an order nobody chose.
  
  - **`@objectstack/spec`**: `ObjectSchema` gains `relatedLists?: string[]`, beside `highlightFields`. It is an ordered list of inbound relationships, most important first. Each entry is a child object name (`'task'`, every list of that child) or `object.field` for one FK when the child points at this object through several (`'event.related_to'`). Listed lists come first in that order, and the rest follow in the old derived order. `defineStack`, and so `os validate` and `os build`, refuses an entry that matches no inbound `lookup` / `master_detail` field with `STACK_CROSS_REFERENCE_INVALID`, naming the entry and the relationships that do exist. A child declared only by a sibling package, or a platform object, is not judged there. The runtime publish door gives the same verdict on an object write (`related-list-ref-unknown`, HTTP 422 `INVALID_METADATA`), judged against the objects the registry and the stored rows hold, so a Studio, REST or MCP author is refused too. `ObjectFieldGroupSchema` gains `relatedList?: string`, spelled the same way: a group that carries it stands for that list's table in the record's details column instead of a section of fields, and a field that names such a group as its `group` is refused at parse. The record page v3 layout draws that placement; until then such a group is not drawn, as any group without fields is not. The Studio object form offers both keys.
  - **`relatedList: 'primary'` changes meaning.** It no longer orders lists; `relatedLists` does. It now says where a list is drawn: in the record's body as a full-width table rather than as a side card, which on today's tabbed record page is still its own tab. And a `master_detail` FK that sets `inlineEdit` (any arm) and declares no `relatedList` is now `'primary'` by default, so inline-edited line items get their own tab on the tabbed page. Write `relatedList: true` on that FK to keep the old placement in the shared Related tab. `relatedList: false` still hides a list whatever `relatedLists` says.
  - **`@object-ui/app-shell`**: `deriveRelatedLists` resolves the order in one pure function, `resolveRelatedListOrder`, and marks the inline-edit default as `isPrimary`. Studio's related-list control on a relationship field reads that default too: an inline-edited `master_detail` with no `relatedList` shows as Primary, and picking Show there writes `relatedList: true`.
  - **`@objectstack/lint`**: new reference-integrity member `validateRelatedListRefs` (rule `related-list-ref-unknown`, `error`), on the CLI and on `object` writes at the runtime publish gate. A child the snapshot does not hold is refused only when no package closure is in force; under a closure it is not judged.
  - **`@objectstack/metadata-core`**: the served object's field-level-security scrub classifies `relatedLists` and a field group's `relatedList` as relationship names, not fields of the object, so a caller denied a field still receives them.
  - **`@objectstack/platform-objects`**: the two new form rows are labelled in en, zh-CN, ja-JP and es-ES.
  - **`@objectstack/skills`**: objectstack-data's relationship rules teach `relatedLists` and the placement reading of `'primary'`; objectstack-ui's related-list bullet follows.
  
  In this repo three record pages move on merge, each gaining its own line-items tab out of the shared Related tab: `crm_opportunity` (its `crm_opportunity_line_item.opportunity` FK), `showcase_invoice` (`showcase_invoice_line.invoice`) and `showcase_expense_report` (`showcase_expense_line.expense_report`). Each FK sets `inlineEdit: 'grid'` and declares no `relatedList`.
  
  What to do: nothing, unless an object has a `master_detail` child with `inlineEdit` that should stay in the shared Related tab; write `relatedList: true` on that FK. To choose the order of an object's related lists, declare `relatedLists` on it.
- 73b7270: feat(spec): `currencyConfig.homeAmount: { field, rateDate, rateField }` — a record-mode amount declares its stored home-currency amount by pointer (ADR-0144 D5)
  
  Clause-②: yes (widening)
  Metadata-protocol: added
  
  ⛔ Not released alone: this ships in the same release as the write-time home-currency projection that fills these fields (ADR-0144 D9, release R2: "the `homeAmount` key never ships ahead of the engine").
  
  An amount in `currencyMode: 'record'` can now declare where its value is stored after conversion into the organization's home currency (the `localization.currency` setting), which date picks the exchange rate, and where the rate used is stored. Consolidated totals then aggregate the home field like any other stored currency field.
  
  ```ts
  fields: {
    currency_code: Field.text({ label: 'Currency', valueDomain: 'iso_4217_currency' }),
    invoice_date: Field.date({ label: 'Invoice date' }),
    amount: Field.currency({
      label: 'Amount',
      currencyConfig: {
        currencyMode: 'record',
        currencyField: 'currency_code',
        homeAmount: { field: 'amount_home', rateDate: 'invoice_date', rateField: 'amount_rate' },
      },
    }),
    amount_home: Field.currency({ label: 'Amount (home)', readonly: true }),
    amount_rate: Field.number({ label: 'Rate used', readonly: true }),
  }
  ```
  
  - **Three required pointers.** When `homeAmount` is declared, `field`, `rateDate` and `rateField` must all be given, and none may be empty. There is no default, no injected column and no fixed field name. The document date is never taken from `created_at`. `homeAmount` is refused under `dynamic` and `fixed`.
  - **What the pointers name, refused at parse with a remedy and the object's candidates.** Each refusal is located at `fields.AMOUNT.currencyConfig.homeAmount.POINTER`.
    - `field` must name another `currency` field of the same object in `dynamic` mode (it displays in the home currency, so metadata never names that currency). No other amount may already store into it.
    - `rateDate` must name a `date` or `datetime` field.
    - `rateField` must name a `number` field. Two amounts may share it only when they have the same `currencyField` and `rateDate`.
    - The amount itself must be a stored `currency` field. A `formula` amount is refused.
  - **The home and rate fields are written by the platform only.** They must declare `readonly: true`, the existing mark that drops a client's write of the field, and no `expression`.
  - **Skills:** `objectstack-data/rules/field-types.md` teaches `homeAmount`. Its field names (`amount_home`, `amount_rate`) are examples, not a contract.
  - **Nothing to migrate.** `homeAmount` is new, and no existing config changes meaning.
- fbb8bec: fix(spec): a count roll-up saves without `summaryOperations.field`
  
  Clause-②: yes (widening)
  Metadata-protocol: added
  Skills-docs: updated here — `skills/objectstack-data/rules/field-types.md` spells `field?` in the `summary` config row, with "(omit for `count`)"; the same file's `sum` example drops its now-duplicate "ignored for count" comment, so the file's size is unchanged.
  
  The description of `summaryOperations.field` always said it is ignored for `count`, yet the schema required it for every function, so a count roll-up with no child field was refused (`422 INVALID_METADATA` at `fields.<name>.summaryOperations.field`, "expected string") and Studio's author had to pick an arbitrary child field to save one. The schema now follows its own description:
  
  - **`count` may omit `field`.** A count counts the matching child rows and reads no field, so `{ object, function: 'count' }` parses and saves as written. A count that carries a `field` is still accepted, and the field is still ignored.
  - **Every other function still needs it.** `sum`, `min`, `max` and `avg` without `field` are refused at `summaryOperations.field`, and the message names the function and the fix: name the child field to aggregate, or use `function: 'count'`.
  - **One rule, read twice.** `summaryFunctionReadsField(fn)` (exported from `@objectstack/spec/data`) is where "does this function read a child field" is written. The schema's refusal reads it, and Studio's roll-up editor reads it: for a count the editor offers no "Child field to aggregate" control, only a note that a count needs none, and saves the roll-up without `field`.
  - **The engine counts it.** The roll-up index carries no source field for such a count (`SummaryDescriptor.sourceField` is now optional), and the recompute and bulk-insert paths count child rows without reading one, as they already did for every count.
  - **Published JSON Schema.** `summaryOperations.field` is no longer in `required`; the "required unless `count`" rule is a refinement the JSON Schema does not state, so `summaryOperations` joins the dropped-refinements ledger at each schema that embeds a field.
  - **Metadata forms.** The `field` sub-row of the roll-up composite (field editor and object quick-add grid) is no longer marked required; its help text, "ignored for count", is unchanged.

### Patch Changes

- 09abc05: docs(skills): the objectui testing guide stops teaching msw and shows a fetch double over the real adapter
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `skills/objectui/guides/testing.md` taught "MSW for API mocking in integration tests" with `import … from 'msw'` and `msw/node`. No package in this stack declares `msw` any more, so a test written from the guide cannot resolve its imports.
  - **Now.** The subsection shows the pattern this repository's own integration tests use: a `vi.fn` passed as the `fetch` of a real `ObjectStackAdapter`, so the adapter and client run and only the wire is faked. It names one real test as the worked example. The guide stays within its token ceiling (3101 of 3101).
- 4df40e2: docs(skills): objectstack-upgrade says a stored row in a ≤16.x shape stops being rewritten at read on 18.3, and teaches the stored pass on 18.2 or earlier first
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** § "Stored rows" said every stored-row rehydration replays the conversion chain including entries retired from the load path, so "a row written under protocol 16 therefore rehydrates in its protocol-17 shape without anybody editing it", and offered `os migrate meta --stored --apply` only as a way to make that durable. § 3.6 called the read-time rehydration "still the guarantee", the report template marked the stored pass optional ("rows rehydrate correctly today"), and eval 4 expected the same answer. On 18.3, which drops every conversion retired at or below 16.x, that advice leaves such a row unconverted for good.
  - **Now.** The section says rehydration replays only the conversions the installed release still carries, that 18.3 drops those retired at or below 16.x, and to run the stored pass on the release being left (18.2 or earlier for such a row) before moving; § 3.6 says the `os migrate meta --stored --json` exit `0` counts only on the release being left, because one that dropped a row's conversions answers `0` without recognising the row; the report template's stored-pass line says it is owed before any release that drops the rows' conversions. Eval 4's expected answer says the same, and new eval 5 asks the 18.1 → 18.3 question directly.
  - `SKILL.md` and `references/examples-upgrade.md` stay under their token ceilings (no ceiling moves). No schema, key, command or behaviour changes.
- 501bfc6: docs(skills): objectstack-data, -automation and -platform teach ownership queues and assignment rules (ADR-0142 phase 2), one eval each
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The `queue` and `assignment_rule` metadata types, the `queues` / `assignmentRules` stack keys, the reserved `queue` column, the claim / release / move verbs, the `queue` sharing recipient and the `queue` approver type shipped in the spec and the docs, but no published skill taught them — `objectstack-platform` listed the two keys without a sentence, and no eval exercised any of it. An agent authoring an app from the skills could route an ownerless record only by hand-rolling it: a per-record picklist, a round-robin counter field, or a hook that picks an owner.
  - **Now.** `objectstack-data` gains *Ownership queues — park a record for a team to claim* (the injected `queue` column, a compiled `defineQueue` example, claim / release / move in one sentence each) and `rules/security.md` the `queue` sharing recipient and the `current_user.queues` placeholder; `objectstack-automation` gains *Assignment rules — route a new record to a queue or a person* (a compiled `defineAssignmentRule` example with `criteria`, `assignTo: { type: 'queue' }`, `strategy` and `load`, and the `queue` approver pointer); `objectstack-platform` says what `queues` and `assignmentRules` are and that both need `sharing` in `requires`. One eval per skill asserts the declared shape and refuses the hand-rolled alternatives.
  - Every file stays at or under its token ceiling: the new text is paid for by folding sentences the same skill's `rules/**` and `references/**` already hold, and by tightening existing eval model answers. No ceiling moves, no frontmatter changes, no schema, key or behaviour changes.
- f986702: docs(skills): objectstack-automation says a `runAs: 'system'` flow is refused identity-assignment writes, and names the remedy
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The `runAs: 'system'` guidance called system context the trusted-writer channel and never said that a system flow's insert, update, delete, transfer, restore or purge of `sys_user_position`, `sys_user_permission_set`, `sys_invitation` or `sys_member` is refused with `PERMISSION_DENIED`. An agent following the skill wrote a system flow to grant a permission set and met the refusal at run time.
  - **Now.** A paragraph beside "Elevate the write, not the flow" states the refusal, says a dedicated system subflow does not lift it, and gives the remedy the refusal prescribes: grant positions and permission sets from a flow whose `runAs` is `'user'`, judged by the delegated-administration gate as the user it acts for; change invitations and memberships through the organization endpoints. Eval 11 in `evals/flows-triggers-approvals.json` checks that an answer routes such a grant through a `runAs: 'user'` flow.
  - No schema, key or behaviour changes.
- a76f811: fix(skills): objectstack-automation eval fixtures 5, 7 and 8 agree with their own assertions
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** Three ideal answers in `evals/flows-triggers-approvals.json` failed the assertions that grade them: eval 5 spelled the negated error-label string inside its answer, eval 7 never spelled the `type: 'position'` approver it requires and spelled the negated positions check, eval 8 never spelled the `type: 'screen'` flow kind it requires. Graded against those assertions, a correct answer scored wrong.
  - **Now.** The three ideal answers say each negation in words, eval 7 names `approvers: [{ type: 'position', value: 'finance_manager' }]`, and eval 8 opens with the flow kind. No fixture added or removed; the assertions and the skill's teaching are unchanged.
  - No schema, key or behaviour changes.
- b1b153a: docs(skills): objectstack-ui gains an eval for a report's `dateRange` and `exportOptions`
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The skill taught a report's `dateRange` in `rules/dashboards.md`, but no eval checked that an agent authoring a report reaches for `dateRange` on a `type: 'date'` dataset dimension and for `exportOptions` with `csv` / `xlsx`. An agent could hand-roll a `runtimeFilter` window on the date column, invent a report permission key for export, declare a second preset table, or place either key on a `joined` container, and nothing scored that wrong.
  - **Now.** A third eval file, `evals/report-period-export.json`, carries one report-authoring prompt whose assertions require `dateRange: { dimension, defaultRange }` and `exportOptions` with `'csv'` / `'xlsx'`, name the existing permission-set `allowExport` as the only export gate, and refuse a `joined` container, a `close_date` filter window, a `presets:` table and an invented permission key. `evals/README.md` lists the file.
  - No schema, key or behaviour changes.
- e269d3b: docs(skills): objectstack-automation says a paused screen's Next / Submit and step count are engine-served, never authored
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The `screen` node row described the fields an author declares and said nothing about the primary button or the step counter. An agent writing a wizard from the skill could hand-roll a "Submit" label or a "Step 2 of 4" into `fields`, or try to author `progress` on the screen node, and the skill did not say that the runtime answers both from the flow graph.
  - **Now.** The `screen` node row says that Next / Submit and "Step N of M" are not authored: when a screen pauses the engine reads the graph and serves `progress` (`nextScreen: 'none' | 'possible' | 'certain'`; `step` / `stepCount` only when every path agrees), and the runner labels the button and draws the counter from that alone. A `decision`, a `fault` edge, a loop back, a non-screen pause (`approval`, `wait`) or a `subflow` after a screen answers `possible`, which shows "Next" with no count. A `progress` key in the node `config` is refused; a hand-rolled label or counter in `fields` is wrong.
  - No schema, key or behaviour changes. No eval prompt: `evals/flows-triggers-approvals.json` sits at token-ratchet headroom 0.
- 4b8f8cd: docs(skills): the i18n skill's group table names `fields.{field}.inlineTitle` and `reports.{report}.blocks.{block}.{label,description}`
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-i18n/SKILL.md` did not name two keys the 18.2 translation bundle already accepts and the runtime already serves, so an AI author writing a bundle from the skill left a master-detail field's inline child-grid heading and a joined report's block headings in the authoring language. The `fields.{field_name}` row now names `inlineTitle` (addressed on the child object that owns the field; untranslated it keeps its authored text, with no fallback to the child's plural label), the `reports` sentence names `reports.{report}.blocks.{block_name}.{label,description}` (keyed by the block's required `name`), and one example row each, spelled as the shipped `app-crm` and `app-showcase` bundles spell them, follows the group table. The eval file gains one prompt covering both keys.
- 40264be: docs(skills): objectstack-formula evals check that a record name built from a select field reaches for `label(record.kind)`, and that a predicate never calls `label()`
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `skills/objectstack-formula/SKILL.md` teaches `label(record.f)`, but no eval in `evals/cel-predicates-formulas.json` exercised it: an agent authoring a record name from a select field could hand-roll a ternary over the stored value with hard-coded English or Chinese strings, and nothing caught it; nor did anything catch `label()` written into a validation rule, where it faults and aborts every write.
  - **Now.** Eval 6 asks for a `contract_version` name built from its `kind` select and expects `label(record.kind)` in an `F` formula, refusing a `== 'clean' ?` ternary. Eval 7 asks for a validation rule and a `visibleWhen` on the same object and refuses `label(` in either, expecting predicates over the stored value. Four sentences in evals 1, 2, 3 and 5 that restated their own `must_not_contain` assertions are gone; every fact and assertion stays.
  - No schema, key or behaviour changes.
- d7dd47a: docs(skills): the objectstack-platform skill teaches the `demoStaff` `manager` key — another entry's email, written as `manager_id` by the development boot (#26764)
  
  Clause-②: no
  Metadata-protocol: none
  
  The Demo accounts section of `objectstack-platform/SKILL.md` now names a line manager in its `demoStaff` example and says how the key behaves: `manager` is another entry's `email`; `os dev` writes `sys_user.manager_id` itself once every demo account exists and keeps a manager someone set by hand, so no seed hook writes it; a display name, an address no entry has, the entry itself or a loop is refused at load. One eval case in `evals/config-plugins-ops.json` expects the key and forbids a seed writing `manager_id`. Three restatements elsewhere in the skill were cut against the addition, each rule keeping its other home in the file; the remainder raises the file's token ceiling by the measurement.
- 4889e22: docs(skills): the objectstack-ui report example declares its download in `exportOptions` under the base object's `allowExport`
  
  Clause-②: no
  Metadata-protocol: none
  
  `rules/dashboards.md` 〈Report Configuration〉 taught a report's `dateRange` and not its `exportOptions`: the example now declares `exportOptions: { formats: ['csv', 'xlsx'] }` (optional `includeHeaders` / `fileNamePrefix`) and the note says who may download is the base object's permission-set `allowExport` and that a `joined` report takes neither key, paid for by folding the `dateGranularity` and `drilldown` restatements that the same file already teaches under Server-side date bucketing and Drilldown.
- e6e0faa: docs(skills): the actions rule, its eval and the i18n skill teach an action's `disabledReason`
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `ActionSchema.disabledReason` (the display-only sentence a greyed action shows beside its `disabled` predicate) was on the protocol, but no published skill named it. An agent authoring an action from the skill left the console's default "Not available for this record" in place, or wrote the reason into `description`.
  - **Now.** `objectstack-ui/rules/actions.md` has one bullet beside `disabled`: an I18nLabel, display-only, never a predicate or a gate; omitted keeps the console's default, a blank one is refused, and `disabledMessage` / `disabledTooltip` / `disabledHint` / `disabledText` are refused naming the key; the ReassignLead example carries it beside `disabled`. Eval 9 in `evals/views-apps-actions-pages.json` expects `disabledReason` beside a `disabled` predicate and forbids the reason in `description`; cases 5 and 8 are reworded so neither spells its own `must_not_contain` string. The `objectstack-i18n` group table lists `disabledReason` under `_actions.{action_name}` (and so under `globalActions.{action_name}`) beside `confirmText` / `successMessage`.
  - No schema, key or behaviour changes.
- 1bd7574: docs(skills): objectstack-formula eval case 4's reference answer names the refused date forms without spelling its own `must_not_contain` strings
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** Case 4 of `skills/objectstack-formula/evals/cel-predicates-formulas.json` refuses `new Date(` and `today() + ` in an answer, yet its own `expected_output` spelled both (`` `new Date()` `` and `` `today() + 45` ``), so a reference-grade answer was graded wrong.
  - **Now.** The reference answer says "never a JS `Date` / `Date.now()`" and "never date arithmetic on `today()` (it faults)", as case 7 names "the `label` macro". Every assertion and every fact stays: the CEL envelope seed, the determinism gate, `daysBetween(today(), record.close_date)`, the `{}` duration trap. A per-case cross-check (no `must_not_contain` string inside its own `expected_output`, every `must_contain` string present) reports 0 failures over all 7 cases; the file keeps its byte size, so its token-ratchet row does not move.
  - No schema, key or behaviour changes.
- 857cd3c: docs(skills): objectstack-i18n teaches the `books` translation group, with an eval for a two-language doc book
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The top-level group list in `skills/objectstack-i18n/SKILL.md` named fourteen of the bundle's fifteen groups and left out `books`, the group the spec added so a doc book's title and section titles follow the reader's locale. An agent writing a zh-CN bundle from the skill left the docs sidebar in one language or invented a key under `pages`.
  - **Now.** The list names `books` with its three keys — `books.{book}.label` / `.description` by `Book.name` and `books.{book}.groups.{group_key}.label` by each group's stable `key` — says the pages themselves localize through `doc.translations` and that a book's inline `translations` map stays retired; `os i18n extract --no-objects-only` seeds the group like every other. Eval 9 in `evals/bundles-locales-coverage.json` checks that an answer for a two-language manual spells the book label and a group label by key and never a `pages.*` key. Five eval sentences that restated a rule the skill already teaches were cut to pay for it.
  - No schema, key or behaviour changes.
- 5fe0b96: docs(skills): an objectstack-data eval asks for a hook's `refusals` catalogue instead of a sentence thrown from the body
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `references/data-hooks.md` teaches a hook's declared `refusals` catalogue (the body throws `{ code }`, the message is translated under `hooks.HOOK.refusals.CODE.message`), but no eval in `evals/hooks-security-seeds-datasources.json` exercised it: an agent asked for a refusal in a multi-language app could still write an English sentence into `throw new Error(...)`, which reaches zh-CN users untranslated, and nothing scored that wrong.
  - **Now.** Eval 7 asks for an `order` save refused over the account's credit limit in an app serving English and Chinese users, and expects `refusals: { CREDIT_LIMIT: { message } }` on the hook, a `language: 'js'` body that throws `{ code: 'CREDIT_LIMIT' }`, and the zh-CN sentence under the bundle's `hooks: { HOOK: { refusals: { CREDIT_LIMIT: { message } } } }`; it refuses a sentence on the throw (`new Error('`) and a `handler:` (a catalogue without a `js` body is refused at save). Five sentences in evals 1–5 that restated their own `must_not_contain` assertions are gone; every fact and assertion stays.
  - No schema, key or behaviour changes.
- f6e1db1: docs(skills): objectstack-formula gains an eval for a mail amount shown in each record's own currency (`currency:@path`)
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The skill taught `{{ amount | currency:@currency_code }}` for a mail template that shows each record's amount in that record's own currency, but no eval checked that an AI author reaches for it. An author could write a bare path after the colon (refused at authoring), hard-code one currency code for every record, or leave the argument out (the organization's default currency for every record), and nothing scored that wrong.
  - **Now.** Case 8 of `evals/cel-predicates-formulas.json` asks for an `email_template` that mails one overdue notice per contract with the amount in that contract's own currency. Its reference answer names the marked form, that only a mail template may read the code from the send's data, that the stored code is three capitals exactly as stored, and that a declared `variables` list must name the path or a root above it; the assertions require `currency:@` and refuse the bare path, a hard-coded code and the no-argument form. Six reference answers of existing cases are shortened where they restated a point they already make, with every assertion and fact kept.
  - No schema, key or behaviour changes.
- f7188b5: Clause-②: no
  Metadata-protocol: none
  
  objectui: the guides teach only what ships. `guides/project-setup.md`'s sample
  `package.json` no longer installs `@object-ui/plugin-ai` (retired; `18.2.0` was its
  last release), the AI row of `guides/page-builder.md`'s plugin catalog lists
  `plugin-chatbot` alone, and the README's package snapshot drops `plugin-ai` from the
  plugin list (18, not 19) and `vscode-extension` from the tooling line (the extension
  left the workspace). `evals/project-setup.json` case 1 (the full Vite + React setup)
  now fails an answer that installs the retired package.
- efb1620: docs(skills): objectstack-ui teaches the record page as the Console ships it, in one ordered rules file from the object's declarations to the reader's own choices
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `SKILL.md` described a record page with Details / Related / Timeline tabs and a shared Related tab for side cards, `rules/pages.md` and `rules/navigation.md` each carried a sentence of it, nothing taught `relatedListFilter`, the inherited row order, the six slots, `isDefault` or which record-page choices are the reader's, and an agent asked to "put the tasks first on the lead page" reached for a full page.
  - **Now.** `rules/record-page.md` says, in order: the object's declarations (`nameField`, `highlightFields`, `stageField`, `fieldGroups`, `relatedLists`, `editMode`) produce the page and the surface's width lays it out (two columns from 760 px, three field columns from 1120 px, a tab row that enlarges one panel); the relationship flags shape the related column (`relatedList`, `relatedListTitle`, `relatedListColumns`, `relatedListFilter`, rows in the child's default list-view sort); a `slotted` page overrides one of six slots and has no `tabs` slot; `kind: 'full'` is the escape hatch; a record opens in the drawer unless the object's list view declares `navigation: { mode: 'page' }` (`modal` / `split` / `popover` are refused); and the reader's Open-records choice, ⊟ right column, panel order and pane width are never metadata. `SKILL.md`, `rules/pages.md` and `rules/navigation.md` keep one pointer each, and `evals/record-page.json` grades the lead-page task as `relatedList: 'primary'` and the full-page ask as the list view's declaration.
  - The package's hand-authored markdown grows by 39 lines against a budget of 40, paid with the tab sentences the record-page retirements made false; the docs' "How a list opens a record" names the live modes and the reader's choices. No schema, key or behaviour changes.
- 7587fd4: docs(ui): package homepages and README links point at objectstack.ai/docs; objectui.org is retired
  
  Clause-②: no
  Metadata-protocol: none
  
  The ObjectUI documentation site at objectui.org is retired. Its pages now live in the ObjectStack docs, mostly under [User Interface](https://objectstack.ai/docs/frontend). Every `@object-ui/*` package's `homepage` and README links now go to the matching page there, and the old objectui.org addresses answer with a permanent redirect to the same page. The `description` fields spell the product name "ObjectUI". The `@objectstack/skills` bundle's ObjectUI skill links to the same pages. Nothing else changes in what these packages ship.
- a33fce2: feat(spec,plugin-form)!: `ObjectForm` lays a form out and no longer picks its container; the `object-form` block drops `formType: 'split'` and `SplitForm` retires, while the block keeps opening `drawer` and `modal` forms itself
  
  Clause-②: no (narrowing)
  
  Metadata-protocol: narrowed (the `object-form` block's `formType` refuses `split`; its `splitDirection`, `splitSize`, `splitResizable` and `sections[].pane`, the `object-master-detail-form` block's `sections[].pane`, and `FormViewSchema.splitDirection`, are tombstones)
  
  <!-- adr-0087: not-required (already-registered form-view-presentation-types-removed, ui-form-view-type-layout-only) 18.3.0 is unreleased, so this change widens those two entries in place: the conversion now strips splitDirection and reaches object-form page blocks, four new RETIRED_KEYS_BY_MAJOR rows record the tombstoned keys, and the D3 entry names the block -->
  
  **BREAKING** accept-set narrowing on the `object-form` page block and the form view (`@objectstack/spec`), and a removed export (`@object-ui/plugin-form`). ADR-0050, the renderer half of #27155.
  
  The model: a form's `formType` says how it lays out its sections. Where it opens is the caller's. On the `object-form` block the caller is the block itself, so `drawer` and `modal` stay there as the two containers the block opens; `split` drew two panes and had no other reader, so it leaves with its renderer.
  
  - **FROM → TO (block).** `formType: 'split'` → `formType: 'tabbed'` (one tab per section) or delete the value for `simple`; delete each section's `pane` and the block's `splitDirection` / `splitSize` / `splitResizable`. To edit child records beside the parent, use an `object-master-detail-form` block. `formType: 'drawer'` and `formType: 'modal'` are unchanged. The `object-master-detail-form` block's parent `sections` share the shape, so delete each section's `pane` there too.
  - **FROM → TO (form view).** `splitDirection` on a form view → delete it. It joins `splitSize` and `splitResizable`, which left in the same release.
  - **The one-line fix.** Delete the retired value and keys. `os migrate meta --from 17` lists the edits for existing sources, and `--write` applies them. A stored page or view row is converted when it is read (the `form-view-presentation-types-removed` conversion now reaches `object-form` page blocks, the section `pane` of `object-master-detail-form` blocks, and `splitDirection` too), so a block saved with `split` keeps loading as a `simple` form.
  - **What the parse says.** `formType: 'split'` is refused by name with its prescription ("'split' was removed from the `object-form` `formType` enum in @objectstack/spec 18.3.0 (ADR-0050) — …"); each tombstoned key is refused on every `formType`. TypeScript rejects each at the authoring site.
  - **`@object-ui/plugin-form`.** `ObjectForm` renders the `simple`, `tabbed` and `wizard` layouts only; a `formType` of `drawer` or `modal` on a node handed straight to `<ObjectForm>` now renders the inline form, and the host opens its own drawer or dialog around it (the console's New and Edit dialogs already mount `ModalForm` themselves). The registered `object-form` block routes `drawer` and `modal` through the new internal `ObjectFormContainer`, which hands the node to `DrawerForm` or `ModalForm` as before. `SplitForm`, `SplitFormProps` and `SplitFormSchema` are no longer exported, and the block no longer publishes the `splitDirection`, `splitSize` and `splitResizable` inputs. FROM `import { SplitForm } from '@object-ui/plugin-form'` → TO a `TabbedForm`, or the `form` renderer's `fieldPanes` for a host that composes panes itself.
  - **`@object-ui/types`.** `ObjectFormSchema.formType` is `'simple' | 'tabbed' | 'wizard' | 'drawer' | 'modal'`, and its `splitDirection` / `splitSize` / `splitResizable` are the spec's tombstones by reference; the section `pane` member is gone.
  - **Console.** Studio's page-block inspector no longer offers `Split` for an `object-form` (its `engine.inspector.pageBlock.option.formType.split` string is removed from `@object-ui/i18n`), the record page passes no split keys, and a view whose `type` is not one of the three form layouts is no longer taken for a form (`@object-ui/console`).
  - **Supersedes one line of the form view `type` entry (#27155).** That entry says `splitDirection` stays declared; in this release it leaves too.
  - **Unchanged.** `drawerSide`, `drawerWidth`, `modalSize` and `modalCloseButton` keep their readers: the block's drawer and modal containers. The enforce-or-remove question for `drawerSide` / `drawerWidth` on form views stays on #27153.
- 1e45a4e: docs(skills): the dashboards guide says how a record-currency amount behaves in a dataset measure; the code field's name is a convention
  
  Clause-②: no
  Metadata-protocol: none
  
  ⛔ Not released alone: this ships in the same release as the `currencyMode: 'record'` mode, its refusals and its per-row display (ADR-0144 D9, release R1).
  
  - **`objectstack-ui/rules/dashboards.md`**: a measure over a `currencyMode: 'record'` amount refuses a measure `currency` and an ungrouped `sum` / `avg` / `min` / `max`. Grouped by the amount's code field, its result column carries `currencyField`, which names the per-row code column, and a `count` column never does.
  - **`objectstack-data/rules/field-types.md`**: a record-mode amount's code field is named `currency_code` by convention, not by contract; any `text` field with `valueDomain: 'iso_4217_currency'` that `currencyField` names will do.
- b4eecd5: docs(skills/objectstack-ui): `pages.md` 〈Inline metadata views〉 states the embed scope `os build` enforces — this package or a package of the same artifact it declares in `manifest.dependencies`
  
  Clause-②: no
  Metadata-protocol: none
  
  The build-lint sentence said a `metadata` fence's referenced object-rule / flow / permission set "must exist in this package". `docs/metadata-embed-ref` judges an embed against the package that ships the doc plus the packages of the same artifact that it declares in `manifest.dependencies` (direct only; one-way), so the rule the skill teaches now matches: an embed may name such a declared package's item, and anything else fails the build. No platform behaviour changes.
- 0dd93f2: Clause-②: no
  Metadata-protocol: none
  
  objectstack-automation: integrations are declared, not coded. The `connector_action`
  node row no longer calls a connector "pre-built"; a new SKILL.md section states the
  declarative-connector-first rule (a vendor system over HTTP is a `connectors:` entry
  with `provider: 'openapi' | 'mcp' | 'rest'`, a packaged spec and `auth.credentialRef`,
  dispatched by `connector_action`; a vendor callback is an `api` flow), the five cases
  that justify platform code, and that a document the loader cannot take yet is a gap to
  name — never a reason to write a plugin. `references/integration-recipes.md` carries one
  recipe per archetype with the author / administrator credential hand-off and today's
  limits (`connectorConfig.input` is sent as written; no `oauth2`; no vendor-signed
  callbacks). `evals/integrations-declared.json` adds the DocuSign, Stripe-read and
  vendor-without-spec cases; the DocuSign case fails any answer that proposes a plugin.
- c2716f8: docs(skills): the objectui action-block rule teaches `variant: 'danger'` for a destructive action and that `destructive` is the Button primitive's word, refused on an action block
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `rules/protocol.md` taught `action:button` without its `variant`. An agent that wanted a red delete button had only the Button primitive's `destructive` to copy from the React examples, and `variant: 'destructive'` on an action block is refused at save with the rename to `danger`.
  - **Now.** The "Actions Are Node Types" rule carries one line: `"variant": "danger"` draws the action block red and asks its `confirmText` question through the destructive confirm button; `destructive` stays the Button primitive's word (`variant="destructive"` in React) and is refused on an action block. Paid in the same file: a provenance sentence about the retired `dataSource` measurement route and a sentence restating the `props` envelope rule, both stated elsewhere in the file, are gone.
  - **Eval.** `evals/page-builder.json` gains a case that asks for a destructive delete action: it must spell `action:button`, `"variant": "danger"` and `confirmText`, and fails on `"variant": "destructive"`. The three existing cases are tightened with every assertion kept, and the file's ratchet ceiling moves 560 → 684 tokens, the measured remainder (ruling 2026-10-27, 「A:先削重复,余额按实测提高」).
  - No schema, key or behaviour changes.
- 96d12ec: docs(skills): the `os package publish` row of objectstack-platform's operations reference points app authors at the Marketplace handbook
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The platform skill's operations reference described `os package publish` as an upload to the cloud catalog and nothing more. An agent authoring an app from the skills never found the page that says what a listing is made of (`objectstack.manifest.json`, the README), what review checks, and what the customer's administrator goes through after installing.
  - **Now.** That row names the listing file, the README, review and the administrator's screens, and links `https://objectstack.ai/docs/deployment/marketplace-handbook`.
  - Paid for under the skills token ratchet by deleting the cloud-connection note's tail (the `LocalManifestSource` ledger and runtime-identity bind v2), plugin internals an app author never acts on. The file stays under its ceiling; no ceiling moves, no frontmatter, schema, key or behaviour changes.
- dbf576b: feat(spec): an inline `object-metric` tile declares `polarity`, so a lower-is-better KPI draws a rise red
  
  Clause-②: yes (widening)
  Metadata-protocol: added (object-metric polarity)
  
  A dataset measure has declared `polarity` since the dataset-bound KPI tile learned to colour its delta by it, but a page-level `object-metric` tile aggregates a field, not a dataset measure, so it had nothing to attach to and coloured its trend badge by direction alone: an average turnaround that rose 23% was drawn green.
  
  - **Spec.** `ObjectMetricPropsSchema` (`ComponentPropsMap['object-metric']`) declares an optional top-level `polarity`, the dataset measure's own `DatasetMeasurePolarity` by reference: `higher`, `lower` or `neutral`. Any other value is refused at the key. `betterWhen`, `goodDirection` and `trendDirection` are pointed at `polarity`; a top-level `direction` is answered with both keys it could mean (`trend.direction` for the static badge's arrow, `polarity` for good news); `higherIsBetter` / `lowerIsBetter` get the three values.
  - **Renderer.** `ObjectMetricWidget` forwards `polarity` to `MetricWidget`, which colours the badge it draws, the `compareTo`-derived one or the static `trend`, by the same rule the dataset-bound tile uses (`deltaToneClass`, now one shared helper): `lower` draws a rise red and a fall green, `neutral` draws it muted. The arrow always shows which way the number moved. The `object-metric` registration publishes the input.
  - **Undeclared keeps today's colours exactly**: a rise green, a fall red. Nothing infers a polarity from the aggregated field's name.
  - **Skills.** `objectstack-ui` `rules/dashboards.md` says an inline `object-metric` declares its own `polarity`.
  
  Nothing to do for existing tiles. To use it, add `polarity: 'lower'` to an `object-metric` node whose number is better when it falls.
- 3a09125: docs(skills): objectstack-ui and objectstack-data teach a primary related list as a body table in the Details tab, and the relatedLists refusal with its package boundary
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** Both skills said a `relatedList: 'primary'` child gets its own tab on the record page, `objectstack-ui` described one tab per primary list plus a shared Related tab and an app-level `relatedLayout` override, and `objectstack-data` said a `relatedLists` name matching no inbound FK is refused, with no boundary.
  - **Now.** A primary list is a full-width body table in the details column after the first field section (inside the Details tab, no tab of its own); every other list is a side card in the shared Related tab; field changes join the Timeline tab under its Changes filter. A `relatedLists` child in the stack with no inbound FK is refused everywhere; one that exists nowhere is refused by `os validate` / `os build` and by a metadata write naming no package, while a write into a package stores it and the page places nothing. No ceiling moves; no schema, key or behaviour changes.
- 4fa4f2c: docs(spec,skills): an `object-metric` tile's `polarity` is declared against the aggregate before `invert`, and `pages.md` points at it
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The `polarity` description said the badge arrow shows which way the number moved. Under `invert: true` the tile shows `1 - value`, so there are two numbers, and the text did not say which one the arrow and `polarity` read. The `objectstack-ui` skill's `rules/pages.md` taught the inline `object-metric` without naming `compareTo` or `polarity`.
  - **Now.** The `polarity` description (and the reference page generated from it) says the badge and `polarity` read the aggregated value before `invert`, so `polarity` is declared against the raw value: an error rate shown as uptime is `lower`. The `object-metric` row in `rules/pages.md` names `polarity` and links to the `compareTo` section of `rules/dashboards.md`. The pointer is paid for by deleting three restatements in the same file; the file stays at its token count and no ceiling moves.
  - **Unchanged.** No schema, accepted value, default or renderer behaviour moves.
- 6892888: fix(skills): four objectstack-platform eval cases agree with their own `must_not_contain` assertions
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** In `skills/objectstack-platform/evals/config-plugins-ops.json`, four cases refused a string their own `expected_output` spelled: eval 1 `tableName`, eval 2 `data:beforeInsert` and `onInstall`, eval 4 `@objectstack/adapter-`, eval 7 `role:` and `admin_full_access`. Graded against those assertions, the reference answer itself scored wrong, so the eval could not tell a good configuration, plugin or operations answer from a bad one.
  - **Now.** Judged per case from the skill text. Eval 1 narrows its assertion to the key spelling `tableName:` (the skill's own warning, "never set `tableName`", names the bare word; the wrong form is the key beside `workflows:` / `approvals:`). Eval 2 says "a `data:*` kernel hook registers and never fires" and "no install / enable / disable hooks" instead of spelling the phantom hook and method. Eval 4 says "no `adapter-*` packages exist". Eval 7 names the refused alias as `role` (the key spelling `role:` stays refused) and says "no platform set" (the skill's term for a set such as the refused platform-admin one). No assertion is deleted, no case added or removed; the file shrinks by 13 tokens under its unchanged ceiling.
  - No schema, key or behaviour changes.
- 72b08ee: docs(skills): hand-written inventory counts are deleted; the names and the source of truth stay
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `objectstack-data` counted its field types ("49") in SKILL.md and in `rules/field-types.md`, and its lifecycle events ("8") in SKILL.md and `references/data-hooks.md`; `objectstack-automation` counted its built-in node types ("20"); `objectui/README.md` counted its plugins ("18"); `objectui/guides/schema-expressions.md` counted the formula registry ("30 functions"); `objectstack-query` counted the aggregate functions ("six"). No gate reads any of those numbers against the tree, so each one goes wrong the moment the inventory moves, and a wrong count misleads the reader more than no count.
  - **Now.** The numbers are gone; every enumeration that taught something (the node-type tables, the plugin names, the function table, the aggregate names) stays, and each page still points at the file or schema that is the source of truth. Deletion only: every touched file shrinks under its unchanged token ceiling.
  - The same deletion in shipped READMEs and one shipped source comment: `@objectstack/spec` (a `//` comment in `src/kernel/metadata-plugin.zod.ts`, which ships), `@objectstack/metadata` (README), and the `@object-ui/*` READMEs of i18n, plugin-grid, components, fields, types, plugin-form and console. No schema, key or behaviour changes.
- 9122271: docs(skills): objectui teaches CEL for a bare-string predicate, with a FROM → TO list for the JavaScript spellings
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `skills/objectui` taught bare predicates in the legacy JavaScript grammar: `"hidden": "data.status === 'draft'"` in `rules/protocol.md`, `data.status === 'active'` and `data.status !== 'active'` in `guides/schema-expressions.md`, and an operator list (`===`, `!==`, `.includes()`, `.length`) that read as condition syntax. Since #27584 the console reads a bare string in a predicate key as CEL, as the spec defines it and the server reads it, so an agent following the skill wrote a gate that faulted and hid the node.
  - **Now.** Every bare-predicate example is CEL. The guide says a bare condition string is CEL on `@objectstack/formula` and that the operator list is the `${…}` template grammar only, and it gives a FROM → TO list measured on the console's evaluator: `===` / `!==` → `==` / `!=`; `list.includes(x)` → `x in list`, `s.includes('x')` → `s.contains('x')`; `list.length` → `size(list)`; a `data.*` key the scope may lack → `has(data.x) && …`, because CEL faults on a missing key. The row-predicate bullet says only a `${…}` condition still reads on the legacy engine. Eval 2 in `evals/schema-expressions.json` hands over a JS-syntax predicate and expects the CEL rewrite.
  - No schema, key or behaviour changes.
- d4064cc: docs(skills): objectstack-ui and objectui teach the report-index navigation item beside the named report
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The skills taught only the named report item, `{ type: 'report', reportName }`. Since PR #27566 a `type: 'report'` item with no `reportName` opens the app's report index (`/reports`), and the console no longer adds an index entry on its own, so an agent following the skills shipped an app with no report index entry.
  - **Now.** The `objectstack-ui` navigation item table marks `reportName` optional and says what omitting it opens; `rules/navigation.md` shows the index entry beside the named one and says the console adds none itself; the `objectui` app-composition route table lists `{type:'report'}` → `/reports`. A new eval case (10 in `evals/views-apps-actions-pages.json`) asks for an app's report index entry and expects `{ type: 'report' }` with no `reportName`.
  - No schema, key or behaviour changes.
- 61c3fdd: docs(skills): objectstack-data teaches that a `secret` / `password` column is queried only for presence, with one eval
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The engine refuses a credential column (`type: 'secret'` / `type: 'password'`) as a filter key, a sort key, a group-by or min/max key and an import `matchFields` key with `400 INVALID_FIELD`, and its search scan never reads one. `objectstack-data`'s `rules/security.md` taught the credential types but said nothing about querying them, so an agent following it could still write a view filter, sort, report or import mapping that the runtime refuses.
  - **Now.** `rules/security.md` states the rule next to the `secret` example: the only condition allowed on a credential column asks whether it has a value (`null`, `$null`, `$exists`, `$empty`); everything else is refused; search never scans it, so it does not belong in `searchableFields`. One eval asks for a list view filtered on a `secret` field and expects the redirect to the view's `is_not_null` rule.
  - The new text in `rules/security.md` is paid for by folding sentences the package already holds elsewhere (the `secret` type's purpose and encryption in `rules/field-types.md`, the queue parking rule in `SKILL.md`), and the remaining balance on it and on the eval file is raised by measurement, at zero headroom. The example shows the has-a-value check in both spellings: `where` / hook `query.filter`, and a list view's `filter` rule (`operator: 'is_not_null'`). No schema, key or runtime behaviour changes.
- 9b85162: docs(skills): the objectui data-integration guide stops teaching the MSW plugin removed in 12.0
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `skills/objectui/guides/data-integration.md` taught a frontend-first setup built on the MSW plugin package, removed in 12.0 (its last npm release is 11.0.0, so the install still succeeds and pulls an 11.x plugin into the current stack), and eval 2 of `evals/data-integration.json` rewarded that answer.
  - **Now.** The section "Frontend-first development" names the two supported paths: a static scope with no backend, or the real server run locally with `os dev` behind a Vite `/api` proxy. It states that `os dev` persists to SQLite, that `--fresh` gives a throwaway database, and that the retired in-memory driver is refused. Eval 2 grades `os dev`, `proxy` and `objectstack.config`, and refuses the MSW setup. Net -35 lines in the guide.
  - **Console.** `VITE_USE_MOCK_SERVER`, which no source reads, leaves `.env.development`, `.env.production` and the Vercel build command. The `mockServiceWorker.js` rewrite exclusion and the `vendor-msw` chunk row in `docs/deployment.md` go too. No runtime behaviour changes.
- 8ebdd28: fix(data-objectstack): `ObjectStackAdapter` reaches discovery from a `baseUrl` that ends in `/api/vN`, and the objectui skill teaches the server origin
  
  Clause-②: no
  Metadata-protocol: none
  
  `new ObjectStackAdapter({ baseUrl: '/api/v1' })` — the form the published `objectui` skill taught — asked for `/api/v1/api/v1/discovery`, so `connect()` failed and every read and write that awaits it failed with it. The adapter's own search, data, export and meta reads already dropped a trailing `/api/vN`; discovery and the wrapped `ObjectStackClient` did not.
  
  - The adapter now reads `baseUrl` as the server origin once, where it and its client are built: a trailing slash and a trailing `/api/vN` are dropped, so `''`, `http://host:3000`, `/api/v1` and `http://host:3000/api/v1` all reach `/api/v1/discovery` and the same `/api/v1/...` routes, through the client and through the adapter's raw reads alike. The five per-call suffix checks are gone; nothing else about the URLs changes.
  - `skills/objectui` (`guides/data-integration.md`, `guides/auth-permissions.md`) and the package README teach the origin form the console passes (`''` behind a same-origin proxy, or the server origin), and the data-integration eval refuses an answer that writes `baseUrl: '/api/v1'`.
- e9caebe: docs(skills): objectstack-data teaches `external.connector`, the datasource credential channel that borrows a declared connector instance's credential, beside `credentialsRef`
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** A datasource can name a declared connector instance in `external.connector` and borrow that instance's credential (ADR-0015 amendment D7), so one credential serves the connector's flow actions and an API-backed datasource's records. `objectstack-data`'s `rules/datasources.md` taught only `credentialsRef`, so an agent following it bound a second copy of a vendor credential the stack already held, and had no way to know the key exists or where it is refused.
  - **Now.** The rule's credentials section names the two channels and that exactly one is written: `credentialsRef`, a secret-store handle resolved at connect; or `connector`, for a datasource on a plugin driver such as `@objectstack/driver-odata`, naming a `connectors` instance with a `provider` and an `auth` other than `none`, shown as `schemaMode: 'external', external: { connector: 'erp_api' }`. It says where `connector` is refused (beside `credentialsRef`, on a built-in driver, on a `managed` datasource, and naming an undeclared instance, at `defineStack` or else at connect), that a disabled instance or a stack with no automation service leaves the datasource unconnected with the reason, and that a connector credential not set yet answers `503` per request instead of failing the connect.
  - The new text is paid for inside the same file: the `field.columnName` history clause, the auto-connect lead-in and the escape-hatch note are shortened, and phrases that restated their neighbours (the `columnMap` direction the example already shows, the mapping-routing tail, the write-gate tail) are dropped. The file stays under its token ceiling, which does not move. No schema, key or runtime behaviour changes.
- 99fa527: docs(skills): the automation skill teaches `connector_action`'s `connectorConfig.input` as an evaluated value slot, and the `openapi` provider's `providerConfig.include`
  
  Clause-②: no
  Metadata-protocol: none
  
  - **`connectorConfig.input` is a value-slot map**, like `subflow` `input`: a top-level CEL envelope is evaluated in the run's scope, so a per-record payload (`{ dialect: 'cel', source: 'record.stripe_id' }`) is a declarative dispatch now. Any other value is sent as written; a `{…}` or `{{ }}` in it is literal text. The skill says plainly that `os validate` does not judge this slot yet, so a malformed envelope fails the step at run time.
  - **`providerConfig.include` exists on the `openapi` provider**, with the `mcp` provider's allowlist meaning: absent exposes every operation, and a non-array or an unknown entry is a fatal configuration fault. Trimming the document is still taught, as the way to keep the package small, not as the only allowlist.
  - The `integrations-declared` eval's first case follows: it no longer grades either stale limit.
- 21b2a10: docs(skills): a dataset measure's `currency` no longer "always wins" over a `fixed` field; the skills teach the two `fixed` refusals
  
  Clause-②: no
  Metadata-protocol: none
  
  - `objectstack-data` `rules/field-types.md` (Currency resolution) and `objectstack-ui` `rules/dashboards.md` (the dataset currency comment) taught that a measure's own `currency` wins under `fixed`. Dataset compile now refuses, with `DATASET_INVALID` / 400, a measure `currency` that differs from its field's `fixed` code (delete it; restating the code is accepted) and a derived measure whose monetary operands resolve to two different `fixed` codes (derive from measures in one currency, or drop the operand in the other). Both files now say so, and keep the not-judged cases explicit: a `fixed` code against the tenant currency, and a measure `currency` over a `dynamic` field.
  - Paid for inside each file by deleting a restating code comment; the remainder raises the two token-ratchet rows on the standing path.
  - No schema, key or behaviour changes.
- 3fd8033: docs(skills): the automation guide says a `connector_action` input is judged against the action's `inputSchema` before dispatch
  
  Clause-②: no
  Metadata-protocol: none
  
  This text shipped in PR #28170 (#28041 / #28162), which missed its `@objectstack/skills` changeset; this entry carries it.
  
  - **`objectstack-automation/SKILL.md`**: once evaluated, a `connector_action`'s `connectorConfig.input` is judged against the action's `inputSchema` (`required`, `type`, `properties`, `items`) before dispatch, and a breach fails the step `VALIDATION_ERROR` (`fault`-routable) with nothing sent. `registerFlow` and `os validate` refuse a `{…}` template token at `connectorConfig.input.<key>`.
  - **`objectstack-automation/references/integration-recipes.md`**: a record value reaches the payload through a CEL envelope (`{ dialect: 'cel', source: 'record.<field>' }`), and the recipes say that envelope is judged against the `inputSchema`.
- 36436fa: docs(skills): the skills teach the third `fixed`-currency refusal, a derived measure's own `currency` against its operands' one `fixed` code
  
  Clause-②: no
  Metadata-protocol: none
  
  - `objectstack-data` `rules/field-types.md` (Currency resolution) and `objectstack-ui` `rules/dashboards.md` (the dataset currency comment) taught two `fixed` refusals and missed the third: a derived `sum` or `difference` whose monetary operands all resolve to one `fixed` code refuses another `currency` at dataset compile, with `DATASET_INVALID` / 400. Both files now teach it beside the other two, with the shipped prescription: delete the measure's `currency` (the column takes the operands' code), or restate that code.
  - Paid for inside each file: `field-types.md` drops the `currency_code` naming convention its own example already shows; `dashboards.md` drops the retired `categoryGranularity` parenthetical, which the parse refusal and the Dataset-Bound Widgets paragraph already carry. Neither ratchet row moves.
  - No schema, key or behaviour changes.
- 3fd8033: docs(skills): the field-types guide teaches `homeAmount.rateDate` as a `date` or `datetime` field and lists all four `currencyConfig` keys
  
  Clause-②: no
  Metadata-protocol: none
  
  - **`objectstack-data/rules/field-types.md`**: the `homeAmount` paragraph says `rateDate` names a `date` or `datetime` field (it said `date` only; the spec accepts both). The Numbers table `currency` row lists `currencyConfig` as `currencyMode`, `defaultCurrency`, `currencyField` and `homeAmount` (it named the first two only).
- 22663ca: docs(skills): objectstack-data teaches the code-defined datasource credential route (`OS_DATASOURCE_<NAME>_PASSWORD`, behind the host switch)
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `rules/datasources.md` taught `credentialsRef` and `connector` as the only credential channels. A datasource defined in code has no `sys_secret:` handle to point at (the Setup form refuses a code-origin datasource, and nothing else mints one), so an agent following the rule wrote a reference the connect could never resolve.
  - **Now.** The credential section says a code-declared datasource reads its password at connect from `OS_DATASOURCE_<NAME>_PASSWORD` (the name upper-cased) while the host switch `OS_DATASOURCE_ENV_CREDENTIALS` is `on`; that `os serve`, `os start` and `os dev` default it on, a library composition leaves it off, and the switch takes `on` or `off` only; that a declared `credentialsRef` or `connector` still wins and never falls back to the variable; and the operator's caution that an installed package may declare a datasource of any free name and so read that variable.
  - The file stays under its token ceiling: the new text is paid for by deleting restatements in the same file (the field-reference pointer the references index already carries, the `writable` and `columnMap` restatements of their own sections, the `datasource` field default the SKILL.md field table carries, and two detail clauses). No ceiling moves, no frontmatter, schema or behaviour changes.
- 3fd8033: docs(skills): the integration recipes say the connector `auth` union declares `oauth2` and `app-credential`, held degraded until a server runs the grant, and that `signed` signs `aliyun-acs3` and `tencentcloud-tc3` requests
  
  Clause-②: no
  Metadata-protocol: none
  
  This text shipped in PR #28290 (#28226), which carried a changeset for `@objectstack/lint` only and missed its `@objectstack/skills` one; this entry carries it.
  
  - **`objectstack-automation/references/integration-recipes.md`**: an OAuth-protected vendor declares `oauth2` (`authorization_code` / `client_credentials`) or `app-credential` (`feishu` / `dingtalk` / `wecom`), but no server runs the grant yet, so the instance is held degraded and calls no upstream. `signed` on `openapi` / `rest` (scheme `aliyun-acs3-hmac-sha256` or `tencentcloud-tc3-hmac-sha256`, with a `keyId`) signs each request; an RSA-signing vendor (Alipay, WeChat Pay) stays blocked on the request-signing card.
- 3b45d4a: docs(skills): objectstack-ui and objectstack-i18n teach six keys the platform already draws — `pressed`, the `{{ }}` copy slots `description` / `helpText` / `outcomeMessages`, the param dialog's `submitText` and its translation slot, the form thank-you translation keys, `kanban.lanes` and report chart `seriesBy`
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** Each key shipped in the spec and the console drew it, but no published skill taught it: an agent authoring from the skills wrote a toggle header action with no `pressed`, spelled the dialog line, a param hint or a per-outcome toast with `${…}` holes that `os validate` refuses, left the param dialog's button at "Confirm", translated no thank-you panel, could neither order kanban lanes nor drop an always-empty one, and split a chart by a second dimension with a `matrix` workaround.
  - **Now.** `objectstack-ui/rules/actions.md` teaches `pressed` (display-only reader state over an `attachedOnRead` block; a boolean literal is refused), names all five `{{ }}` copy slots with one example each, and teaches `submitText` beside `params` (with the `confirmText` contrast and the refused spellings); its `ReassignLeadAction` example sets `submitText`, and eval 11 asks for a param dialog whose button reads the verb. `rules/list-views.md` shows `kanban.lanes` in the kanban example — a choice of lanes and their order, not a record filter. `rules/dashboards.md` sets `seriesBy` on the report chart example and says where it is refused (an undeclared dimension, the `xAxis` dimension, a single-series type). `objectstack-i18n/SKILL.md` lists `_views.{view}.submitBehavior.title` / `.message` and `_actions.{action}.submitText`.
  - Every file stays at or under its token ceiling: the actions, list-views and dashboards additions are paid for by condensing text in the same file (the `ctx` section's blessed-name code block, which restates the objectstack-data hooks reference; two ADR-0047 renderer notes folded into the code comments they repeat; two engine- and Studio-facing notes that told an author nothing to write). No ceiling moves, no frontmatter changes, no schema, key or behaviour changes.
- 56bd596: docs(skills): objectstack-data rules/lifecycle.md teaches the save notice
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** A hook can tell the person who made a create or update what the save set in motion (`ctx.notice(message)`, answered as the create/update `notice`), and a flow a record create/update trigger starts can set the same message with a `save_notice` node, but no published skill taught it, so an AI author writing a save hook from `objectstack-data` kept reaching for a `record:alert` banner.
  - **Now.** `objectstack-data/rules/lifecycle.md` gains *Save Notice — what the save set in motion*: the `ctx.notice` spelling for inline `handler` and sandboxed `body` alike (no capability), info severity and the distinction from validation `warnings` and from a `record:alert` banner, one message per write with the last call winning, the dispatches that carry it, the non-string refusal, and the flow face (`save_notice`, refused outside a create/update record trigger and after an `approval` / `wait`).
  - The file stays under its token ceiling: the new text is paid for by deleting the Decision Tree (which restated the class table and the syntax examples), the telemetry-growth anecdote and a Safety Semantics restatement. No ceiling moves; no schema, key or behaviour changes.
- 1f1a369: docs(skills): the objectstack-data field-types rule teaches `percentDisplay` and `lookupAutofill`
  
  Clause-②: no
  Metadata-protocol: none
  
  - The `percent` row of the field-type table lists `percentDisplay`: unset or `'bar'` draws the progress bar, `'plain'` prints the number alone, for a rate or a probability.
  - The Relational section teaches `lookupAutofill: [{ target, source, overwrite? }]` on a single-value `lookup` / `master_detail`: which targets a pick may fill, which sources it may copy, the overwrite rule, that the fill is client-side only, and how it relates to a line-item grid column's `autofill`.
  - Paid inside the file's token ceiling: the `Select with Default`, `Email with Uniqueness` and `Lookup (Many-to-Many)` examples go (each restated a rule the skill carries elsewhere), and the `vectorConfig` trap folds into the invented-key list at the top of the file.
- 3eb6dfc: docs(skills): objectstack-automation teaches `oauth2` and `app-credential` as a served recipe now that the built-in connector providers run the grant
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `references/integration-recipes.md` filed the OAuth-protected vendor under "Not yet": `auth` could declare `oauth2` and `app-credential`, but "no server runs the grant yet", so the integration was to be marked blocked. Eval 1 (DocuSign) graded that answer, and `SKILL.md` listed OAuth among the documents the loader cannot take.
  - **Now.** The built-in `rest`, `openapi` and `mcp` providers ask the per-dispatch credential handle, so both kinds are served. Recipe 6 teaches the three `auth` shapes (`authorization_code`, `client_credentials`, `app-credential` with `feishu` / `dingtalk` / `wecom`), where the token is held, that `client_credentials` and `app-credential` dispatch once the ref is set, and how an administrator holding `manage_connector_connections` connects an `authorization_code` instance once per organization (`POST /api/v1/automation/connectors/:name/connection`, the vendor's redirect to the callback, status, revoke). The warning against parking a short-lived token behind a `bearer` ref stays. Eval 1 now expects that recipe and names one remaining gap (the vendor-signed webhook); `SKILL.md`'s loader-gap line no longer names OAuth. WeChat Pay stays under "Not yet" (no `signed` scheme).
  - The file's token ceiling moves to the measured count after two same-file restatement cuts; no schema, key or behaviour changes.
- f116f38: docs(skills): objectstack-data eval case 3 answers the code-defined datasource credential route and pins it
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `evals/hooks-security-seeds-datasources.json` case 3 (a read-only `legacy_customer` object over the `customers` table of a Postgres reporting database) answered "a `defineDatasource` entry (`credentialsRef`, never inline credentials)". `rules/datasources.md` now teaches that a datasource defined in code reads its password at connect from `OS_DATASOURCE_<NAME>_PASSWORD` behind the host switch `OS_DATASOURCE_ENV_CREDENTIALS`, and that nothing mints a `sys_secret:` handle for one; the eval's `must_contain` pinned neither route, so the eval stayed green while its model answer taught a handle the connect could never resolve.
  - **Now.** The model answer names the environment route the rule teaches (`OS_DATASOURCE_REPORTING_PASSWORD` for a datasource named `reporting`, the switch and the hosts that default it on), `schemaMode: 'external'`, the object's `datasource` / `external.remoteName` / `columnMap` binding and the closed write gate (`allowWrites`, `writable`). `must_contain` keeps `defineDatasource`, `datasource`, `remoteName`, `columnMap` and `schemaMode` and adds `OS_DATASOURCE_ENV_CREDENTIALS` and `_PASSWORD`, so an answer that teaches only the old route goes red.
  - Eval fixtures are measured but not ratcheted; no SKILL.md, rules, references, schema, key or behaviour changes.
- f662c71: Clause-②: no
  Metadata-protocol: none
  
  objectstack-ui `rules/list-views.md` § Filtering teaches the view filter any-of group `{ or: [rule, ...] }` (`ViewFilterOrGroupSchema`): an element of the `filter` list that matches when any of its flat rules does, still ANDed with the elements beside it; no group in a group, no empty `or`; the Console builder saves its OR toggle as one group and shows a group beside other elements read-only. One eval case asks for an either-of list in one view.
  
  Token ratchet: the growth is paid by deletion in the same file (the flat-view and data-source blockquotes, the `tabs`-on-object and omit-`userFilters` bullets, the search-blast-radius and toolbar-search prose, the kanban intro).
- 35b178b: docs(skills): the objectstack-data field-types rule states a percent field's storage scale
  
  Clause-②: no
  Metadata-protocol: none
  
  The `percent` row of the field-type table no longer says "Percentage values (0-100)". It states the storage rule the platform applies: a `percent` field stores a fraction (0-1) unless it declares `max` above 1 (for example `max: 100`), in which case it stores whole percentage points; seeds, defaults and API values use that stored scale. An author who followed the old text seeded `25` on a field without `max` and read back `2500%`. Paid inside the file's token ceiling by deleting the `Vector (AI Embeddings)` example, whose one fact (`dimensions` is the flat key) the Enhanced Types row already states.
- 8de519f: docs(skills): objectstack-platform teaches the one effective read of a `.custom` declared override (ADR-0146 D8)
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The `overrides: { package, basedOn }` declaration takes effect on every read of a name an installed package ships (ADR-0146 D8), but no published skill mentioned `.custom`, `overrides` or `basedOn`. An agent customizing an installed package (HotCRM) was still taught the Setup overlay row as the only path, which the read now treats as a package-unbound row awaiting migration, or wrote an undeclared same-name item that the layered read reports as an orphan.
  - **Now.** `objectstack-platform`'s Manifest Reference says where a customization lives (the paired `<base>.custom` package), what an author writes (the same-named item with `overrides: { package, basedOn }`, the base's `manifest.id` / `manifest.version`), where the declaration is honoured (only from the pair; today only for a view, dashboard, report, email_template or translation, the other overridable types waiting for their doors; `basedOn` never judged; any other package's declaration ignored) and what the read serves (every read agrees; one item per name in the environment-wide list; orphans in the layered read's `overlay`; a withdrawn public form never re-opened; the pair's export carries the declaration). One eval asserts the declared shape and refuses the Setup-write alternative.
  - The file stays under its token ceiling: the new text is paid for by deleting restatement in the same file (the CLI cheat sheet `references/operations.md` already holds, the seed `object`-is-derived sentence `objectstack-data`'s `seeds.md` holds, a table restating its own paragraph, two doubled rules). The `os migrate` row of `references/operations.md` takes back the `apply` rule the cheat sheet carried (loosens only; `--allow-destructive` for drops/tightenings). The SKILL.md ceiling lowers to its new measurement; no ceiling rises, no frontmatter, schema or behaviour change. The docs site gains the same facts on the metadata-lifecycle page and one sentence on the forms page.
- bc02a77: fix(metadata-protocol)!: a write naming no package onto an installed package's view, dashboard, report, translation or email template is refused where `os migrate packageless-overlays` can move its row as a declared override, naming the base's `.custom` pair and the command
  
  Clause-②: yes (narrowing) — the metadata save, publish, delete and rollback doors refuse a write that names no package onto an item of the five overlay types that one installed read-only package ships, where the ceremony would classify the row (or the first write's body) `movable` and its move as a declared override can succeed; they accepted it before as a package-unbound Setup row. Every row the ceremony lists and does not move keeps that write. One write is widened: a rollback of the `.custom` pair's own declared row of an item its base ships (#28644 item 1) is judged as the pair's declared override, where the store sealed it as an artifact override before, on every type the pair can override (a page or flow pair row included).
  
  Metadata-protocol: narrowed (the `allowEnvironmentOverlay` flag of `view`, `dashboard`, `report`, `translation` and `email_template` no longer opens a package-less write onto a packaged item the ceremony can move as a declared override; it stays the predicate the migration ceremony, the read of an unmigrated row and every row the ceremony leaves use)
  
  Skills-docs: updated here — `skills/objectstack-platform/SKILL.md`'s ADR-0146 paragraph said "a package-unbound Setup row still wins over the base's until D11"; it now says such a row from before D11 wins over the base's until `os migrate packageless-overlays` moves it, and that its package-less save, reset and rollback are refused once the command can move it. To stay under the bundle's token ceiling, the same paragraph drops "the base's is unchanged" after the export sentence (which "replaces the base's document whole" already implies) and the aside that the other overridable types wait for their doors (the sentence already names the six types the read honours today).
  
  <!-- adr-0087: registered packageless-overlay-write-closed -->
  
  **BREAKING** write narrowing at the metadata doors (`@objectstack/metadata-protocol`), shipped as `minor` during the launch window.
  
  **Upgrade, then run the ceremony.** The command ships in this release. On each deployment with Setup customizations of a package's items, upgrade, run `os migrate packageless-overlays` (preview) with the flags and environment the deployment boots with (`--preset` and `--dev` mean what they mean to `os serve`), then `os migrate packageless-overlays --apply`. Nothing breaks at the upgrade: between the upgrade and `--apply`, every customization is served as before, and the package-less save, reset, publish and rollback of one the command moves as a declared override are refused, naming the command (one it moves as the pair's own member keeps that write, see `movable` below). Done when the preview lists no movable row.
  
  The preview lists five dispositions; only `movable` rows are moved, and every other row keeps its package-less write:
  
  - `movable`: `--apply` moves it into the pair, as the base's declared override (outcome `moved` with its `basedOn`). A row of an `email_template` locale the base does not ship (the preview lists it as the pair's own member; `--json` carries it as `addedMember`) moves instead as the pair's own member at that locale, declaring nothing (outcome `moved` with that `addedMember` in place of a `basedOn`), since a declared override of a locale the base does not ship is refused; its package-less write stays open, before and after the move. A move that ends `failed` keeps the row as it was; fix what the error names and re-run. When the error names the pair (it cannot be ensured, or it refuses the row) or, for a declared override, the base's missing version, the row also keeps its package-less write and may be left.
  - `multi_shipped` (several packages ship the name): delete it naming no package, then save it into the pair of the package it customizes if it is still wanted (the pair's override is then served at that base's address, `?package=<base>`; a read naming no package is not pinned to it while several packages ship the name).
  - `no_pair` (the base's id forms no pair): nothing to do.
  - `foreign_declaration` (its `overrides` names another package): remove the key with a save naming no package, then re-run: the move declares the right override. (A package-less save that keeps a corrected `overrides` is refused by the override write gate.)
  - `shadowed` (the pair already holds the item; the pair's row is served when it declares the override, otherwise this row still is): nothing to do to keep the pair's declared override; or restore the package original (`DELETE …?package=<base>.custom`) and re-run to move this one.
  
  ### Migration: FROM → TO
  
  FROM, a customization of the installed package `com.acme.crm`'s view written with no package:
  
  ```http
  PUT /api/v1/meta/view/account_list
  { "name": "account_list", "label": "My accounts" }
  ```
  
  TO, the same customization written into the base's paired `.custom`, declaring what it overrides:
  
  ```http
  PUT /api/v1/meta/view/account_list?package=com.acme.crm.custom
  { "name": "account_list", "label": "My accounts", "overrides": { "package": "com.acme.crm", "basedOn": "1.4.0" } }
  ```
  
  To restore the package original, FROM `DELETE /api/v1/meta/view/account_list` TO `DELETE /api/v1/meta/view/account_list?package=com.acme.crm.custom`. `basedOn` is the base's installed `manifest.version`. The pair is created by `os migrate packageless-overlays --apply`, or by Studio's Customize. A locale of an email template the base does not ship is the pair's own member, not an override: write it into the pair with no `overrides` (one declaring the base is refused), and `DELETE …?package=<base>.custom&member=<locale>` removes it (with no `member`, the delete addresses the canonical locale).
  
  - **Now refused.** A save (draft or publish mode), a publish, a delete of the active item, or a rollback whose restored row is package-less, with no `?package=` (or an empty one), of a `view`, `dashboard`, `report`, `translation` or `email_template` that exactly one installed read-only package ships, where the item's stored package-less row in that state (or, with none, the saved body) is one the ceremony classifies `movable`, the pair can be ensured (the base has a namespace and a SemVer version), and the override write gate admits that row, declared as the base's override, into the pair (so not an `email_template` locale the base does not ship: see **Still open**). This covers an unmigrated `movable` row, and the first package-less write of an item the pair already holds (a moved one). Each answers `403 NOT_OVERRIDABLE`, writes nothing, and its message names the item, the shipping package, the pair (`?package=<base>.custom`), the `overrides` declaration and `os migrate packageless-overlays`; a rollback's message says to save a version from before the move into the pair, declaring it. The metadata item page shows that message as sent when its URL holds no `?package=`. The refusal comes before every gate that reads a stored row's lock, so it is the same with or without `overrides` in the body.
  - **Still open.** Every write naming `?package=<base>.custom` (the pair's save, publish, delete and rollback, judged by the override write gate as before); a rollback of the pair's own declared row, which is judged as the pair's override; a write of a name no installed package ships (environment metadata); and every package-less write the ceremony would not move, as before this release: a name several read-only packages ship (`multi_shipped`); a base whose id forms no pair (`no_pair`); a base whose pair cannot be ensured (no namespace, or a version that is not SemVer); a stored package-less row whose `overrides` names another package (`foreign_declaration`) or beside the pair's row of the item (`shadowed`; its package-less writes are addressed to the pair's row as before, so its package-less delete restores the package original). Every package-less write of an `email_template` locale the base does not ship stays open too, before and after the ceremony moves its row as the pair's own member (#28904): the close judges only the declared-override move, and the override write gate refuses a declared override of that locale (#28777). Discarding a draft stays open.
  - **Unchanged.** A package-less row stored before this release is still served exactly as before, by every read. The ceremony still moves it: it writes into the pair, never package-less.
  - **Studio.** The read-only item notice no longer links to the package-less Setup overlay (`@object-ui/app-shell`).
  - **Removed with it.** #28413's interim allowance, by which a package-less save that landed on a moved row kept that row's `overrides` block, is gone: such a save is refused like any other.
- 504ba51: docs(skills): the ADR-0126 §1.3 promise pages and the skills teach what ADR-0146 D2 delivers — customizations in `.custom`, `__c` fields, the flow override and "new similar", no package-less overlay
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The skills taught the pre-epic paths: `objectstack-data` named no home for a customer's extension of a shipped object and no `__c` rule, and its lock table still called an edit of a shipped item an "overlay"; `objectstack-automation` said nothing about a flow an installed package ships, so an agent cloned it (two copies running) or edited it in place (refused); `objectstack-platform` taught the declared override's read but not who may declare it, how the pair is created, or what the three non-overridable types do. The docs promise pages (`capabilities/integrations`, `build-without-code`) still said views and dashboards are "yours to edit directly" and sent readers to a Setup packaged-automation page to switch off and clone a flow.
  - **Now.** `objectstack-data` says an object an installed package ships is extended from the base's paired `.custom` package, every added field ends in `__c`, the suffix is refused anywhere else and an unsuffixed field is refused in the pair, a base field changes only through `fieldPatches`, and Studio's Add field writes the same extension; its lock table reads "Edit", not "Edit (overlay)". `objectstack-automation` says a packaged flow is customized by a same-named declared override in the pair (armed in the base's place, one activation switch, a suspended run finishes on the body it started on), that an undeclared same name is refused at publish, and that the clone door is "new similar": a copy under a new name, switched off, in the pair, never package-less. `objectstack-platform` adds the ensure door and its two manifest facts, the customizations read, the uninstall refusal, the write gate's one rule for dependents (rename), and "new similar" for permission sets, positions and capabilities. One eval per skill asserts the taught shape and refuses the old one.
  - Every file stays under its token ceiling: the new text is paid for by deleting restatement in the same file (a layout tree the Template section and the Naming table already state; a search-mirror maintenance table and a formula aside restating the sentence above them; the dates and money legacy → CEL rows `objectstack-formula`'s table holds; the CEL callout restating that skill's pointer; two `runAs` notes and a `readonly` note tightened, no rule removed). The touched ceilings lower to their new measurements; no ceiling rises, no frontmatter, schema or behaviour changes. The docs site's promise pages, install modes, object extensions, metadata lifecycle, permission sets, CLI and metadata API pages gain the same facts.
- 28f2e99: docs(skills): the automation skill's `mcp` recipe teaches the `providerConfig.toolsSnapshot` pin
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `providerConfig.toolsSnapshot` (a sha256 pin per MCP tool, checked on every materialization) shipped in `@objectstack/connector-mcp` and on the connectors page, but no published skill named it. An agent authoring an MCP connector app from the skills declared `include` alone, with no protection against a server silently rewriting a tool's description or `inputSchema`.
  - **Now.** `skills/objectstack-automation/references/integration-recipes.md`, recipe 2 (remote MCP), gains one paragraph: what `toolsSnapshot` pins and that a pinned name `include` leaves out is refused at boot; where the digests come from (`computeMcpToolsSnapshot(tools)`, or the served digest the degraded reason prints against a placeholder pin); what an author sees when a pin no longer matches (the instance degraded with no actions, `CONNECTOR_UPSTREAM_CHANGED`, the reason on `GET /api/v1/automation/connectors` naming each tool and the digest it now serves), and the link to the connectors page's pin section.
  - The file stays under its token ceiling: the paragraph is paid for by deleting restatements in the same file that keep a home elsewhere (the `connector_action` row of `SKILL.md`, its `api`-trigger *Signature* bullet, the objectstack-platform skill's `plugins:`/`requires` rule, and the connectors page). No ceiling moves, no frontmatter, schema, key or behaviour changes.
- 00918c8: docs(skills): objectstack-data teaches an object extension's `fieldPatches` — relabel a vendor field without redeclaring it in `fields`
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** `ObjectExtensionSchema.fieldPatches` is applied by the registry merge and refused at install and by `os validate` when it names nothing, but the published `objectstack-data` skill's *Object Extension Model* taught only `fields` / `priority`, so an agent that wanted a vendor field to read "Sector" instead of "Industry" redeclared the field in `fields` and took it over.
  - **Now.** The section carries one paragraph on `fieldPatches`: display keys only (`BASE_FIELD_DISPLAY_WHITELIST` — `label`, `description`, `inlineHelpText`, `placeholder`, and an option's `label` keyed by its stored `value`), type / values / rules stay the owner's, a tenant's edit wins, the higher `priority` wins between extensions, a patch naming a missing field or option is refused at install and by `os validate`, a `picklist`-bound field's options are not patchable — with the `crm_account.industry` example.
  - The file stays under its token ceiling: the new text is paid for by deleting restatement in the same file (the search section's second refusal paragraph, folded into its first; the index blockquote and the validation type list, each already carried by `rules/indexing.md` / `rules/validation.md`). No ceiling moves, no frontmatter, schema, key or behaviour changes.
- 7f4cbc9: docs(skills): objectstack-platform says an email-template override names a locale its base ships; a new locale carries no `overrides`
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The ADR-0146 customization paragraph taught that a same-named item in the paired `.custom` package with `overrides` replaces the base's item, and listed `email_template` among the honoured types, but said nothing about the locale. An email template is one item per `(name, locale)`, and the override write gate refuses a declared override of a locale the base does not ship (`declared_package_ships_no_such_item`), so an author following the skill could declare `overrides` on a locale the base never shipped and be refused.
  - **Now.** One sentence in that paragraph: an email template is one item per (name, locale), an override names a locale the base ships, and a locale the base does not ship is added without `overrides`. The file stays at its token ceiling: the sentence is paid for by naming the not-yet-honoured types as the rest of `OVERRIDABLE_METADATA_TYPES` instead of enumerating them, and by dropping four filler intro clauses. No rule is removed, no frontmatter, schema or behaviour changes.
- 2c70f65: docs(skills): objectstack-platform says a locale added in the `.custom` pair is served on the base's address, and a locale a dependent adds under the base's name stays under its own package
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The ADR-0146 customization paragraph said a locale the base does not ship is added in the pair without `overrides`, and stopped there: nothing said where that added locale is served, and nothing said what a dependent package's added locale under the base's name reaches. The reads of a base's address now decide an email template member by member, so an author could expect the pair's added locale to stay under `hotcrm.custom` only, or a dependent's to answer on the base's address.
  - **Now.** One sentence beside that rule: the base's address serves the pair's added locale too (both lists, the execution list, a send in that locale), and a locale a dependent adds under the base's name is served only under its own `?package=`, never by a base-named or package-less read. The file stays under its token ceiling: the sentence is paid for by tightening four restating clauses elsewhere in the file (one intro clause, one explanatory aside, one restated driver rule, one filler template bullet). No rule is removed, no frontmatter, schema or behaviour changes.
- b5e7ba5: feat(spec)!: a form view no longer declares `drawerSide` / `drawerWidth`; no form view opens in a drawer, so neither key was ever read there
  
  Clause-②: no (narrowing)
  
  Metadata-protocol: narrowed
  
  Skills-docs: regenerated here — `skills/objectstack-ui/references/react-blocks.md` (`gen:react-blocks`) lists `<ObjectForm>`'s `drawerSide` / `drawerWidth` as binding props from the block's overlay instead of data props from the form view schema, with the same types; `drawerWidth`'s description drops the form view's `[DEPRECATED → size buckets]` tag (the block's drawer has no size bucket) and says the value is the drawer's width, or its height from the top or bottom edge; no hand-written file under `skills/**` teaches either key on a form view (a `git grep` of `skills/` names only that contract and `rules/record-page.md`'s list-drawer width on `navigation`, which this does not touch).
  
  <!-- adr-0087: registered form-view-drawer-keys-removed, ui-form-view-drawer-keys-retired -->
  
  **BREAKING** accept-set narrowing on the form view surface (`@objectstack/spec`), ADR-0049 enforce-or-remove.
  
  `type: 'drawer'` left the form view earlier in this release, so no form view opens in a drawer. No form-view surface read the two keys either: the console's form page, its New and Edit dialogs, the record form page and Studio all ignored them, so a form view saved with `drawerSide: 'left', drawerWidth: '480px'` was accepted, served and drawn exactly as one without them.
  
  - **FROM → TO.** `form: { …, drawerSide, drawerWidth }` (and `formViews.<key>`, a form view item's `config`) → `form: { … }`. Nothing on the form view replaces them. A list opens a clicked record in its drawer (`navigation.mode`) and sizes it with the `navigation.size` bucket; a React page that opens a form in a drawer writes the props on the block, `ObjectForm` with `formType='drawer'`.
  - **The one-line fix.** Delete `drawerSide` and `drawerWidth` from the form view. `os migrate meta --from 17` lists the edits for existing sources, and `--write` applies them. A stored `sys_metadata` row is converted when it is read (the `form-view-drawer-keys-removed` conversion), so a form view saved with the keys keeps loading, and nothing a reader sees changes.
  - **What the parse says.** "`view.form.drawerSide` was removed in @objectstack/spec 18.3.0 (ADR-0049) — no form view opens in a drawer, so no form view ever read it. …" (and the same for `drawerWidth`), at every form view door (a view's `form` and `formViews.*`, a form view item record, a flattened form overlay) and at `defineStack` as `STACK_SCHEMA_INVALID` / 422. TypeScript rejects the keys at the authoring site.
  - **Unchanged.** The React `ObjectForm` block still takes `drawerSide` / `drawerWidth` for the drawer it opens with `formType='drawer'`: the react-tier contract now declares them on the block itself, with the same types and descriptions. The `object-form` page block keeps both in its own props. `modalSize` stays on the form view; the console's record dialog reads it.
- 74a19dd: docs(skills): objectstack-formula says the build refuses date subtraction (`end - start`), and the skills stop describing a stored formula that subtracts dates
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The "No date arithmetic" note in `objectstack-formula` said `end - start` "does not fault — it yields a `duration` stored as `{}`", which read as a shape that builds. `objectstack-ui` `rules/dashboards.md` and an analytics eval described a leave-days formula written as `end - start`, and a formula eval explained `record.close_date - today()` as "a duration stored as `{}`".
  - **Now.** The note says the build refuses both `date + n` and `end - start`: a date or date-time mixed with a number, or minus another, reads `null`, and `today()` / `now()` minus a date field reads `{}`. It prescribes `daysBetween(a, b)` and keeps the Want / Write table. The leave-days formula is written `daysBetween(start, end)` in the dashboards rule and `daysBetween(record.start_date, record.end_date)` in the eval prompt, and the formula eval says the build refuses `record.close_date - today()`.
  - The formula gate change itself ships in `@objectstack/formula` (`formula-date-subtraction-refused`). `SKILL.md` and `rules/dashboards.md` stay under their token ceilings (no ceiling moves). No schema, key, command or behaviour changes.
- e82bf64: docs(skills): objectstack-formula names action `visible` / `disabled` as the sparse, client-side exception to the total-record rule, and teaches the `has()` guard that surface needs
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Before.** The "`has()` is NOT a null check" section said every predicate reads a `record` that is total over the object's declared fields, so `has(record.<declared_field>)` is always `true` and tells you nothing. An agent following it dropped the `has()` guard from an action's `visible` predicate on a `list_item` location, where the row can lack the key: the predicate faults `No such key` and the button silently vanishes. The Surfaces table listed only `Action.disabled`.
  - **Now.** The total-record statement is scoped to the server-evaluated surfaces (validation rules, `requiredWhen`, option `visibleWhen`, `readonlyWhen`, hook `condition`, the flow trigger record), where `!= null` is the whole guard. A new paragraph says action `visible` / `disabled` bind the row the client already holds, which lacks a key when the column is outside the view's projection, refused by field-level security, or never written (the mongo and memory drivers), and teaches the guard: `has(record.x) && record.x != null`; `has()` alone beside a literal `==` / `!=`; one `has()` per segment of a nested path. The Surfaces table lists `visible` beside `disabled`, marked client-side and sparse.
  - `SKILL.md` stays under its token ceiling (no ceiling moves). No schema, key, command or behaviour changes.
- 5a2bdf9: docs(skills): the record-page rule names drawer and full page as the reader's only Open records choices
  
  Clause-②: no
  Metadata-protocol: none
  
  The console retired the split pane beside the list: a list record opens in the drawer (the default) or as the full page, and the Display menu's Open records offers those two only. `skills/objectstack-ui/rules/record-page.md` rule 6 still taught "split beside the list — the default — or drawer, or full page", so an agent reading it told authors that records open beside the list and offered a choice that no longer exists. Rule 6 now names the two choices and says the split beside the list is retired; the drawer's dragged width and ⤢ stay reader preferences. Eval 2's expected answer says the same: a pane beside the list is no longer offered, nothing is authored for it, and the contract object keeps `navigation: { mode: 'page' }`.
- 00f72f9: docs(skills): the formula skill teaches the null-guard gate on a record-triggered flow's conditions
  
  Clause-②: no
  Metadata-protocol: none
  
  The publish-time null-guard gate (`os validate` / `os build` / `os lint` and the runtime publish gate) has judged a record-triggered flow's start `config.condition`, every edge `condition` and every `decision` branch `expression` since the lint change that widened it; the formula skill now says so where it teaches the gate: which slots are judged, that a `count` / `sum` roll-up is always valued while `min` / `max` / `avg` stay nullable, that a bare field name in a flow condition is the field and is judged alike, that a guard in the start condition holds at every edge and branch and is spelled `record.<field> != null` so both doors accept it, and that an unguarded null fails the run while the write that fired it still lands. One eval exercises a refused flow edge. The flows docs page carries the same rule where edge and decision conditions are taught.
- 69ce01d: docs(skills): the field-types guide names the backfill for an amount switched to record mode; the dashboards guide says a record-mode amount aggregate is served only grouped by its code field
  
  Clause-②: no
  Metadata-protocol: none
  
  - **`objectstack-data/rules/field-types.md`**: an amount field with stored rows that is switched to `currencyMode: 'record'` is backfilled with `os migrate record-currency-codes`. The derived-measure sentence moves out of this guide; it already sits in the dashboards guide, which the line now points to.
  - **`objectstack-ui/rules/dashboards.md`**: a record-mode amount refuses `sum` / `avg` / `min` / `max` unless grouped by its code field. The old "ungrouped" read as if any grouping would do.

## 18.2.0

### Minor Changes

- 493a6c4: feat(spec,metadata-protocol): a seed dataset column can be written only when its row is created (`columns.FIELD.applyOn: 'create'`)
  
  Clause-②: yes
  Metadata-protocol: added
  
  A seed is replayed on every dev-server boot and every package re-publish, and an `upsert` replay re-asserts every column a record declares on the row it matched. That reverts the columns an app's own jobs write after the first seed (a status a payment job advances, a flag a renewal job sets), so a re-run undid the jobs' work with nothing in the log.
  
  A seed dataset now takes a per-column write policy, keyed by field name:
  
  ```ts
  defineSeed(Instalment, {
    externalId: 'code',
    columns: {
      status:      { applyOn: 'create' },
      is_expiring: { applyOn: 'create' },
    },
    records: [{ code: 'INS-001', amount: 1200, status: 'pending', is_expiring: false }],
  });
  ```
  
  - **`applyOn: 'create'`** writes the column when the seed creates the row and leaves it out of every write to a row the seed matched by its `externalId`: an `upsert` replay over an existing row, and every row of an `update` dataset. The matched row keeps the value it holds, while the `always` columns are refreshed. A row whose only differences are create-only columns is not written at all. A create-only reference column on a matched row is not resolved and not deferred to pass 2, so nothing later in the load writes it back. A column of the `externalId` is the key the row was matched by and stays in its update. `insert`, `ignore` and `replace` never update a matched row, so nothing changes on those modes.
  - **`applyOn: 'always'`** (the default, and every column without a `columns` entry) is the behaviour before this change.
  - The values, the default and the meaning are those of the import door's `FieldMappingEntry.applyOn`. Both doors now read one enum, exported as `ColumnApplyOnSchema` from `@objectstack/spec/data`. `SeedColumnSchema` (with `SeedColumn` / `SeedColumnParsed`) is the per-column shape.
  - A `columns` key must name a column the object has: a declared field, or a system column the platform injects on it such as `owner_id`. `defineSeed` refuses one that does not when it runs (and at compile time for an object literal), naming the key with a near miss. The seed loader logs an `error` naming the column, once per dataset, whenever it loads a seed that names one, since a stored seed never passes through `defineSeed`. The rows still load.
  - `SeedSchema` refuses an unknown key on a column (`unrecognized_keys`), and a dataset-level `applyOn` is pointed at `columns`.
  
  `@objectstack/skills` only regenerates its schema reference indexes, which now list `SeedColumnSchema` and `ColumnApplyOnSchema`.

### Patch Changes

- f3d0eab: docs(skills): the objectstack-automation capability table says a declared webhook or auto-launched flow is refused without its `requires` pair, not silently undelivered
  
  Clause-②: no
  Metadata-protocol: none
  
  The 〈Prerequisite — declare the capabilities your nodes need〉 table in `objectstack-automation/SKILL.md` said that without `webhooks` in `requires` "nothing [is] delivered outbound", and that without `triggers` "flows register, never fire". Neither is what `defineStack` does: a declared webhook while `requires` omits `webhooks`, `realtime` or both is refused with `STACK_WEBHOOK_CAPABILITY_REQUIRED` (422), and an auto-launched flow while `requires` omits `triggers`, `automation` or both is refused with `STACK_TRIGGER_CAPABILITY_REQUIRED` (422) — at `os validate`, `os build`, `os dev` and `os serve` alike. The two rows now name the pair each surface owes and the refusal code; the lead-in says the refusal is at load time and that neither token implies the other. The `requires: [...]` example block under the table is folded into the lead-in to keep the skill within its token ceiling.
- 061cc94: docs(skills): the objectstack-platform bootstrap example pins every `@objectstack/*` dependency to one exact version
  
  Clause-②: no
  
  The 〈Complete Working Example〉 `package.json` in `objectstack-platform/references/bootstrap.md` gave `^17.0.0` for its five `@objectstack/*` packages, a major behind and a caret range the v18 docs advise against. It now gives `18.1.0` for each, the exact form `create-objectstack` writes, with all of them on one version.
- 992a7e1: docs(skills): the objectstack-platform stack-config example declares `engines: { protocol: '^18' }`, the major the 18.x boot handshake accepts
  
  Clause-②: no
  Metadata-protocol: none
  
  `objectstack-platform/SKILL.md` taught `engines: { protocol: '^17' }` in its `defineStack` manifest example while `PROTOCOL_VERSION` is `18.0.0`, so a config copied from the skill was refused at boot (`OS_PROTOCOL_INCOMPATIBLE`). The example, the eval that pins it (`evals/config-plugins-ops.json`, prompt and expected output together) and the `objectstack-upgrade` sentence describing what the scaffold writes now all say `'^18'`, matching `create-objectstack` and every example app. The `'^17'` → `--from 17` worked example in `objectstack-upgrade` is unchanged.
- d0eac35: docs(skills): the automation skill's inbound-hook table names `config.secretRef`, the form a package ships instead of a literal secret
  
  Clause-②: no
  
  Metadata-protocol: none
  
  The `objectstack-automation` skill's start-node table said an `api` flow needs a non-blank literal `secret`, or the flow is refused at registration. An `api` flow's start node may now name its secret instead, with `secretRef: 'NAME'`: the deployment fills that name (an environment variable in the open tier, never `OS_*`), and the engine reads it at every post, answering `503` while the name is unfilled. The row now says either one is required, and that a package ships `secretRef` and never commits a literal. The signature line names the `x-objectstack-signature` header the row used to carry.
- 8f35ffc: docs(skills): object-level `composite` / `repeater` are untyped JSON — a typed list is a child object
  
  Clause-②: no
  Metadata-protocol: none
  
  The `objectstack-data` field-types table said a `composite` carries "declared sub-fields". An object field has no member that declares them: `fields`, `subFields` and `columns` are refused on the field. The two rows now say the types are untyped JSON and that a list needing typed columns is a child object with a `master_detail` field (`inlineEdit: 'grid'` edits it inline on the parent's form).
  
  What to do: nothing. No key, value or behaviour changes.
- d65cbb6: docs(skills, spec): state that every published package declares exactly one anchor-safe `isDefault: true` permission set
  
  Clause-②: no
  Metadata-protocol: none
  
  `objectstack-data/rules/security.md` said what `isDefault: true` means (the `everyone` baseline, ADR-0090 D5) but not that a published package must declare one. Its `isDefault` bullet now states the requirement as a check an author can run: exactly one such set, anchor-safe, meaning `describeAnchorForbiddenBits(set, 'everyone')` from `@objectstack/spec/security` returns `null`; otherwise lint rule `security-anchor-high-privilege` and the binding refuse it. It also says what happens without one (invited members get nothing until an admin assigns a set to each) and that no gate counts the sets. The Marketplace Protocol header in `marketplace.zod.ts`, which the generated marketplace reference page renders, gains a matching "What a published package declares" section. No lint rule or schema changes. To stay within the skill file's token ceiling, three source-path asides, a section reference and one sentence are trimmed in the same file.
- a8f2afa: docs(skills): the `objectui` skill joins the published catalog, so `@objectstack/skills` ships the `@object-ui/*` authoring skill beside the `objectstack-*` ones
  
  Clause-②: no
  Metadata-protocol: none
  
  - **What ships.** `skills/objectui/` (its `SKILL.md`, 11 guides, 3 rules, 11 evals and a README) moves in from the objectui repository's own `skills/` tree. A project that syncs `@objectstack/skills` now gets an `objectui` skill in its agent directory, and `npx skills add objectstack-ai/objectstack/skills` lists it on the `next` channel.
  - **Stamped like the others.** Its `compatibility:` line now reads `Requires @objectstack/spec 18.x`, and `metadata.version` carries the workspace version, as on every catalog skill.
  - **Content changes on the way in.** The guides use the platform's vocabulary: expression examples gate on `data.status` or a user position, not on a `role` field, and the expressions guide gates a combined condition with `visibleWhen` instead of the deprecated `visibleOn`. The `@object-ui/permissions` example keeps its real `roles` keys, and the plugin guide's color input passes `value ?? ''` instead of a hard-coded black fallback.
- 2409c9c: chore(packages): ship a LICENSE in the 14 published packages that had none
  
  Clause-②: no
  Metadata-protocol: none
  
  npm packs a package's own `LICENSE` whatever its `files` says, and nothing in the release tooling copies the repository's root `LICENSE` into a package, so these 14 published tarballs carried no licence text at all while declaring `"license": "Apache-2.0"`. Each now carries a byte-for-byte copy of the root `LICENSE`, the same file the other 59 published packages already ship. With this, every one of the 73 published packages outside `ui/` ships a LICENSE and a README.
- 8061f33: chore(packages): publishing metadata — per-format types in `exports`, declared `sideEffects`, and a README for the 18 published packages without one
  
  Clause-②: no
  Metadata-protocol: none
  
  Measured on a fresh `origin/main` build of all 73 published packages outside `ui/`, each staged as `npm pack` would ship it, with publint 0.3.25 and @arethetypeswrong/cli 0.18.5. Before: 73 of 73 packages carried at least one publint message and 48 carried an attw problem. After: 3 packages carry a publint message and 16 carry an attw problem, each remaining class needing a change this one deliberately does not make — an export-map shape change, or a dual-build fix in `@objectstack/core`.
  
  - **Types per module format.** On 38 manifests one `types` entry served both formats, so a TypeScript consumer importing the ESM build was handed the CJS declarations — every one of attw's 38 `FalseCJS`. Each `{types, import, require}` entry becomes `{import: {types, default}, require: {types, default}}` pointing at the declaration file the same tsup run already emits for that format. No subpath is added or removed, and no JavaScript target moves. `@objectstack/core` keeps its single `types` entry: its `.d.ts` and `.d.cts` declare the same classes with private members, so serving them per format gives a consumer that reaches `core` through both resolution modes two incompatible `ObjectKernel` types, which is `@objectstack/plugin-dev`'s declaration build (it awaits `import('@objectstack/objectql')` inside a CommonJS build). Its `FalseESM` therefore stays, measured and unfixed here.
  - **`sideEffects` on the 72 manifests that declared none**, read per package rather than set in bulk: `@objectstack/service-cluster-redis` registers its `redis` cluster driver at module load and `create-objectstack`'s bin reaches its program through a bare import, so both declare their entry files side-effectful; everything else is `false`.
  - **`publishConfig: { access: 'public' }`** on the 17 that had none, the value the other 56 already declare.
  - **`type`** on the 39 that shipped `.js` without declaring a format — every `.js` under their `dist/` was read first and is CommonJS, which is what the absent field already meant — **`engines.node >= 22.0.0`** on the 22 that had no `engines`, and **`repository.url`** as the full `git+https://` git URL on 71.
  - **A README for 18 published packages that had none**: one paragraph, the first import a reader writes, and a link to the package's docs page. They are the pages npm renders, and for these 18 npm rendered nothing.

## 18.1.0

### Patch Changes

- c0cde8b: docs(skills): the npm page and the catalog's front page give the install line for the project's own package manager
  
  Clause-②: no
  
  `README.md` (the npm page) and `dist/skills/README.md` (the catalog's front page, copied from the repository's `skills/README.md`) printed `npm install --save-dev "@objectstack/skills@$(node -p …)"` as the only install line. In a pnpm-installed project that line exits `1` with `npm error Cannot read properties of null (reading 'edgesOut')` and writes nothing, and `create-objectstack` installs with pnpm when it is available, so a scaffolded project is commonly a pnpm project.
  
  - **Both pages** now print `pnpm add -D "@objectstack/skills@$(node -p "require('@objectstack/spec/package.json').version")"`, with the npm and yarn spellings on a comment line beside it, and the rule: add the package with the manager that installed the project. The `objectstack-upgrade` skill's re-install step, which an agent follows for this exact move, prints the same line.
  - **The npm page** names pnpm's `ERR_PNPM_NO_MATCHING_VERSION` beside npm's `ETARGET` for a project on `@objectstack/spec` 17.x, and runs `npx skills list` before `npx skills remove --all`, which removes every installed skill without asking.
- 7f5b19d: docs(spec, skills): the `titleFormat` description and the objectstack-data skill no longer steer a composite record title that must be queried into a formula field
  
  Clause-②: no
  Metadata-protocol: none
  
  The `titleFormat` description (and its generated copies on the object, metadata and migration reference pages) and the `objectstack-data` skill's `nameField` and `titleFormat` rows told an author to migrate a composite record title to a `formula` field with `returnType: 'text'` designated as `nameField`. A formula value is computed on read and stored nowhere, so a sort by it is refused, search never reaches it, and an import cannot match a lookup cell against it. Both now say what the record-title lint and ADR-0079 D3 already say: a composite title that import, sort or search must match is a stored computed field, a non-`formula` field that declares an `expression`, which the engine computes and stores on every write, designated as `nameField`; a text formula designated as `nameField` stays legal for a title shown for display only.
  
  The same skill's "Computed column" bullet (`rules/relationships.md`) said a stored field's `expression` is a client compute hint and the sent value is stored verbatim. The engine computes the expression from the row the write stores and stores the result, so a client-sent value never stands; the bullet now says so.
  
  No key, type, default or accepted value changes; only the text an author reads changes.
- cb38a8c: docs(skills): the objectstack-data skill's `current_user` placeholder table names a declared membership key
  
  Clause-②: no
  
  The security rules' table of the `current_user.*` placeholders the RLS compiler resolves listed only the kernel's keys. It now has a row for `current_user.KEY`, the set an object's `membershipKeys.KEY` declares (for `IN`), so an author reading the catalog alone learns that a declared key resolves.
- 0949fe5: docs(skills): objectstack-data's security rules name the risk of renaming or removing a shipped access item in a later package version
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-data/rules/security.md` gains a closing section, "Renaming or removing a shipped access item". Administrators act on a package's permission sets, positions, sharing rules and capabilities by name: they switch them off, clone them, and name the package's objects, fields and capabilities in their own sets. The section says what a rename, a removal or an added field deny does to those choices on upgrade, asks authors to keep shipped names stable and, when such a change is genuinely needed, to say in the release notes what changed and what an administrator should re-check. It is guidance only: no gate and no behaviour change.
  
  The file stays under its token ceiling. The new text is paid for by deleting restatements elsewhere in the same file: the stack-key bullet that repeated the code sample's comment, the assignment payload that repeated the row's columns, a code comment that repeated the sentence above it, the `viewAllRecords` corollary sentence, and the callout's repeats of the Layer 0 bullets and of a citation made two paragraphs earlier. No rule changes meaning.

## 18.0.0

### Minor Changes

- 165587e: New published package `@objectstack/skills`: the ObjectStack skills catalog (`skills/**` of the repository), shipped in the changeset `fixed` group so it always carries the version of the `@objectstack/*` packages it teaches. Its build copies the catalog into `dist/skills/<skill>/…` byte for byte (the layout the skills CLI's `experimental_sync` reads from `node_modules`), and `files` lists only that tree. The repository's `skills/**` stays the one source of truth and the documented `next` channel; nothing a consumer writes changes.
  
  `@objectstack/spec`: `llms.txt`'s package-ecosystem count reads 69 with `@objectstack/skills` joining the scope.

### Patch Changes

- f4755a6: docs(skills): `objectstack-data` says which hook doors provide `ctx.title` — a `body` has it, a deprecated `handler` gets it at runtime without `HookContext` declaring it, and `ql.registerHook` and a bare `ObjectQL` `bindHooks` do not provide it (#24289)
  
  Clause-②: no
  
  `skills/objectstack-data/references/data-hooks.md` listed `ctx.title(field?)` in the sandbox `ctx` table with no qualifier, so it read as a member of every hook context. It is not: a sandboxed `body` has it (the recommended form); an inline or named `handler`, which is deprecated, is handed it at runtime when the runtime binds the stack's hooks, but `HookContext` does not declare it, so a handler annotated with that type fails to compile; a hook registered with `ql.registerHook(...)`, or bound through `ObjectQL.bindHooks` with no runtime, gets no `ctx.title` at all. The row now says so. Text only; nothing an author writes changes, and no hook context changes.
- e4a770d: docs(skills): the `objectstack-ai` skill names the `agent` type's environment-overlay switch by its protocol-18 spelling, `allowEnvironmentOverlay:false` (#22340 S3)
  
  Clause-②: no
  
  `skills/objectstack-ai/SKILL.md`'s "Platform agents — reference only" section said the `agent` type is closed with `allowOrgOverride:false`. That key was renamed to `allowEnvironmentOverlay` in protocol 18 (ADR-0131 D6 retired the per-organization overlay axis, so the key names the one scope it governs; the old key stays on the registry entry schema only as a tombstone that refuses at parse with the new name in its prescription), so the published line now reads `allowEnvironmentOverlay:false`. The value, the `allowRuntimeCreate:false` beside it and the ADR-0063 §2 citation are unchanged; nothing an author writes changes. The same rename is recorded in `AGENTS.md` rule 7 and as header amendment notes on ADR-0005 and ADR-0010, none of which publishes.
- 44cadd3: fix(skills): the automation skill teaches flow value slots as a CEL envelope or a literal and text slots as `{{ }}` holes; the single-brace `{…}` dialect leaves the catalog text
  
  Clause-②: no
  
  The `objectstack-automation` skill no longer lists `{$User.<path>}`, `{NOW()}` / `{TODAY() ± N}` or any other single-brace `{…}` token as a spelling a flow value slot still reads, and the remedies it gives no longer pass through a refused spelling. What the skill now teaches is what the platform accepts:
  
  - A value slot — `assignments.*`, `fields.*`, a `subflow` / `map` `input.*`, a `script` `inputs.*`, a `loop` / `map` `collection`, a notify node's `recipients` / `templateData.*` / `sourceId`, an `http` node's `body`, each CRUD `filter` operand — takes a CEL value envelope `{ dialect: 'cel', source: '…' }` or a literal. A `{…}` token there is refused at `objectstack validate` (`expression-invalid`), `registerFlow` and the executor, naming its CEL spelling.
  - A text slot — notify `title` / `message` / `actionUrl`, screen `title` / `description`, end `message`, `http` `url` and `headers` — renders `{{ }}` holes.
  - The run user is `current_user.id`, guarded as `current_user != null ? current_user.id : null` in a flow that can run without a user; the date macros are `isoDate(today())`, `isoDate(daysFromNow(N))` / `isoDate(daysAgo(N))`, `isoDatetime(now())` and `isoDatetime(addDays(now(), N))`.
  - A CRUD `filter` operand that is a whole-string query placeholder (`{current_user_id}`, `{today}`) passes through to the query engine untouched; an operand that evaluates to `null` refuses the node.
  - A notify `recipients` value is one id, a list, or an envelope that evaluates to one, a list or `null` — a comma-separated string is one recipient.
  
  The `objectstack-query` skill's filters rule names the value-slot judge (`expression-invalid`) in place of the retired lint rule `flow-filter-token-unknown`, and the automation eval set's two expected outputs that spelled a retired token move with the text.
- 197fbe2: docs(skills): both READMEs the package ships install the catalog from `@objectstack/skills` at the installed `@objectstack/spec`'s version, and name the GitHub path only as the `next` channel (#22668)
  
  Clause-②: no
  
  `README.md` (the npm page) and `dist/skills/README.md` (the catalog's front page, copied from the repository's `skills/README.md`) are the two READMEs this package ships. Both now give the same two-step install the docs give: `npm install --save-dev "@objectstack/skills@$(node -p "require('@objectstack/spec/package.json').version")"`, then `npx skills experimental_sync --agent claude-code -y` — the catalog's version is then the installed spec's.
  
  Before: the npm page taught a bare `npm install --save-dev @objectstack/skills`, which on a project depending on `@objectstack/spec` 17.x installs `18.0.0-next.0`, the next major's catalog (the registry's `latest`); its example named `@objectstack/skills@17.7.0`, a version that was never published; and it did not say that the sync skips every skill a `skills add` installed, which is every project `create-objectstack` scaffolded through `18.0.0-next.0`. The catalog's front page still taught `npx skills add objectstack-ai/objectstack/skills …` as the install command for existing projects.
  
  Both pages now state which versions exist (published from `18.0.0-next.0` on; no 17.x, so step 1 answers `ETARGET` there), the update story (bump `@objectstack/skills` with the other `@objectstack/*` packages, then re-run the sync), and the GitHub path once, as the `next` channel: the unreleased `main`, for trying the next version's skills, not for a released project. Nothing under `dist/skills/*/` changes.
- 179f7bf: fix(skills): the `objectstack-data` field-types rule names all five formula `returnType` members, `'currency'` included, and the `currencyConfig` a currency formula carries (#22743)
  
  Clause-②: no
  
  `skills/objectstack-data/rules/field-types.md` taught a formula's `returnType` as the four-member set `'number' | 'text' | 'boolean' | 'date'`, and its formula example said `(no 'currency')`. `@objectstack/spec`'s `FieldSchema.returnType` is the five-member enum `'number' | 'text' | 'boolean' | 'date' | 'currency'`, and a formula whose `returnType` is `'currency'` carries its currency in its own `currencyConfig` — `CurrencyConfigSchema`, the same shape a `currency` field declares; absent, the mode is `dynamic`, the tenant default currency. The `formula` table row and the formula example now both state the five-member set and name `currencyConfig` as the carrier. The example's `CEL — record. prefixes required` comment, which restated the table cell above it, is removed to pay the skill's token ratchet. Nothing is said about how a currency formula renders.
- eed637c: docs(automation): every text that teaches a sender of an inbound `api` hook teaches the timestamped `x-objectstack-signature` form only — `t=<unix seconds>,v1=<hex>`, the HMAC-SHA256 of `<t>.<raw body>` under the flow's secret, refused when `t` is more than 300 seconds from the server clock
  
  Clause-②: no
  
  The inbound hook door has accepted the timestamped form since `signHttpBodyAt` landed in `@objectstack/core`, and it is the only form that stops a captured post from verifying forever; the published teaching still showed the body-only `sha256=<hex>` form. The guidance converges first; the door's refusal of the body-only form is a later change of its own.
  
  - **`@objectstack/skills`.** The `objectstack-automation` skill's Inbound webhook section teaches `t=<unix seconds>,v1=<hex>`: `v1` is the HMAC-SHA256 of `<t>.<raw body>` under the start node's `secret`, and the door refuses a `t` more than 300 seconds from its clock. The body-only form is no longer shown.
  - **`@objectstack/lint`.** The hint of `flow-api-trigger-secret-missing` and its `os explain` entry describe the same form. The rule's id, severity, verdict sentence and judgement are unchanged.
  - The showcase example's comment and the platform checklist's intake recipe sign the same way.
  
  **Nothing to migrate for an author.** A sender that already signs with `signHttpBodyAt` is unchanged. **The outbound contract stays as published:** the messaging outbox and the flow `http` node keep signing body-only (`signHttpBody`) for third-party receivers, and the inbound door's accept set is not changed by this release.
- e9e10fd: docs(skills): the `objectstack-data` indexing rule's partial-index example teaches the rule with an application-shaped index instead of restating the platform's overlay uniqueness key (#23039)
  
  Clause-②: no
  
  `skills/objectstack-data/rules/indexing.md`'s "Access methods and partial indexes" section illustrated a partial index with the platform's own overlay-uniqueness DDL and said that was what `ensureOverlayIndex` runs. The quoted key had four parts; the platform's runtime key has carried a fifth, `bundle_member`, since protocol 18, so the sentence stated something the platform no longer runs. The example is re-cut to an application-shaped partial index — one *active* subscription per account, the coarse `{ fields: ['account_id'] }` declared in metadata and the unique partial form built in a migration — so the rule is taught without restating a platform key that changes on its own schedule. The rule itself is unchanged: declare the coarse index (or none) in metadata, build the partial form as raw SQL in a runtime migration, fall back to a plain index on a dialect that rejects the predicate. Nothing an author writes changes.
- 11d4c5a: docs(skills): the `objectstack-data` lint-rule reference drops `security-external-wider-than-internal`, retired with `externalSharingModel` (#23268)
  
  Clause-②: no
  
  The row named a rule `@objectstack/lint` 18 no longer has, and nothing an author writes changes.
- 713f231: docs(skills): the upgrade skill's preflight re-installs the catalog from `@objectstack/skills` when a 17.x project moves to 18, and both READMEs give the scaffolder's pinned `--copy` sync (#23276)
  
  Clause-②: no
  
  `objectstack-upgrade`'s §0 Preflight gains one step for the skills themselves. A 17.x project's skills were installed with `skills add` from the repository's `main`; their `skills-lock.json` entries read `sourceType: github`, and `experimental_sync` skips them (it prints `Skipped … installed with skills add` and exits 0), so a project that only bumps its packages keeps its 17.x-era skill text. The step removes the eleven `objectstack-*` skills the catalog carried during 17.x (a name not installed is skipped; `--all` when they are the project's only skills), installs `@objectstack/skills` at the installed `@objectstack/spec`'s version, and copies it with `npx skills@1.7.2 experimental_sync --agent claude-code --copy -y` — the command `create-objectstack` runs. The step is paid under the token ratchet by deleting text the same file restates elsewhere; the ceiling is unchanged.
  
  `README.md` (the npm page) and `dist/skills/README.md` (the catalog's front page, copied from the repository's `skills/README.md`) replace the unpinned linked sync (`npx skills experimental_sync --agent claude-code -y`) with that pinned `--copy` spelling and say why: without `--copy` the sync writes links into `node_modules`, which a clone of a project that commits its skills does not have.
- 68e64dd: fix(skills): the automation skill's two reference files write a CRUD `filter` operand as a CEL value envelope or the `{today}` query placeholder; the single-brace `{…}` filter spelling leaves them
  
  Clause-②: no
  
  `skills/objectstack-automation/references/examples-flows.md` and `references/state-machines-and-approvals.md` no longer teach `'{TODAY()}'`, `'{TODAY() + N}'` or `'{record.id}'` at an `update_record` filter operand — spellings the platform refuses (`expression-invalid`) at `objectstack validate`, `registerFlow` and the executor, so an author who copied the example got a refused node. The examples now write what the platform accepts: the query placeholder `'{today}'` for today's date, a CEL value envelope `{ dialect: 'cel', source: 'isoDate(daysFromNow(N))' }` for a one-day window at a date offset, and `{ dialect: 'cel', source: 'record.id' }` for the triggering record's id. The prose names the CEL value envelope where it named a template token (and no longer says a CEL envelope is compared as a literal at a filter operand), and the time-word cheat sheet names the CEL envelope and the `{{ }}` text hole where it named the retired `{…}` template.
- 46ca793: docs(skills): the `objectstack-ui` pages rule says what a page type, template and region name run (#23610)
  
  Clause-②: no
  
  `skills/objectstack-ui/rules/pages.md` taught `home` as the app's landing page, `utility` as a floating utility panel, templates `two-column` / `single-column` and regions `left_sidebar` / `right_sidebar`, and `kind: 'jsx'` as a live alias of `html` — none of which the console draws or the spec accepts. The rule now states the declared contract: `home` is the widest region page and not a landing (an app opens on its first navigation item; `isDefault` on it is refused), `utility` is a narrow inline region page with no floating or docked shell slot, `template` is one of `default`, `header-sidebar-main`, `three-column` or `dashboard` with the regions each one places (`sidebar` left, `aside` right; `full-width` retired), a region the template does not place or a second region for a filled slot is refused at its `name`, and `kind: 'jsx'` is refused with the prescription `html`. Skill text only; nothing an author writes changes.
- 5477020: docs(skills): the `objectstack-data` security rule states a grant's uniqueness as the declared `unique: 'organization'` index holds it, in place of the retired `permission_set_id` column (#23615)
  
  Clause-②: no
  
  `skills/objectstack-data/rules/security.md`'s grant paragraph closed with "`permission_set_id` is a legacy column: do not write it." The grant object `sys_user_permission_set` no longer declares that column, so a write naming it is refused `400 INVALID_FIELD` as an undeclared field, and the sentence taught an AI author a key the declared shape does not have. The sentence is replaced by the rule the declared shape holds: one grant per user, set and organization, enforced by the join object's `unique: 'organization'` index on (`user_id`, `permission_set`, `organization_id`). The by-name reference — `permission_set` takes the set's `name` — and its refusals are unchanged. No behaviour changes; nothing an author writes changes.
- b711056: docs(skills): the `objectstack-ui` navigation rule states the derived record surface per flow — viewing routes to a page, creating or editing opens a modal bounded on desktop and full-screen on mobile, a light record uses a drawer (#23753)
  
  Clause-②: no
  
  `skills/objectstack-ui/rules/navigation.md`'s Surface bullet said a field-heavy object opens create/edit/detail as a full page and that mobile always pages. The platform's derivation (`deriveRecordFlowSurface` in `@objectstack/spec`) routes only the `view` flow to a page; the create, edit and child task flows never route — a field-heavy record, or any record on mobile, opens them in a modal that is bounded on desktop and full-screen on mobile, and a light record on desktop opens every flow in a drawer. The bullet now states that mapping and names the override only where the spec declares it: `navigation.mode` on the list view (`navigation` is not an object key). Text only; nothing an author writes changes.
- 2fdfb5d: docs(skills): the `objectstack-data` datasources rule states that `default` is host-reserved — the host connects it from `OS_DATABASE_URL`, and a stack that declares a datasource named `default` is refused (#23768)
  
  Clause-②: no
  
  `skills/objectstack-data/rules/datasources.md`'s opening paragraph read "Most apps need only the `default` datasource; declare more to read/write a separate or external database." "Declare more" implied that `default` is declared too, and a stack whose `datasources` collection carries an entry named `default` is refused at `defineStack`, `os validate`, publish and boot: the host declares and connects `default` itself. The sentence is replaced by the rule the spec and runtime hold: `default` is host-reserved, the host connects it from `OS_DATABASE_URL`, a stack that declares a datasource named `default` is refused, and a datasource is declared under its own name only to read/write a separate or external database. The added words are paid for inside the same file by deleting two restatements of the field reference: "`external` settings are required when `schemaMode !== 'managed'`" (the schema refuses the omission itself) and "Set `autoConnect: true` to force a live connection" (the auto-connect list two lines above already names it). No behaviour changes; nothing an author writes changes.
- 49700e4: docs(skills): the `objectstack-api` skill stops teaching an app to mount routes on `http.server` — an app declares `apis:`, computes in a flow, and registers code as a stack function or a connector (#23787)
  
  Clause-②: no
  
  `skills/objectstack-api/SKILL.md`'s decision table sent an endpoint that needs code to an imperative `http.server` mount on `kernel:ready`, and its "Code routes" section taught that mount. Ruling C′ item 2 on #23128 retired the mount as an app-author surface: the `http.server` service is the platform plugins' own door-building primitive. The table now points code at a `type: 'flow'` endpoint whose `script` node runs a stack function (`defineStack({ functions })`) or whose `connector_action` node calls a declared connector, names the inbound `type: 'api'` flow hook for a webhook signed with ObjectStack's own `x-objectstack-signature`, and states the three cases that have no app surface today (a third-party callback verified by its own signature over the raw body, a streaming response, a protocol the platform does not speak) instead of inventing one. The "Code routes" section is deleted, and eval 3 expects that answer. Skill text only; nothing an author writes changes.
- f1c0b57: docs(skills): `objectstack-data` and `objectstack-formula` state that `previous` is `null` on insert — `previous == null` judges an insert, a column read off it there faults, and only a write to an existing row whose prior state is not in hand leaves it unbound (#23983)
  
  Clause-②: no
  
  `skills/objectstack-data/references/data-hooks.md` and `skills/objectstack-formula/SKILL.md` said `previous` is unbound on insert events and told authors to write insert-event conditions over `record` alone. Since `@objectstack/objectql` binds `previous` to `null` on insert in validation rules and declarative hook conditions (the binding a flow's start condition already had), that text was false: `previous == null || …` judges an insert and `previous != null && …` skips one; only a column read off `previous` on insert (`previous.status`) still has no value and still fails the write, and only a write to an existing row whose prior state is not in hand leaves `previous` unbound, failing closed. The bullet, the scope-table row, the abort note and the legacy-translation note now state that binding and the `null` guard; the `record`-alone advice stays correct and is no longer presented as the rule. Text only; nothing an author writes changes, and a hook's `ctx.previous` is unchanged.
- 53ef752: docs(skills): `objectstack-api` states that a public form's submit is authorized by the form's own `publicFormGrant`, and that the `guest_portal` name on the submit context admits nothing and needs no permission set (#24239)
  
  Clause-②: no
  
  `skills/objectstack-api/SKILL.md` described the anonymous form endpoints as running under a synthetic `{ permissions: ['guest_portal'], anonymous: true }` execution context and named nothing else, so an author reading it inferred that a `guest_portal` permission set authorizes the submit and declared one, or concluded that the form falls open without one. Neither is true: the submit is authorized by the form's own declaration (ADR-0056 Option A) — the route hands the engine a `publicFormGrant` scoped to the form's target object, which admits the create and the read-back of the row it made and nothing else, decided before any permission set resolves. The `guest_portal` name on the context admits nothing; where a deployment registers a set under it, that set only feeds the grant's result masker. The passage now says so, matching `content/docs/ui/public-data-collection.mdx` and the `registerFormEndpoints` docstring in `@objectstack/rest`. Text only; nothing an author writes changes, and the form routes' behaviour is unchanged.

## 18.0.0-next.5

No changes in this release.

## 18.0.0-next.4

### Patch Changes

- f1c0b57: docs(skills): `objectstack-data` and `objectstack-formula` state that `previous` is `null` on insert — `previous == null` judges an insert, a column read off it there faults, and only a write to an existing row whose prior state is not in hand leaves it unbound (#23983)
  
  Clause-②: no
  
  `skills/objectstack-data/references/data-hooks.md` and `skills/objectstack-formula/SKILL.md` said `previous` is unbound on insert events and told authors to write insert-event conditions over `record` alone. Since `@objectstack/objectql` binds `previous` to `null` on insert in validation rules and declarative hook conditions (the binding a flow's start condition already had), that text was false: `previous == null || …` judges an insert and `previous != null && …` skips one; only a column read off `previous` on insert (`previous.status`) still has no value and still fails the write, and only a write to an existing row whose prior state is not in hand leaves `previous` unbound, failing closed. The bullet, the scope-table row, the abort note and the legacy-translation note now state that binding and the `null` guard; the `record`-alone advice stays correct and is no longer presented as the rule. Text only; nothing an author writes changes, and a hook's `ctx.previous` is unchanged.
- 53ef752: docs(skills): `objectstack-api` states that a public form's submit is authorized by the form's own `publicFormGrant`, and that the `guest_portal` name on the submit context admits nothing and needs no permission set (#24239)
  
  Clause-②: no
  
  `skills/objectstack-api/SKILL.md` described the anonymous form endpoints as running under a synthetic `{ permissions: ['guest_portal'], anonymous: true }` execution context and named nothing else, so an author reading it inferred that a `guest_portal` permission set authorizes the submit and declared one, or concluded that the form falls open without one. Neither is true: the submit is authorized by the form's own declaration (ADR-0056 Option A) — the route hands the engine a `publicFormGrant` scoped to the form's target object, which admits the create and the read-back of the row it made and nothing else, decided before any permission set resolves. The `guest_portal` name on the context admits nothing; where a deployment registers a set under it, that set only feeds the grant's result masker. The passage now says so, matching `content/docs/ui/public-data-collection.mdx` and the `registerFormEndpoints` docstring in `@objectstack/rest`. Text only; nothing an author writes changes, and the form routes' behaviour is unchanged.

## 18.0.0-next.3

### Patch Changes

- 46ca793: docs(skills): the `objectstack-ui` pages rule says what a page type, template and region name run (#23610)
  
  Clause-②: no
  
  `skills/objectstack-ui/rules/pages.md` taught `home` as the app's landing page, `utility` as a floating utility panel, templates `two-column` / `single-column` and regions `left_sidebar` / `right_sidebar`, and `kind: 'jsx'` as a live alias of `html` — none of which the console draws or the spec accepts. The rule now states the declared contract: `home` is the widest region page and not a landing (an app opens on its first navigation item; `isDefault` on it is refused), `utility` is a narrow inline region page with no floating or docked shell slot, `template` is one of `default`, `header-sidebar-main`, `three-column` or `dashboard` with the regions each one places (`sidebar` left, `aside` right; `full-width` retired), a region the template does not place or a second region for a filled slot is refused at its `name`, and `kind: 'jsx'` is refused with the prescription `html`. Skill text only; nothing an author writes changes.
- b711056: docs(skills): the `objectstack-ui` navigation rule states the derived record surface per flow — viewing routes to a page, creating or editing opens a modal bounded on desktop and full-screen on mobile, a light record uses a drawer (#23753)
  
  Clause-②: no
  
  `skills/objectstack-ui/rules/navigation.md`'s Surface bullet said a field-heavy object opens create/edit/detail as a full page and that mobile always pages. The platform's derivation (`deriveRecordFlowSurface` in `@objectstack/spec`) routes only the `view` flow to a page; the create, edit and child task flows never route — a field-heavy record, or any record on mobile, opens them in a modal that is bounded on desktop and full-screen on mobile, and a light record on desktop opens every flow in a drawer. The bullet now states that mapping and names the override only where the spec declares it: `navigation.mode` on the list view (`navigation` is not an object key). Text only; nothing an author writes changes.
- 2fdfb5d: docs(skills): the `objectstack-data` datasources rule states that `default` is host-reserved — the host connects it from `OS_DATABASE_URL`, and a stack that declares a datasource named `default` is refused (#23768)
  
  Clause-②: no
  
  `skills/objectstack-data/rules/datasources.md`'s opening paragraph read "Most apps need only the `default` datasource; declare more to read/write a separate or external database." "Declare more" implied that `default` is declared too, and a stack whose `datasources` collection carries an entry named `default` is refused at `defineStack`, `os validate`, publish and boot: the host declares and connects `default` itself. The sentence is replaced by the rule the spec and runtime hold: `default` is host-reserved, the host connects it from `OS_DATABASE_URL`, a stack that declares a datasource named `default` is refused, and a datasource is declared under its own name only to read/write a separate or external database. The added words are paid for inside the same file by deleting two restatements of the field reference: "`external` settings are required when `schemaMode !== 'managed'`" (the schema refuses the omission itself) and "Set `autoConnect: true` to force a live connection" (the auto-connect list two lines above already names it). No behaviour changes; nothing an author writes changes.
- 49700e4: docs(skills): the `objectstack-api` skill stops teaching an app to mount routes on `http.server` — an app declares `apis:`, computes in a flow, and registers code as a stack function or a connector (#23787)
  
  Clause-②: no
  
  `skills/objectstack-api/SKILL.md`'s decision table sent an endpoint that needs code to an imperative `http.server` mount on `kernel:ready`, and its "Code routes" section taught that mount. Ruling C′ item 2 on #23128 retired the mount as an app-author surface: the `http.server` service is the platform plugins' own door-building primitive. The table now points code at a `type: 'flow'` endpoint whose `script` node runs a stack function (`defineStack({ functions })`) or whose `connector_action` node calls a declared connector, names the inbound `type: 'api'` flow hook for a webhook signed with ObjectStack's own `x-objectstack-signature`, and states the three cases that have no app surface today (a third-party callback verified by its own signature over the raw body, a streaming response, a protocol the platform does not speak) instead of inventing one. The "Code routes" section is deleted, and eval 3 expects that answer. Skill text only; nothing an author writes changes.

## 18.0.0-next.2

### Patch Changes

- 11d4c5a: docs(skills): the `objectstack-data` lint-rule reference drops `security-external-wider-than-internal`, retired with `externalSharingModel` (#23268)
  
  Clause-②: no
  
  The row named a rule `@objectstack/lint` 18 no longer has, and nothing an author writes changes.
- 5477020: docs(skills): the `objectstack-data` security rule states a grant's uniqueness as the declared `unique: 'organization'` index holds it, in place of the retired `permission_set_id` column (#23615)
  
  Clause-②: no
  
  `skills/objectstack-data/rules/security.md`'s grant paragraph closed with "`permission_set_id` is a legacy column: do not write it." The grant object `sys_user_permission_set` no longer declares that column, so a write naming it is refused `400 INVALID_FIELD` as an undeclared field, and the sentence taught an AI author a key the declared shape does not have. The sentence is replaced by the rule the declared shape holds: one grant per user, set and organization, enforced by the join object's `unique: 'organization'` index on (`user_id`, `permission_set`, `organization_id`). The by-name reference — `permission_set` takes the set's `name` — and its refusals are unchanged. No behaviour changes; nothing an author writes changes.

## 18.0.0-next.1

### Patch Changes

- 44cadd3: fix(skills): the automation skill teaches flow value slots as a CEL envelope or a literal and text slots as `{{ }}` holes; the single-brace `{…}` dialect leaves the catalog text
  
  Clause-②: no
  
  The `objectstack-automation` skill no longer lists `{$User.<path>}`, `{NOW()}` / `{TODAY() ± N}` or any other single-brace `{…}` token as a spelling a flow value slot still reads, and the remedies it gives no longer pass through a refused spelling. What the skill now teaches is what the platform accepts:
  
  - A value slot — `assignments.*`, `fields.*`, a `subflow` / `map` `input.*`, a `script` `inputs.*`, a `loop` / `map` `collection`, a notify node's `recipients` / `templateData.*` / `sourceId`, an `http` node's `body`, each CRUD `filter` operand — takes a CEL value envelope `{ dialect: 'cel', source: '…' }` or a literal. A `{…}` token there is refused at `objectstack validate` (`expression-invalid`), `registerFlow` and the executor, naming its CEL spelling.
  - A text slot — notify `title` / `message` / `actionUrl`, screen `title` / `description`, end `message`, `http` `url` and `headers` — renders `{{ }}` holes.
  - The run user is `current_user.id`, guarded as `current_user != null ? current_user.id : null` in a flow that can run without a user; the date macros are `isoDate(today())`, `isoDate(daysFromNow(N))` / `isoDate(daysAgo(N))`, `isoDatetime(now())` and `isoDatetime(addDays(now(), N))`.
  - A CRUD `filter` operand that is a whole-string query placeholder (`{current_user_id}`, `{today}`) passes through to the query engine untouched; an operand that evaluates to `null` refuses the node.
  - A notify `recipients` value is one id, a list, or an envelope that evaluates to one, a list or `null` — a comma-separated string is one recipient.
  
  The `objectstack-query` skill's filters rule names the value-slot judge (`expression-invalid`) in place of the retired lint rule `flow-filter-token-unknown`, and the automation eval set's two expected outputs that spelled a retired token move with the text.
- 197fbe2: docs(skills): both READMEs the package ships install the catalog from `@objectstack/skills` at the installed `@objectstack/spec`'s version, and name the GitHub path only as the `next` channel (#22668)
  
  Clause-②: no
  
  `README.md` (the npm page) and `dist/skills/README.md` (the catalog's front page, copied from the repository's `skills/README.md`) are the two READMEs this package ships. Both now give the same two-step install the docs give: `npm install --save-dev "@objectstack/skills@$(node -p "require('@objectstack/spec/package.json').version")"`, then `npx skills experimental_sync --agent claude-code -y` — the catalog's version is then the installed spec's.
  
  Before: the npm page taught a bare `npm install --save-dev @objectstack/skills`, which on a project depending on `@objectstack/spec` 17.x installs `18.0.0-next.0`, the next major's catalog (the registry's `latest`); its example named `@objectstack/skills@17.7.0`, a version that was never published; and it did not say that the sync skips every skill a `skills add` installed, which is every project `create-objectstack` scaffolded through `18.0.0-next.0`. The catalog's front page still taught `npx skills add objectstack-ai/objectstack/skills …` as the install command for existing projects.
  
  Both pages now state which versions exist (published from `18.0.0-next.0` on; no 17.x, so step 1 answers `ETARGET` there), the update story (bump `@objectstack/skills` with the other `@objectstack/*` packages, then re-run the sync), and the GitHub path once, as the `next` channel: the unreleased `main`, for trying the next version's skills, not for a released project. Nothing under `dist/skills/*/` changes.
- 713f231: docs(skills): the upgrade skill's preflight re-installs the catalog from `@objectstack/skills` when a 17.x project moves to 18, and both READMEs give the scaffolder's pinned `--copy` sync (#23276)
  
  Clause-②: no
  
  `objectstack-upgrade`'s §0 Preflight gains one step for the skills themselves. A 17.x project's skills were installed with `skills add` from the repository's `main`; their `skills-lock.json` entries read `sourceType: github`, and `experimental_sync` skips them (it prints `Skipped … installed with skills add` and exits 0), so a project that only bumps its packages keeps its 17.x-era skill text. The step removes the eleven `objectstack-*` skills the catalog carried during 17.x (a name not installed is skipped; `--all` when they are the project's only skills), installs `@objectstack/skills` at the installed `@objectstack/spec`'s version, and copies it with `npx skills@1.7.2 experimental_sync --agent claude-code --copy -y` — the command `create-objectstack` runs. The step is paid under the token ratchet by deleting text the same file restates elsewhere; the ceiling is unchanged.
  
  `README.md` (the npm page) and `dist/skills/README.md` (the catalog's front page, copied from the repository's `skills/README.md`) replace the unpinned linked sync (`npx skills experimental_sync --agent claude-code -y`) with that pinned `--copy` spelling and say why: without `--copy` the sync writes links into `node_modules`, which a clone of a project that commits its skills does not have.
- 68e64dd: fix(skills): the automation skill's two reference files write a CRUD `filter` operand as a CEL value envelope or the `{today}` query placeholder; the single-brace `{…}` filter spelling leaves them
  
  Clause-②: no
  
  `skills/objectstack-automation/references/examples-flows.md` and `references/state-machines-and-approvals.md` no longer teach `'{TODAY()}'`, `'{TODAY() + N}'` or `'{record.id}'` at an `update_record` filter operand — spellings the platform refuses (`expression-invalid`) at `objectstack validate`, `registerFlow` and the executor, so an author who copied the example got a refused node. The examples now write what the platform accepts: the query placeholder `'{today}'` for today's date, a CEL value envelope `{ dialect: 'cel', source: 'isoDate(daysFromNow(N))' }` for a one-day window at a date offset, and `{ dialect: 'cel', source: 'record.id' }` for the triggering record's id. The prose names the CEL value envelope where it named a template token (and no longer says a CEL envelope is compared as a literal at a filter operand), and the time-word cheat sheet names the CEL envelope and the `{{ }}` text hole where it named the retired `{…}` template.

## 18.0.0-next.0

### Minor Changes

- 165587e: New published package `@objectstack/skills`: the ObjectStack skills catalog (`skills/**` of the repository), shipped in the changeset `fixed` group so it always carries the version of the `@objectstack/*` packages it teaches. Its build copies the catalog into `dist/skills/<skill>/…` byte for byte (the layout the skills CLI's `experimental_sync` reads from `node_modules`), and `files` lists only that tree. The repository's `skills/**` stays the one source of truth and the documented `next` channel; nothing a consumer writes changes.
  
  `@objectstack/spec`: `llms.txt`'s package-ecosystem count reads 69 with `@objectstack/skills` joining the scope.

### Patch Changes

- e4a770d: docs(skills): the `objectstack-ai` skill names the `agent` type's environment-overlay switch by its protocol-18 spelling, `allowEnvironmentOverlay:false` (#22340 S3)
  
  Clause-②: no
  
  `skills/objectstack-ai/SKILL.md`'s "Platform agents — reference only" section said the `agent` type is closed with `allowOrgOverride:false`. That key was renamed to `allowEnvironmentOverlay` in protocol 18 (ADR-0131 D6 retired the per-organization overlay axis, so the key names the one scope it governs; the old key stays on the registry entry schema only as a tombstone that refuses at parse with the new name in its prescription), so the published line now reads `allowEnvironmentOverlay:false`. The value, the `allowRuntimeCreate:false` beside it and the ADR-0063 §2 citation are unchanged; nothing an author writes changes. The same rename is recorded in `AGENTS.md` rule 7 and as header amendment notes on ADR-0005 and ADR-0010, none of which publishes.
- 179f7bf: fix(skills): the `objectstack-data` field-types rule names all five formula `returnType` members, `'currency'` included, and the `currencyConfig` a currency formula carries (#22743)
  
  Clause-②: no
  
  `skills/objectstack-data/rules/field-types.md` taught a formula's `returnType` as the four-member set `'number' | 'text' | 'boolean' | 'date'`, and its formula example said `(no 'currency')`. `@objectstack/spec`'s `FieldSchema.returnType` is the five-member enum `'number' | 'text' | 'boolean' | 'date' | 'currency'`, and a formula whose `returnType` is `'currency'` carries its currency in its own `currencyConfig` — `CurrencyConfigSchema`, the same shape a `currency` field declares; absent, the mode is `dynamic`, the tenant default currency. The `formula` table row and the formula example now both state the five-member set and name `currencyConfig` as the carrier. The example's `CEL — record. prefixes required` comment, which restated the table cell above it, is removed to pay the skill's token ratchet. Nothing is said about how a currency formula renders.
- eed637c: docs(automation): every text that teaches a sender of an inbound `api` hook teaches the timestamped `x-objectstack-signature` form only — `t=<unix seconds>,v1=<hex>`, the HMAC-SHA256 of `<t>.<raw body>` under the flow's secret, refused when `t` is more than 300 seconds from the server clock
  
  Clause-②: no
  
  The inbound hook door has accepted the timestamped form since `signHttpBodyAt` landed in `@objectstack/core`, and it is the only form that stops a captured post from verifying forever; the published teaching still showed the body-only `sha256=<hex>` form. The guidance converges first; the door's refusal of the body-only form is a later change of its own.
  
  - **`@objectstack/skills`.** The `objectstack-automation` skill's Inbound webhook section teaches `t=<unix seconds>,v1=<hex>`: `v1` is the HMAC-SHA256 of `<t>.<raw body>` under the start node's `secret`, and the door refuses a `t` more than 300 seconds from its clock. The body-only form is no longer shown.
  - **`@objectstack/lint`.** The hint of `flow-api-trigger-secret-missing` and its `os explain` entry describe the same form. The rule's id, severity, verdict sentence and judgement are unchanged.
  - The showcase example's comment and the platform checklist's intake recipe sign the same way.
  
  **Nothing to migrate for an author.** A sender that already signs with `signHttpBodyAt` is unchanged. **The outbound contract stays as published:** the messaging outbox and the flow `http` node keep signing body-only (`signHttpBody`) for third-party receivers, and the inbound door's accept set is not changed by this release.
- e9e10fd: docs(skills): the `objectstack-data` indexing rule's partial-index example teaches the rule with an application-shaped index instead of restating the platform's overlay uniqueness key (#23039)
  
  Clause-②: no
  
  `skills/objectstack-data/rules/indexing.md`'s "Access methods and partial indexes" section illustrated a partial index with the platform's own overlay-uniqueness DDL and said that was what `ensureOverlayIndex` runs. The quoted key had four parts; the platform's runtime key has carried a fifth, `bundle_member`, since protocol 18, so the sentence stated something the platform no longer runs. The example is re-cut to an application-shaped partial index — one *active* subscription per account, the coarse `{ fields: ['account_id'] }` declared in metadata and the unique partial form built in a migration — so the rule is taught without restating a platform key that changes on its own schedule. The rule itself is unchanged: declare the coarse index (or none) in metadata, build the partial form as raw SQL in a runtime migration, fall back to a plain index on a dialect that rejects the predicate. Nothing an author writes changes.
