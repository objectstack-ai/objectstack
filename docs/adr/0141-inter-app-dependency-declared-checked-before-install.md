# ADR-0141: An app may depend on another installed app — declared in `manifest.dependencies`, checked once before install, and co-owning the namespace it shares

**Status**: Proposed (2026-10-25; first draft 2026-10-24). `docs/adr/**` is Tier H (Prime Directive #14): this record
becomes **Accepted** by the maintainer's merge, and ⛔ the cards under [Execution plan](#execution-plan-after-acceptance)
are cut after that merge, never before it. Until the pre-install check ships, a composite product keeps shipping as one
release artifact under [ADR-0130](./0130-release-artifact-as-co-ownership-boundary.md). **This record declares; it
implements nothing** — no schema, no code, no changeset.
**Decided by**: two maintainer rulings on [#25403](https://github.com/objectstack-ai/objectstack/issues/25403), executed
here as written and ⛔ not re-opened:

- Ruling [`6369704387`](https://github.com/objectstack-ai/objectstack/issues/25403#issuecomment-6369704387) — batch #7
  item 1, letter **B′**, 「同意」 at 2026-10-23T16:28:30Z. The card's letter B (full inter-app dependency: install
  ordering, uninstall protection, version compatibility, cross-app permission semantics, Console dependency views),
  narrowed by the maintainer to: the declaration stays as it is, the save door's closure is the reference mechanism, a
  pre-install check is the only new gate, the rest is deferred by name, permissions are unchanged. The maintainer's
  reasoning, verbatim and untranslated, as the ruling records it from the director thread of 2026-10-23:
  > 25403 如果按照包依赖的方式，整个开发会复杂很多，如果每个应用包是单独安装的，有其他方式把数据串起来吗 (16:10:20Z)
  >
  > 往往需要引用的数据并不多，可能就几个对象 (16:10:38Z)
  >
  > 包依赖本身没问题，也就是说如果 psa 依赖 crm, 安装psa 之前先检测crm有没有，没有就禁止安装，这个有必要嘛 (16:20:28Z)
  >
  > 如果这样，hotcrm 岂不是真实的可以分拆出很多模块 (16:25:59Z) / 而每个包可以独立安装 (16:26:18Z)
  >
  > 同意 (16:28:30Z)
- Ruling [`6377678758`](https://github.com/objectstack-ai/objectstack/issues/25403#issuecomment-6377678758) — batch #8
  item 2, letter **A**, 「同意 #8」 at 2026-10-24T00:40:55Z, raised by the `repo:hotcrm` seat's input
  [`6370024454`](https://github.com/objectstack-ai/objectstack/issues/25403#issuecomment-6370024454): dependency-declared
  namespace co-ownership — 「声明依赖即命名空间共有，单向，D3 对象名唯一检查跨发布物同行」 — no new manifest field, and
  ADR-0130 D8's deferral reworded to end at marketplace publishing. Letters B (an owner / publisher field now) and C
  (rename the module's objects) were not chosen.

**Builds on**: [ADR-0019](./0019-app-as-consumer-unit.md) (the App is the consumer unit; §Out of scope deferred
"Shared/published data model + inter-App dependencies" to a separate gated decision — this record is that decision for
the dependency half), [ADR-0130](./0130-release-artifact-as-co-ownership-boundary.md) D1, D3, D5, D6, D8 (co-ownership
inside one artifact; the gate-and-uniqueness pair; the one sorter; one version per artifact; the deferred owner field),
[ADR-0048](./0048-cross-package-metadata-collision.md) §3.2 and its
[2026-08-08 addendum](./0048-cross-package-metadata-collision.md#addendum-2026-08-08-publish-time--marketplace-namespace-exclusivity)
(the install-time namespace gate; the publisher-held reservation, still Proposed, whose activation precondition A.5 is
third-party publishing), [ADR-0086](./0086-authz-metadata-config-boundary-and-cross-package-composition.md) D4 (a package
ships its own permission sets and never writes a foreign one),
[ADR-0087](./0087-metadata-protocol-upgrade-contract.md) D1 (the protocol handshake every install door runs before it
registers anything), [ADR-0112](./0112-error-code-vocabulary-and-ledger.md) D3 (a refusal's code is ledger-registered;
the envelope is `code` + `status`), [ADR-0116](./0116-plugin-ordering-declared-contract.md) (ordering is a declared
contract with one sorter), [ADR-0129](./0129-object-name-is-the-canonical-id.md) (an object name carries its module
prefix literally — why a split module keeps `crm_*` and the `crm` namespace), and
[ADR-0029](./0029-kernel-object-ownership-and-platform-objects-decomposition.md) (the one uninstall refusal that exists
today: a package whose object another package `extend`s).
**Amends**: [ADR-0028](./0028-metadata-naming-and-namespace-isolation.md) D4 — a Deferred proposal whose sentence is
rewritten (D6 below); ADR-0130 D8's deferral end point and the stale #14488 line of its 2026-09-02 addendum — by an
additive addendum on 0130 plus one status-header pointer line (the form 0130's 2026-09-22 line set), no original text
of 0130 edited; ADR-0048 §3.2's install gate gains a second co-owner source
(D5) — by cross-reference from here, exactly as ADR-0130 D1 amended that gate, ⛔ no text of 0048 edited.
**Cross-references**: ADR-0019 gains one additive `Related` header line; its text is unchanged (ADR-0130 D2's recording
convention, which that record offered as the follow-up should the maintainer want the amendment visible from 0019).
**Consumers**: `@objectstack/spec` (`ManifestSchema.dependencies` in `kernel/manifest.zod.ts`;
`AppCompatibilityCheckSchema` and `AppManifestSchema` in `system/app-install.zod.ts`; `PackageDependencySchema` and
`PackageManifestSchema` in `marketplace/package-version.zod.ts`), `@objectstack/objectql` (`SchemaRegistry.installPackage`
and `refuseCoOwnedObjectNameCollision` in `registry.ts`; the manifest service in `plugin.ts`),
`@objectstack/metadata-protocol` (`installPackage` in `protocol-package-install.ts`; `resolveWritePackageScope` in
`protocol.ts`), `@objectstack/runtime` (`POST /api/v1/packages` and `PATCH /api/v1/packages/:id`, `domains/packages.ts`),
`@objectstack/cloud-connection` (`POST /api/v1/marketplace/install-local`), the `objectui` Console's install refusal
text, `packages/cli` and `packages/lint` (`os package publish`; the `os lint` / `os validate` range rule of D2), and
HotCRM's module split.
**Evidence**: every anchor into this repository was read at `origin/main` `47af3dde42`, the base of this record's branch
(the tree outside `docs/adr/` is identical at the record's head). `objectstack-ai/hotcrm` and `objectstack-ai/cloud` are
not readable from the drafting session; their facts are cited as the rulings and the HotCRM seat cite them and marked
**not re-verified**.

---

## TL;DR

An installable app may depend on another installed app and reference its objects. Nothing new is authored; one gate is
added; one gate learns a second source of co-owners:

1. **Declaration** is the `dependencies` key every manifest already has — `{ "PACKAGE_ID": "SEMVER_RANGE" }`.
2. **Reference** is what the runtime save door already admits: a package's own objects, the objects of the packages its
   `dependencies` declare (transitively), platform objects, and tenant objects that belong to no package. An undeclared
   cross-app reference is refused there today, `422`, with "declare a dependency" as the fix.
3. **The one new gate is a pre-install check.** Installing a package judges every declared dependency — installed in the
   target environment at a version inside the declared range, or delivered by the same artifact (presence only: the
   artifact is one tested unit) — and otherwise refuses the whole install, before anything registers, with a message
   naming what is missing (the ruling's example: 「请先安装 HotCRM 6.x」). It fills the `dependency_missing` category
   `AppCompatibilityCheckSchema` has reserved with no producer. The range grammar it reads is stated by the runtime
   card, and the author's tooling reports an unreadable range before install.
4. **A package that declares a dependency on an installed package X and uses X's namespace co-owns that namespace with
   X at the install gate — and with X's other declared dependents that use it (siblings under one declared parent).**
   One-way: X declares nothing and gains nothing. ADR-0130 D3's per-object-name uniqueness check spans these co-owners
   across artifacts exactly as it spans co-owners inside one artifact. Two conditions make it hold: every package of X's
   own artifact that shares the namespace declares X too, and a boot re-registers each hydrate path's packages in
   dependency order through the one sorter.
5. **Deferred, by name, with a trigger each**: uninstall protection, upgrade interception, topological / cascade install,
   an owner-side publish marker, marketplace version negotiation, and judging a post-install edit of `dependencies`.
   **Permissions are unchanged**; record-level semantics across a dependency are an open section, decided with the first
   consumer.

The first consumer is a HotCRM module shipping on its own, revenue first.

---

## Context

### 1. What the platform does today (measured at `47af3dde42`)

**The declaration exists and is editable after install.** `ManifestSchema.dependencies` is
`z.record(z.string(), z.string()).optional()`, documented as "Map of package IDs to version requirements" with an
npm-style example (`packages/spec/src/kernel/manifest.zod.ts#ManifestSchema`). `PATCH /api/v1/packages/:id` edits it on
an installed package and validates its shape by reference to that very schema — nothing else: its own comment says
⛔ No in-use check is made (`packages/runtime/src/domains/packages.ts`).

**Reference is already judged against the declared closure — at the runtime save door, nowhere else.**
`resolveWritePackageScope` computes the **transitive** closure of the written package's `manifest.dependencies`
(`packages/metadata-protocol/src/protocol.ts#resolveWritePackageScope`); a declared dependency the registry cannot resolve
stays in the closure and the walk stops there — an absent dependency is not a fault at the save door. A view bound outside
the closure is refused `422`, and the refusal's fix line already reads "declare a dependency on the package that defines
the object" (`packages/lint/src/rule-explanations.ts#LIST_VIEW_OBJECT_OUTSIDE_CLOSURE_EXPLANATION`). The same text records
the boundary of that judgement: `os validate`, `os build` and `os lint` "judge neither: a stack there is one app, and an
unresolved binding may be a dependency package's object the stack does not carry". What `defineStack` does say about a
reference across packages is measured in ADR-0130 §1.5 and pinned in `packages/spec/src/stack.zod.ts`: a lookup or
master-detail to an object the stack does not carry is admitted; a hook on such an object, and a package's own
`app.navigation` pointing at one, are refused — "navigation crosses only through contributions, and the split must
follow hook ownership".

**At install, `manifest.dependencies` has exactly one reader, and it orders — it never checks.** The dispatch for this
record assumed nothing at install reads the key; the measurement corrects that by one reader.
`resolveArtifactPackageEntries` (`packages/core/src/artifact-packages.ts#resolveArtifactPackageEntries`) hands every
declared id to `resolvePluginOrder` as an **optional** edge, so the packages of one artifact register in dependency
order (ADR-0130 D5) and a declared id that is not in the artifact "is simply not an edge here" — skipped silently, by
design (its module header says why). No install door asks whether a declared dependency is installed, or at what version.
`dependency_missing` is an enum value of `packages/spec/src/system/app-install.zod.ts#AppCompatibilityCheckSchema`; across
the tracked tree it occurs in that schema, its test and the generated reference page
(`content/docs/references/system/app-install.mdx`) — zero producers.
`packages/core/src/dependency-resolver.ts#SemanticVersionManager` is written for kernel plugins, not installed packages,
and has no caller in `packages/` outside its own file and test; the handshake's
`packages/metadata-core/src/protocol-handshake.ts#rangeAdmitsMajor` reads `engines.protocol` at major granularity.

**The namespace gate admits co-owners from one source only, and the uniqueness check follows that set.**
`SchemaRegistry.installPackage` (`packages/objectql/src/registry.ts#installPackage`) builds its co-owner set from the
artifact scope the load path passes (`ArtifactInstallScope.packageIds` — the artifact's own package list, built by the
manifest service in `packages/objectql/src/plugin.ts` and handed through `packages/objectql/src/engine.ts#registerApp`),
and refuses a package whose non-shareable namespace an installed non-co-owner owns —
`packages/objectql/src/registry.ts#NamespaceConflictError`, `422 NAMESPACE_CONFLICT` (downgraded to a warning only under
`OS_METADATA_COLLISION=warn`). Its other half, `packages/objectql/src/registry.ts#refuseCoOwnedObjectNameCollision`,
refuses two co-owners defining one object name (`ArtifactObjectNameConflictError`, `DUPLICATE_ARTIFACT_OBJECT_NAME`),
returns early when the co-owner set is empty, and deliberately skips a sitting owner that is **not** a co-owner — "a
cross-artifact claim, which the namespace gate above owns and refuses". The two halves read one set; whoever joins that set
is judged by both. So today a module published as its own artifact with HotCRM's namespace `crm` is refused beside an
installed HotCRM whatever it declares — the HotCRM seat's input 1, confirmed.

**Three schemas spell a dependency, in three shapes** — the alignment D8 records:

| Carrier | Shape | Readers at `47af3dde42` |
|:---|:---|:---|
| `ManifestSchema.dependencies` (`packages/spec/src/kernel/manifest.zod.ts#ManifestSchema`) | record `{ [packageId]: versionRange }`, optional | the save-door closure; the intra-artifact sort; the package door's edit |
| `PackageManifestSchema.dependencies` (`packages/spec/src/marketplace/package-version.zod.ts#PackageManifestSchema`), entries `#PackageDependencySchema` | array of `{ packageId, versionRange, optional = false }`, default `[]` | none outside `packages/spec` in this repository |
| `AppManifestSchema.dependencies` (`packages/spec/src/system/app-install.zod.ts#AppManifestSchema`) | array of bare ids, no range, default `[]` | none outside `packages/spec` |

`os package publish` snapshots the compiled artifact into `sys_package_version.manifest_json`
(`packages/cli/src/commands/package/publish.ts`, its header's step 2), so a snapshot carries the record shape where
`PackageManifestSchema` declares an array. Whether the control plane parses that snapshot against the array schema lives in
`objectstack-ai/cloud` — **not measured** here.

**In-repo declaring population**: one manifest — `examples/app-multi-package/src/packages/orders/index.ts` declares
`dependencies: { 'com.example.multi.core': '^1.0.0' }` on the package delivered beside it in the same artifact; each of the
two packages declares its own `version: '1.0.0'` (`examples/app-multi-package/src/packages/core/index.ts`), and
`composeStacks(…, { manifest: 'preserve' })` (`packages/spec/src/stack.zod.ts#composeStacks`) carries each manifest into
the artifact as authored. HotCRM's manifests are **not measured** (the seat's input says every one declares
`namespace: 'crm'`).

### 2. Why now, and for whom

ADR-0130 lets one product carry N packages inside one artifact, installed whole, and D6 records both the gain (no version
matrix) and the cost (no per-module hot-fix) — with one escape hatch: a module that must ship on its own cadence becomes
its own artifact, "at which point it needs the owner field D8 defers, and D8's deferral ends". The maintainer's rulings
take that escape hatch for real — 「如果这样，hotcrm 岂不是真实的可以分拆出很多模块」「而每个包可以独立安装」 — and
without the field: three things are missing for it, and this record supplies the first and third and defers the second:
a check that the depended-on app is there (D2), a namespace gate that admits the module (D5), and a written record of
what is deliberately left for later (D3). The HotCRM seat's two module cards frame the sequence: hotcrm#2270 packages
revenue and marketing inside the one artifact now; hotcrm#2271 ships revenue on its own once the check is released (both
**not re-verified**, cited from comment `6370024454`).

The maintainer's first line on the card — 「如果按照包依赖的方式，整个开发会复杂很多」 — is why B′ is narrow. Every
mechanism beyond the declaration and one check is a permanent obligation; the card's own fourth axis counted four. This
record takes one and names the others as D3's deferred items, each with the trigger that would justify it.

---

## Decision

### D1 — Declaration and reference: no new mechanism

An app — any installable package — declares what it depends on in `ManifestSchema.dependencies`, unchanged:
`{ "PACKAGE_ID": "SEMVER_RANGE" }`. **A dependency opens the reference.** What a dependent may reference is what the
platform already admits for a declared package: the runtime save door judges a write against the transitive closure
described in Context §1, and `defineStack` keeps admitting a lookup or master-detail to an object the stack does not
carry while refusing a hook on it and a package's own navigation to it (ADR-0130 §1.5). Nothing else decides whether a
cross-app reference is legal.

⛔ No owner-side "published object" flag, no export list, no second reference mechanism (the ruling's own words: the
closure "already honours the declared packages' objects"). An undeclared cross-app reference is refused where it is
refused today — at the save door, `422` — and the fix it prints is the declaration. `os validate`, `os build` and
`os lint` keep judging neither side of a cross-package binding: a stack there is one app and cannot see its dependencies'
objects.

### D2 — The pre-install check: installed and in range, or a clear refusal — and only that gate

**What it judges.** For an install that delivers package P, every entry `(id, range)` of `P.manifest.dependencies` is
satisfied when both hold:

1. **Present.** The registry holds an installed package record for `id` (`SchemaRegistry.getPackage`), or `id` names a
   package delivered by the **same artifact** as P. The second arm is what keeps every ADR-0130 artifact installable:
   the check judges the whole artifact before any of it registers (below), so a dependency the same act delivers is not
   yet "installed" at that moment, and refusing it would refuse `examples/app-multi-package` and every product split under
   ADR-0130. It mirrors the one reader the key already has at install: inside the artifact a declared id is an edge,
   outside it is a question for this check.
2. **In range — for an installed record.** The record's `manifest.version` satisfies `range`, read in the npm semver
   range grammar `ManifestSchema.dependencies` already documents and `engines.protocol` already uses. A dependency the
   same artifact delivers is judged for **presence only**: the packages of one artifact each carry their own
   `manifest.version` (Context §1 — `core` and `orders` both declare `1.0.0`, and `composeStacks` keeps each as
   authored), so an artifact that bumps its core to `2.0.0` while a module still declares `^1.0.0` would be refused by
   the platform over a unit its publisher built, versioned and tested as one (ADR-0130 D6). D2 says nothing about such
   an entry — not a warning either: both packages sit in front of `os lint`, which is where an in-artifact range
   mismatch is reported (the author-side rule below), and an install is not where an author first hears of it. A
   version or range the reader cannot parse does **not** satisfy; the refusal says which side was unreadable. Fail
   closed: an unread bound is not a bound — deliberately the opposite of the protocol handshake beside it, which admits
   an unrecognised `engines.protocol` range with a warning (merge question 6 says why).

Every record entry is required: the record shape has no optional arm (D8 says how the marketplace shape's `optional`
projects). Only P's **own** entries are judged — a dependency's dependencies were judged when it was installed.
Enablement (`InstalledPackageSchema.enabled`) is not judged: presence and version are the declared facts; what a disabled
dependency means for a dependent is an open item for the card (Open items 4).

**What it answers.** One unsatisfied entry refuses the **whole install** — nothing is registered, written or persisted —
with the ADR-0112 envelope: `status` **422**, the status the sibling refusal at the same gate (`NAMESPACE_CONFLICT`)
answers for an environment-state conflict; a `code` the card registers in the ADR-0112 D3 ledger; and one
`AppCompatibilityCheck` issue per unsatisfied entry — `severity: 'error'`, `category: 'dependency_missing'`, and a
`message` naming the dependency, the declared range and what was found (absent, or installed at version V). Every
unsatisfied entry is reported in that one answer, never the first alone. The Console renders it in the author's terms
(「请先安装 HotCRM 6.x」); the text is the runtime card's, with the refusal's facts fixed here.

**Where it runs — the install acts.** Three doors install a package into an environment, and each already refuses before
it registers anything (ADR-0087 D1's protocol handshake, `packages/metadata-core/src/protocol-handshake.ts#assertProtocolCompat`,
sits at each). The check sits beside that handshake:

- the protocol primitive `packages/metadata-protocol/src/protocol-package-install.ts#installPackage`, which
  `POST /api/v1/packages` calls when the protocol service resolves and which `duplicatePackage` and the base-package
  path call in-process;
- the bare-registry fallback of `POST /api/v1/packages` when no protocol service resolves (`packages/runtime/src/domains/packages.ts`);
- `POST /api/v1/marketplace/install-local` (`packages/cloud-connection/src/marketplace-install-local-plugin.ts`), before it
  hands the artifact to the manifest service — the same placement the picklist and bound-action seals already use in
  `packages/objectql/src/plugin.ts`: "a refused install registers nothing".

One predicate serves every door; ⛔ no door carries its own copy.

**The range reader, and the grammar it must state.** No package under `packages/` carries a semver library (the root
`semver` is a devDependency nothing there imports), and the tree's three range readers each lack something D2 needs.
`packages/metadata-core/src/protocol-handshake.ts#rangeAdmitsMajor` (with `alternativeAdmitsMajor`) already reads the
documented grammar — `*`, `x`, `latest`, `^`, `~`, `N.x` / `N.*`, `||` unions, space- or comma-joined comparator
intersections, hyphen ranges, bare versions — but answers at **major granularity** only: `^6.2.0` against an installed
`6.1.0` answers true, which D2 cannot accept. `packages/metadata-core/src/artifact-forward-conversion.ts#parseRangeFloor`,
the same school by its own docstring, computes only a lower bound. `packages/core/src/dependency-resolver.ts#SemanticVersionManager`
compares full versions but reads a narrower grammar — `*`, `latest`, an exact version, one `^` `~` `>=` `>` `<=` `<`
operator, `a - b`; `6.x`, an intersection or a `||` union answers `false` or throws, and its `parse` wants three numeric
parts, so `^6` throws — and has no caller in `packages/` outside its own file and test (re-exported by
`@objectstack/core`'s index; "resolves kernel plugins" is its header's claim, not a measured caller). Two things follow.
The runtime card gives **one** reader both properties — the handshake family's grammar and exact-version granularity —
and **states the grammar the check supports**: at least `^`, `~`, `>=`, an `x` wildcard, `||` and the space intersection,
so the ruling's own 「HotCRM 6.x」 is readable. The drafter's choice is to extend the handshake family in
`packages/metadata-core`, on which every install door already depends and beside whose `assertProtocolCompat` the check
sits; ⛔ never a fourth reader. And the author side catches an unreadable `dependencies` range **before** install: an
`os lint` / `os validate` rule beside the `engines.protocol` reading `os validate` already performs
(`packages/cli/src/utils/protocol-version-gap.ts#checkProtocolVersionGap`) reports a range outside the stated grammar
and, inside one artifact, a co-delivered entry whose range the sibling's declared version does not satisfy. Fail-closed
at install is the backstop, not the place an author learns the grammar.

**Where it does not run — re-registration.** A boot re-registers what an environment already holds: code-composed
packages through the manifest service at `init`/`start`, the `sys_packages` rehydrate (`packages/services/service-package/src/index.ts`),
and the install-local plugin's cached-manifest rehydrate on `kernel:ready`. None is an install act, and a boot fills the
registry incrementally — a code package rehydrated at `start` would read a marketplace dependency that arrives at
`kernel:ready` as absent. Concluding "dependency X is not installed" there and refusing on it is the verdict AGENTS.md's
*Startup registry reads* section names as a defect. What an install admitted stays admitted; a dependent whose dependency
has since gone is D3's uninstall-protection item, not a boot refusal. The order a boot registers in is D5's requirement,
because the namespace gate does run there.

**Nor the manifest edit.** `PATCH /api/v1/packages/:id` rewrites a stored `dependencies` whole after install, by
reference to `ManifestSchema.shape.dependencies` and with ⛔ no in-use check (Context §1); it reaches only authored
packages, since `requireWritablePackage(…, 'edit')` answers `422 WRITABLE_PACKAGE_REQUIRED` for a package provided by
code or an installed app (ADR-0070 D2). It is not an install act, and D2 does not run there: an entry added or changed
by that door is judged when P is next installed, and an entry deleted there — D5's proof of co-ownership — is missed at
the next related registration. Both are D3's last item, deferred by name (merge question 11).

### D3 — Deferred, by name, not implemented now

Each item is a decision **not** to build yet, recorded so the next author finds a reason instead of an absence. None is
rejected; each has a trigger. Meanwhile the ADR-0029 refusal stands unchanged (a package whose object another package
`extend`s cannot be uninstalled — `packages/objectql/src/registry.ts#uninstallPackage` through `unregisterObjectsByPackage`),
and it is the only refusal that reads another package's relation to the one being removed; the install-local `DELETE`
door's own refusals (ADR-0131 D12's wall, a request it cannot serve) read the deployment's posture and the request, not
another package.

| Deferred item | What happens meanwhile | Trigger to build it |
|:---|:---|:---|
| **Uninstall protection** — refusing to uninstall a package another installed package depends on | The uninstall proceeds; the dependent's lookups dangle. Only ADR-0029's extender refusal stands | A first customer uninstall that strands a dependent |
| **Upgrade interception** — refusing an install-overwrite of X that would leave a dependent's declared range | The upgrade proceeds; no dependent's range is re-judged (same-package reinstall is exempt at the gate today) | A first dependent broken by an upgrade of what it depends on |
| **Topological / cascade install** — installing a set across artifacts in dependency order, or pulling a missing dependency in | The administrator installs dependencies first; D2's refusal names which. Inside one artifact ADR-0130 D5's sort is unchanged | More than one level of standalone modules in a real product |
| **Owner-side publish marker** — X restricting which of its objects a dependent may reference | Every object of X is referenceable by a declared dependent, under D4 | A third-party dependent on a first-party app — marketplace publishing, D5's end point for ADR-0130 D8 |
| **Marketplace version negotiation** — choosing versions of X and P that satisfy each other | None; D2 judges the installed version against the declared range, once | Listings carrying more than one installable version of a depended-on app |
| **Judging a post-install edit** — running D2's predicate on a `PATCH /api/v1/packages/:id` that adds, changes or deletes a `dependencies` entry (a fourth door) | The edit is applied as given — that door's standing disposition, ⛔ no in-use check. The door reaches only **authored** packages (`422 WRITABLE_PACKAGE_REQUIRED` for a package provided by code or an installed app, ADR-0070 D2), so a marketplace-installed module cannot be edited there at all. An added entry is unjudged until P is next installed, and the save door keeps admitting an absent dependency as it does today. A deleted entry removes D5's proof of co-ownership: the next related registration — an upgrade of X, a reinstall of P, a boot — is refused at the namespace gate naming the other package | A stored declaration found unsatisfied or missing after an edit, or the Console offering the edit to authors |

### D4 — Permissions unchanged; record-level semantics are an open section

A dependency opens the **reference**, not the **data**. A referencing app's users see the referenced app's records under
the referenced app's own permission sets and sharing rules; a lookup from P to an object of X confers no read on X's
records. Each package ships its own permission sets (ADR-0086 D4) and nothing composes into another package's set — the
answer #14488's closing ruling already gives a module carved out as its own artifact (D6 below).

**Open section — decided with the first consumer, not here.** Three questions, measured on HotCRM's revenue module
against the existing record-access path before its runtime card is cut:

1. What a user who may read P's record but not the referenced record of X sees in the lookup — the referenced id, a
   redacted label, or nothing — and whether P's lists, reports and search may filter through X's records the user cannot
   read.
2. Whether a dependent's **own** permission set may grant on a dependency's objects. ADR-0086 D4's conflict-freedom rests
   on "each set only grants `objects.<own-namespace>_*` keys" — one namespace per package; D5 lets two artifacts share a
   namespace, so that discriminator is gone across artifacts as ADR-0130's 2026-09-02 addendum already found it gone
   inside one. Nothing in this repository was measured to refuse a package's set naming another package's object; the
   card measures before it decides.
3. Whether anything at install or boot must change for the referenced app's sharing rules to apply to a dependent's
   lookups as they apply to its own — the ruling's "a dependency opens the reference, not the data" is the invariant; the
   card finds the seam.

### D5 — A declared dependency is namespace co-ownership, one-way

**The relation.** Installed packages P and X are *dependency-declared co-owners* of namespace N when P declares X in
`manifest.dependencies`, N is P's namespace, N is X's namespace, and N is not a shareable platform namespace
(`packages/objectql/src/registry.ts#isShareableNamespace`). **Siblings join it**: an installed package S is also P's
co-owner of N when S and P each directly declare one installed package Q whose namespace is N — two modules under one
declared parent. At the install gate, this relation is a second source of the co-owner set ADR-0130 D1 introduced,
beside the artifact scope. Nothing else changes:

- **One-way.** Only the dependent declares. X declares no dependency on its modules and gains nothing on P's side; P
  gains admission to the shared namespace and nothing on X's side, and a sibling gains the same admission beside P. The
  in-tenant trust behind the admission is the administrator's choice to install P beside X — the same trust that admits
  any package into an environment.
- **The D3 pair holds across artifacts.** ADR-0130 D3 made the namespace relaxation and the per-object-name uniqueness
  check one change, and the registry reads one co-owner set for both halves; a co-owner by declaration — parent or
  sibling — is therefore judged by both. A dependent defining an object name X already owns, or a sibling defining a
  name the other sibling owns, is refused at install, ahead of any DDL, with the error
  `refuseCoOwnedObjectNameCollision` already raises for co-owners inside one artifact — `code` and `status` asserted, as
  ADR-0130 D3's gate test requires. The code stays `DUPLICATE_ARTIFACT_OBJECT_NAME`; the message, which today reads
  "Object name conflict inside one release artifact … delivered by the same artifact"
  (`packages/objectql/src/registry.ts#ArtifactObjectNameConflictError`), is worded per co-ownership source — same
  artifact, declared dependency, sibling — so a cross-artifact refusal never claims one artifact.
- **No new manifest field.** The proof is the declaration plus the install act. ADR-0130 D8 stands: no owner or publisher
  field on `ManifestSchema`.
- **Direct declarations only.** The relation reads P's own `dependencies` and, for the sibling arm, S's own — never the
  transitive closure the save door walks. The sibling arm exists because the direct reading alone breaks the second
  module: revenue and marketing both declare sales, both use `crm`, and neither depends on the other; when marketing
  installs second the sitting owners of `crm` are {sales, revenue}, marketing declares no revenue, and the gate refuses.
  The only cure without the arm is to declare revenue, which D2 then requires installed first — modules stop being
  independently installable from the second one on, and 「每个包可以独立安装」 is lost; the closure does not reach revenue
  from marketing either. A sitting owner that is neither declared nor a sibling still meets `NamespaceConflictError`
  naming it, and the fix is the declaration. Narrower is the reversible direction.
- **Read from either end.** The relation is declared by P alone, and the gate reads it whichever of the pair arrives
  second: on P's registration the sitting owner X is P's co-owner because P declares X; on X's registration a sitting
  owner that declares X is X's co-owner for the namespace gate and the uniqueness check alike; a sibling is recognised
  whichever sibling registers second, each reading the other's declaration of Q. This is recognition of one declared
  fact, not a right X acquires — X still declares nothing — and it is not optional:
  `packages/objectql/src/registry.ts#installPackage` refuses when any sitting owner of the namespace is neither the
  installing package nor in the co-owner set (`getNamespaceOwners(...).find(owner => owner !== manifest.id &&
  !coOwners.has(owner))`), and once revenue is installed it *is* a sitting owner of `crm`. The next upgrade or reinstall
  of HotCRM arrives second; read from P's side alone, HotCRM itself is refused `NAMESPACE_CONFLICT`, so HotCRM could
  never be upgraded once a module is installed. Boot order is the second reason: a rehydrate that registers P before X
  would refuse the depended-on app the same way. One consequence comes free: on such an upgrade the uniqueness check
  judges X against its co-owner P, so an upgrade of HotCRM that newly defines a `crm_*` name revenue already owns is
  refused naming revenue — a small upgrade guard D3's interception item does not otherwise give, and the Console's
  refusal text must say which module holds the name.
- **The depended-on app's companions must declare it.** The gate refuses any sitting owner outside the co-owner set, and
  after install the registry does not record which artifact a package came from: `InstalledPackageSchema` carries
  `manifest` and `source`, no artifact (`packages/spec/src/kernel/package-registry.zod.ts#InstalledPackageSchema`), and
  the manifest service's scope is "nothing persisted — the claim cannot outlive … the artifact that IS the claim"
  (`packages/objectql/src/plugin.ts`). So the platform cannot infer that service is sales' companion. HotCRM's artifact
  holds more than one `crm` package — sales and service at least (seat input `6370024454`), marketing inside it per
  hotcrm#2270 — and two cases fail without a declaration: a standalone revenue declaring only sales meets service as a
  sitting owner of `crm` and is refused naming service; a later HotCRM upgrade re-registers service, which neither
  declares revenue nor is declared by it, and the upgrade is refused naming revenue. **Precondition**: every package of
  X's artifact that shares N with a module directly declares X (or the module declares each such package). Then the
  sibling arm admits both ways — service and revenue both declare sales, which holds `crm`. Inside the artifact the
  declaration costs nothing: D2's second arm judges it for presence only, and it gives ADR-0130 D5's sort a real edge
  (service after sales) where today there is a tie. Not verified in HotCRM — Open items 7, the HotCRM lane's reading
  before hotcrm#2271 ships.
- **Hydrate order is a requirement, not a reading.** A boot registers in whatever order its source lists: the
  `sys_packages` hydrate iterates `packageService.list()` and, when `installPackage` throws, logs that the package "was
  NOT hydrated into the registry" and leaves it absent for the process lifetime
  (`packages/services/service-package/src/index.ts`); the install-local plugin's `kernel:ready` rehydrate registers its
  ledger entries in `readdirSync` order (`packages/cloud-connection/src/local-manifest-source.ts#list`,
  `packages/cloud-connection/src/marketplace-install-local-plugin.ts`). Two siblings hydrated before their parent Q meet
  the gate with Q's namespace unreadable; the second is refused and never recovered — the recorded verdict AGENTS.md's
  *Startup registry reads* section names as a defect. The same order breaks the two `kernel:ready` seals in
  `packages/objectql/src/plugin.ts` (`picklistVocabularySealed`, `boundActionTargetsSealed`): once sealed, an arriving
  artifact must bind its actions and picklists to an object the registry holds or it declares, so a standalone revenue
  whose action targets a HotCRM object is refused if its ledger entry is read before HotCRM's. **Decided**: both hydrate
  paths order their batch by `manifest.dependencies` through `resolvePluginOrder`, declared ids as optional edges —
  ADR-0116's one sorter, the reading `packages/core/src/artifact-packages.ts#resolveArtifactPackageEntries` already gives
  the key inside an artifact — before registering any of it; an id absent from the batch is not an edge. The sibling arm
  keeps reading Q's namespace from Q's record; ⛔ not a reading that admits a sibling without Q, which would let any two
  packages sharing a utility dependency co-own a namespace (merge question 12). What a sort inside each path cannot
  order — a dependent on one of D2's three paths whose parent hydrates on a later one — is Open items 2.

**ADR-0130 D8's deferral now ends at marketplace publishing**, not at a module's first standalone artifact. Within one
tenant, D5 proves co-ownership without an owner field. Across vendors — the moment a module is published to the
marketplace and must assert "I have the same publisher as HotCRM" — the owner / publisher field lands, aligned to the
`publisherOrgId` reservation of ADR-0048's 2026-08-08 addendum (still Proposed; its A.5 precondition is the opening of
third-party publishing). That field is the later superset of D5 (letter B of ruling `6377678758`) and needs no undo of
it. Renaming a module's objects to dodge the gate stays refused (ADR-0129; letter C of the same ruling, and ADR-0048
§3.5's standing non-goal).

### D6 — What ADR-0028, ADR-0019 and ADR-0130 now say

- **ADR-0028 D4** (Deferred; proposed 2026-06-01) proposed full isolation: *"Apps are sandboxed: no cross-app
  references"* — an app *"may not reference metadata owned by another app"*. Its sentence is rewritten to **"No cross-app
  reference without a declared dependency"**: an app reaches its own metadata, the kernel, and the metadata of the apps
  its manifest declares in `dependencies`; every other cross-app reference is refused. The isolation D4 wanted between
  marketplace apps is kept by the closed set. The three sentences in 0028 that restate D4 (TL;DR item 4, D6's author-time
  bullet, leak-point 3) follow it; the rest of ADR-0028 stays Deferred and untouched, and D4 carries a note quoting its
  original sentence.
- **ADR-0019** keeps its text verbatim. Its header gains one additive `Related` line naming this record as the gated
  decision its "Shared/published data model + inter-App dependencies" bullet asked for, taken for the dependency half.
  The shared data model half (a platform-owned customer / supplier model — letter C on #25403) was not chosen and stays
  out of scope.
- **ADR-0130** gains a status-header pointer line (the form its 2026-09-22 line set) and an addendum, no original text
  edited, recording two things. First, D8's deferral now ends at marketplace publishing (D5 above). Second, the
  2026-09-02 addendum's *What was NOT decided* line listing
  [#14488](https://github.com/objectstack-ai/objectstack/issues/14488) as "filed, not decided" is stale: #14488 was closed
  `not_planned` on 2026-09-12 by ruling
  [`5645322259`](https://github.com/objectstack-ai/objectstack/issues/14488#issuecomment-5645322259) — an artifact installs
  whole, the app package's sets cover every module's objects, nothing composes grants into another package's set, and a
  module carved out as its own artifact ships its own permission sets under ADR-0086 D4; the card is not reopened for
  that case. That ruling's premise sentence — 「目前的要求是发布物是完整安装的，没有设计单独安装其中 一个模块的需求。」 —
  has two halves. The first, an artifact installs whole, is **unchanged**: ADR-0130 D2 stands, and a module shipped on
  its own is another artifact, not a partial install of the first. The second, that no requirement to install one module
  alone existed, names the need B′ (「而每个包可以独立安装」) now states — met by another artifact, the carve-out path
  the ruling itself named, never by a partial install. The ruling's disposition is unchanged and is what D4 above relies
  on: a standalone module's permission sets are the module author's work, not a platform blocker.

### D7 — The first consumer: a HotCRM module shipping on its own, revenue first

The scenario this record is accepted against is HotCRM's module split as its `docs/architecture/module-split-plan.md`
records it — the 2026-09-14 shape: the sales app plus service, revenue and marketing modules (**not re-verified**). The
revenue module ships as its own artifact whose consumer-installable package is **`type: 'app'`** — only that type
installs for a consumer (`packages/spec/src/kernel/plugin.zod.ts#isConsumerInstallable`, ADR-0019 D2); inside the
combined artifact it is an internal-contribution type under ADR-0130 D2, so the carve-out changes its `type` (the HotCRM
side **not re-verified**). It declares `dependencies: { "HOTCRM_SALES_PACKAGE_ID": "HOTCRM_MAJOR_RANGE" }`, keeps
`namespace: 'crm'` and its `crm_*` object names, and installs beside an installed HotCRM. On an environment without
HotCRM, or with HotCRM outside the declared range, D2 refuses it naming HotCRM and the range; beside HotCRM, D5 admits it
to `crm` and the uniqueness check refuses any `crm_*` name HotCRM already owns; marketing, shipped the same way, is
admitted as revenue's sibling. Under ADR-0019 the standalone module is therefore an App in its own right — installed,
opened and uninstalled as one (D1, D4) — and D4's "set of namespaces" gains a namespace two Apps hold, which the
registry's `Map<namespace, Set<packageId>>` already represents: uninstalling the module releases its own ownership and
objects, not the namespace HotCRM still owns.

Three HotCRM-side preconditions, each **not re-verified** and each the HotCRM lane's to confirm before hotcrm#2271 ships:

- **Companions declare the app.** Every `crm` package left in HotCRM's artifact — service, marketing — directly
  declares sales (D5's precondition). Without it, revenue's install is refused at the namespace gate naming the
  undeclared package, and so is HotCRM's next upgrade, naming revenue.
- **Hooks follow ownership.** `defineStack` refuses a hook on an object the stack does not carry (ADR-0130 §1.5,
  `packages/spec/src/stack.zod.ts`), so the carved-out revenue cannot carry a hook on a sales-owned object; a hook that
  must stay crosses only by staying in the package that owns the object.
- **Permission sets move with the objects.** Today the sales app's sets cover every module's objects (ruling
  `5645322259`); after the carve-out the grants on revenue's objects ship in revenue's artifact, since nothing composes
  into another package's set (ADR-0086 D4). D4's open question 2 covers only the reverse direction — a dependent's own
  set granting on a dependency's objects.

Until the runtime card ships, composite products keep shipping as one artifact under ADR-0130. That is the state
hotcrm#2270 packages revenue and marketing in; hotcrm#2271 moves revenue to its own artifact once the check is released.

### D8 — The dependency shapes, and the alignment the runtime card owes

The authored source of truth is the **manifest record**, `ManifestSchema.dependencies`. D2 reads it, the save-door
closure reads it, D5 reads it. ⛔ No spec shape changes in this record.

The marketplace snapshot's array — `PackageManifestSchema.dependencies` of `PackageDependencySchema` — is a **projection**
of that record, one entry per key: `packageId` = the key, `versionRange` = the value, `optional` = `false` (the record
has no optional arm, and D2 treats every entry as required). Three things are owed — the first on its own card, the
other two on the runtime card:

1. **One conversion** from record to array, used by every writer of a snapshot, so a snapshot conforms to its declared
   schema instead of carrying the record shape it carries today (`publish.ts` uploads the compiled artifact as it is).
   **Its own card** (merge question 9), whose first step reads how the control plane parses
   `sys_package_version.manifest_json` — in `objectstack-ai/cloud`, not readable here — because changing the snapshot's
   shape before that reading could break the very reader it is meant to satisfy. Until that card lands, snapshots keep
   carrying the record shape, as today: no new harm, and D2 reads the manifest record, never the snapshot.
2. **A stated fate for `optional`.** An `optional: true` entry has no record spelling. Until one is decided, a snapshot
   never produces it and D2 never reads it.
3. **A stated fate for `AppManifestSchema.dependencies`** (bare ids, no range, no reader outside `packages/spec`): either
   it projects from the record (ids only, losing the range) or it retires through the ADR-0087 conversion layer. The card
   decides with a measured reader count; this record decides neither.

The resolver-side `ResolvedPackageDependencySchema` (`@objectstack/spec/kernel`) is unaffected: it is a resolution outcome,
not a declaration, and `PackageDependencySchema`'s own header already tells the two apart.

---

## Consequences

**Positive**
- A customer installs CRM now and PSA — or a HotCRM module — later, without the module having been shipped to every CRM
  customer and without swapping to a combined app: 「每个包可以独立安装」.
- One rule replaces several special cases. Inside an artifact (ADR-0130), at the save door (the closure), and across apps
  (this record), a cross-package reference is legal exactly when it is declared.
- An AI author's undeclared reference stays a loud `422` at the save door, and a missing dependency becomes a loud refusal
  at install, instead of copied objects that drift silently.
- The work is small and stays small: no new authorable key, no schema change, one predicate at three doors, one more
  source for one co-owner set (read two ways: a declared parent, a shared declared parent), one author-side lint rule,
  and the one sorter applied inside two hydrate loops.
- Two modules of one app install in either order and need not declare each other (the sibling arm), and an upgrade of
  the app that would take a module's object name is refused for free (D5).

**Negative / costs, stated plainly**
- Uninstalling or upgrading a depended-on app is not guarded (D3), and a `dependencies` entry edited in after install is
  not judged until the next install of that package. An administrator can strand a dependent until those items are
  built; the refusal at install is the only gate, and the refusal's message is the only guidance.
- No reader in the tree has both the documented range grammar and exact-version granularity; the gate needs one before
  the first consumer's range is readable, and until the author-side rule exists an unreadable range is refused at
  install, not reported at build (D2).
- D5 holds for a module only if its app's own companions declare the app (D5, D7) — a HotCRM-side precondition not yet
  verified; without it the module's install and the app's next upgrade are both refused at the namespace gate.
- A standalone module and its app have **separate versions** — the matrix ADR-0130 D6 removed inside one artifact
  returns across artifacts, bounded only by the declared range and judged only at install.
- D5 lets a module share a vendor's namespace on the administrator's say-so. Inside one tenant that is the install choice
  the administrator already makes; across vendors it is not enough, which is why D8's deferral now ends at marketplace
  publishing.
- D4's open section is real work before the first consumer ships: the permission-set discriminator ADR-0086 D4 relied on
  is gone across artifacts.

**Unchanged** — the consumer model (ADR-0019 D1–D4: one app installs, opens, uninstalls — a standalone module is itself
an App), the artifact as a control-plane noun that installs whole (ADR-0130 D2), the one sorter (ADR-0130 D5), one
version per artifact (ADR-0130 D6), permission sets (ADR-0086 D4), the save door's closure rules, the snapshot shape
(D8, until its own card), and the compile-time boundary (`os validate` judges neither side of a cross-artifact binding).

---

## Alternatives considered

The letters as filed on #25403 and on ruling `6377678758`:

1. **Keep apps isolated (#25403 letter A).** Composite products ship as one artifact. Not chosen: every later product is
   either pre-installed on everyone or a swap to a bigger bundle, and cross-app master data travels by import and sync,
   which drifts silently.
2. **The full inter-app dependency (#25403 letter B as filed).** Install ordering, uninstall protection, version
   compatibility, cross-app permission semantics and Console dependency views at once. Narrowed by the maintainer to B′:
   「整个开发会复杂很多」 — the declaration and one check now, the rest as D3's deferred items.
3. **A platform-owned shared master data model (#25403 letter C).** Not chosen: the platform would own a business data
   model and every existing app's objects would migrate. Under this record a "master data app" is an ordinary app others
   depend on.
4. **An owner-side "published objects" list (the director's variant D).** Not chosen: 「往往需要引用的数据并不多，可能就几个对象」
   — the declaration is enough; restricting what a dependent may reference is D3's publish-marker item.
5. **For the namespace — an owner / publisher field now (ruling `6377678758` letter B).** Not chosen now: the later
   superset of D5, aligned to `publisherOrgId`, landing at marketplace publishing without undoing D5.
6. **For the namespace — rename the module's objects (letter C).** Refused: ADR-0129 makes the object name the canonical
   id, and a rename is the deep rewrite ADR-0130 exists to avoid (ADR-0048 §3.5).

---

## Open items (not blocking acceptance; each becomes a reading on its card)

1. **Record-level semantics across a dependency** — D4's three questions, measured on HotCRM's revenue module.
2. **Rehydrate order across paths** — D5 requires each hydrate path to sort its own batch. What the card measures: whether
   a dependent on one of D2's three paths can have its parent on a later one (code packages at `init`/`start`, the
   `sys_packages` hydrate, the install-local ledger at `kernel:ready`), and whether the `kernel:ready` seals in
   `packages/objectql/src/plugin.ts` run before or after the ledger rehydrate on the same hook.
3. **Declared ids that are not installable packages.** The key's own documentation example is an npm-style id. The
   in-repo population is one manifest, co-delivered (Context §1). If an id that names no installable package turns up in
   HotCRM's manifests, the card reports it; D2 does not exempt it.
4. **A disabled dependency.** D2 judges presence and version. Whether `enabled: false` on X should satisfy, refuse, or
   warn for a dependent is measured against what the save door's closure and the data door do with a disabled package
   today.
5. **`optional` and `AppManifestSchema.dependencies`** — D8 items 2 and 3.
6. **The carved-out module's `type`.** D7 states `type: 'app'`. The card confirms the artifact `os build` writes for a
   standalone module carries it, and reads what each install door does today with a top-level package of another type
   (not measured here).
7. **Companion declarations in HotCRM's artifact** — D5's precondition: service and marketing directly declare sales
   (not verified; the HotCRM lane confirms it, with D7's hook and permission-set moves, before hotcrm#2271 ships).

## Open questions for the maintainer's merge decision

These are the points this record decided where the rulings were silent, listed so the merge is an informed act. Merging
accepts them; an objection names the number. Items 1–4, 11 and 12 shape the mechanism; 5–8 shape D2's refusal; 9 is a
sizing decision; 10 is a reading of an earlier ruling.

1. **D2's second arm — a dependency delivered by the same artifact counts as present, and is judged for presence only.**
   Without the arm, judging the whole artifact before anything registers would refuse every ADR-0130 artifact whose
   modules declare their app, and judging per package instead would leave a half-registered artifact behind on refusal.
   Without the presence-only reading, an artifact whose packages carry their own `manifest.version` (as
   `examples/app-multi-package`'s do) would be refused by the platform over a range its publisher built and tested as one
   unit; D2 says nothing about such an entry, and the mismatch is `os lint`'s to report.
2. **D2's placement** — the three install acts only; never boot re-registration, never the manifest edit (11). The cost:
   an environment whose dependency was removed outside an install act boots without complaint (D3's uninstall item).
3. **D5 read from either end** — the gate honours P's declaration on X's registration too. "One-way" is kept for who
   declares and who gains; recognition from X's side is what lets HotCRM be upgraded or reinstalled at all once a module
   sits in `crm` (the gate refuses any sitting owner outside the co-owner set), keeps a rehydrate from refusing HotCRM
   itself, and brings the upgrade guard D5 records.
4. **D5 direct-only, with the sibling arm** — co-ownership follows P's own declarations and those of a sibling under one
   declared parent that holds the namespace, never the transitive closure the save door walks. Without the arm the
   second module of one app is not independently installable; with it there is no new field and no closure walk.
   Narrower is the reversible direction; widening later needs no undo.
5. **D2's status is 422** — the registry gate's family: `NAMESPACE_CONFLICT`, `DUPLICATE_ARTIFACT_OBJECT_NAME`
   (`packages/objectql/src/registry.ts`) and `INVALID_ARTIFACT_PACKAGES` / `INVALID_ARTIFACT_PACKAGE_ENTRY`
   (`packages/core/src/artifact-packages.ts`) all answer 422 for a delivered manifest judged against the environment
   ahead of registration, and D2 is one more such judgement. The same doors also answer 409 — install-local's
   `RESOURCE_CONFLICT` for a namespace a writable base holds and `MANIFEST_CONFLICT` for an id local code defines
   (`packages/cloud-connection/src/marketplace-install-local-plugin.ts`), and ADR-0029's uninstall refusal
   `RESOURCE_CONFLICT` (`packages/objectql/src/registry.ts#PackageUninstallExtendedError`) — for a request that collides
   with an existing resource's state and holds until that resource changes. D2 refuses the manifest as delivered, which
   is the 422 family; the code itself goes to the ADR-0112 D3 ledger on the runtime card.
6. **D2 fails closed on an unparseable version or range, and the grammar is stated** — the opposite of
   `assertProtocolCompat` at the same doors, which admits an unrecognised `engines.protocol` range with a warning so that
   no artifact already in the field is refused by a parser gap. The reason the policies differ: the handshake
   grandfathers a fleet of existing artifacts, while a dependency entry is written today by the dependent's own author
   about one named package (the in-repo population is one manifest), and an unread bound would admit every version — the
   one outcome the check exists to refuse. Because no reader in the tree has both the documented grammar and
   exact-version granularity (`6.x` reads as nothing to `SemanticVersionManager`; `rangeAdmitsMajor` reads it at major
   granularity only), fail-closed is paired with a stated grammar on the runtime card and an author-side rule that
   reports an unreadable range before install — otherwise the ruling's own example would be refused at the gate it was
   written for. The reader to extend is the handshake family in `packages/metadata-core`, not `SemanticVersionManager`,
   which has no caller.
7. **Every record entry is required; the marketplace `optional` arm projects to `false`** — the record shape has no
   optional spelling, and inventing one would be the spec change this record forbids itself.
8. **Only P's own entries are judged** — a dependency's own dependencies were judged when it was installed; judging them
   again would re-run D2 for packages the administrator already admitted.
9. **D8 item 1's record-to-array conversion is its own card**, not the runtime card's — the ruling's sizing (XS–S for the
   check, S for the objectql source) is kept, and the conversion waits on one reading: how the control plane parses
   `sys_package_version.manifest_json` (`objectstack-ai/cloud`, not readable here). Changing the snapshot's shape before
   that reading could break the reader it is meant to satisfy; until then snapshots carry the record shape as they do
   today, no new harm.
10. **The reading of ruling `5645322259`** (D6; ADR-0130's addendum) — its disposition is unchanged; the first half of
    its premise, an artifact installs whole, is unchanged (ADR-0130 D2); the need its second half denied — installing one
    module alone — is now met by another artifact, the carve-out path the ruling itself named, never by a partial
    install. A reconciliation neither ruling on #25403 makes; recorded so a reader of both records does not find them
    contradicting.
11. **The post-install edit of `dependencies` is deferred, not a fourth door** — `PATCH /api/v1/packages/:id` rewrites
    the declaration whole after install with no in-use check, so an entry added there meets D2 only at the package's
    next install, and an entry deleted there removes D5's proof of co-ownership until the next related registration
    refuses. The door is narrower than it looks: it reaches only authored packages (`422 WRITABLE_PACKAGE_REQUIRED` for a
    package provided by code or an installed app, ADR-0070 D2), so no marketplace-installed module meets it. Running D2's
    predicate on that edit is one call at one more door; it is deferred (D3) because B′ named one new gate, and the
    edit's practical case — an author declaring the package whose object the save door just refused — names a package
    that is present. The maintainer may take the fourth door instead; it needs no undo.
12. **Each hydrate path sorts its batch by `manifest.dependencies`** — both boot re-registration paths order their
    entries through `resolvePluginOrder` with declared ids as optional edges before registering any of them, rather
    than giving the sibling arm a reading that admits a sibling without its parent present. The sort is ADR-0116's one
    sorter, already reading this key inside an artifact; the alternative would let any two packages sharing a utility
    dependency co-own a namespace. It also closes the `kernel:ready` seals' order hazard (a module's bound action
    targeting its app's object). Cost: a sort inside two hydrate loops; a dependent whose parent hydrates on a later
    path is the card's residual reading (Open items 2).

---

## Verification notes

- **"Nothing at install reads `manifest.dependencies`"** (the card's premise 6 and the dispatch) holds for checking and
  fails for ordering: `resolveArtifactPackageEntries` reads every declared id as an optional sort edge (Context §1). No
  decision moves — the sort skips an absent id silently, which is exactly why D2 is needed — but the record states the
  reader.
- **"The namespace refusal is `NamespaceConflictError` in `packages/objectql/src/registry.ts`"** holds. The line numbers
  comment `6370024454` and ruling `6377678758` cite have moved since they were written; this record cites the symbols
  (`installPackage`, `NamespaceConflictError`, `refuseCoOwnedObjectNameCollision`), which the anchor gate resolves.
- **"`revenue` first per ADR-0130 §1.3(c)"** (ruling `6369704387`): §1.3(c) names CPQ as the module with no sellable
  unit; it does not order HotCRM's modules. Revenue first is HotCRM's own ordering (module-split plan, hotcrm#2271);
  §1.3(c) is the general consequence both serve. No decision moves.
- **#14488.** Closed `not_planned` 2026-09-12 by ruling `5645322259`, as the HotCRM seat's input 2 says. Of its premise
  sentence, the first half — an artifact installs whole — is unchanged; the need the second half denied is now met by
  another artifact, the carve-out path the ruling itself named; its disposition stands (D6).
- **ADR numbering.** `0136` and `0140` were taken by proposals that never landed — PR #18480 (closed 2026-09-18,
  superseded by the North Star) and PR #25618 (withdrawn 2026-10-24 by the maintainer's ruling in session) — and are not
  reused; no landed record or open pull request carries either number, and no open pull request carries a new record.
  This record is `0141`.

---

## Execution plan (after acceptance)

1. **Runtime card (XS–S, `domain:services` / objectql), one PR**: D2's predicate at the three install doors, with the
   `dependency_missing` issues, the ledger-registered code, the range reader (the handshake family in
   `packages/metadata-core` extended to exact-version granularity, D2) with its stated grammar, and the Console refusal
   text; D5's dependency source for the co-owner set — declared parent and sibling arm, read from either end — with the
   ADR-0130 D3 gate test extended to a cross-artifact pair and a sibling pair (a dependent defining an object name X
   owns, and a sibling defining a name the other sibling owns, are refused, asserting `code` and `status`, the message
   worded per co-ownership source), and the upgrade case (X reinstalled beside its module is admitted; X newly defining a
   name the module owns is refused); the dependency sort in the `sys_packages` and install-local rehydrates through
   `resolvePluginOrder` (D5); D8 items 2 and 3. Its first readings: Open items 2, 3, 4 and 6.
2. **Author-side card (XS, `packages/cli` / `packages/lint`)**: the `os lint` / `os validate` rule that reports a
   `dependencies` range outside the stated grammar and, inside one artifact, a co-delivered entry whose range the
   sibling's declared version does not satisfy (D2). Released with or before (1), so the first refusal an author meets is
   at build.
3. **Snapshot-alignment card (S, `packages/cli`, with a reading in `objectstack-ai/cloud`)**: D8 item 1 — first the
   control-plane reader of `sys_package_version.manifest_json`, then the one record-to-array conversion. Independent of
   (1); snapshots keep the record shape until it lands.
4. **Docs**: the package-authoring guide states how to declare a dependency, the range grammar, what the install refusal
   means, that two modules of one app need not declare each other, and that `os validate` cannot see a dependency's
   objects.
5. **HotCRM** (its own lane): the D4 readings on the revenue module; D7's preconditions — service and marketing declare
   sales (Open items 7), hooks follow ownership, revenue's permission sets travel with it — and the carved-out module's
   `type: 'app'`; hotcrm#2271 ships revenue as its own artifact once (1) is released.

## References

- [#25403](https://github.com/objectstack-ai/objectstack/issues/25403) — the decision card; rulings `6369704387`,
  `6377678758`; HotCRM seat input `6370024454`
- [#14488](https://github.com/objectstack-ai/objectstack/issues/14488) — closed `not_planned`, ruling `5645322259`
- ADR-0019, ADR-0028, ADR-0029, ADR-0048 (and its 2026-08-08 addendum), ADR-0086, ADR-0087, ADR-0112, ADR-0116,
  ADR-0129, ADR-0130
- `packages/spec/src/kernel/manifest.zod.ts`, `packages/spec/src/system/app-install.zod.ts`,
  `packages/spec/src/marketplace/package-version.zod.ts`, `packages/spec/src/kernel/package-registry.zod.ts`,
  `packages/spec/src/kernel/plugin.zod.ts` (`isConsumerInstallable`)
- `packages/objectql/src/registry.ts` (`installPackage`, `refuseCoOwnedObjectNameCollision`, `NamespaceConflictError`,
  `uninstallPackage`), `packages/objectql/src/engine.ts` (`registerApp`), `packages/objectql/src/plugin.ts`
- `packages/metadata-protocol/src/protocol.ts` (`resolveWritePackageScope`),
  `packages/metadata-protocol/src/protocol-package-install.ts`, `packages/metadata-core/src/protocol-handshake.ts`
- `packages/core/src/artifact-packages.ts`, `packages/core/src/plugin-order.ts`,
  `packages/core/src/dependency-resolver.ts`, `packages/metadata-core/src/artifact-forward-conversion.ts`
- `packages/runtime/src/domains/packages.ts`, `packages/cloud-connection/src/marketplace-install-local-plugin.ts`,
  `packages/cloud-connection/src/local-manifest-source.ts`, `packages/services/service-package/src/index.ts`,
  `packages/lint/src/rule-explanations.ts`
  (`list-view-object-outside-closure`), `packages/spec/src/stack.zod.ts` (`composeStacks`),
  `packages/cli/src/utils/protocol-version-gap.ts` (`checkProtocolVersionGap`)
- `examples/app-multi-package/src/packages/orders/index.ts`, `examples/app-multi-package/src/packages/core/index.ts`
- hotcrm `docs/architecture/module-split-plan.md`, hotcrm#2270, hotcrm#2271 (not re-verified)
