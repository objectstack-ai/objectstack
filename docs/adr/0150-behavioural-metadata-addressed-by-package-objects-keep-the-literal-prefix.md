# ADR-0150: Behavioural metadata is addressed by (package, name) — objects keep the literal prefix; ADR-0028 re-opened for the behavioural tier

**Status**: Proposed (2026-11-08). `docs/adr/` is Tier H (Prime Directive #14): this record becomes **Accepted** by the maintainer's merge. The child cards under [Execution plan](#execution-plan-after-acceptance) are filed under the epic ruling [`6723499113`](https://github.com/objectstack-ai/objectstack/issues/31527#issuecomment-6723499113) (child R is #31575); ⛔ no child lands before this record is accepted. **This record declares; it implements nothing**: no schema, no code, no changeset. · **Supersedes in part** [ADR-0028](./0028-metadata-naming-and-namespace-isolation.md) (D1 and D3, for the metadata types of buckets 2–4 below; ADR-0028 stays Deferred for objects and everything else) · **Amends** [ADR-0048](./0048-cross-package-metadata-collision.md) §3.3 and its 2026-11-06 addendum (the one-holder refusal retires per type as that type's readers carry the package, [D9](#d9--what-retires-and-what-stays)) · **Withdraws** the non-object half of ruling C on #30798: phase 3 (#30806 S1 and S5) does not ship.

- **Date**: 2026-11-08
- **Supersedes**: [ADR-0028](./0028-metadata-naming-and-namespace-isolation.md) in part (D1 and D3, for buckets 2–4)
- **Card**: [#31527](https://github.com/objectstack-ai/objectstack/issues/31527), replacing [#30806](https://github.com/objectstack-ai/objectstack/issues/30806) phase 3 for the behavioural tier.
- **Decided by**: the maintainer, 2026-11-08, three rulings, verbatim and untranslated. This record executes them as written; ⛔ none is re-opened here.
  - The direction, decision card tapped **A 「转向包寻址」** at 13:12:35Z (seat record [`6721941146`](https://github.com/objectstack-ai/objectstack/issues/30806#issuecomment-6721941146) on #30806), after his message 「你不能只考虑现状，还要考虑长远的合理性；我说的流程不是url挂到对象下，而是挂到软件包下」.
  - The scope, 13:13:39Z: 「流程等行为元数据按软件包寻址，立决策卡，现在就所有的元数据类型然后和我沟通。」
  - The per-type table, decision card tapped **A 「按修正后分档写入」** at 15:36:01Z (seat record [`6723462584`](https://github.com/objectstack-ai/objectstack/issues/31527#issuecomment-6723462584) on #31527). [D1](#d1--four-buckets-as-ruled) restates it; where the two differ in words, the ruling binds.
  - The ruled table names `rag_pipeline` in bucket 3 because the stage-1 inventory listed it, and that inventory was stale on this point. The type was retired on `main` by #31456 (`39aa3f64`, migration `meta-type-rag-pipeline-retired`), before the inventory's commit `86e37660`. This record marks it retired wherever the ruling's table carries it, and no child touches it. Nothing else in the ruling moves.
- **Left open by the per-type ruling, put to the maintainer by this record, and since ruled**: the bucket-3 flat spelling on the AI face (Q1, D6) and how two packages' same-named positions are handled (Q2, D7). Decision card tapped **option 0 「A+A，含对象动作补充」** at 16:30:25Z (seat record [`6724050556`](https://github.com/objectstack-ai/objectstack/issues/31527#issuecomment-6724050556) on #31527): Q1 = A with the object-action refinement, Q2 = A. D6 and D7 record both as decided. The one question the refined spelling raised, Q3, was ruled A 「安装时拒绝」 at 17:13:30Z (seat record [`6724530715`](https://github.com/objectstack-ai/objectstack/issues/31527#issuecomment-6724530715) on #31527); see [Questions put to the maintainer](#questions-put-to-the-maintainer-all-ruled). D2 was accepted at 17:17:11Z (seat record [`6724570466`](https://github.com/objectstack-ai/objectstack/issues/31527#issuecomment-6724570466)).
- **Division of labour** (ruling A 「留核心，其余交车道」, record [`6723571682`](https://github.com/objectstack-ai/objectstack/issues/31527#issuecomment-6723571682)) and the red lines every child carries (the #31527 body) shape the [Execution plan](#execution-plan-after-acceptance).
- **Builds on**: [ADR-0005](./0005-metadata-customization-overlay.md) (overlays), [ADR-0019](./0019-app-as-consumer-unit.md) (the namespace-named app), [ADR-0048](./0048-cross-package-metadata-collision.md) §3.1–§3.3 (package id is identity; prefer-local resolution), [ADR-0126](./0126-packaged-metadata-customization-model.md) §4 (the activation ledger; no re-encoded literal in a column), [ADR-0129](./0129-object-name-is-the-canonical-id.md) (the object name is the table name), [ADR-0130](./0130-release-artifact-as-co-ownership-boundary.md) and [ADR-0141](./0141-inter-app-dependency-declared-checked-before-install.md) (namespace co-ownership; the declared dependency closure), [ADR-0146](./0146-studio-designs-setup-administers-one-editor-per-item-paired-customize-package.md) (the paired `.custom` package).
- **Inputs**: the #30806 plan ([`6719833098`](https://github.com/objectstack-ai/objectstack/issues/30806#issuecomment-6719833098)), the seat records `6721537981` and `6721596287`, and the #31527 stage-1 inventory, measured read-only on `main` at `86e37660`. Measurements below cite it.

---

## TL;DR

1. **Two tiers, two mechanisms.** Names that are storage identity or a shared data contract (objects, fields, object extensions, views, capabilities, docs, API paths) keep ADR-0129's literal prefix. Behavioural and presentation metadata (flows, actions, hooks, jobs, permission sets, apps, pages, …) are identified by **(package, name)**. Authors write short names, and **no behavioural name is ever rewritten**.
2. **The storage already holds the package.** The registry keys every non-object item `PACKAGE:NAME`, and `sys_metadata` is unique on `(type, name, package_id, bundle_member)`. What this record changes is the **readers that drop the package before they ask**: runtime indexes, the activation ledger, by-name doors, the AI face and stored references.
3. **One resolution rule** for a bare name: the caller's own package → else the unique holder in its declared dependency closure (ADR-0141) → else a refusal that lists the candidates.
4. **Addresses carry the namespace when they must.** A by-name URL takes an optional namespace segment (`/automation/crm/send_email`). A bare one keeps resolving while the name is unique in the environment, and answers `409` with the candidates when it is not. The AI face spells a flat name derived from the address (ruled): `NS-NAME`, and `OBJECT-ACTION` for an action bound to an object.
5. **Stored references gain a package column beside the name**, backfilled from the one holder phase 1 guarantees today. The sealed ambiguity set is reported, ⛔ never rewired on a guess.
6. **Positions stay one environment-wide slot per name** (ruled), and a second package holder is refused, as today (ruled). An administrator binds another package's set through an overlay; there is no merge engine.
7. **The refusals this record adds.** Each is a declared narrowing. Every one that can be measured counts 0 first-party.
   - **Ruled by the maintainer:**
     - **Child N** (D2, ruled 17:17Z): a `(type, name)` held twice inside one namespace.
     - **Child K** (Q3, ruled 17:13Z): a namespace equal to an object name, in both directions, at every object door.
   - **Added by this record beyond the rulings, accepted by the maintainer's merge:**
     - **The address grammar's namespace-position literals** (`trigger`, `hooks`, `connectors`, `actions`, `global`, …) are refused as a namespace at install. They live in a `spec/kernel` constant that `route-ledger.ts`'s test pins (D5).
     - **A package caller's bare reference whose only holder is an environment-authored item** is refused (`outside-closure`), where today the bare slot serves it (D3 (a)). It cannot be measured on a package tree; the D10 upgrade report names each one.
     - **A name of a bucket 2/3 type that starts with `_`** is refused, because `_`-led segments are the router's (D5). The narrower alternative is recorded under Alternatives.

   Measured first-party, none of them refuses anything.

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
| **3 — (package, name) plus a derived flat name on the AI face** | `tool` · `skill` · `agent` · `rag_pipeline` (retired (#31456) before the ruled table was measured; no child touches it); the cloud's action tool name (#31515) | `(package, name)` | D3 resolution; D6 face spelling |
| **4 — environment-authored rows** | mostly `datasource`, and every customer-authored item whose name no package holds for that type (a package-less row bearing a package-held name is that holder's customization, D4) | `(environment, name)`: package null, the implicit environment package | unique in the environment; no rename, no migration |
| **position (ruled separately)** | `position` | one slot per name in the environment | D7 |

**Why objects differ (the card's question).** An object's name is not an address that a resolver can qualify. It is a physical identifier that leaves the platform:

- it is the SQL table name (Postgres 63, MySQL 64 characters), read by drivers, migrations, external BI and raw SQL that the platform never sees;
- it is the data contract, in `/api/v1/data/:object`, in seed `externalId`s, in every field reference across packages, and in record ids shared with integrators;
- two packages' tables live in one schema, so the physical names must be globally unique whatever addressing sits above them.

ADR-0028 D2 proposed deriving physical names from `(namespace, short)` to hide that prefix. The ruling keeps objects literal, because a derived table name is a second spelling that every external reader of the database sees and the authoring layer does not. Behavioural metadata has no such reader: every consumer of a flow, an action or a page is platform code that can carry the package coordinate. So the tier that leaves the platform keeps the name that leaves it, and the tier the platform resolves is resolved by the platform.

### D2 — The package coordinate: identity is the package id, the address is the namespace

- **Identity** is `(package id, type, name)`: the registry's composite key, ADR-0048 §3.1's globally unique package id, and every new stored package column (D8) holds the package id.
- **Address** is `(namespace, name)`: the URL segment (D5), the AI face (D6) and the MCP inputs carry the manifest `namespace`, which an author and an AI already know and which the install gate keeps unique per environment (ADR-0048 §3.2).
- **Co-owners of a namespace keep each behavioural name unique across it** (child N; ruled: the maintainer accepted D2 「同意」 at 17:17:11Z, seat record [`6724570466`](https://github.com/objectstack-ai/objectstack/issues/31527#issuecomment-6724570466) on #31527, with `?package=` kept as the exact qualifier). ADR-0130 and ADR-0141 let several packages share one namespace (HotCRM's five packages all declare `crm`). The address `crm/send_email` must name one item, so within a namespace a `(type, name)` has at most one package holder. This is the object rule of ADR-0130 D3 / ADR-0141 D5, extended to buckets 2 and 3. Measured on HotCRM `6961ab1`: 0 of its 297 behavioural `(type, name)` keys are held by two of its packages, so the rule costs no rename.
- **`sys`** is the reserved kernel package (ADR-0028 TL;DR 5): platform metadata belongs to it, and its address is `sys/NAME`.
- **The environment package** has no namespace. An environment item is addressed by its bare name, which is unique in the environment, or under the reserved segment `_env` where a bare name would read as a namespace (D5).

### D3 — One resolution rule for a bare name (buckets 2 and 3, as ruled)

A bare name, read by a caller that belongs to package P, resolves to:

1. **P's own item** of that type and name;
2. else **the unique holder in P's declared dependency closure** (ADR-0141: P's `manifest.dependencies`, transitively, plus `sys`, which the resolver adds itself: `resolvePackageClosure` in `packages/lint/src/runtime-gate.ts` does not, and ADR-0141 admits platform objects by a separate clause);
3. else a **refusal that lists the candidates**, in the vocabulary `bare-name-one-holder.ts` already defines (`BareNameHolder`, `describeBareNameHolder`).

A caller with no package (an environment item, a context-free door, an MCP client) resolves against the whole environment: the environment item of that name first (ADR-0005 overlay precedence keeps the environment's own item ahead), else the unique package holder, else the refusal with candidates (`409` at a door, D5).

**Two consequences of the rule, as R (#31637) implements it.**

- **(a) A package caller never resolves to an environment-authored item by bare name.** A package cannot declare a dependency on the environment, so an environment item is in no package's closure. A name that only an environment item holds is refused for a package caller (`outside-closure`), and the refusal names the environment as the holder. **This is a declared narrowing**, added by this record within the letter of the ruled rule. Today `getItem` serves the bare slot first to every caller (D4's overlay row), so a package flow's `template: welcome` filled by an environment-authored template is served today and refused once its reader is wired. It is carried by the E rows that wire a package caller (E1–E6, E8) and by G1 and U wherever a `?package=` or Studio's held package id is read as the caller. It cannot be measured on a package tree (HotCRM holds no environment), so the D10 upgrade report names each such reference as the migration finds it.
- **(b) An overridable platform baseline ranks below a package holder.** These are the items of phase 1's `OVERRIDABLE_BASELINE_PACKAGES`; today that is the email service's built-in templates (ADR-0131 D6/D10). They rank below a package holder in step 2 and in the context-free environment step. A baseline item answers only when no package holds the name among that step's candidates, as the template loader serves it today. In step 2 the candidates are P's closure, so a baseline outside it is refused in step 3, never answered by an environment-wide fallback.

**Exceptions (ruled).**

- **Names the platform requests by spelling** (`PLATFORM_REQUESTED_BARE_NAMES`; today only the permission set `guest_portal`, which the public form doors request): the platform declares no dependency, so they resolve environment-wide and keep ONE holder. Phase 1's refusal stays for them.
- **Positions** are one environment-wide slot (D7).

**References between items need no new key.** A reference written inside package P (a field's `picklist`, a dashboard's `datasetName`, an `ActionNavItem`, a flow's subflow) is a bare name resolved by this rule from P. A reference that would resolve to two holders in P's closure is refused at `defineStack`, `os validate` and the save door, naming the candidates. ⛔ No qualified reference spelling is added to the metadata contract now: HotCRM's measured cross-package ambiguity is zero, and a spelling without pull is declared surface the startup rule refuses. It is added by its own ruling when a named package needs it.

**A reference written in an environment-authored overlay (ADR-0005) is the environment's reference.** It resolves as a caller with no package: the environment item first, else the unique package holder, else the refusal with candidates. It never resolves from the package the overlay customizes. That keeps the ruled Q2 mechanism working (D7: an administrator's overlay of P's position adds a set of another package Q, or an environment-authored set), and today's admin customizations too, such as an overlay of a package field's `picklist`. It loosens nothing, because the answer is one holder or a refusal, and it guesses nothing.

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
| job adapters | `jobName`, or `APPID:jobName` on collision | the schedule key is always the package coordinate (`jobKeyFor` aligned); the bare key stays readable for the one holder that has it today (E7) |
| registry overlay slot (ADR-0005) | ONE bare slot that shadows every package's item of that name | an overlay binds to the `(package, name)` it customizes, so overlaying one package's item never shadows another's |
| engine function registry | one function per name | resolved in the package of the flow or action that names it (D3); a function is not a metadata type, so it follows its referrer |

Hooks bind by event and object and already carry `packageId`. Only `isArtifactShippedHook` (name-only) gains the package.

**A package-less row that bears a package-held name is a customization, never a second item.** A `sys_metadata` row with `package_id` NULL hydrates into the bare slot today (`registerItem`). Where a package holds that `(type, name)`, the row is the ADR-0005 overlay of that one phase-1 holder (`bare-name-one-holder.ts` already counts it as no holder). It is not a bucket-4 item, so it never arms beside the item it shadows (E1) and never makes the name ambiguous. Its migration into a declared override in the holder's paired `.custom` package is [ADR-0146](./0146-studio-designs-setup-administers-one-editor-per-item-paired-customize-package.md) D11's, and this record does not repeat it (R15). A bucket-4 item is therefore one whose `(type, name)` no package holds. If a package installed later takes such a name, the row reads as that holder's overlay, which is what the bare slot does today. The D10 upgrade report names the row.

### D5 — Addresses: an optional namespace segment, `409` on ambiguity

**The grammar.** A by-name door accepts the qualified form, with the namespace before the name, and keeps the bare form:

| Door | Bare (kept) | Qualified |
|:--|:--|:--|
| automation | `/automation/:name[/runs …]`, `/automation/trigger/:name` | `/automation/:ns/:name[/runs …]`, `/automation/trigger/:ns/:name` |
| inbound hook | `/automation/hooks/:flowName/:hookId` | `/automation/hooks/:ns/:flowName/:hookId` |
| actions | `/actions/:object/:action[/:recordId]`, `/actions/global/:action` | `/actions/:ns/:object/:action[/:recordId]`, `/actions/:ns/global/:action` |
| metadata | `/meta/:type/:name` (`?package=` kept for Studio's write binding) | `/meta/:type/:ns/:name` |
| connectors | `/automation/connectors/:name/connection` | `/automation/connectors/:ns/:name/connection` |

- **How the router tells them apart**, in this order:
  1. **The grammar's literal segments win.** These are the letter-led literals in a namespace position, such as `trigger`, `hooks`, `connectors`, `actions` (`/automation/…`) and `global` (`/actions/…`), and the `_`-led ones, such as `_status`, `_activation` and `_drafts`. Each is read as the literal before any namespace. The namespace-position set is a `spec/kernel` constant, built with P's address-grammar helpers. `route-ledger.conformance.test.ts` pins it against the `ROUTE_LEDGER` rows (the rows `check:route-ledger-census` already guards), so it never drifts from the routes the ledger declares. The objectql install gate reads it from spec, because objectql cannot depend on the runtime.
     - A `_`-led literal can never be a namespace (`^[a-z][a-z0-9_]{1,19}$`). It can be an item name, though. Tool, skill, agent, flow, hook, connector, sharing rule, job, analytics cube and api endpoint names admit a leading `_` (`^[a-z_][a-z0-9_]*$`); the rest of buckets 2–3 use `SnakeCaseIdentifierSchema` and refuse it already. So a name of a bucket 2/3 type that starts with `_` is refused at `defineStack`, `os validate` and the save door, naming the reserved prefix (child P). The grammar binds every row of those types, bucket 4 included. That is a declared narrowing, added by this record beyond the rulings, and the first-party count is 0 (the only `_`-led hits are `_selectedIds`, a flow variable, and two test fixtures).
     - A letter-led literal can be a namespace today: nothing in `installPackage` compares a namespace to anything but other namespaces (the `NamespaceConflictError` branch, objectql `registry.ts`). `RESERVED_NAMESPACES` is the opposite kind of set: it holds the shareable namespaces, which the gate never fires on. So the install gate gains the refused-literal set (the spec constant above) and refuses a namespace that spells one, naming it. That is a narrowing (child G1), added by this record beyond the rulings, and no first-party manifest declares any of those namespaces.
  2. **A first segment that names an installed namespace is the namespace.** The install gate keeps namespaces unique (ADR-0048 §3.2).
  3. **Otherwise the bare grammar applies.**
- **A package item whose bare name equals an installed namespace** is still reachable by its qualified address.
- **An environment item has no namespace, so it gets the reserved segment `_env`**: `/automation/_env/:name`, `/actions/_env/:object/:action`, and so on. A `_`-led segment can never be a namespace, and no item name either (step 1). So an environment flow named like an installed namespace, including one installed after the flow was saved, keeps every sub-resource door (`runs`, `trigger`, `toggle`, `clone`) through `_env`, and nothing is refused.
- **An object name can equal a namespace.** The namespace grammar admits `_`, so the object `crm_lead` of namespace `crm` and a package namespaced `crm_lead` can both be installed. Then `/actions/crm_lead/convert_lead/REC1` reads as qualified (namespace `crm_lead`, object `convert_lead`) under step 2. This is the same ambiguity as D6's face check, and Q3's ruled refusal (child K) closes it.
- This is documented precedence, not a guess.
- **A bare address** resolves while the name has one holder in the environment, and answers **`409`** with the candidate qualified addresses otherwise, in the D3 refusal vocabulary. The status already exists in the ledger (`RESOURCE_CONFLICT`); ⛔ no new code is minted.
- **MCP.** `run_action` gains an optional `namespace` input beside `objectName`. `list_actions` rows carry `namespace`. Skill prompts and agents are named by the D6 face.
- **The client SDK** methods that take a name (`automation.*`, `actions.invoke`, `meta.getItem`) take an optional namespace and build the qualified path.
- **Studio and the Console** (`ui/`, in this repository) pass the package they already hold. `ui/packages/app-shell`'s `MetadataService` `meta.getItem(type, name, opts)` accepts `{ packageId }` today, and `StudioDesignSurface`, `ObjectFormDesigner` and `StudioCustomizeControls` hold the current package id. About ten page, view, dashboard and app reads go without it; object reads need none.
- ⛔ **No alias window.** Every existing bare address keeps working while unique, which is the common case: there is nothing to alias. A bare address that becomes ambiguous because a second package installed the name answers `409` with both qualified addresses. That is the loud answer, never a silent pick.

### D6 — The AI face spells a derived flat name (ruled: Q1 = A, with object-bound actions)

MCP requires one unique name per tool and per prompt on a server, and the model providers that consume them admit only letters, digits, `_` and `-` in a tool name (OpenAI caps it at 64 characters; MCP itself also admits `.`, which the providers do not). A bucket-3 item's face name is therefore **derived** from its address, never authored. This is ADR-0028 D2's "derived physical name", applied to the one physical surface this tier has.

**Ruled** (Q1 = A with the object-action refinement, 16:30:25Z, record [`6724050556`](https://github.com/objectstack-ai/objectstack/issues/31527#issuecomment-6724050556) on #31527):

- **`NS-NAME`** for a tool, a skill, an agent and an object-less action (`rag_pipeline`, which the ruling also names, was retired (#31456) before the ruled table was measured; no child touches it). For example, `crm-qualify_lead`. An environment item keeps its bare `NAME`.
- **`OBJECT-ACTION`** for an action bound to an object. For example, `crm_lead-convert_lead`. One package may bind the same action name to several objects (the #5510 dedup reading), so `NS-NAME` would not name one action; the object name already carries the global prefix (ADR-0129), so the namespace is not repeated.
- **Past 64 characters**, the result is cut to 55, then `-` and 8 hex characters of a hash of the full identity are appended: deterministic, and the same on every server.
- **The cloud's action tool** (#31515; today `action_` plus the bare action name) derives its name from the same function (carrier: cloud).

The four-axis reading the maintainer ruled on, kept as the record of why:

| Option | Business need (measured) | Long-term | Hard for AI to get wrong | Startup scope |
|:--|:--|:--|:--|:--|
| **`NS-NAME` (ruled)** | every MCP client and both providers accept it | reversible: a namespace and a name never contain `-`, so the face parses back to its two parts with no lookup table, except the hashed long form, which the registry resolves (see the check below for the object-bound form) | nothing to remember | no new gate, no registry of spellings |
| `NS.NAME` (ADR-0028 D3's proposal) | the providers refuse `.` in a tool name | — | breaks at the first provider call | — |
| `NS_NAME` | accepted everywhere | not reversible: `crm` + `a_b` and `crm_a` + `b` both give `crm_a_b`, so a clash needs a refusal at registration | the clash reappears as a rare registration error | a new gate, which defaults to no |
| `NS__NAME` | accepted everywhere | a name may itself contain `__` (`^[a-z_][a-z0-9_]*$`), so it is ambiguous again | as above | a new gate |

**Collision and reversibility check of the two ruled forms** (measured on this tree):

- **Each form on its own is collision-free and splits at its only `-`.** No grammar admits `-`: a namespace is `^[a-z][a-z0-9_]{1,19}$` (`kernel/namespace-prefix.ts`), an object name `^[a-z_][a-z0-9_]*$` (`data/object.zod.ts`), an action name `SnakeCaseIdentifierSchema` (`^[a-z][a-z0-9_]*$`, `ui/action.zod.ts`), and a tool, skill, agent or flow name `^[a-z_][a-z0-9_]*$` (`ai/tool.zod.ts`, `ai/skill.zod.ts`, `ai/agent.zod.ts`, `automation/flow.zod.ts`).
- **The two forms can produce the same string.** The left part is a namespace in one form and an object name in the other, and the namespace grammar admits `_`, so an object name is also a valid namespace. A package with namespace `crm_lead` and an object-less action `convert_lead` spells `crm_lead-convert_lead`. So does the action `convert_lead` on the object `crm_lead` of the package with namespace `crm`. The install gate compares namespaces for equality only (`NamespaceConflictError`, objectql `registry.ts`), so nothing refuses that pair today. The shape is ordinary: the paired `.custom` package's namespace is `NS_custom` (the tree's fixtures spell `crm_custom`). Measured: HotCRM `6961ab1`'s five modules all declare `crm`, and no object is named `crm`, so the collision count is 0. (`probe` is a namespace only in two test fixtures.)
- **Reading a face back is therefore not grammar-only.** `L-R` splits unambiguously, but whether `L` is a namespace or an object needs the environment's catalog. That is a lookup the server already holds. A hashed face needs the server's derivation in any case.
- **The 64-character boundary.** A face of exactly 64 characters is not cut, and it can have the cut form's shape: an object name of 55 characters, `-`, and an 8-letter action name made only of `a`–`f`.

- **One list, several types.** A carrier that lists several types' faces together can collide across them. For example, the cloud lists its action tools as `action_` plus the face beside tool faces, and a tool of a namespace `action_crm` named `x` spells `action_crm-x`, the same as the cloud tool for `crm`'s object-less action `x`.

**Ruled** (Q3 = A 「安装时拒绝」, 17:13:30Z, record [`6724530715`](https://github.com/objectstack-ai/objectstack/issues/31527#issuecomment-6724530715) on #31527):

- **A namespace never equals an object name.** This is refused in both directions, at every object door (`defineStack`, `os validate`, install, Studio publish), naming both spellings (child K). So no package ships an object whose short name is `custom`, because the ADR-0146 pair's namespace is `NS_custom`.
- **A face is cut only past 64 characters**, as Q1 ruled.
- **The face list refuses a duplicate face** at registration, naming both items (G2, and C for the cloud's list). This covers the 64-character boundary, an `action_*` namespace against the cloud's `action_` prefix, and a hash collision.

With these, `L-R` names one item per environment, and the server's catalog reads it back.

### D7 — Positions are environment-scoped (ruled: Q2 = A, the one-holder refusal stays)

Ruled: one org chart per environment; packages contribute positions; the same name is the same slot. Approval routing (`position:NAME`) and sharing recipients carry no package.

**Ruled** (Q2 = A, 16:30:25Z, record [`6724050556`](https://github.com/objectstack-ai/objectstack/issues/31527#issuecomment-6724050556) on #31527): **positions keep the one-holder refusal** (`security-catalog-namespace.ts`, ADR-0048 addendum 2026-10-08). A second package that ships a position name another package or the environment already holds is refused at registration, naming both holders. There is no merge engine.

| Option | Business need (measured) | Long-term | Hard for AI to get wrong | Startup scope |
|:--|:--|:--|:--|:--|
| **Keep the refusal (ruled)** | HotCRM's 12 positions all live in one package. No first-party package contributes to another's slot. | one definition per slot: label, `permissionSets` and `delegatable` have one author | a clash is loud at install | ships today; no new mechanism |
| Merge contributions | no measured pull | needs a merge rule for every field: whose `label`, a union of `permissionSets` or not, `delegatable` true if either?; and what an uninstall removes | a merged slot silently gains another package's grants, the widening ADR-0090 D9 refuses for `everyone` | a new merge engine plus uninstall semantics |

A package that needs its permission sets on another package's position asks the environment to bind them (ruled): an ADR-0005 overlay of the position adds the set, by an administrator's decision, exactly as an `isDefault` set is suggested and never auto-bound (ADR-0090 D9).

`position.permissionSets` names permission sets, which are bucket 2, so each name resolves by D3 from the package that declared the position (an environment position resolves environment-wide). A set that an administrator's overlay adds is the environment's reference (D3): it resolves as a caller with no package, never from the package the overlay customizes. So binding package Q's set, or an environment-authored set, to package P's position works as ruled.

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
| R15 | package-less `sys_metadata` overlay rows over a package-held name | `package_id` bound to the one phase-1 holder by ADR-0146 D11's migration (a declared override in that holder's `.custom` pair); two holders → the ambiguous set, reported | D4: a customization, never a bucket-4 item |
| R16 | `.custom` pair overrides | already carry the package | the overlay slot binds per package (D4) |
| R17 | `sys_metadata` bodies that name another item | nothing stored | resolved by D3; an ambiguous one is reported |
| R20 | `sys_email_template` overlays | `package_id` | |
| R12, R18, R19, R21 | informational, prose and code, history, `NS.SHORT` scopes | none | |

### D9 — What retires, and what stays

- **Narrows per type, in that type's own trailing child, last:** phase 1's one-holder refusal (`BARE_NAME_ONE_HOLDER_TYPES`). It narrows from one package holder per environment to one holder per namespace (D2), only after that type's indexes, doors and stored references all carry the package. Until then it stays in force, so every intermediate `main` behaves as today plus optional package coordinates (the card's decision 6 and red line 3).
- **Withdrawn with this record:** #30806 phase 3 (S1 spec refusal, S5 HotCRM renames). **Retired by child P:** phase 2's `naming/namespace-prefix` bare-name warning for buckets 2–4 (the intra-package duplicate warning stays), and the authoring skills' and templates' instruction to prefix non-object names (#30805's text). Studio prefixes object names only (`prefixObjectName` in `ui/packages/app-shell/src/views/studio-design/packages-io.ts`), so child U retires no prefix.
- **Stays:** ADR-0129 and the object rule, unchanged; the one-holder rule for platform-requested bare names (D3) and, as ruled (Q2 = A), for positions (D7); the capability's `NS.SHORT` spelling (bucket 1); the ADR-0048 §3.2 namespace install gate, which stays and gains the G1 and K refusals.
- **Names already prefixed stay as they are.** The examples renamed in phase 2 (#30927) and HotCRM's already prefixed names (email templates) are just names, and ⛔ nothing un-renames them.

### D10 — Upgrade: what an already-deployed app sees

- **No rename, no alias window, no author action.** Every authored name keeps working. Every bare address keeps resolving while it has one holder, which phase 1 guarantees today.
- **The release that carries the D8 migration** adds the package columns and backfills them. It reports the ambiguous set: each stored reference left null, with its candidates, and the operator command that binds one after review. It also names each package item's bare reference that only an environment-authored item holds, which D3 (a) refuses once that reader is wired.
- **A second package installed later** that takes an existing name (once that type's backstop is narrowed; until then it is refused, as today) does not change what any stored reference, overlay, run or URL of the first one means. That is the guarantee this whole record buys. Bare doors answer `409` from then on, naming both qualified addresses.
- **Customer-authored metadata** (bucket 4) is untouched.

---

## Execution plan (after acceptance)

Each slice is a child card, filed under the epic ruling `6723499113`; ⛔ none lands before this record is accepted. **Who builds** follows ruling `6723571682`: the epic seat keeps D and R; E, G and S go to the `domain:server` queue, P to `domain:spec`, the Studio slice to the ui lane, #31515 to the cloud lane. **Order** (same ruling): R before E and G; S after E and G; the backstop narrowing last.

**Every child is independently releasable** (red line 3). It is additive: nullable package columns are backfilled before any reader uses them, an index gains the package without dropping the bare path, a URL gains an optional segment, and a bare name keeps resolving to its unique holder, except a package caller's reference whose only holder is the environment (D3 (a), declared on the rows that carry it).

**Covered and uncovered types.** For the 13 types phase 1 covers (`BARE_NAME_ONE_HOLDER_TYPES`' 12 plus permission sets), no two package holders of a name exist while its refusal stands, so adding the coordinate changes no observable answer. (`BARE_NAME_ONE_HOLDER_TYPES` is picklist, mapping, dataset, api, action, function, flow, webhook, connector, email_template, agent and skill, so E6's whole surface is covered.) The other 12 bucket 2/3 types have no backstop: sharing rule, queue, assignment rule, hook, job, app, page, dashboard, report, book, cube and tool. (`rag_pipeline` is retired (#31456) before the ruled table was measured; no child touches it.) Two of them change no bare answer:
- **Hook** has no first-match read to narrow: it binds by event and object, and `isArtifactShippedHook` is a yes/no predicate (D4).
- **Job** keeps `jobKeyFor`'s reading (E7): the first holder keeps the bare key, and a second holder already gets its own `APPID:jobName`.

For the other 10, two unrelated packages may hold `page/home` today, and a bare read serves the first match (`getItem` with no package; `declaredItems().find`; ADR-0048 §3.3's best-effort first match, for packages with no dependency relation). After E4, E8 and G1, that same bare read answers a refusal or a `409` with the candidates. That is the outcome red line 2 asks for, but it is a **narrowing**, and those rows declare it.

The alternative was to widen phase 1's backstop to those 10 types first, so that red line 3 holds literally. This record does not take it, for three reasons:

- it refuses a package install that this record exists to allow;
- B children would then retire it again, so the same deployments would see two narrowings and a widening instead of one narrowing;
- it extends a refusal the maintainer scoped to 12 types.

What the declared narrowing changes is limited to a deployment that already holds one of those names twice. That deployment moves from a silent first match to a loud answer. Measured on HotCRM `6961ab1`: 0 such names.

Each child PR proves it is releasable with four readings:

- **(a)** the phase-1 one-holder tests stay green;
- **(b)** bare-name behaviour (URLs, MCP, SDK) is unchanged for every name with one holder; for an uncovered type's name with two holders, the child's declared narrowing stands in its place;
- **(c)** any migration is re-runnable and never guesses an ambiguous reference;
- **(d)** its `Clause-②:` declaration and, where it changes the protocol, its ADR-0087 migration entry.

**Clause-②** says whether the slice changes a published contract (spec, protocol, SDK, a door's request or response). **Narrowing** says whether something accepted before is refused after.

| # | Child | Builds | File surface | Clause-② | Narrowing |
|:--|:--|:--|:--|:--|:--|
| D | this ADR | epic seat | `docs/adr/` | no | no |
| R | **resolver and closure**: one `(package, name)` resolver (D3) with the ADR-0141 closure (the save door's `resolveWritePackageScope` is the nearest existing one), the refusal in `bare-name-one-holder.ts`'s vocabulary, and the per-package overlay slot (D4). The resolver adds `sys` to the closure itself (D3). Not wired to any reader yet | epic seat | objectql (`registry.ts`, a new resolver module), metadata-protocol (closure) | no | no |
| N | **namespace co-owner uniqueness** for the bucket 2/3 types phase 1 does not cover (sharing rule, queue, assignment rule, hook, job, app, page, dashboard, report, book, cube, tool; `rag_pipeline` is retired (#31456) before the ruled table was measured; no child touches it): a `(type, name)` held twice inside one namespace is refused at install and `os validate` (D2), on the ADR-0130 D3 object check. Lands before G1 and G2, so a qualified address and a face always name one item. Ruled with D2 (record `6724570466`) | server | objectql `registry.ts` (`installPackage`), cli validate | no | **yes** (measured first-party: 0 of 297) |
| K | **a namespace never equals an object name** (Q3 = A, ruled): refused in both directions (a new namespace equal to an existing object name; a new object name equal to an existing namespace), naming both spellings, at every object door: `defineStack`, `os validate`, install and Studio publish. The one predicate lives in `kernel/namespace-prefix.ts`, which `defineStack`/`os validate`, `MetadataManager.publishPackage()` and the save door (`protocol-save-door-refusals.ts`) already read. What each door compares against: `defineStack` and `os validate` see no environment catalog, so they compare an object name with the stack's own namespace, its declared dependencies' namespaces and the `NS_custom` corollary; install and publish compare with the environment's namespaces and object names. It also refuses an object whose short name is `custom` (the ADR-0146 pair namespace is `NS_custom`). Lands before G1, G2 and C | the spec predicate rides P's lane (`domain:spec`); the three doors are server | spec `kernel/namespace-prefix.ts`, `stack.zod.ts`; cli validate; objectql `registry.ts` (`installPackage`); metadata-protocol (`publishPackage`) | no | **yes**: a namespace equal to an object name, and an object short-named `custom` (measured first-party: 0) |
| P | **spec**: `namespace` on MCP `run_action` / `list_actions` shapes; the address grammar helpers (D5); the face derivation (D6, ruled: `NS-NAME`, `OBJECT-ACTION`); retire phase 2's bare-name lint finding and the skills and templates text (D9) | `domain:spec` | spec (`ai/`, `api/`, `automation/`, `data/`, `integration/`, `security/`, `system/`, `kernel/`), cli `lint.ts`, `skills/`, create-objectstack templates; the refusal of a `_`-led name of a bucket 2/3 type, and the namespace-position literal constant (D5) | yes | **yes**: a `_`-led name of a bucket 2/3 type (measured first-party: 0) |
| E1 | flow index and activation consult on `(package, name)` | server | service-automation (`engine.ts`, `flow-definitions.ts`) | no | **yes**, for a package item's bare reference that only an environment-authored item holds (D3 (a); not measurable first-party) |
| E2 | action engine key `(package, objectName, name)`; `ActionNavItem` resolved by D3 | server | objectql (`engine` action registry, `action-governance.ts`), runtime `action-execution.ts` | no | **yes**, for a package item's bare reference that only an environment-authored item holds (D3 (a); not measurable first-party) |
| E3 | security catalog: permission sets by `(package, name)`; `position.permissionSets` by D3; positions unchanged | server | core `security/security-catalog.ts`, plugin-security | no | **yes**, for a package item's bare reference that only an environment-authored item holds (D3 (a); not measurable first-party) |
| E4 | sharing rules, queues, assignment rules | server | plugin-sharing | no | **yes**, for a bare name of an uncovered type that two packages hold today (measured first-party: 0); and yes, for a package item's bare reference that only an environment-authored item holds (D3 (a); not measurable first-party) |
| E5 | webhooks, connectors, email templates | server | plugin-webhooks, service-automation connectors, plugin-email | no | **yes**, for a package item's bare reference that only an environment-authored item holds (D3 (a); not measurable first-party) |
| E6 | picklist, mapping, dataset, the api matcher's name key, engine functions by referrer | server | objectql, rest (`endpoint-matcher.ts`), service-analytics | no | **yes**, for a package item's bare reference that only an environment-authored item holds (D3 (a); not measurable first-party). Every type here is covered by phase 1, so there is no two-holder arm |
| E7 | jobs: `jobKeyFor` on the package coordinate, keeping the bare key readable | server | runtime `app-artifact-handlers.ts`, service-job | no | no: the first holder keeps the bare key and a second keeps its `APPID:jobName`, as `jobKeyFor` gives them today |
| E8 | presentation and AI items: app, page, dashboard, report, book, cube, tool, skill, agent (`rag_pipeline` is retired (#31456) before the ruled table was measured; no child touches it); `agent_prompt` on the protocol read (#31514) | server | objectql, metadata-protocol, mcp | no | **yes**, for a bare name of an uncovered type that two packages hold today (measured first-party: 0); and yes, for a package item's bare reference that only an environment-authored item holds (D3 (a); not measurable first-party) |
| G1 | REST doors: the optional namespace segment, the `_env` segment and the `409` with candidates (D5) on `/automation`, `/automation/hooks`, `/actions`, `/meta`, connectors; the install gate refuses a namespace that spells a grammar literal (D5) | server | runtime `domains/*.ts`, `route-ledger.ts`; objectql `registry.ts` (`installPackage`, reading the refused-literal constant from `spec/kernel`); `route-ledger.ts`'s test pins that constant | yes (additive) | **yes**: a namespace spelling a literal (first-party: none); and a today-ambiguous bare name of an uncovered type answers `409` (measured first-party: 0). A bare address with one holder still resolves; and where `?package=` is read as the caller, a package item's bare reference that only an environment-authored item holds (D3 (a); not measurable first-party) |
| G2 | MCP: `run_action` / `list_actions` `namespace`; skill, agent and action face names (D6, ruled), and the face list's duplicate refusal (Q3) | server | mcp | yes (additive) | no: N and K land first, so two items can share a face only by a hash collision, which the refusal names |
| G3 | client SDK: optional namespace on `automation.*`, `actions.invoke`, `meta.getItem` | server | client | yes (additive) | no |
| U | Studio and Console pass the held package id through `MetadataService` reads and editors (D5) | ui lane | `ui/packages/app-shell` (`services/MetadataService.ts`, `views/studio-design/*`) | no | **yes**, for a package item's bare reference that only an environment-authored item holds (D3 (a); not measurable first-party) |
| C | the action tool name on the AI face (#31515), from the D6 derivation (ruled), with the same duplicate refusal over the cloud's list (Q3) | cloud lane | cloud `service-ai` | carrier: cloud | — |
| S1 | activation ledger unique `(metadata_type, package_id, name)`, backfilled (R4) | server | platform-objects, core `metadata-activation-store.ts` | no | no |
| S2 | security and sharing columns: R1, R3, R5, R6, R13 | server | plugin-security, plugin-sharing | no | no |
| S3 | automation columns: R7, R8, R9, R10, R11, R14, R20 | server | service-automation, plugin-approvals, service-job, plugin-email | no | no |
| S4 | the ambiguous-set upgrade report and the reviewed bind command (D10), with its ADR-0087 migration entry | server | cli (`os migrate`), metadata-protocol | no | no |
| B1…B13 | **backstop narrowing, one child per type**, last: the one-holder refusal narrows from environment to namespace (D2), after that type's E, G and S children land | server, after each type's E/G/S | objectql `bare-name-one-holder.ts`, `security-catalog-namespace.ts` (permission sets) | no | **yes** for co-owners of one namespace (measured first-party: 0); a widening for everyone else |
| A | ADR status lines (ADR-0048 addendum, ADR-0129 cross-reference) | epic seat | `docs/adr/` | no | no |

**Count:** D, R, N, K, P, A, U and C (8), 8 E, 3 G and 4 S make 23 build children, N and K included. That is one above the evaluation thread's estimate of 18–22, because of K, which carries the Q3 ruling.

The B children are one per covered type, 13 in all (phase 1's 12 types plus permission sets), and small. Several types of one family can ride one PR where their E, G and S children have all landed. The trailing B children are new, and come from red line 3.

**Critical path, at fleet pace** (about 2–6 hours per medium PR, lanes in parallel):

| Step | Working days |
|:--|:--|
| this ADR, plus the maintainer's Tier H approval (Q1/Q2 ruled 16:30Z, Q3 17:13Z, D2 17:17Z) | 0.5 + his approval |
| R, K, N | 0.5–1 |
| E, G, P, U, C in parallel; within the step, P's spec pieces land before G1 and G2 | 1–2 |
| S | 1 |
| B, per type | 0.5 |
| **Total** | **about 4–5** |

The real bottlenecks are not calendar weeks. They are the maintainer's ADR approval, merge-queue and CI throughput, and the cloud lane for C.

## Questions put to the maintainer (all ruled)

No question is left open on this record.

- **Q1 — the bucket-3 face spelling** (`status: decided`). Ruled `NS-NAME`, with `OBJECT-ACTION` for an object-bound action (D6). Decision card option 0 「A+A，含对象动作补充」 at 16:30:25Z, record [`6724050556`](https://github.com/objectstack-ai/objectstack/issues/31527#issuecomment-6724050556). This unblocks P, G2 and C.
- **Q2 — two packages' same-named position** (`status: decided`). Ruled: keep the one-holder refusal; an administrator binds another package's set through an ADR-0005 overlay; no merge engine (D7). Same card and record.
- **Q3 — the face collisions the refined spelling leaves** (`status: decided`). Ruled A 「安装时拒绝」, decision card at 17:13:30Z, record [`6724530715`](https://github.com/objectstack-ai/objectstack/issues/31527#issuecomment-6724530715) on #31527. A namespace never equals an object name, refused in both directions at every object door, naming both spellings. The riders: a face is cut only past 64 characters, and the face list refuses duplicates (D6). It is carried by child K, a declared narrowing (first-party 0), and it blocks nothing: the faces stay as Q1 ruled. The option not taken was a separate `OBJECT--ACTION` separator: it re-spells the ruled example, and D5's router would still need the refusal.
- **D2 — co-owners of a namespace keep behavioural names unique** (`status: decided`). Accepted 「同意」 at 17:17:11Z, seat record [`6724570466`](https://github.com/objectstack-ai/objectstack/issues/31527#issuecomment-6724570466) on #31527. Identity is the package id, and the address is the namespace, so a qualified address names exactly one item. Child N carries the refusal, a declared narrowing (HotCRM: 0 of 297). `?package=` stays the exact qualifier.

## Consequences

- **Good.** Two packages can ship `send_email` side by side, and every caller reaches the one it means. No author, no AI and no stored row carries the namespace inside a behavioural name. The literal prefix is left only where a name leaves the platform (objects). Live environments migrate by adding columns, not by rewriting names.
- **Cost.** Every runtime index and by-name door of 20 behavioural types gains a coordinate, which is the plan above. The router gains a documented precedence (the grammar's literals, then a namespace, then the bare grammar) and the reserved `_env` segment. Four refusals are added beyond the two ruled ones: a namespace spelling a grammar literal (install), a `_`-led bucket 2/3 item name (authoring and the save door), and a package caller's bare reference whose only holder is the environment (D3 (a)). The two ruled refusals are a name held twice across a namespace's co-owners (N, with D2) and a namespace equal to an object name (K, with Q3). On an uncovered type, a bare name that two packages already hold turns from a silent first match into a `409`.
- **Risk.** A reader that is missed keeps resolving first-registered. Each slice therefore retires its type's phase-1 refusal only once its readers are measured on a booted two-package deployment, as phase 1 measured them.

## Alternatives considered

- **Finish phase 3 (literal prefix on every name).** Rejected by the 13:12:35Z ruling: 206 renames in HotCRM, 17 kinds of stored rewrite per environment, and a prefix every AI must remember.
- **Derive physical table names for objects too (ADR-0028 D2 in full).** Rejected by the per-type ruling: the table name is read by consumers the platform does not control (D1).
- **A qualified reference spelling inside metadata now (`NS:NAME`).** Deferred: no measured cross-package ambiguity (D3).
- **No co-owner uniqueness (no child N); a qualified address with two co-owner holders answers `409` with package-id candidates instead.** Not taken: the maintainer accepted D2 (record `6724570466`). `?package=` already disambiguates `/meta`, so this costs no install refusal. But a qualified address would then not always name one item, and the AI face (D6) would need the package id after all. Every client would need a second disambiguation step for a case HotCRM measures at 0 of 297 keys. N refuses that case once, at install, where an author can rename.
- **Refuse only the reserved `_` segments as item names** (`_env` and the ledger's `_`-led literals: `_status`, `_activation`, `_drafts`, `_migrate-stored`), instead of every `_`-led name. This costs the same 0 first-party and leaves every other `_`-led name legal. Not taken: each new `_`-led literal would then need its own refusal and its own narrowing, and a name taken before that refusal lands would be shadowed silently. Reserving the prefix once makes "a `_`-led segment is the router's" total.
- **Package id, not namespace, in addresses.** Rejected: `com.objectstack.hotcrm.revenue` in every URL and tool name is unreadable to authors and AI, and the namespace already identifies the item once co-owners keep names unique (D2).
