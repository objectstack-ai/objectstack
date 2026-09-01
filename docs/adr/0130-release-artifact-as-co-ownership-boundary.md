# ADR-0130: The release artifact is the co-ownership boundary — one artifact, N packages

**Status**: Proposed (2026-09-01) — awaiting the maintainer's hand-merge, which is itself the
acceptance act for a governed surface (Prime Directive #14). ⛔ Nothing below is settled until
this record merges; the implementation cards are cut **from** the merged ADR, never ahead of it.
**Deciders**: ObjectStack maintainer, 2026-09-01, live PM chat, verbatim and untranslated:
「立 ADR 起草卡派发」and 「14122 作为epic 任务集中跟踪」— approving the proposal in
[#14122](https://github.com/objectstack-ai/objectstack/issues/14122) into the ADR-drafting lane
and promoting that issue to the epic that tracks the whole work family. The director seat's
four-axis evaluation (recorded on
[#14122 comment 5490688405](https://github.com/objectstack-ai/objectstack/issues/14122#issuecomment-5490688405))
concluded "方案合理,建议接受" and added the two tightenings this record carries as D3 and D5.
**Builds on**: [ADR-0003](./0003-package-as-first-class-citizen.md) (the package as the
first-class versioned artifact — the noun this record composes),
[ADR-0019](./0019-app-as-consumer-unit.md) D1–D4 (the App is the only consumer-facing unit; an
App owns **a set of** namespaces), [ADR-0048](./0048-cross-package-metadata-collision.md) §3.2
(the install-time namespace gate this record amends) and its
[2026-08-08 addendum](./0048-cross-package-metadata-collision.md#addendum-2026-08-08-publish-time--marketplace-namespace-exclusivity)
D2 (the publisher-held reservation the deferred owner field will align with),
[ADR-0005](./0005-metadata-customization-overlay.md) (the org overlay keyed on object/field
names — why not renaming is a compatibility answer, not only an ergonomics one),
[ADR-0116](./0116-plugin-ordering-declared-contract.md) (plugin ordering is a **declared**
contract resolved by one topological sorter),
[ADR-0129](./0129-object-name-is-the-canonical-id.md) D1–D2 (the object `name` is the canonical
id and carries its module prefix literally — the reason a rename is a deep rewrite),
[ADR-0025](./0025-plugin-package-distribution.md) (`engines.protocol`, the forward-compatibility
mechanism this record reuses instead of inventing one).
**Evidence**: [#14122](https://github.com/objectstack-ai/objectstack/issues/14122) (hotlong,
including 修订 1), measured against running `@objectstack/*` **17.2.0** instances of
`steedos-labs/hotcrm-heimao` and `objectstack-ai/hotcrm`. Every anchor this record cites into
**this** repository was re-verified against `origin/main` `c85a2657` while drafting; the two
places where the proposal's citation did not survive that re-verification are recorded in
§7 rather than silently corrected.
**Consumers**: `@objectstack/spec` (`stack.zod.ts` — `ObjectStackDefinitionSchema`,
`ComposeStacksOptionsSchema`), `@objectstack/objectql` (`SchemaRegistry.installPackage`,
`ObjectQL.registerApp`, `ObjectQLPlugin`'s manifest service), `@objectstack/core`
(`plugin-order.ts`), `packages/cli` (`os compile` / `os build`), the marketplace install path,
`objectui` (the Studio package picker, §7), and every package author splitting a product into
modules.

---

## TL;DR

A product that wants internal module boundaries has exactly two options today, and both are
bad: keep everything in one flat package (no boundary at all), or split into packages with
separate namespaces — which means **renaming every object**, a rewrite
[ADR-0048](./0048-cross-package-metadata-collision.md) §3.5 already declared a non-goal.

This record takes a third road that costs no rename: **compile per package, ship one JSON, keep
N manifests inside it, register N packages in dependency-topological order at load time.**

The load-bearing insight is that the runtime registry was **already built multi-package**:
namespaces are stored as `Map<namespace, Set<packageId>>`
(`packages/objectql/src/registry.ts:1456`), registration is per-manifest
(`ObjectQL.registerApp`, `packages/objectql/src/engine.ts:4746`), uninstall is per-package
(`SchemaRegistry.unregisterObjectsByPackage`, `registry.ts:2679`), and objects already carry a
per-item owner. **The only gate is `installPackage`** — and that gate's criterion
(`owner !== manifest.id`, `registry.ts:3583`) is a *proxy*. What it means to ask is "do these
packages have the same owner?"; what it actually asks is "are they the same package?". This
record corrects the proxy to its intent: **the release artifact itself is the co-ownership
declaration**, because everything inside one artifact is delivered atomically by one publisher.

No `owner` field is added to the manifest (D8). The consumer model of
[ADR-0019](./0019-app-as-consumer-unit.md) does not move a single letter (D2). And the gate
relaxation is **mechanically inseparable** from the install-time object-name uniqueness check
that today rides along on it for free (D3) — because relaxing one without the other is the only
part of this design that can reach customer data.

---

## 1. Context

The evidence below is #14122's, measured downstream on 17.2.0. It is summarised here because a
decision record must carry the need it answers; the instruments and full tables live on the
issue.

### 1.1 The boundary that does not exist is paid for as a fork

`steedos-labs/hotcrm-heimao` is a **fork** of the standard `hotcrm` — the only mechanism
available for "standard product plus customer customization". #14122 measures the fork tax
directly: upgrading `@objectstack/*` 17.1.0 → 17.2.0 had to be done **twice**, hitting the same
obstacles (sharing seeding, the StackBlitz double-lockfile gate) in both repositories, with the
knowledge carried across by hand.

The telling measurement is what the fork actually contains: the six files that touch standard
objects are **+1,000 / −15 lines**, and all fifteen deleted lines are *replacements*, not
removals of capability. Roughly **95% of the fork is additive**. It is a fork because the
platform offers no boundary, not because the work is divergent.

### 1.2 The product's own modules are expanding too

This is not only about customer forks. `hotcrm` wants to extend the sales module with CPQ;
黑猫 added "orders and gross-margin calculation" — 12 objects plus 8 hooks. All of it lands in
one `src/`, flat alongside the standard CRM objects.

### 1.3 Three measurable consequences

**(a) The maintainer cannot see their own system.** Studio's scope is the package. In 黑猫's
single package: 30 objects flat, 29 flows flat (two of which both truncate to
`Case Escalation…` and are visually indistinguishable), and a permission matrix of 30 rows × 9
CRUD columns × 6 permission sets that interleaves `客户/联系人/商机` with
`运费标准/等级政策/工厂成本`. The one section that *is* grouped — navigation — is grouped only
because it renders the single grouping an author was ever able to write down (`app.navigation`'s
group nodes).

That asymmetry is structural, and re-verified here: the object document has **no** grouping,
module, category or section key — the only `group` spelling in
`packages/spec/src/data/object.zod.ts:1779` is a *rejection-guidance* entry redirecting the
author to the view's `userActions`. There is nothing for Studio to group by.

**(b) The context budget has no module boundary.** The product promise is that a CRM sales
module fits whole in an AI context window, and downstream that promise is ratcheted
mechanically. #14122 reports 黑猫 at `authored total 178,417 / 180,000`, headroom 1,583 — hard
against the ceiling. Without module boundaries there is no *per-module* budget: every module
pushes against one ceiling and no one can say which module consumed it.

**(c) There is no sellable unit.** CPQ is meant to be sold separately and sits in the same
package as the sales module. Commercially it does not exist as a thing.

### 1.4 The three obvious roads, and why each is closed (#14122 §2)

| Road | Why it fails | Verified against `origin/main` |
| --- | --- | --- |
| **Add a `module` tag to objects/flows** | A pure grouping key priced at ~1,100–1,200 tokens across 190 authored files — **70–75% of the downstream ratchet's remaining headroom**, for zero enforcement. Raising the ceiling is a maintainer floor item, not an agent's. | The absence it would fill is real (§1.3a); the ratchet itself is a downstream-app script, see §7. |
| **Split into packages with separate namespaces** | This is **rename-on-install by another name**. `${namespace}_${shortName}` is kernel-validated and the object `name` **is** the table name, the REST path, the formula token and the saved-view key (ADR-0129 D1–D2). `crm_account` → `sales_account` breaks all of them. | ADR-0048 §3.5 and its Non-goals (line 171) already record this as an explicit non-goal: *"Namespace rename-on-install is an explicit non-goal for now (deep rewrite of every object name, cross-reference, and formula)."* |
| **Merge with the existing `composeStacks`** | It **flattens**, and flattening is the whole loss. Its `manifest` option is `z.union([z.enum(['first','last']), z.number().int().min(0)]).default('last')` — it *picks one manifest and drops the rest*. Running the full refactor through it lands back on one 30-object flat package: the benefit evaporates exactly where it was supposed to appear. | `packages/spec/src/stack.zod.ts:1759`, with the doc comment above it stating the selection semantics ("Which manifest to keep when multiple stacks provide one"). |

### 1.5 What the runtime already does (the reason this is small)

Re-verified in this worktree, not taken from the proposal:

| Fact | Anchor |
| --- | --- |
| Namespace ownership is stored **many-to-one**: `private namespaceRegistry = new Map<string, Set<string>>();` | `packages/objectql/src/registry.ts:1456` |
| `getNamespaceOwners()` returns an **array** of package ids | `registry.ts:1540` |
| Registration is **per manifest** — `registerApp(manifest)` stamps each object with that manifest's id/namespace | `packages/objectql/src/engine.ts:4746` |
| Uninstall is **per package**, not a namespace sweep | `registry.ts:2679` (`unregisterObjectsByPackage`) |
| The one place a second package is refused | `registry.ts:3575` `installPackage`, gate at `3583`, throw at `3595` |
| The load-time call site that registers exactly one manifest | `packages/objectql/src/plugin.ts:405` (`ql.registerApp(manifest)`) |
| `validateSingleApp` constrains only `type: 'app'` — it returns `[]` for every other type | `packages/spec/src/stack.zod.ts:854` |
| Shareable namespaces are `{base, system}` plus `sys` | `registry.ts:45` + `registry.ts:1116` (`isShareableNamespace`) |
| The artifact's `manifest` key is **singular and optional** on the schema `os compile` validates and writes | `packages/spec/src/stack.zod.ts:240`; `packages/cli/src/commands/compile.ts:271` (parse) and `:596` (write); `os build` is an alias of `os compile` (`packages/cli/src/commands/build.ts:6`) |

#14122 also measured the authoring side: a sub-package declaring `namespace: 'crm'`, defining
`crm_*` objects and injecting navigation through `navigationContributions` is ACCEPTED by
`defineStack` for all three of `plugin` / `module` / `app`. Cross-package lookups and
`navigationContributions` into a foreign app are ACCEPTED; a package's own `app.navigation`
pointing at a foreign object, and a hook attached to a foreign object, are REJECTED. Those two
rejections are the shape of the seam: **navigation crosses only through contributions, and the
split must follow hook ownership.**

---

## 2. Decision

### D1 — The release artifact is the co-ownership declaration

A release artifact MAY carry N package manifests. Everything inside one artifact is delivered
**atomically by one publisher** — it is built together, versioned together (D7), downloaded as
one file and installed in one act. That joint delivery **is** the ownership proof; nothing else
needs to assert it.

Therefore the install gate's criterion is corrected from *"is this the same package id?"* to
*"are these co-owners within one artifact?"*. This is not a new permission being granted; it is
an existing check being asked the question it was always meant to ask. The 2026-08-06 ruling
recorded in ADR-0048's addendum already located ownership at the **publisher**, not the package
(addendum D2, `0048-cross-package-metadata-collision.md:459`); one artifact is the smallest
publisher-atomic unit the runtime can observe without a new field.

### D2 — The consumer model does not move; the artifact stops at the control plane

[ADR-0019](./0019-app-as-consumer-unit.md) D1–D3 stand **verbatim and unamended**. The consumer
still installs one thing, opens one thing, uninstalls one thing: the single `type: app` package.
The other packages in the artifact are `type: module` / `plugin` — ADR-0019 D2's "internal
contribution" tier, which that record defines as *"the 'frameworks inside the `.app` bundle':
they ship inside an App or are operator-provisioned, and are never independently browsed or
installed by a consumer"* (`0019-app-as-consumer-unit.md:68`). `isConsumerInstallable(type)`
already filters them out of the consumer marketplace and
`MarketplaceListingSchema.packageType` already cannot represent a non-App listing — neither
changes.

D4 of ADR-0019 accommodates this case in its own words, unchanged: *"An App declares and owns
**a set of namespaces**; uninstall is atomic over that set"* (`0019-app-as-consumer-unit.md:81`,
`:83`) — a **set**, and its parenthetical already cites the very `Map<namespace, Set<packageId>>`
this record leans on (`:85–86`).

⛔ **The line this must not cross.** The artifact is a **control-plane and publishing** noun. The
moment it becomes something a consumer browses, installs or uninstalls, it is the **suite**
ADR-0019 D3 removed by name, and that record's Apple argument (`:73–79`, `:44–46`) applies
unaltered: *"there is no user-visible container above the app"*. The artifact must never appear
in the consumer marketplace, never be an install target a consumer selects, and never be a unit
a consumer can partially uninstall. It has exactly one consumer-visible consequence — the App
you installed brought its modules — and that is the same consequence a plugin inside a package
has today.

**Recording convention.** ADR-0019's text is **not rewritten**. This record cross-references it
and is listed in its own `Builds on` line; per this repository's convention a governed record is
amended by an additive addendum or by a successor that cites it (the shape ADR-0048's 2026-08-08
addendum uses: *"additive to §3.2, supersedes nothing"*). Should the maintainer prefer the
amendment be visible from 0019 itself, the follow-up is a one-line **Related** entry on 0019
pointing here — additive, superseding nothing. ⛔ No original text of 0019 or 0048 is edited by
this work.

### D3 — The gate relaxation and the object-name uniqueness check are ONE change, mechanically

This is the only part of the design that can reach customer data, and it is therefore the only
part specified as a machine constraint rather than an instruction.

Today's namespace exclusivity is **carrying a second guarantee for free**. ADR-0048's own TL;DR
says why: objects *"dodge collisions because their names are namespace-prefixed (`crm_account`)
and map to physical tables; a clash fails **loudly** at the DB"*
(`0048-cross-package-metadata-collision.md:20–23`), and §3.2 grounds the gate on exactly that:
*"two packages with namespace `crm` both try to create `crm_account` and the second fails at the
DB"* (`:208–210`). So "no two packages share a namespace" has been silently proxying for **"no
two packages define the same object name."**

Relax the first without adding the second, and two packages in one artifact both defining
`crm_account` produce: no install-time error; a failure deferred to the DB layer (duplicate
`CREATE TABLE`) — **or, driver-dependent, one package silently overwriting the other's table
definition.** That last form is the only outcome in this whole design that can damage customer
data.

**Therefore, as an acceptance criterion, not a recommendation:**

1. The namespace-gate relaxation (#14122 §5.4) and the **install-time per-object-name uniqueness
   check** (#14122 §5.6) MUST land in the **same pull request**. Neither may ship alone, in
   either order.
2. A **gate test** MUST assert the pair as one proposition: *given the namespace gate admits two
   co-owning packages, an artifact in which two packages define the same object name is
   REFUSED at install time, with an error naming both packages and the object.* The test fails
   if the relaxation is present and the refusal is not.
3. The uniqueness check is **install-time**, ahead of any DDL — its whole purpose is to move the
   failure earlier than the DB, which is where it lands today by accident.

The refusal assertion follows this repository's rejection-test contract (ADR-0112 envelope): it
asserts the error's **`code` and `status`**, never a bare "it throws" — a bare throw assertion
stays green against a driver that throws a plain `Error` for an unrelated reason, which is
exactly the failure this test exists to catch.

Per §6.2 of #14122, this new refusal is not a compatibility break: it can only reject
configurations that would have failed at the DB anyway, and it rejects them earlier and more
legibly.

### D4 — Artifact schema: `packages: [...]` is additive, and both shapes are read

`ObjectStackDefinitionSchema` gains an **optional** `packages` key carrying an array of
manifests. `manifest` (singular, `stack.zod.ts:240`) is **retained**, and the load path reads
both:

- `packages` present → iterate it.
- `packages` absent → treat `manifest` as a **single-element list**.

This is stated as the schema decision, not as an implementation note, because it is the term on
which #14122 §6.1's compatibility claim rests: an existing single-`manifest` artifact takes the
second branch and its behaviour is unchanged. A *replacement* of `manifest` by `packages` would
break every artifact already built — the schema shape is the compatibility mechanism.

Forward compatibility rides on the mechanism that already exists: `manifest.engines.protocol`
(`packages/spec/src/kernel/manifest.zod.ts:70`, ADR-0025). A new-format artifact declares a new
protocol range and an older runtime **refuses it cleanly** rather than mis-parsing it into a
half-registered install. ⛔ No new version-negotiation mechanism is introduced.

**Segmented loading: the key position is reserved now, deliberately unimplemented.** 黑猫's
30-object artifact is already 2.6 MB; modules accreting into one JSON grow both marketplace
transfer and startup parse. This is not a blocker and this record does **not** decide to build
segmentation. But format is the hardest decision to revisit — an artifact schema is on disk at
every customer — so the position is reserved **at schema time** rather than retrofitted at 20 MB
(#14122 待决策 ④). Concretely: each entry in `packages` is an **object**, never a bare inlined
manifest body flattened into the array, so a future `{ ref, integrity }` external-segment form
is an additive key on an existing object rather than a shape change. The reservation is a
structural commitment only; the segmented form itself needs its own decision and is a Non-goal
here.

### D5 — Topological ordering is an acceptance criterion, and reuses the one sorter

Packages inside an artifact MUST be registered in **dependency topological order**. A package
using `defineObjectExtension` to extend another package's object must register **after** the
package it extends.

This is specified as a machine criterion, not left to the implementer's judgement, because it is
**the one part of this design that fails silently**: get the order wrong and nothing throws —
the extension simply does not take effect. A silent failure that a reviewer cannot see is a
failure the tests must own.

⛔ **Reuse `resolvePluginOrder`; do not write a second ordering mechanism.**
`packages/core/src/plugin-order.ts:66` is the platform's single topological sorter, and
[ADR-0116](./0116-plugin-ordering-declared-contract.md) already established that ordering is a
**declared** contract resolved from `dependencies` / `optionalDependencies` — with the failure
mode ADR-0116 exists for being precisely "correctness rode on which array slot each caller put it
in." Sorting intra-artifact packages with a second, parallel implementation would re-create that
failure inside the artifact after ADR-0116 removed it between packages. `resolvePluginOrder`
already throws on a missing hard dependency and on a cycle; the intra-artifact case inherits both
behaviours rather than re-deciding them.

**The test that pins it** must be a *behavioural* one, not an assertion about a sorted array: an
artifact whose `packages` array is deliberately ordered **extension-before-base** installs, and
the extension is verified **present and in effect** on the extended object. Asserting only that
the sorter returns a permutation would pass on an implementation that computed the order and then
never used it — which is the silent failure restated.

### D6 — One artifact, one version

An artifact carries one version number for all packages inside it. #14122 待决策 ③ records both
halves, and both are recorded here.

**What it buys:** the version matrix disappears. A customer cannot assemble
`core 3.2 + cpq 1.4` — a combination nobody tested and nobody can support — because that
combination is not expressible. And `defineObjectExtension` cannot dangle: the extended package
cannot be upgraded out from under the extending one, because they upgrade as one act.

**What it costs, stated plainly:** you **cannot hot-fix one module.** A one-line fix in the order
module means re-publishing the whole artifact, re-testing the whole artifact, and every customer
taking the whole artifact. For internal modules of one product this trade is correct — they are
tested together anyway and the matrix they would otherwise create is real risk. **For a module
that must ship on its own cadence, this trade is wrong, and the answer is that such a module
becomes its own artifact** — at which point it needs the owner field D8 defers, and D8's deferral
ends.

### D7 — Existing artifacts register bit-identically through the new path

An existing single-`manifest` artifact, loaded through the new N-package path, MUST produce a
registration state **bit-identical** to today's, over at least: the package record, every object
FQN, every `_packageId` stamp, and the namespace-owner sets.

This is the acceptance criterion #14122 §6.4 asked for, and it is recorded here as an
**automated test, not a review judgement** — because "we checked the behaviour is unchanged" is
exactly the claim a reviewer cannot verify by reading a diff, and the entire compatibility story
of D4 rests on it. Reviewer attention is not a mechanism.

The comparison must be over the **registry state** after install, not over the install path's
return value: it is the state the DB, the API and every read path see.

### D8 — No owner/publisher field on the manifest (deferred, not rejected)

⛔ This record adds **no** `owner` or `publisher` field to `ManifestSchema`. D1 makes it
unnecessary: within one artifact, co-ownership is already proven by joint atomic delivery, and a
field would restate what the artifact structure already says — a second source of truth for the
same fact, which can drift from it.

The field becomes **necessary** the day a module ships as its own artifact and must assert
across artifacts *"I have the same publisher as HotCRM."* That is exactly the moment D6's cost
bites, and it is exactly the case ADR-0048's 2026-08-08 addendum already has a home for: **D2
holds the namespace reservation at the `publisherOrgId`, not at the package**
(`0048-cross-package-metadata-collision.md:459–463`). When the field lands, it aligns with that
key rather than inventing a parallel identity. Until then it is not built.

This deferral is a decision, recorded so the next author finds a reason instead of an absence.
It is listed again under Non-goals.

---

## 3. Non-goals

- **A manifest `owner` / `publisher` field.** Deferred, D8. Aligns with ADR-0048 addendum D2 when
  it lands.
- **Namespace rename-on-install.** Unchanged non-goal — ADR-0048 §3.5 and Non-goals (`:171`,
  `:261–267`). This record's entire value is that it does **not** require a rename; it must never
  become the wedge that reintroduces one.
- **The artifact as a consumer-visible unit.** D2's ⛔ line. Not a suite, not a browse target, not
  an install target, not partially uninstallable.
- **Implementing segmented artifact loading.** D4 reserves the key position only. The segmented
  form itself needs its own decision.
- **A second ordering mechanism.** D5. `resolvePluginOrder` or nothing.
- **Changing the marketplace transport.** Whatever the artifact contains, the marketplace still
  publishes, lists, downloads and installs **one file**. No distribution-path change is in scope.
- **Object, flow or permission-set grouping keys in `packages/spec`.** §1.4 rejected the `module`
  tag on cost. Grouping inside Studio follows from the package boundary this record creates; it
  is not a new authorable key.
- **Implementation code.** This record is prose only. The cards below are cut after it merges.

---

## 4. Consequences

**Positive**

- A product can be split into modules **with zero object renames** — so table names, REST paths,
  formulas, filters, integrations and every customer-saved view keep working, and the ADR-0005
  org overlay (keyed on object/field names) is untouched.
- Studio's scope is the package, so package boundaries **are** the grouping Studio has never had
  (§1.3a) — without adding a single authorable key or a single token to the ratcheted budget.
- A per-module context budget becomes expressible for the first time; "which module ate the
  headroom" becomes answerable.
- CPQ acquires a unit it can eventually be sold as (D6's escape hatch: it becomes its own
  artifact).
- Customers who do **not** split modules are affected in no way at all: D4's read-both branch,
  pinned by D7's bit-identical test. **No data migration for anyone.**
- The install gate stops asserting a proxy and starts asserting its intent (D1) — and the
  guarantee it was silently carrying becomes explicit and *earlier* (D3).

**Negative / costs**

- **No per-module hot-fix** (D6). Any fix re-publishes the whole artifact.
- **Artifact size grows** with each module folded in; 2.6 MB today for 30 objects. Mitigated only
  by D4's reserved position, which is not itself a mitigation until built.
- **One more thing an author can get wrong**: the split must follow hook ownership (§1.5 — a hook
  on a foreign object is rejected by `defineStack`), and navigation must cross via
  `navigationContributions`. Both fail loudly today, which is the good case, but they are new
  constraints an author must learn when splitting.
- **`installPackage` gains a second reason to refuse** (D3's object-name check). It can only
  reject what the DB would have rejected, but it is one more refusal an install can hit.

**Follow-up implementation surface** (from #14122 §5 — cards cut **after** this record merges;
⛔ none of them are authorised by this record's existence in draft):

| # | Change | Size | Repo |
| --- | --- | --- | --- |
| 1 | Artifact schema: optional `packages: [...]`, both shapes read (D4) | The one substantive change | objectstack |
| 2 | Load path: `ql.registerApp(manifest)` at `packages/objectql/src/plugin.ts:405` becomes an iteration, **topologically ordered** (D5) | A loop plus the sorter call | objectstack |
| 3 | `composeStacks`: add a **preserve** mode alongside today's deliberate pick semantics; default `'last'` unchanged (`stack.zod.ts:1759`) | Small, additive | objectstack |
| 4 | `installPackage` namespace gate accepts co-owners within one artifact (D1) | ~One criterion | objectstack |
| 5 | **Install-time per-object-name uniqueness check — same PR as #4, with the pairing gate test** (D3) | Small, **not omittable** | objectstack |
| 6 | Studio package picker lists project-domain `module` packages (today only `app.objectstack.hotcrm` shows; 22 system plugins are filtered out) | UI, separate card | **objectui** |
| 7 | The D7 bit-identical registration test | Test | objectstack |

Row 6 is **objectui-side** and is cut as a cross-repo card against that repository, linked to the
#14122 epic — it does not ride in the objectstack PRs above.

**What downstream may do before any of this lands** (#14122 §8, recorded because its honesty is
part of the decision): 黑猫 and hotcrm control their own delivery chain and can split **source
structure** by package now, releasing in lockstep. The source layout will not need rework when
the artifact schema lands. ⚠️ Its stated defect stands: **lockstep is a convention, not a gate** —
nothing prevents installing a mismatched pair. That is precisely the half this record exists to
turn into a mechanism, and it does not become one until the cards above ship.

---

## 5. Alternatives considered

1. **A `module` grouping tag on objects and flows.** Rejected on measured cost (§1.4): ~75% of
   the downstream token headroom for a key that groups but enforces nothing — a false module
   boundary, since nothing would stop a "module" from being defined half in one place. It also
   asks the maintainer's ceiling floor-item to move for a grouping key.
2. **Separate namespaces per package.** Rejected: it is rename-on-install, ADR-0048's standing
   non-goal, and under ADR-0129 D1 the object `name` is the table name, so the rename reaches
   every customer's data plane.
3. **`composeStacks` as-is.** Rejected: it flattens by design and drops N−1 manifests
   (`stack.zod.ts:1759`), destroying the sub-package identity that is the whole point.
4. **Add the `owner` field now, alongside the gate change.** Rejected for now as scope the pull
   does not justify (D8): within one artifact the field restates what delivery already proves,
   and a second source of truth for ownership can drift from the first. It is deferred with a
   named trigger, not dropped.
5. **Let the artifact be a consumer-visible container ("a suite, but a good one").** Rejected
   outright: it is ADR-0019 D3 by another name, and that record's argument does not weaken
   because the container is better built.

---

## 6. Open questions for the maintainer's merge decision

These are the points where the maintainer's hand-merge is the ruling, listed so the merge is an
informed act rather than a rubber stamp:

1. **D8's deferral.** #14122 待决策 ⑤ asked explicitly whether the `owner` field should land with
   ADR-0048 addendum D2 instead of being deferred. The director-seat evaluation recorded
   "owner 字段推迟" and this record follows it. Merging accepts the deferral.
2. **The recording convention for the ADR-0019 boundary** (D2): cross-reference from here only
   (as drafted), or additionally a one-line **Related** entry added to 0019. Either way ⛔ 0019's
   own text is not rewritten.
3. **D6's cost acceptance.** "No per-module hot-fix" is a real operational cost that lands on
   whoever supports the product. It is stated, not softened.

---

## 7. Verification notes — where #14122's citations did not survive re-verification

Recorded rather than silently corrected, because the proposal is this record's evidence base and
a reader deserves to know which of its anchors were re-measured:

- **`objectql/src/engine.ts:4745` is off by one.** `registerApp(manifest: any)` is declared at
  **`:4746`**; line 4745 is the closing `*/` of its doc block. The claim it supports —
  registration is per-manifest and stamps that manifest's id/namespace — holds exactly as
  described.
- **`scripts/check-source-token-ratchet.mjs` does not exist in this repository.** The token
  ratchet #14122 §1.3b cites is a **downstream application repo's** script; `grep` across this
  worktree finds no occurrence of that filename. The measurement it produced
  (`178,417 / 180,000`) is therefore downstream evidence about the applications, not a gate in
  this repo — which does not weaken §1.3b's argument (the *absence* of a module boundary is a
  platform fact, verified here in §1.3a) but does change who owns the number.
- Every other anchor cited by #14122 and re-checked while drafting was found exactly as
  described: `registry.ts:1456`, the `installPackage` gate at `:3575`/`:3583`/`:3595`,
  `getNamespaceOwners` at `:1540`, `unregisterObjectsByPackage` at `:2679`,
  `plugin.ts:405`, `stack.zod.ts:240` / `:854` / `:1759`, `RESERVED_NAMESPACES` at
  `registry.ts:45` with `isShareableNamespace` at `:1116`, and ADR-0048's rename-on-install
  non-goal in all three of its recorded places (`:57–59`, `:171`, `:261–267`).

---

## 8. References

- [#14122](https://github.com/objectstack-ai/objectstack/issues/14122) — the proposal and all
  measured evidence (hotlong), including 修订 1 (§5.6 and §6); the epic tracking this work family
- [#14144](https://github.com/objectstack-ai/objectstack/issues/14144) — this drafting card
- [ADR-0003](./0003-package-as-first-class-citizen.md) — package as first-class citizen
- [ADR-0005](./0005-metadata-customization-overlay.md) — org overlay keyed on object/field names
- [ADR-0019](./0019-app-as-consumer-unit.md) — D1–D4, the consumer surface (unamended by this
  record)
- [ADR-0025](./0025-plugin-package-distribution.md) — `engines.protocol`
- [ADR-0048](./0048-cross-package-metadata-collision.md) — §3.2 install gate, §3.5
  rename-on-install non-goal, and the 2026-08-08 addendum (D2, publisher-held reservation)
- [ADR-0116](./0116-plugin-ordering-declared-contract.md) — ordering is a declared contract, one
  sorter
- [ADR-0129](./0129-object-name-is-the-canonical-id.md) — D1–D2, the object `name` is the table
  name
- `packages/objectql/src/registry.ts`, `packages/objectql/src/engine.ts`,
  `packages/objectql/src/plugin.ts`, `packages/core/src/plugin-order.ts`,
  `packages/spec/src/stack.zod.ts`, `packages/spec/src/kernel/manifest.zod.ts`,
  `packages/cli/src/commands/compile.ts`
