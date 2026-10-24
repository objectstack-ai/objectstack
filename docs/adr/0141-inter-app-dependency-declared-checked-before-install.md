# ADR-0141: An app may depend on another installed app — declared in `manifest.dependencies`, checked once before install, and co-owning the namespace it shares

**Status**: Proposed (2026-10-24). `docs/adr/**` is Tier H (Prime Directive #14): this record becomes **Accepted** by
the maintainer's merge, and ⛔ the execution cards under [Execution plan](#execution-plan-after-acceptance) are cut after
that merge and never before it. Until then a composite product keeps shipping as one release artifact under
[ADR-0130](./0130-release-artifact-as-co-ownership-boundary.md).
**Decided by**: two maintainer rulings on [#25403](https://github.com/objectstack-ai/objectstack/issues/25403), recorded
verbatim and untranslated:

- ruling [`6369704387`](https://github.com/objectstack-ai/objectstack/issues/25403#issuecomment-6369704387), batch #7
  item 1, letter **B′**, 「同意」 at 2026-10-23T16:28:30Z — the declaration stays as it is, the save door's closure is
  the reference mechanism, a pre-install check is the only new gate, the rest is deferred by name, permissions are
  unchanged. The maintainer's reasoning, from the director thread that day:
  > 往往需要引用的数据并不多，可能就几个对象 (16:10:38Z)
  >
  > 包依赖本身没问题，也就是说如果 psa 依赖 crm, 安装psa 之前先检测crm有没有，没有就禁止安装，这个有必要嘛 (16:20:28Z)
  >
  > 如果这样，hotcrm 岂不是真实的可以分拆出很多模块 (16:25:59Z) / 而每个包可以独立安装 (16:26:18Z)
- ruling [`6377678758`](https://github.com/objectstack-ai/objectstack/issues/25403#issuecomment-6377678758), batch #8
  item 2, letter **A**, 「同意 #8」 at 2026-10-24T00:40:55Z — 「声明依赖即命名空间共有，单向，D3 对象名唯一检查跨发布物同行」,
  no new manifest field, and ADR-0130 D8's deferral reworded to end at marketplace publishing.

The second ruling answers input 1 of the `repo:hotcrm` seat's comment
[`6370024454`](https://github.com/objectstack-ai/objectstack/issues/25403#issuecomment-6370024454); its input 2 (a stale
line in ADR-0130) is corrected by D6 below.
**Builds on**: [ADR-0019](./0019-app-as-consumer-unit.md) (the App is the consumer unit; §Out of scope deferred
"inter-App dependencies" to a separate gated decision — this is that decision, narrowed),
[ADR-0130](./0130-release-artifact-as-co-ownership-boundary.md) D1, D3, D5, D6, D8 (co-ownership inside one artifact, the
gate/uniqueness pair, the one sorter, one version per artifact, the deferred owner field),
[ADR-0048](./0048-cross-package-metadata-collision.md) §3.2 and its
[2026-08-08 addendum](./0048-cross-package-metadata-collision.md#addendum-2026-08-08-publish-time--marketplace-namespace-exclusivity)
(the install-time namespace gate; the publisher-held reservation, still Proposed),
[ADR-0086](./0086-authz-metadata-config-boundary-and-cross-package-composition.md) D4 (a package ships its own
permission sets and never writes a foreign one), [ADR-0087](./0087-metadata-protocol-upgrade-contract.md) D1 (the
protocol handshake every install door already runs before it registers anything — the placement D2 reuses),
[ADR-0112](./0112-error-code-vocabulary-and-ledger.md) (the refusal envelope),
[ADR-0116](./0116-plugin-ordering-declared-contract.md) (ordering is a declared contract with one sorter),
[ADR-0129](./0129-object-name-is-the-canonical-id.md) (an object name carries its module prefix literally, which is why
a split module keeps `crm_*` and its namespace).
**Amends**: [ADR-0028](./0028-metadata-naming-and-namespace-isolation.md) D4 (a Deferred proposal; its sentence is
rewritten, D6 below); ADR-0130 D8's deferral end point and the stale #14488 line of its 2026-09-02 addendum (each by an
additive addendum on 0130; no original text of 0130 is edited). **Cross-references**: ADR-0019 gains one additive
`Related` line; its text is unchanged (ADR-0130 D2's recording convention).
**Consumers**: `@objectstack/spec` (`ManifestSchema.dependencies` in `kernel/manifest.zod.ts`,
`AppCompatibilityCheckSchema` and `AppManifestSchema` in `system/app-install.zod.ts`, `PackageDependencySchema` and
`PackageManifestSchema` in `marketplace/package-version.zod.ts`), `@objectstack/objectql` (`SchemaRegistry.installPackage`
and `refuseCoOwnedObjectNameCollision` in `registry.ts`), `@objectstack/metadata-protocol` (`installPackage` in
`protocol-package-install.ts`; `resolveWritePackageScope` in `protocol.ts`), `@objectstack/runtime` (`POST
/api/v1/packages`, `domains/packages.ts`), `@objectstack/cloud-connection` (`POST /api/v1/marketplace/install-local`), the
`objectui` Console's install refusal text, `packages/cli` (`os package publish`), and HotCRM's module split.
**Evidence**: every anchor in this repository was read at `origin/main` `47af3dde42` while drafting. Repositories this
session cannot read (`objectstack-ai/hotcrm`, `objectstack-ai/cloud`) are cited as the rulings cite them and marked
**not re-verified**.

---

## TL;DR

An installable app may now depend on another installed app and reference its objects. **Nothing new is authored**:

1. **Declaration** is the `dependencies` key every manifest already has (`{ packageId: versionRange }`).
2. **Reference** is what the runtime save door already allows: a package's own objects, the objects of the packages its
   `dependencies` declare (transitively), platform objects, and tenant objects that belong to no package.
3. **The one new gate is a pre-install check.** Installing a package checks each declared dependency — installed in the
   target environment (or delivered by the same artifact) and at a version inside the declared range — and otherwise
   refuses the install with a message naming what is missing (「请先安装 HotCRM 6.x」). It fills the `dependency_missing`
   category `AppCompatibilityCheckSchema` has reserved with no producer.
4. **A package that declares a dependency on an installed package X and uses X's namespace co-owns that namespace with
   X** at the install gate. One-way: X declares nothing and gains nothing. ADR-0130 D3's per-object-name uniqueness check
   spans these co-owners across artifacts, exactly as it spans co-owners inside one artifact.
5. **Deferred, by name**: uninstall protection, upgrade interception, topological / cascade install, an owner-side
   publish marker, marketplace version negotiation. **Permissions are unchanged**; record-level semantics across a
   dependency are an open section, decided with the first consumer.

The first consumer is a HotCRM module shipping on its own, revenue first.

---

## Context

### What the platform does today (measured at `47af3dde42`)

**Declaration exists and is editable.** `ManifestSchema.dependencies` is `z.record(z.string(), z.string()).optional()`,
documented as a "Map of package IDs to version requirements" (`packages/spec/src/kernel/manifest.zod.ts#ManifestSchema`). The
package door edits it after install and validates only its shape (`packages/runtime/src/domains/packages.ts`,
recorded on the registry by `packages/objectql/src/registry.ts#SchemaRegistry`).

**Reference is already judged against the declared closure — at the runtime save door only.**
`resolveWritePackageScope` computes the transitive closure of the written package's `manifest.dependencies`
(`packages/metadata-protocol/src/protocol.ts#resolveWritePackageScope`), and the lint gate keeps an object when it belongs to the
package, to a declared dependency, to the platform, or to no package. A view bound outside it is refused `422`
(`list-view-object-outside-closure`, `packages/lint/src/rule-explanations.ts#LIST_VIEW_OBJECT_OUTSIDE_CLOSURE_EXPLANATION`), whose fix line already reads
"declare a dependency on the package that defines the object". The same explanation records the boundary of that
judgement: `os validate`, `os build` and `os lint` "judge neither: a stack there is one app, and an unresolved binding
may be a dependency package's object the stack does not carry". A closure that does not resolve a declared dependency
keeps it in the closure and stops walking — an absent dependency is not a fault there.

**At install, `manifest.dependencies` is read by exactly one consumer, and it orders — it never checks.** The dispatch
for this record assumed nothing at install reads the key; the measurement corrects that by one reader.
`resolveArtifactPackageEntries` (`packages/core/src/artifact-packages.ts#resolveArtifactPackageEntries`) feeds each declared id to `resolvePluginOrder` as an
**optional** edge, so packages inside one artifact register in dependency order (ADR-0130 D5) and a declared id that is
not in the artifact "is simply not an edge here" — silently skipped by design (its module header). No install
door asks whether a declared dependency is installed, or at what version. `dependency_missing` is an enum value of
`packages/spec/src/system/app-install.zod.ts#AppCompatibilityCheckSchema`; across the tree it occurs only there, in that file's test and in the
generated reference page — zero producers. `packages/core/src/dependency-resolver.ts` serves kernel plugins, not
installed packages.

**The namespace gate admits co-owners from one source only.** `SchemaRegistry.installPackage` builds its co-owner set
from the artifact scope the load path passes (`packages/objectql/src/registry.ts#installPackage`, `scope?.packageIds`, line 5974) and refuses a package whose
non-shareable namespace an installed non-co-owner owns, throwing `NamespaceConflictError` (lines 5989–6005, the
throw at 6003; the class `packages/objectql/src/registry.ts#NamespaceConflictError`, `422 NAMESPACE_CONFLICT`). Its other half, `refuseCoOwnedObjectNameCollision`
(`packages/objectql/src/registry.ts#refuseCoOwnedObjectNameCollision`), refuses two co-owners defining one object name (`ArtifactObjectNameConflictError`,
`DUPLICATE_ARTIFACT_OBJECT_NAME`) and returns early when the co-owner set is empty. So a module published as its own
artifact with HotCRM's namespace `crm` is refused next to an installed HotCRM today, whatever it declares.

**Three schemas spell a dependency, in three shapes** — the alignment D8 records:

| Carrier | Shape | Who reads it at `47af3dde42` |
|:---|:---|:---|
| `ManifestSchema.dependencies` (`packages/spec/src/kernel/manifest.zod.ts#ManifestSchema`) | record `{ [packageId]: versionRange }`, optional | the save-door closure; the intra-artifact sort; the package door's edit |
| `PackageManifestSchema.dependencies` (`packages/spec/src/marketplace/package-version.zod.ts#PackageManifestSchema`), entries `#PackageDependencySchema` | array of `{ packageId, versionRange, optional = false }`, default `[]` | no runtime reader in this repository |
| `AppManifestSchema.dependencies` (`packages/spec/src/system/app-install.zod.ts#AppManifestSchema`) | array of bare strings, no version, default `[]` | no reader outside `packages/spec` |

`os package publish` snapshots the compiled `dist/objectstack.json` into `sys_package_version.manifest_json`
(`packages/cli/src/commands/package/publish.ts`, its header steps 1–2), so the snapshot carries the record shape where
`PackageManifestSchema` declares an array. Whether the control plane parses that snapshot against the array schema lives
in `objectstack-ai/cloud` — **not measured** here.

### Why now, and for whom

ADR-0130 lets one product carry N packages inside one artifact, installed whole; its D6 records the cost — no per-module
hot-fix — and the escape hatch: a module that must ship on its own cadence becomes its own artifact, at which point D8's
deferral ends. The maintainer's rulings above take that escape hatch for real: a HotCRM module that ships and installs on
its own, beside an installed HotCRM. That needs three things the platform does not have — a check that the depended-on
app is there, a namespace gate that admits the module, and a record of what is deliberately left for later. The
`repo:hotcrm` seat's two module cards frame the sequence: hotcrm#2270 packages revenue and marketing inside the one
artifact now; hotcrm#2271 ships revenue on its own once this check is released (both **not re-verified**, cited from
comment `6370024454`).

---

## Decision

### D1 — Declaration and reference: no new mechanism

An app — any installable package — declares what it depends on in `ManifestSchema.dependencies`, unchanged:
`{ "PACKAGE_ID": "SEMVER_RANGE" }`. A dependency **opens the reference**: the runtime save door judges a package's
writes against the closure already described above, and nothing else decides whether a cross-app reference is legal.

⛔ No owner-side "published object" flag, no export list, no second reference mechanism. An undeclared cross-app
reference is refused where it is refused today — at the save door, `422` — and the fix it prints is the declaration.
`os validate`, `os build` and `os lint` keep judging neither side of a cross-package binding: a stack there is one app
and cannot see its dependencies' objects.

### D2 — The pre-install check: installed, in range, or a clear refusal — and only that gate

**What it judges.** For an install of package P, every entry `(id, range)` of `P.manifest.dependencies` is satisfied
when both hold:

1. **Present.** A package with that id is installed in the target environment, or is delivered by the **same artifact**
   as P. The second arm is what keeps every ADR-0130 artifact installable: inside one artifact the dependency is
   installed in the same act (D1 of 0130) and registered first (D5 of 0130), so the check must not refuse a dependency
   the act itself delivers.
2. **In range.** The present package's version satisfies `range`. A co-delivered package's version is the artifact's
   one version (ADR-0130 D6). A version or range the parser cannot read does **not** satisfy — the refusal says which
   side was unreadable. Fail closed: an unread bound is not a bound.

Every manifest entry is required: the record shape has no optional arm (D8 states the marketplace shape's `optional`
flag and how it projects).

**What it answers.** An unsatisfied entry refuses the install, before anything is registered or written, with the
ADR-0112 envelope and one `AppCompatibilityCheck` issue per unsatisfied entry — `severity: 'error'`, `category:
'dependency_missing'`, a `message` naming the dependency, the declared range, and what was found (absent, or installed at
version V). All unsatisfied entries are reported in one answer, never the first alone. The Console renders the refusal
in the author's terms (「请先安装 HotCRM 6.x」). The error code and HTTP status are the runtime card's to choose from the
ADR-0112 ledger; the category is fixed here.

**Where it runs.** At the **install act** — the doors that already run the ADR-0087 D1 protocol handshake before they
register anything: `POST /api/v1/packages` on both of its arms (the protocol primitive `installPackage` in
`protocol-package-install.ts`, and the no-protocol fallback in `domains/packages.ts`), and
`POST /api/v1/marketplace/install-local`. One predicate serves every door; ⛔ no door carries its own copy, and the range
grammar is read by an existing parser, ⛔ never a second semver implementation.

**Where it does not run.** Re-registration of an already-installed set is not an install act: boot registration of
code-composed packages, the `sys_packages` rehydrate, and the cached marketplace-manifest rehydrate. A boot fills the
registry incrementally, so "dependency X is not installed" concluded there can be contradicted a moment later by X
registering — the verdict AGENTS.md's *Startup registry reads* section names as a defect. What an installed set already
admitted stays admitted; a dependent whose dependency has since gone is D3's uninstall-protection item, not a boot
refusal.

### D3 — Deferred, by name, not implemented now

Each item below is a decision **not** to build yet, recorded so the next author finds a reason instead of an absence.
None is rejected; each has a trigger.

| Deferred item | What happens meanwhile | Trigger to build it |
|:---|:---|:---|
| **Uninstall protection** — refusing to uninstall a package another installed package depends on | The uninstall proceeds. The dependent's references to the removed objects dangle; the existing ADR-0029 refusal (a package whose object another package `extend`s cannot be uninstalled) still holds, unchanged | A first customer uninstall that strands a dependent |
| **Upgrade interception** — refusing an upgrade of X that would leave a dependent's declared range | The upgrade proceeds; the dependent's range is not re-judged | A first dependent broken by an upgrade of what it depends on |
| **Topological / cascade install** — installing a set in dependency order, or pulling a missing dependency in automatically | The administrator installs dependencies first; D2's refusal says which. Inside one artifact, ADR-0130 D5's sort is unchanged | More than one level of standalone modules in a real product |
| **Owner-side publish marker** — X restricting which of its objects a dependent may reference | Every object of X is referenceable by a declared dependent, subject to D4 | A third-party dependent on a first-party app, i.e. marketplace publishing (D5's end point for ADR-0130 D8) |
| **Marketplace version negotiation** — choosing versions of X and P that satisfy each other | None; D2 judges the installed version against the declared range, once | Marketplace listings carrying more than one installable version of a depended-on app |

### D4 — Permissions unchanged; record-level semantics are an open section

A dependency opens the **reference**, not the **data**. A referencing app's users see the referenced app's records under
the referenced app's own permission sets and sharing rules; a lookup from P to an object of X confers no read on X's
records. Each package ships its own permission sets (ADR-0086 D4), and nothing composes into another package's set — the
same answer #14488's closing ruling gives a module carved out as its own artifact (D6 below).

**Open section — decided with the first consumer, not here.** How a dependent's lookup to X's object behaves at record
level: what a user who may read P's record but not the referenced record of X sees in the lookup (the referenced id, a
redacted label, or nothing), and whether a dependent's list, report or search may filter through X's records it cannot
read. The answer is measured on HotCRM's revenue module against the existing record-access path, before the runtime card
for it is cut.

### D5 — A declared dependency is namespace co-ownership, one-way

At the install gate, package P's co-owner set gains every installed package X such that P declares X in
`manifest.dependencies` **and** P's namespace equals X's non-shareable namespace. Nothing else changes:

- **One-way.** Only the dependent declares. X declares no dependency on its modules and gains nothing on P's side; P
  gains admission to the shared namespace and nothing on X's side.
- **The D3 pair holds across artifacts.** ADR-0130 D3 made the namespace relaxation and the per-object-name uniqueness
  check one change; the second half now spans these co-owners too. A dependent defining an object name X already owns
  is refused at install, ahead of any DDL, with an error naming both packages and the object — the refusal
  `refuseCoOwnedObjectNameCollision` already raises for co-owners inside one artifact.
- **No new manifest field.** The co-ownership proof is the declaration plus the administrator's install act. Its in-
  tenant trust is that administrator's choice to install P beside X — the same trust that admits any package.
- **Direct declarations only.** A package sharing a namespace with several installed packages declares each one; the
  `NamespaceConflictError` it meets otherwise names the owner it did not declare.
- **Recognised whichever of the two registers first.** The relation is declared by P alone, but the gate honours it on
  both registrations: when X registers and an existing owner of X's namespace is a package that declares X, that owner
  is X's co-owner for the namespace gate and for the uniqueness check alike. This is recognition, not a right — X still
  declares nothing — and it is required because registration order at boot is not install order: a rehydrate that
  registers P before X would otherwise refuse the depended-on app itself. Whether today's rehydrate order can put P
  first is the runtime card's first reading.

**ADR-0130 D8's deferral now ends at marketplace publishing**, not at a module's first standalone artifact. Within one
tenant, D5 proves co-ownership without an owner field. Across vendors — the moment a module is published to the
marketplace and must assert "I have the same publisher as HotCRM" — the owner / publisher field lands, aligned to the
`publisherOrgId` reservation of ADR-0048's 2026-08-08 addendum (still Proposed). That field is the later superset of D5
(letter B of ruling `6377678758`) and needs no undo of it. Renaming a module's objects to dodge the gate stays refused
(ADR-0129; letter C of the same ruling).

### D6 — What ADR-0028, ADR-0019 and ADR-0130 now say

- **ADR-0028 D4** (Deferred, proposed 2026-06-01) proposed full isolation between apps — "may not reference metadata
  owned by another app". Its sentence is rewritten to **"no cross-app reference without a declared dependency"**: an app
  may reference its own metadata, the kernel, and the metadata of the apps its manifest declares in `dependencies`;
  every other cross-app reference is refused. The isolation D4 wanted between marketplace apps is kept by the closed
  set — an app reaches only what it declared, and the save door already refuses the rest. The rest of ADR-0028 stays
  Deferred and untouched; D4 carries a note pointing here.
- **ADR-0019** §Out of scope keeps its text verbatim. Its header gains one additive `Related` line naming this record as
  the gated decision its "Shared/published data model + inter-App dependencies" bullet asked for, narrowed to the
  dependency half. The shared data model half (a platform-owned customer/supplier model, letter C on #25403) was not
  chosen and stays out of scope.
- **ADR-0130** gains an addendum (no original text edited) recording two things: D8's deferral now ends at marketplace
  publishing (D5 above), and the 2026-09-02 addendum's *What was NOT decided* line listing
  [#14488](https://github.com/objectstack-ai/objectstack/issues/14488) as "filed, not decided" is stale — #14488 was closed
  `not_planned` on 2026-09-12 by ruling
  [`5645322259`](https://github.com/objectstack-ai/objectstack/issues/14488#issuecomment-5645322259): an artifact
  installs whole, nothing composes grants into another package's set, and a module carved out as its own artifact ships
  its own permission sets under ADR-0086 D4. A standalone module's permission sets are therefore the module author's
  work, not a platform blocker.

### D7 — The first consumer: a HotCRM module shipping on its own, revenue first

The scenario this record is accepted against is HotCRM's module split as its `docs/architecture/module-split-plan.md`
records it (the 2026-09-14 shape: the sales app plus service, revenue and marketing modules; **not re-verified**): the
revenue module ships as its own artifact, declares `dependencies: { HOTCRM_SALES_PACKAGE_ID: "HOTCRM_MAJOR_RANGE" }`, keeps
`namespace: 'crm'` and its `crm_*` object names, and installs beside an installed HotCRM. Installing it on an environment
without HotCRM, or with HotCRM outside the declared range, is refused by D2 with the message naming HotCRM and the range.

Until the runtime card ships, composite products keep shipping as one artifact (ADR-0130). That is the state hotcrm#2270
packages revenue and marketing in; hotcrm#2271 moves revenue to its own artifact after the check is released.

### D8 — The dependency shapes, and the alignment the runtime card owes

The authored source of truth is the **manifest record**, `ManifestSchema.dependencies`. D2 reads it, the save-door
closure reads it, D5 reads it. ⛔ No spec shape changes in this record.

The marketplace snapshot's array, `PackageManifestSchema.dependencies` of `PackageDependencySchema`, is a **projection** of
that record, one entry per key: `packageId` = the key, `versionRange` = the value, `optional` = `false` (the record has
no optional arm, and D2 treats every entry as required). The runtime card owes:

1. **One conversion** from record to array, used by every writer of a snapshot, so the snapshot conforms to its declared
   schema instead of carrying the record shape it carries today (`publish.ts` writes the compiled manifest as-is). Where
   the control plane reads `manifest_json` is in `objectstack-ai/cloud`; the card states what it found there.
2. **A stated fate for `optional`.** An `optional: true` entry has no record spelling. Until one is decided, a snapshot
   never produces it, and D2 does not read it.
3. **A stated fate for `AppManifestSchema.dependencies`** (bare ids, no range, no reader outside `packages/spec`): either
   it projects from the record (ids only, losing the range) or it is retired through the ADR-0087 conversion layer. The
   card decides which with a measured reader count; this record decides neither.

The resolver-side `ResolvedPackageDependencySchema` (`kernel/plugin-security.zod.ts`) is unaffected — it is the
resolution outcome, not a declaration, and its own header already tells the two apart.

---

## Consequences

**Positive**
- A customer can install CRM now and PSA, or a HotCRM module, later — without the module having been shipped to every
  CRM customer and without swapping to a combined app. 「每个包可以独立安装」.
- One rule replaces several special cases: inside an artifact (ADR-0130), at the save door (the closure), and across apps
  (this record), a cross-package reference is legal exactly when it is declared.
- An AI author's undeclared reference stays a loud `422` at the save door, and a missing dependency is a loud refusal at
  install, instead of copied objects that drift silently.
- The work is small: no new authorable key, no schema change, one predicate at the install doors, one more source for the
  co-owner set.

**Negative / costs, stated plainly**
- Uninstalling or upgrading a depended-on app is not guarded (D3). An administrator can strand a dependent until those
  items are built; the refusal at install is the only gate.
- A standalone module and its app now have **separate versions**, which ADR-0130 D6 avoided inside one artifact: the
  version matrix it removed comes back across artifacts, bounded only by the declared range.
- D5 lets a module share a vendor's namespace on the administrator's say-so. Inside one tenant that is the install
  choice the administrator already makes; across vendors it is not enough, which is why D8's deferral now ends at
  marketplace publishing.

**Unchanged** — the consumer model (ADR-0019 D1–D4: one app installs, opens, uninstalls), the artifact as a
control-plane noun (ADR-0130 D2), the one sorter (ADR-0130 D5), permission sets (ADR-0086 D4), and the save door's
closure rules.

---

## Alternatives considered

The letters as filed on #25403 and on ruling `6377678758`:

1. **Keep apps isolated (#25403 letter A).** Composite products ship as one artifact. Not chosen: every later product is
   either pre-installed on everyone or a swap to a bigger bundle, and cross-app master data travels by import and sync,
   which drifts silently.
2. **The full inter-app dependency (#25403 letter B as filed).** Install ordering, uninstall protection, version
   compatibility, cross-app permission semantics and Console dependency views at once. Narrowed by the maintainer to
   B′: the declaration and one check now, the rest as D3's deferred items.
3. **A platform-owned shared master data model (#25403 letter C).** Not chosen: the platform would own a business data
   model and every existing app's objects would migrate. Under this record a "master data app" is an ordinary app others
   depend on.
4. **An owner-side "published objects" list (the director's variant D).** Not chosen: 「往往需要引用的数据并不多，可能就几个对象」
   — the declaration is enough; restricting what a dependent may reference is D3's publish-marker item.
5. **For the namespace — an owner / publisher field now (ruling `6377678758` letter B).** Not chosen now: it is the
   later superset of D5, aligned to `publisherOrgId`, and lands at marketplace publishing without undoing D5.
6. **For the namespace — rename the module's objects (letter C).** Refused: ADR-0129 makes the object name the canonical
   id, and a rename is the deep rewrite ADR-0130 exists to avoid.

---

## Open items (not blocking acceptance; each becomes a reading on its card)

1. **Record-level semantics across a dependency** — D4's open section, measured on HotCRM's revenue module.
2. **Rehydrate order** — whether any boot path can register a dependent before the package it depends on (D5's
   recognition rule makes the answer harmless; the card records it).
3. **Declared ids that are not installable packages.** `ManifestSchema.dependencies`' own documentation example names an
   npm-style id (`@steedos/plugin-auth`). Measured population in this repository: one declaring manifest,
   `examples/app-multi-package/src/packages/orders/index.ts`, whose dependency is delivered by the same artifact (D2's
   second arm). HotCRM's manifests are **not measured**. If an id that names no installable package turns up, the card
   reports it; D2 does not exempt it.
4. **`optional` and `AppManifestSchema.dependencies`** — D8 items 2 and 3.

## Open questions for the maintainer's merge decision

These are the points this draft decided where the rulings were silent, listed so the merge is an informed act:

1. **D2's second arm** — a dependency delivered by the same artifact counts as present. Without it every multi-package
   artifact whose modules declare their app (`examples/app-multi-package` today) would refuse itself.
2. **D2's placement** — install acts only, not boot re-registration. Checking at boot would be a startup-registry verdict
   (AGENTS.md); the cost is that an environment whose dependency was removed outside an install act boots without
   complaint (D3's uninstall item).
3. **D5's recognition rule** — the gate honours P's declaration on X's registration too. The ruling's "one-way" is kept
   for declaration and rights; recognition from X's side is what keeps a rehydrate from refusing HotCRM itself.
4. **D5's direct-only scope** — co-ownership follows direct declarations, not the transitive closure the save door walks.
   Narrower is the reversible direction; widening later needs no undo.

---

## Verification notes

- **The dispatch's assumption "nothing at install reads `manifest.dependencies`"** holds for checking and fails for
  ordering: `resolveArtifactPackageEntries` reads every declared id as an optional sort edge (Context above). It changes no decision —
  the sort skips an absent id silently, which is exactly why D2 is needed — but the record states the reader.
- **The namespace refusal** is `NamespaceConflictError` in `packages/objectql/src/registry.ts`, as assumed. The line
  comment `6370024454` cites (line 5942) and ruling `6377678758`'s range (`~5929–5942`) have moved: at `47af3dde42` the
  gate is `5989–6005`, the throw `6003`, the co-owner set `5974`.
- **"`revenue` first per ADR-0130 §1.3(c)"** (ruling `6369704387`): §1.3(c) names CPQ as the unsellable module, not
  revenue. Revenue first is HotCRM's own ordering (module-split plan, hotcrm#2271); §1.3(c) is the general consequence
  both serve. No decision moves.
- **ADR numbering.** `0136` and `0140` were taken by proposals that never landed (#18480; #25618, withdrawn
  2026-10-24) and are not reused; no open pull request carries an ADR at `47af3dde42`. This record is `0141`.

---

## Execution plan (after acceptance)

1. **Runtime card (XS–S, `domain:services` / objectql), one PR**: D2's predicate at the three install doors with the
   `dependency_missing` issues and the Console refusal text; D5's dependency source for the co-owner set, recognised on
   both registrations, with the ADR-0130 D3 gate test extended to a cross-artifact pair (a dependent defining an object
   name X owns is refused, asserting `code` and `status`); D8's record-to-array conversion. Its first readings: open
   items 2 and 3.
2. **Docs**: the package-authoring guide states how to declare a dependency and what the install refusal means.
3. **HotCRM** (its own lane): hotcrm#2271 ships revenue as its own artifact once (1) is released.

## References

- [#25403](https://github.com/objectstack-ai/objectstack/issues/25403) — the decision card; rulings `6369704387`,
  `6377678758`; HotCRM seat input `6370024454`
- [#14488](https://github.com/objectstack-ai/objectstack/issues/14488) — closed `not_planned`, ruling `5645322259`
- ADR-0019, ADR-0028, ADR-0029, ADR-0048 (and its 2026-08-08 addendum), ADR-0086, ADR-0087, ADR-0112, ADR-0116,
  ADR-0129, ADR-0130
- `packages/spec/src/kernel/manifest.zod.ts`, `packages/spec/src/system/app-install.zod.ts`,
  `packages/spec/src/marketplace/package-version.zod.ts`
- `packages/objectql/src/registry.ts` (`installPackage`, `refuseCoOwnedObjectNameCollision`, `NamespaceConflictError`)
- `packages/metadata-protocol/src/protocol.ts` (`resolveWritePackageScope`),
  `packages/metadata-protocol/src/protocol-package-install.ts`
- `packages/core/src/artifact-packages.ts`, `packages/lint/src/rule-explanations.ts`
  (`list-view-object-outside-closure`)
- hotcrm `docs/architecture/module-split-plan.md`, hotcrm#2270, hotcrm#2271 (not re-verified)
