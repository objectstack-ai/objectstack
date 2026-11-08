# ADR-0150: Behavioural metadata is addressed by (package, name) — objects keep the literal prefix; ADR-0028 re-opened for the behavioural tier

**Status**: Proposed (2026-11-08). `docs/adr/` is Tier H (Prime Directive #14): this record becomes **Accepted** by the maintainer's merge, and ⛔ the cards under [Execution plan](#execution-plan-after-acceptance) are cut after that merge, never before it. **This record declares; it implements nothing**: no schema, no code, no changeset. · **Supersedes in part** [ADR-0028](./0028-metadata-naming-and-namespace-isolation.md) (D1 and D3, for the metadata types of buckets 2–4 below; ADR-0028 stays Deferred for objects and everything else) · **Amends** [ADR-0048](./0048-cross-package-metadata-collision.md) §3.3 and its 2026-11-06 addendum (the one-holder refusal retires per type as that type's readers carry the package, [D9](#d9--what-retires-and-what-stays)) · **Withdraws** the non-object half of ruling C on #30798: phase 3 (#30806 S1 and S5) does not ship.

- **Date**: 2026-11-08
- **Card**: [#31527](https://github.com/objectstack-ai/objectstack/issues/31527), replacing [#30806](https://github.com/objectstack-ai/objectstack/issues/30806) phase 3 for the behavioural tier.
- **Decided by**: the maintainer, 2026-11-08, three rulings, verbatim and untranslated. This record executes them as written; ⛔ none is re-opened here.
  - The direction, decision card tapped **A 「转向包寻址」** at 13:12:35Z (seat record [`6721941146`](https://github.com/objectstack-ai/objectstack/issues/30806#issuecomment-6721941146) on #30806), after his message 「你不能只考虑现状，还要考虑长远的合理性；我说的流程不是url挂到对象下，而是挂到软件包下」.
  - The scope, 13:13:39Z: 「流程等行为元数据按软件包寻址，立决策卡，现在就所有的元数据类型然后和我沟通。」
  - The per-type table, decision card tapped **A 「按修正后分档写入」** at 15:36:01Z (seat record [`6723462584`](https://github.com/objectstack-ai/objectstack/issues/31527#issuecomment-6723462584) on #31527). [D1](#d1--four-buckets-as-ruled) restates it; where the two differ in words, the ruling binds.
- **Left to this record by the ruling**, each argued on the four axes: the bucket-3 flat spelling on the AI face ([D6](#d6--the-ai-face-spells-a-derived-flat-name-ns-name)) and how two packages' same-named positions are handled ([D7](#d7--positions-are-environment-scoped-and-a-second-holder-is-refused)).
- **Builds on**: [ADR-0005](./0005-metadata-customization-overlay.md) (overlays), [ADR-0019](./0019-app-as-consumer-unit.md) (the namespace-named app), [ADR-0048](./0048-cross-package-metadata-collision.md) §3.1–§3.3 (package id is identity; prefer-local resolution), [ADR-0126](./0126-packaged-metadata-customization-model.md) §4 (the activation ledger; no re-encoded literal in a column), [ADR-0129](./0129-object-name-is-the-canonical-id.md) (the object name is the table name), [ADR-0130](./0130-release-artifact-as-co-ownership-boundary.md) and [ADR-0141](./0141-inter-app-dependency-declared-checked-before-install.md) (namespace co-ownership; the declared dependency closure), [ADR-0146](./0146-studio-designs-setup-administers-one-editor-per-item-paired-customize-package.md) (the paired `.custom` package).
- **Inputs**: the #30806 plan ([`6719833098`](https://github.com/objectstack-ai/objectstack/issues/30806#issuecomment-6719833098)), the seat records `6721537981` and `6721596287`, and the #31527 stage-1 inventory, measured read-only on `main` at `86e37660`. Measurements below cite it.

---

## TL;DR

1. **Two tiers, two mechanisms.** Names that are storage identity or a shared data contract (objects, fields, object extensions, views, capabilities, docs, API paths) keep ADR-0129's literal prefix. Behavioural and presentation metadata (flows, actions, hooks, jobs, permission sets, apps, pages, …) are identified by **(package, name)**. Authors write short names, and **no behavioural name is ever rewritten**.
2. **The storage already holds the package.** The registry keys every non-object item `PACKAGE:NAME`, and `sys_metadata` is unique on `(type, name, package_id, bundle_member)`. What this record changes is the **readers that drop the package before they ask**: runtime indexes, the activation ledger, by-name doors, the AI face and stored references.
3. **One resolution rule** for a bare name: the caller's own package → else the unique holder in its declared dependency closure (ADR-0141) → else a refusal that lists the candidates.
4. **Addresses carry the namespace when they must.** A by-name URL takes an optional namespace segment (`/automation/crm/send_email`). A bare one keeps resolving while the name is unique in the environment, and answers `409` with the candidates when it is not. The AI face spells a derived flat name, `NS-NAME`.
5. **Stored references gain a package column beside the name**, backfilled from the one holder phase 1 guarantees today. The sealed ambiguity set is reported, ⛔ never rewired on a guess.
6. **Positions stay one environment-wide slot per name**, and a second package holder is refused, as today.

---

## Context

### Why the prefix was ruled, and why it is reversed

Ruling C on #30798 (2026-11-06) chose to make every package-authored name carry the namespace literally (`crm_send_email`), because most runtime consumers resolve a non-object name with no package. Phase 1 (#30803) refused a second package holder for the 12 silent types, and phase 2 (#30804) warned on bare names. Phase 3 (#30806) was to refuse them at `defineStack` and rename the stored references.

On 2026-11-08 the maintainer redirected it: 「你不能只考虑现状，还要考虑长远的合理性；我说的流程不是url挂到对象下，而是挂到软件包下」. The literal prefix fixes the clash by asking every author, every AI and every stored row to carry the namespace inside the name. That costs 206 renames in HotCRM alone, plus a rewrite of 17 kinds of stored reference in every live environment (#30806 plan §2). Package addressing fixes it once, in the platform: the package is the namespace, and the reader carries it.

### What the tree already carries (stage-1 inventory, `86e37660`)

| Already package-aware | Where |
|:--|:--|
| Registry keys `PACKAGE:NAME`; `getItem(type, name, currentPackageId)` is prefer-local | objectql `registry.ts` `getItem` (ADR-0048 §3.3) |
| `sys_metadata` unique on `(type, name, package_id, bundle_member)` | metadata-core `sys-metadata.object.ts` indexes |
| `GET /meta/:type/:name` and `client.meta.getItem` accept `?package=` | runtime `domains/meta.ts` (`metaItemPackageBinding`); client `meta.getItem` |
| Jobs schedule as `APPID:jobName` when another package holds the name | runtime `app-artifact-handlers.ts` `jobKeyFor` |

| Drops the package | Key today | Where |
|:--|:--|:--|
| Automation engine flow map | `Map` by name, one armed flow per name | service-automation `engine.ts`, `flow-definitions.ts` |
| Action engine | `objectName:name`; object-less `global:name` | objectql `executeAction` (ADR-0048 §6 runtime key) |
| Activation ledger | unique `(metadata_type, name)`, global | platform-objects `sys-metadata-activation.object.ts` |
| Security catalog | `resolve(type, name)`; list dedupes by name | core `security/security-catalog.ts` |
| Declared webhooks, queues | first match by name | plugin-webhooks `declared-webhooks.ts`; plugin-sharing `ownership-queue-service.ts` |
| Sharing rules | stored rows unique `(name)` per org | plugin-sharing `sys-sharing-rule.object.ts`, `sharing-rule-service.ts` |
| By-name doors | `/automation/:name/*`, `/automation/hooks/:flowName/:hookId`, `/actions/*`, MCP `run_action` / `agent_prompt` / skill `prompts/get`, the SDK's `automation.*` | runtime `route-ledger.ts`; mcp; client |
| References between items | a field's `picklist`, `datasetName`, a send's `template`, `ActionNavItem.actionDef.actionName`, flow nodes, nav items | spec, resolved by each consumer |
| Stored by-name columns | 12 of the #30806 plan's 21 kinds | §[D8](#d8--stored-references-gain-a-package-column-backfilled-from-the-one-holder) |

---

## Decision

### D1 — Four buckets, as ruled

**Principle (ruled).** Storage identity and data contracts keep the global literal prefix. Behavioural and presentation metadata are identified by (package, name). Environment-authored items belong to the implicit environment package and need only be unique within the environment.

| Bucket | Types | Identity | Addressing |
|:--|:--|:--|:--|
| **1 — global literal prefix, unchanged** | `object` (ADR-0129 D2, the table name) · `field` · `object_extension` · `view` (object-derived) · `capability` (`NS.SHORT`, ruling 6683456244) · `doc` (ADR-0046 doc lint) · an api's `path` (globally unique) | the literal name | unchanged |
| **2 — (package, name)** (20 types) | `flow` · `action` (`objectName:name` plus package) · `hook` · `job` (`jobKeyFor` aligned to the package coordinate) · `webhook` · `mapping` · `connector` · `permission` (set) · `sharing_rule` · `queue` · `assignment_rule` · `app` · `page` · `dashboard` · `report` · `dataset` · `analytics_cube` · `picklist` · `email_template` · `book`; an api item's `name` | `(package, name)` | D3 resolution; D5 addresses |
| **3 — (package, name) plus a derived flat name on the AI face** | `tool` · `skill` · `agent` · `rag_pipeline`; the cloud's action tool name (#31515) | `(package, name)` | D3 resolution; D6 face spelling |
| **4 — environment-authored rows** | mostly `datasource`, and every customer-authored item | `(environment, name)`: package null, the implicit environment package | unique in the environment; no rename, no migration |
| **position (ruled separately)** | `position` | one slot per name in the environment | D7 |

**Why objects differ (the card's question).** An object's name is not an address that a resolver can qualify. It is a physical identifier that leaves the platform:

- it is the SQL table name (Postgres 63, MySQL 64 characters), read by drivers, migrations, external BI and raw SQL that the platform never sees;
- it is the data contract, in `/api/v1/data/:object`, in seed `externalId`s, in every field reference across packages, and in record ids shared with integrators;
- two packages' tables live in one schema, so the physical names must be globally unique whatever addressing sits above them.

ADR-0028 D2 proposed deriving physical names from `(namespace, short)` to hide that prefix. The ruling keeps objects literal, because a derived table name is a second spelling that every external reader of the database sees and the authoring layer does not. Behavioural metadata has no such reader: every consumer of a flow, an action or a page is platform code that can carry the package coordinate. So the tier that leaves the platform keeps the name that leaves it, and the tier the platform resolves is resolved by the platform.

### D2 — The package coordinate: identity is the package id, the address is the namespace

- **Identity** is `(package id, type, name)`: the registry's composite key, ADR-0048 §3.1's globally unique package id, and every new stored package column (D8) holds the package id.
- **Address** is `(namespace, name)`: the URL segment (D5), the AI face (D6) and the MCP inputs carry the manifest `namespace`, which an author and an AI already know and which the install gate keeps unique per environment (ADR-0048 §3.2).
- **Co-owners of a namespace keep each behavioural name unique across it.** ADR-0130 and ADR-0141 let several packages share one namespace (HotCRM's five packages all declare `crm`). The address `crm/send_email` must name one item, so within a namespace a `(type, name)` has at most one package holder. This is the object rule of ADR-0130 D3 / ADR-0141 D5, extended to buckets 2 and 3. Measured on HotCRM `6961ab1`: 0 of its 297 behavioural `(type, name)` keys are held by two of its packages, so the rule costs no rename.
- **`sys`** is the reserved kernel package (ADR-0028 TL;DR 5): platform metadata belongs to it, and its address is `sys/NAME`.
- **The environment package** has no namespace. An environment item is addressed by its bare name, which is unique in the environment.

### D3 — One resolution rule for a bare name (buckets 2 and 3, as ruled)

A bare name, read by a caller that belongs to package P, resolves to:

1. **P's own item** of that type and name;
2. else **the unique holder in P's declared dependency closure** (ADR-0141: P's `manifest.dependencies`, transitively, plus `sys`);
3. else a **refusal that lists the candidates**, in the vocabulary `bare-name-one-holder.ts` already defines (`BareNameHolder`, `describeBareNameHolder`).

A caller with no package (an environment item, a context-free door, an MCP client) resolves against the whole environment: the environment item of that name first (ADR-0005 overlay precedence keeps the environment's own item ahead), else the unique package holder, else the refusal with candidates (`409` at a door, D5).

**Exceptions (ruled).**

- **Names the platform requests by spelling** (`PLATFORM_REQUESTED_BARE_NAMES`; today only the permission set `guest_portal`, which the public form doors request): the platform declares no dependency, so they resolve environment-wide and keep ONE holder. Phase 1's refusal stays for them.
- **Positions** are one environment-wide slot (D7).

**References between items need no new key.** A reference written inside package P (a field's `picklist`, a dashboard's `datasetName`, an `ActionNavItem`, a flow's subflow) is a bare name resolved by this rule from P. A reference that would resolve to two holders in P's closure is refused at `defineStack`, `os validate` and the save door, naming the candidates. ⛔ No qualified reference spelling is added to the metadata contract now: HotCRM's measured cross-package ambiguity is zero, and a spelling without pull is declared surface the startup rule refuses. It is added by its own ruling when a named package needs it.

### D4 — The runtime keys carry the package

Every runtime index that keys a bucket 2 or 3 item by bare name gains the package coordinate. Each becomes `(package id, name)`, or `(package id, objectName, name)` for an action bound to an object:

| Index | Today | Becomes |
|:--|:--|:--|
| automation engine flow map | name | `(package, name)`; all same-named flows arm |
| action engine (ADR-0048 §6) | `objectName:name` | `(package, objectName, name)`; object-less `(package, global, name)` |
| activation ledger | unique `(metadata_type, name)` | unique `(metadata_type, package_id, name)` (the column exists; D8) |
| security catalog: permission sets | `resolve(type, name)` | `(package, name)` through D3; positions stay environment-wide (D7) |
| declared webhooks, queues, sharing rules, assignment rules | first match by name | `(package, name)` |
| connector instances, email template loader, picklist, mapping, dataset, the api matcher's name key | first or last registered | `(package, name)` through D3 |
| job adapters | `jobName`, or `APPID:jobName` on collision | always the package coordinate (`jobKeyFor` aligned) |
| registry overlay slot (ADR-0005) | ONE bare slot that shadows every package's item of that name | an overlay binds to the `(package, name)` it customizes, so overlaying one package's item never shadows another's |
| engine function registry | one function per name | resolved in the package of the flow or action that names it (D3); a function is not a metadata type, so it follows its referrer |

Hooks bind by event and object and already carry `packageId`. Only `isArtifactShippedHook` (name-only) gains the package.

### D5 — Addresses: an optional namespace segment, `409` on ambiguity

**The grammar.** A by-name door accepts the qualified form, with the namespace before the name, and keeps the bare form:

| Door | Bare (kept) | Qualified |
|:--|:--|:--|
| automation | `/automation/:name[/runs …]`, `/automation/trigger/:name` | `/automation/:ns/:name[/runs …]`, `/automation/trigger/:ns/:name` |
| inbound hook | `/automation/hooks/:flowName/:hookId` | `/automation/hooks/:ns/:flowName/:hookId` |
| actions | `/actions/:object/:action[/:recordId]`, `/actions/global/:action` | `/actions/:ns/:object/:action[/:recordId]`, `/actions/:ns/global/:action` |
| metadata | `/meta/:type/:name` (`?package=` kept for Studio's write binding) | `/meta/:type/:ns/:name` |
| connectors | `/automation/connectors/:name/connection` | `/automation/connectors/:ns/:name/connection` |

- **How the router tells them apart.** A first segment that names an installed namespace is the namespace (the install gate keeps namespaces unique, ADR-0048 §3.2). Otherwise the bare grammar applies. Object names cannot collide with this, because an object name is `NS_SHORT` and never equals a bare namespace. A flow whose bare name equals an installed namespace is still reachable by its qualified address. This is documented precedence, not a guess, and it adds no refusal.
- **A bare address** resolves while the name has one holder in the environment, and answers **`409`** with the candidate qualified addresses otherwise, in the D3 refusal vocabulary. The status already exists in the ledger (`RESOURCE_CONFLICT`); ⛔ no new code is minted.
- **MCP.** `run_action` gains an optional `namespace` input beside `objectName`. `list_actions` rows carry `namespace`. Skill prompts and agents are named by the D6 face.
- **The client SDK** methods that take a name (`automation.*`, `actions.invoke`, `meta.getItem`) take an optional namespace and build the qualified path.
- **Studio and the Console** (carrier objectui) open an item by `(namespace, name)`. The server door already takes the package.
- ⛔ **No alias window.** Every existing bare address keeps working while unique, which is the common case: there is nothing to alias. A bare address that becomes ambiguous because a second package installed the name answers `409` with both qualified addresses. That is the loud answer, never a silent pick.

### D6 — The AI face spells a derived flat name: `NS-NAME`

MCP requires one unique name per tool and per prompt on a server, and the model providers that consume them admit only letters, digits, `_` and `-` in a tool name (OpenAI caps it at 64 characters; MCP itself also admits `.`, which the providers do not). A bucket-3 item's face name is therefore **derived** from its address, never authored. This is ADR-0028 D2's "derived physical name", applied to the one physical surface this tier has.

**Choice: `NS-NAME`.** For example, `crm-qualify_lead`; an environment item keeps its bare `NAME`. When the result exceeds 64 characters it is cut to 55 and suffixed with `-` and 8 hex characters of a hash of the full identity: deterministic, and the same on every server.

| Option | Business need (measured) | Long-term | Hard for AI to get wrong | Startup scope |
|:--|:--|:--|:--|:--|
| **`NS-NAME` (chosen)** | every MCP client and both providers accept it | reversible: a namespace and a name never contain `-`, so the face parses back to `(namespace, name)` with no lookup table | collision-free by construction; nothing to remember | no new gate, no registry of spellings |
| `NS.NAME` (ADR-0028 D3's proposal) | the providers refuse `.` in a tool name | — | breaks at the first provider call | — |
| `NS_NAME` | accepted everywhere | not reversible: `crm` + `a_b` and `crm_a` + `b` both give `crm_a_b`, so a clash needs a refusal at registration | the clash reappears as a rare registration error | a new gate, which defaults to no |
| `NS__NAME` | accepted everywhere | a name may itself contain `__` (`^[a-z_][a-z0-9_]*$`), so it is ambiguous again | as above | a new gate |

The cloud's action tool (`action_` plus the bare action name, #31515) derives its name from the same function (carrier: cloud).

### D7 — Positions are environment-scoped, and a second holder is refused

Ruled: one org chart per environment; packages contribute positions; the same name is the same slot. Approval routing (`position:NAME`) and sharing recipients carry no package.

**Choice: keep the one-holder refusal** (`security-catalog-namespace.ts`, ADR-0048 addendum 2026-10-08) for positions. A second package that ships a position name another package or the environment already holds is refused at registration, naming both holders.

| Option | Business need (measured) | Long-term | Hard for AI to get wrong | Startup scope |
|:--|:--|:--|:--|:--|
| **Keep the refusal (chosen)** | HotCRM's 12 positions all live in one package. No first-party package contributes to another's slot. | one definition per slot: label, `permissionSets` and `delegatable` have one author | a clash is loud at install | ships today; no new mechanism |
| Merge contributions | no measured pull | needs a merge rule for every field: whose `label`, a union of `permissionSets` or not, `delegatable` true if either?; and what an uninstall removes | a merged slot silently gains another package's grants, the widening ADR-0090 D9 refuses for `everyone` | a new merge engine plus uninstall semantics |

A package that needs its permission sets on another package's position asks the environment to bind them: an ADR-0005 overlay of the position adds the set, by an administrator's decision, exactly as an `isDefault` set is suggested and never auto-bound (ADR-0090 D9). A merge is ruled by its own card when a named package needs it.

`position.permissionSets` names permission sets, which are bucket 2, so each name resolves by D3 from the package that declared the position (an environment position resolves environment-wide).

### D8 — Stored references gain a package column, backfilled from the one holder

This replaces #30806 S3's name rewrite. Nothing is renamed, so nothing is rewritten. Each stored by-name reference to a bucket 2 or 3 item gains a **package column beside the name** (ADR-0126 §4: two facts, two columns, ⛔ never a re-encoded literal).

**The backfill source** is the package that holds `(type, name)` in this environment when the migration runs. Phase 1 makes that holder unique for the 12 silent types and the security catalog's types after the boot seal. A name with no package holder is environment-authored, and its column stays null. A name two packages held before phase 1 is in the seal's warn list (`SchemaRegistry.sealBareNameHolders`). It is the **ambiguous set**: left null, named in the upgrade report, and ⛔ never rewired on a guess.

| # (#30806 plan §2) | Table · column | Gains | Note |
|:--|:--|:--|:--|
| R1 | `sys_user_permission_set.permission_set` | `permission_set_package` | |
| R2 | `sys_user_position.position` | none | positions stay environment-wide (D7) |
| R3 | `sys_audience_binding_suggestion.permission_set_name` | `permission_set_package` | |
| R4 | `sys_metadata_activation` | `package_id` exists; the unique key becomes `(metadata_type, package_id, name)` | rows with a null `package_id` take the holder |
| R5 | `sys_sharing_rule` rows | `package_id` (managed rows); admin rows stay null | position recipients stay bare (D7) |
| R6 | `sys_queue_member.queue` | `queue_package` | position recipients stay bare |
| R7 | `sys_approval_request.process_name` (`flow:NAME`) | `process_package` | open requests only; `sys_approval_approver.approver` (`position:NAME`) stays (D7) |
| R8 | `sys_automation_run.flow_name` | `flow_package` | paused runs resume by it |
| R9 | `sys_flow_credential.flow_name` | `flow_package` | the hook and signing secrets |
| R10 | `sys_flow_dispatch.id` | the key gains the package segment | keys inside retention |
| R11 | `sys_connector_connection.connector_name` | `connector_package` | per-organization OAuth connections |
| R13 | `sys_assignment_cursor.rule` | `rule_package` | |
| R14 | `sys_job.name` | follows the aligned `jobKeyFor` key | the run history stays as written |
| R15, R16 | `sys_metadata` overlays and `.custom` pairs | already carry the package | the overlay slot binds per package (D4) |
| R17 | `sys_metadata` bodies that name another item | nothing stored | resolved by D3; an ambiguous one is reported |
| R20 | `sys_email_template` overlays | `package_id` | |
| R12, R18, R19, R21 | informational, prose and code, history, `NS.SHORT` scopes | none | |

### D9 — What retires, and what stays

- **Retires per type, in the slice that makes that type's readers carry the package:** phase 1's one-holder refusal (`BARE_NAME_ONE_HOLDER_TYPES`). Until a type's slice lands the refusal stays, as the card's decision 6 requires.
- **Retires now with this record:** #30806 phase 3 (S1 spec refusal, S5 HotCRM renames); phase 2's `naming/namespace-prefix` bare-name warning for buckets 2–4 (the intra-package duplicate warning stays); the authoring skills' and templates' instruction to prefix non-object names (#30805's text); ADR-0146 D3's prefix on a Studio-authored non-object name (the `.custom` pair's items are short names in their own package; its objects keep the prefix).
- **Stays:** ADR-0129 and the object rule, unchanged; the one-holder rule for platform-requested bare names (D3) and for positions (D7); the capability's `NS.SHORT` spelling (bucket 1); the ADR-0048 §3.2 namespace install gate.
- **Names already prefixed stay as they are.** The examples renamed in phase 2 (#30927) and HotCRM's already prefixed names (email templates) are just names, and ⛔ nothing un-renames them.

### D10 — Upgrade: what an already-deployed app sees

- **No rename, no alias window, no author action.** Every authored name keeps working. Every bare address keeps resolving while it has one holder, which phase 1 guarantees today.
- **The release that carries the D8 migration** adds the package columns and backfills them. It reports the ambiguous set: each stored reference left null, with its candidates, and the operator command that binds one after review.
- **A second package installed later** that takes an existing name does not change what any stored reference, overlay, run or URL of the first one means. That is the guarantee this whole record buys. Bare doors answer `409` from then on, naming both qualified addresses.
- **Customer-authored metadata** (bucket 4) is untouched.

---

## Execution plan (after acceptance)

Each slice is its own card, cut after this record merges. **Clause-②** says whether the slice changes a published contract (spec, protocol, the SDK, a door's request or response). **Narrowing** says whether something accepted before is refused after. A runtime-index slice ships its readers, its doors and its stored columns together where they cannot be separated without a window in which a reader and a writer disagree.

| # | Slice | Scope | Clause-② | Narrowing |
|:--|:--|:--|:--|:--|
| 1 | **Spec: the coordinate** | the face-name derivation (D6), the address grammar helpers (D5), `namespace` on MCP / `list_actions` shapes; retire the phase-2 bare-name lint finding and the skills and templates text (D9); stop ADR-0146 D3's non-object prefix | yes | no |
| 2 | **Resolver and closure** | one `(package, name)` resolver with ADR-0141's dependency closure (the save door's `resolveWritePackageScope` is the nearest existing closure), the D3 refusal reusing `bare-name-one-holder.ts`'s vocabulary, and the per-package overlay slot (D4) | no | yes: a reference ambiguous in its closure is refused |
| 3 | **Namespace co-owner uniqueness** | a behavioural `(type, name)` held twice inside one namespace is refused at install and `os validate` (D2), on the ADR-0130 D3 object check | no | yes (measured first-party: 0) |
| 4 | **Flows** | engine map, the activation consult, `/automation` qualified doors and `409`, SDK `automation.*`, R7 / R8 / R9 / R10; retire `flow`'s phase-1 refusal | yes (doors) | no |
| 5 | **Actions** | engine key `(package, objectName, name)`, `/actions` doors, MCP `run_action` / `list_actions`, `ActionNavItem` resolution, the activation write door; retire the object-less `action` refusal | yes | no |
| 6 | **Activation ledger** | unique `(metadata_type, package_id, name)` with backfill (R4), for flows, actions, webhooks and sharing rules | no | no |
| 7 | **Security: permission sets** | the catalog's `(package, name)`, R1 and R3, and `position.permissionSets` resolution; positions keep D7 | no | no |
| 8 | **Sharing, queues, assignment rules** | the indexes and R5, R6 and R13 | no | no |
| 9 | **Flow-family services** | webhooks, connectors (R11), email templates (R20); retire their phase-1 refusals | no | no |
| 10 | **Data family and api name** | picklist, mapping, dataset, the api matcher's name key, engine functions by referrer; retire their phase-1 refusals | no | no |
| 11 | **Jobs** | `jobKeyFor` always on the package coordinate; R14 | no | no |
| 12 | **Presentation** | app, page, dashboard, report, book, analytics cube: close the context-free reads; `/meta/:type/:ns/:name` | yes | no |
| 13 | **AI face** | tool, skill, agent, rag_pipeline named `NS-NAME` on MCP; `agent_prompt` on the protocol read (#31514); retire `agent` and `skill` refusals | yes | no |
| 14 | **Upgrade report and operator command** | the ambiguous-set report and the reviewed bind command (D10) | no | no |
| 15 | **ADR status lines** | ADR-0048's 2026-11-06 addendum, ADR-0146 D3 and ADR-0129's cross-reference, as the slices land | no | no |
| — | **cloud** | the action tool name on the D6 face (#31515) | carrier: cloud | |
| — | **objectui** | Studio and Console open items by `(namespace, name)` | carrier: objectui | |

That is 15 objectstack PRs plus one each in cloud and objectui, 17 in all. Slices 4 and 5 are the largest and may split into an index PR and a doors PR, which gives 19. Slices 4–13 depend on 2. Slice 6 lands before 4's activation consult and 5's write door. Slice 14 ships in the release that carries 6–11.

---

## Consequences

- **Good.** Two packages can ship `send_email` side by side, and every caller reaches the one it means. No author, no AI and no stored row carries the namespace inside a behavioural name. The literal prefix is left only where a name leaves the platform (objects). Live environments migrate by adding columns, not by rewriting names.
- **Cost.** Every runtime index and by-name door of 20 behavioural types gains a coordinate, which is the plan above. The router gains a documented precedence for a first segment that names a namespace. Co-owners of a namespace keep behavioural names unique across it.
- **Risk.** A reader that is missed keeps resolving first-registered. Each slice therefore retires its type's phase-1 refusal only once its readers are measured on a booted two-package deployment, as phase 1 measured them.

## Alternatives considered

- **Finish phase 3 (literal prefix on every name).** Rejected by the 13:12:35Z ruling: 206 renames in HotCRM, 17 kinds of stored rewrite per environment, and a prefix every AI must remember.
- **Derive physical table names for objects too (ADR-0028 D2 in full).** Rejected by the per-type ruling: the table name is read by consumers the platform does not control (D1).
- **A qualified reference spelling inside metadata now (`NS:NAME`).** Deferred: no measured cross-package ambiguity (D3).
- **Package id, not namespace, in addresses.** Rejected: `com.objectstack.hotcrm.revenue` in every URL and tool name is unreadable to authors and AI, and the namespace already identifies the item once co-owners keep names unique (D2).
