# ADR-0123: Layered master data — group template rows, per-organization overrides, and the resolution organization

**Status**: **Proposed** (2026-08-08) — drafted as decision-ready material for the maintainer. Nothing here is implemented, and no code, spec or gate changes ship with this record. Per the 2026-08-06 ruling on [#4585](https://github.com/objectstack-ai/objectstack/issues/4585) the first deliverable of ADR-0105 D10 is this ADR, not code (「首个交付物是 ADR 不是代码」).
**Deciders**: ObjectStack Protocol Architects (maintainer ruling requested — see [Open questions](#open-questions-for-the-maintainer))
**Resolves**: [ADR-0105](./0105-group-tenancy-posture-and-first-class-org-scope.md) **D10** ("Mechanics … to be detailed in a follow-up ADR; this ADR reserves the concept and its place in Phase 2") and the ADR-0105 non-goal line "D10 mechanics (linkage/resolution/distribution) — reserved, follow-up ADR"
**Builds on**: [ADR-0105](./0105-group-tenancy-posture-and-first-class-org-scope.md) (D2 union wall, D5 stamping, D6 grouping metadata + red lines, D9 `$root`/`$parent`, D12 edition split), [ADR-0095](./0095-authz-kernel-tenant-layer-and-posture-ladder.md) (W1/W2 — Layer 1 can never widen Layer 0), [ADR-0005](./0005-metadata-customization-overlay.md) (the same template/override shape, already solved on the **metadata** plane), [ADR-0120](./0120-unique-scope-vocabulary-and-null-safe-tenant-uniqueness.md) (`unique: 'organization'`, `COALESCE(organization_id, '__global__')`), [ADR-0049](./0049-no-unenforced-security-properties.md) (declared = enforced), [ADR-0078](./0078-no-silently-inert-metadata.md) (no declarable-but-inert keys), [ADR-0033](./0033-ai-assisted-metadata-authoring.md) (the AI-authoring axis), cloud ADR-0016 (open/paid iron rule 强制免费、治理收费)
**Consumers (if accepted)**: `@objectstack/spec` (`ObjectSchema`), `@objectstack/plugin-security` (`tenant-layer.ts`), `@objectstack/objectql` (read path), `@objectstack/lint`, `@objectstack/organizations` (cloud, commercial surface), the group-deployment dogfood suite
**Surfaced by**: [#4585](https://github.com/objectstack-ai/objectstack/issues/4585) (successor of the closed #3541 umbrella); demand side tracked on cloud#874 "主数据分发管理"

---

## TL;DR

A group publishes one canonical material / customer / vendor master; each plant
consumes it and may override some fields locally; the group decides **per object**
how much local freedom exists (集团统管 / 分级 / 自由). ADR-0105 D10 reserved that
shape and deferred every mechanic. This ADR proposes the mechanics.

Three measurements decide most of it, and none of them existed when D10 was reserved:

1. **The group wall has no NULL arm.** Layer 0 under `group` is
   `{ organization_id: { $in: accessible_org_ids } }`
   (`plugin-security/src/tenant-layer.ts:139-143`), which lowers to SQL `IN (…)` —
   NULL-false. The SQL driver's *native* scoping carries the opposite rule
   (`sql-driver.ts:6369`, `whereIn(field, tenantIds).orWhereNull(field)`). The two
   layers AND together, so today a `organization_id IS NULL` row is **invisible** under
   the group posture. A "platform-global, read-shared" template row is not merely
   unbuilt — it is actively excluded, and no Layer 1 mechanism can restore it (W1/W2).
2. **`group` posture deleted the single-valued read organization.** D2 demoted the
   active organization to "default write target, UI context" and made membership the
   read bound. But "org override wins" is only well-defined **relative to one
   organization**, and a union reader spanning root + plant A + plant B has *several*
   valid answers. **Resolution therefore needs a resolution organization, and D2
   removed the one the read path used to have.** This is the sharpest consequence of
   Phase 1 for D10 and it is not addressed by the reserved text at all.
3. **Walking the org tree in an authored rule is lint-forbidden.** D6 red line ① is an
   `error`-severity rule (`packages/lint/src/validate-org-axis-red-lines.ts`): an RLS
   policy or sharing rule whose predicate reads `parent_organization_id` fails at
   authoring time. So "just author a policy that reaches up to the group org" is not a
   shortcut that was overlooked — it is closed.

| # | Decision | One line |
|---|---|---|
| D1 | `layered` is an object-level declaration, and refuses rather than idles | Declaring it outside the `group` posture is a runtime refusal, not a silent no-op |
| D2 | Linkage is a declared **natural key**, not a row-id lookup | `layered: { key: 'code' }` + ADR-0120 `unique: 'organization'`; portable, replay-safe, no wall-crossing FK |
| D3 | The template row is **org-less**, and Layer 0 gains one narrow, declared opening | `$or: [{ organization_id: { $in: … } }, { organization_id: null }]` **only** for `layered` objects — read-only by construction |
| D4 | Reads do **not** silently collapse; resolution is explicit and names its organization | Default = raw rows (wall semantics untouched); resolution is asked for, and a union reader gets one resolved row **per organization** |
| D5 | 集团统管 / 分级 / 自由 are declared per object and enforced on **write** | A non-overridable divergence is REFUSED, never quietly resolved away on read |
| D6 | Grouping vocabulary is reused verbatim from D6/D9 | `$root` / `$parent`, "shares a `parent_organization_id` root", refuse-don't-ignore. No parallel vocabulary |
| D7 | Open/commercial line stated, not inherited | Enforcement (declaration, policy, resolution, gates) open; distribution *management* commercial; `layered` without the entitlement **refuses to boot** |
| D8 | Named non-goals | No template versioning/effectivity, no intra-JSON merge, no cross-*group* distribution |

**The one thing this ADR does not settle by itself** is how far the maintainer wants to
open Layer 0 (D3) — an org-less template is installation-global, and making it
*group*-scoped instead costs either an over-broad membership grant or an
engine-owned exception to the D6 red line. That trade is presented, not forced.

---

## Context

### The customer shape (unchanged from D10's reservation)

SAP's material master and the 用友 / 金蝶 distribution model are the same pattern: a
group-level master record is published once, plants consume it, and local
divergence is permitted or forbidden **per master object** by group policy:

| Policy | Chinese | Meaning |
|:---|:---|:---|
| group-controlled | 集团统管 | the group's row is the only row; plants may not diverge at all |
| graded | 分级 | plants may diverge on a declared subset of fields; the rest is the group's |
| free | 自由 | plants may diverge on anything, and may hold purely local rows |

ADR-0105 Appendix A already prescribes the interim shape for a group engagement
today: "group-standard objects OWD `public_read` with write permission held by group
positions; plant-local overrides as plant-scoped rows (**D10 formalizes this later**)."
That interim answer works in the `single` posture, where Layer 0 is inert. It does
**not** survive the move to `group`, for the reason below.

### Why Phase 1 made this harder, not easier

D10 was reserved before the `group` wall existed. Every measurement below is from
`main` today.

#### C1 — Layer 0's `$in` has no NULL arm; the driver's native scoping does

```
// plugin-security/src/tenant-layer.ts (group posture)
if (!orgIds || orgIds.length === 0) return { ...RLS_DENY_FILTER };
return { organization_id: { $in: [...orgIds] } };
```

`$in` lowers to knex `whereIn` (`sql-driver.ts:7449`) and therefore to SQL
`col IN (…)`, which is false for NULL. Meanwhile `applyTenantScope` — the driver's own
tenant chokepoint — deliberately carries a NULL carve-out on *both* its arms
(`sql-driver.ts:6369` and `:6382`), documented as the fix for #2734 ("every platform row is
org-less … with strict equality every tenant admin saw ZERO RBAC rows on a fresh
deployment").

So the two scoping layers currently **disagree about an org-less row**, and because
they AND together the stricter one wins: under `group`, an `organization_id IS NULL`
row is invisible. Any design that puts the template row "platform-global by NULL org"
must open Layer 0 on purpose. This is the "principled opening, not an exception" that
#4585 asked for, stated as a measured fact rather than an intuition.

#### C2 — the write side is already closed, and closed in the right direction

`organization_id` is effectively immutable in a non-platform user context: the
enterprise auto-stamp (`@objectstack/organizations` Middleware A) authoritatively
overwrites a user-supplied value, and the open post-image check
(`plugin-security/src/security-plugin.ts` step 3.7) denies a forged or re-pointed
value on **both** INSERT and UPDATE, fail-closed, including bulk
(`authz-conformance.matrix.ts` → `multi-tenant-write-postimage`). A tenant user
therefore *cannot* mint an org-less row today. That is convenient rather than
inconvenient: it means the publish authority for template rows is already narrowed to
platform-admin / system contexts without inventing a permission axis.

#### C3 — the org tree is lint-forbidden as an authorization input

`packages/lint/src/validate-org-axis-red-lines.ts` raises `org-axis-permission-inheritance`
at **error** severity for any RLS policy or sharing rule whose predicate reads
`parent_organization_id`, with the reasoning spelled out in the file: such a rule
"builds a SECOND permission hierarchy beside the business-unit tree … It also silently
outranks the wall it sits behind, since a Layer-1 policy cannot widen Layer 0 (W1) — so
the author gets a rule that appears to grant access and does not."

Consequence for D10: **the resolution and visibility rules must be engine machinery,
not authored metadata.** Every "the customer can just write a policy" escape is closed
by a gate that already ships.

#### C4 — no Layer 1 mechanism can rescue a cross-org template row

ADR-0095 W1/W2, restated in `tenant-layer.ts`'s own header: Layer 0 is computed
independently, AND-composed first, and crossable only by a true `PLATFORM_ADMIN`.
Sharing rules, `sys_record_share` rows, OWD `public_read`, and the
`viewAllRecords`/`modifyAllRecords` superuser bit are all Layer 1. So "share the group's
template rows with the plants" is not an available implementation, in any spelling.

#### C5 — `group` removed the resolution organization

D2, in ADR-0105's own words: "The active organization keeps its current meaning
(default write target, UI context); it **no longer bounds *read* reach** in `group`
posture — membership does."

"Org override wins" presupposes exactly one organization to win *for*. Under the union
wall a group-HQ analyst reading `material` sees the template row **and** plant A's
override **and** plant B's override, all legitimately. There is no single correct
collapsed answer, and picking one silently is how a consolidated report starts lying.
The reserved D10 text says "with a resolution rule (org override wins)" and could not
have known this; it is the single most important thing this ADR has to add.

#### C6 — ADR-0092's whitelist does not apply to business master objects

#4585 floats "the ADR-0092 extension-field whitelist route on shared objects" as a
candidate linkage. ADR-0092's guard is registry-driven off `managedBy: 'better-auth'`
and its whitelist governs *identity* tables (`sys_user`, and by D7 of ADR-0105
`sys_organization` / `sys_member`). A `material` / `customer` / `vendor` object is not
better-auth-managed, so the mechanism has no jurisdiction over it. Recorded here as a
premise correction, not a rejection on merits: the route is not narrower or wider than
we need, it is a different family of object.

#### C7 — the same problem is already solved one plane up

ADR-0005 is template-and-override for **metadata**: a platform-global base record plus
per-`organization_id` overlay rows, resolved by a layered repository, gated by an
explicit whitelist (`allowOrgOverride`) of which metadata types may be overridden at
all. D10 is the **data-plane twin** of that decision, and the whitelist maps almost
exactly onto the 分级 policy. This ADR reuses the shape and the naming deliberately —
"layer", "override", "resolution" — so a reader who knows one knows the other.

#### C8 — ADR-0120 already minted the index this needs

`unique: 'organization'` materializes as `COALESCE(organization_id, '__global__')`
(ADR-0120 D3). An org-less template row and its per-org overrides therefore coexist in
**one** unique index, with the template occupying a reserved slot and each org
occupying its own. The natural-key linkage below needs no new index concept.

---

## Decisions

### D1 — `layered` is an object-level declaration, and it refuses rather than idles

Layered governance is declared on the object, once:

```ts
// illustrative — the exact spelling is for the implementation PR
layered: {
  key: 'code',                        // D2 — the linkage
  policy: 'graded',                   // D5 — 集团统管 / 分级 / 自由
  overridable: ['sales_price', 'lead_time_days'],   // D5, `graded` only
  publishFrom: '$root',               // D6 — reuses D9's symbols
}
```

Object-level, not field-level and not view-level, because the *governance* is a
statement about the object's rows, and both a field-level and a view-level spelling
would let one object carry two contradictory layerings.

**A `layered` declaration in a non-`group` posture is a runtime REFUSAL, not a
no-op.** This copies ADR-0105 D9's amendment point 4 verbatim in reasoning: posture is
environment configuration, the same portable metadata deploys into any posture, and no
static check can see which. Silently ignoring the declaration would let a
`group → isolated` migration turn a governed master into an ungoverned one with no
signal. It is also ADR-0078's rule (no declarable-but-inert keys) applied to the one
key whose inertness would be a data-governance incident.

### D2 — Linkage is a declared natural key, not a row-id lookup

**How an override row names its template row** (#4585 point ①).

| Option | Shape | Verdict |
|:---|:---|:---|
| **L1** dedicated self-lookup | `template_id → same object` | rejected |
| **L2** declared natural key | `layered: { key: 'code' }`, resolution key = `(code, organization_id)` | **recommended** |
| **L3** ADR-0092 whitelist route | — | not applicable (C6) |

**Recommendation: L2.**

*实际业务需求* — the business already has the key. A material master is identified by
its material code in every ERP this pattern comes from; SAP's own layering
(`MARA` → `MARC`, client-level material → plant-level material) is keyed on the
material number, not on a surrogate link. An override row that carries the same `code`
as the template *is* the link, and it reads correctly to a human looking at the table.

*项目长远合理性* — a row id is minted per deployment. ADR-0105 D9 already rejected
per-deployment ids in portable metadata for exactly this reason and chose symbols
instead; the same argument transfers to distribution: a template published from a
package, replayed per organization (the cloud#881/#884 seed/config replay machinery),
or exported and re-imported must not require id rewriting to keep its links. L1 also
creates a lookup that **points across the wall** — an override row in plant A
referencing a row plant A cannot read — so its referential-integrity check would have
to run above Layer 0, i.e. as a system-context read, on the write path of an ordinary
business object. That is a new privileged read path for a link that L2 does not need.

*防 AI 写元数据犯错* — under L2 an AI author writing an override row writes the
business key it already knows. Under L1 it must first read the template row to learn
an id it cannot guess, and the failure mode of getting it wrong is a silently
unlinked row that resolves as a purely local record.

**Cost of L2, stated plainly:** there is no database-level referential integrity for
the link, and renaming a key value on a template silently re-parents (or orphans) every
override. Mitigation, to be settled in the implementation PR: the `key` field is
write-locked once the row participates in a layered set, and a rename is a dedicated
action that rewrites both layers, not a field edit.

**Uniqueness follows ADR-0120 mechanically**: the `key` field carries
`unique: 'organization'`, which materializes as
`COALESCE(organization_id, '__global__')` — one template slot, one slot per
organization, one index (C8). A `layered` object declaring `unique: 'global'` on its
key is a lint error: it would make the template and its first override collide.

### D3 — The template row is org-less, and Layer 0 gains exactly one declared opening

**Where the template row lives, and how the wall lets it through** (#4585 point ③,
visibility half).

| Option | Shape | Cost |
|:---|:---|:---|
| **T1** template owned by the group root org | plants are granted membership in the root org so it enters `accessible_org_ids` | over-grant: membership is all-or-nothing over **every** object in that org, and C4 means it cannot be narrowed afterwards by sharing |
| **T2** template is org-less (`organization_id IS NULL`); Layer 0 widened **only** for `layered` objects | `$or: [{ organization_id: { $in: accessible_org_ids } }, { organization_id: null }]` | opens Layer 0, and an org-less row is **installation**-global, not group-global |
| **T3** two objects | platform-global template object (`tenancy.enabled: false`) + org-scoped override object | zero engine change; two objects per master, resolution becomes a join, every view / report / AI author must know the pair |

**Recommendation: T2, with T3 named as the honest fallback** if the maintainer's
appetite for touching Layer 0 is nil.

*实际业务需求* — T1 fails the requirement outright: a plant operator must read the
material master without gaining read access to the group's finance, HR and approval
data, and under W1/W2 there is no second lever to take that access back.

*项目长远合理性* — T2 does not invent a rule so much as **reconcile a disagreement the
platform already has** (C1): the driver's native scoping says an org-less row belongs
to everyone; Layer 0 says it belongs to no one. Today the disagreement is harmless
because nothing writes org-less business rows. The moment D10 does, one of the two has
to move, and the `layered` declaration is precisely the place to say which — per
object, in metadata, visible in the JSON Schema, rather than as a wall-wide default
that would change the meaning of every org-less row in the database at once. The
opening is also **read-only by construction**: C2 already denies a tenant user any
write whose post-image carries an org other than their own, NULL included, so no
tenant context can mint, re-point or edit a template row. An org-less row carries no
other organization's data by definition, so the opening cannot leak org A to org B —
which is the property the wall actually exists to protect.

*防 AI 写元数据犯错* — T3's two-object shape doubles the metadata surface for every
master object and makes "which one do I query?" a question every author, human or
model, gets to answer wrongly. T2 keeps one object, one table, one name.

**The unresolved half, and it is the maintainer's call.** An org-less row is visible
across the **installation**, not across the **group**. In an environment whose
`parent_organization_id` forest has more than one root, T2's templates cross group
boundaries. Making them group-scoped instead requires resolving "the root of my group"
at authorization time — which is walking the org tree as an authorization input, the
substance of D6 red line ① (C3). The red line's letter forbids it in *authored* policies
and sharing rules; an engine-owned Layer 0 computation is a different mechanism, but it
is the same second hierarchy in spirit, and W1's warning ("a rule that appears to grant
access and does not") does not apply to something computed inside Layer 0 itself.

This is a genuine fork and it is not a developer's to take:

- **T2-flat** (recommended default): org-less templates, installation-global, no tree
  walk, no red-line question. Multi-group-per-environment is declared out of scope, and
  a second group belongs in a second environment (which is already true of every
  physical-isolation story, ADR-0002/0095).
- **T2-rooted**: templates carry the root org's id, and Layer 0 gains a group-root
  term for `layered` objects. Buys multi-group-per-environment; costs an engine-owned
  exception to the org-axis red line and a tree read on the authorization hot path
  (with a caching story that must respect the existing 60s staleness envelope).

### D4 — Reads do not silently collapse; resolution is explicit and names its organization

**Where resolution happens, and what a union reader sees** (#4585 point ②).

The reserved text says "org override wins", which is well-defined for a plant reader
and undefined for a union reader (C5). Three candidate semantics:

| Option | What a group-HQ union reader gets | Verdict |
|:---|:---|:---|
| **R1** resolve against the **active organization** | one row, resolved as the active org sees it; the template if the active org has no override | partial |
| **R2** no implicit resolution — raw rows; resolution is an explicit read option | template + every visible override, exactly what the wall returned | **recommended default** |
| **R3** resolve **per organization in the union** | one resolved row per participating org — "the master as each plant sees it" | **recommended as the explicit semantics** |

**Recommendation: R2 is the default; R3 is what "resolve" means when asked for; R1 is
available as the single-org convenience (`resolutionOrg: $active`).**

*实际业务需求* — the two real queries are different and both must be expressible. A
plant screen wants "my one row" (R1/R3 with one org). A group consolidated report wants
"the master as each plant sees it" (R3) — that is precisely the drill-down D2's union
wall was built for, and collapsing to one row destroys it.

*项目长远合理性* — R2 as the default keeps two things separable that must not be
conflated: **what the wall returns** and **what the resolver computed**. Under R1-as-a-
default, `count(*)` disagrees with the grid, an export disagrees with the table, and
nobody reading the result can tell which row won or why. Resolution is a projection, not
a scoping rule, and giving it the same silent, always-on status as the wall is how a
security primitive and a convenience feature become indistinguishable in an incident.

*防 AI 写元数据犯错* — an AI author reading a layered object under R2 sees the actual
rows and can reason about them. Under a silent-collapse default it sees a row that
exists in no table, and any write it derives from that read targets the wrong layer.

**Two mechanical constraints on the implementation, both load-bearing:**

1. **Resolution must not ride `DriverOptions.tenantIds`.** That option widens the
   *wall* (ADR-0105 D2 / #3631), and its documented failure mode is "absent or empty →
   fall back to `tenantId` equality (fail toward isolation, never toward exposure)". A
   resolution rule pushed down the same channel would inherit a fallback that means
   "fail toward isolation" for a wall and "fail toward the **wrong answer**" for a
   projection — a driver without native scoping would silently return unresolved rows
   that look resolved. Resolution belongs above the driver seam, in the engine read
   path, where every driver gets the same answer.
2. **Resolution is not authored.** Per C3 the merge cannot be expressed as an RLS
   policy or sharing rule, and per C4 it cannot be a sharing mechanism at all. It is
   engine machinery reading the `layered` declaration.

**A view layer is not an alternative to this decision, it is a consumer of it.** A
"resolved master" view is a fine product affordance and can be built on R3; what it
cannot do is *be* the resolution rule, because a view cannot bind the read path a flow,
an action, an export or an AI tool call takes.

### D5 — The three policies are declared per object and enforced on WRITE

**What 集团统管 / 分级 / 自由 mean for write authority** (#4585 point ③, policy half).

| `policy` | Chinese | Override rows | Write authority |
|:---|:---|:---|:---|
| `group_controlled` | 集团统管 | **refused** — the template is the only row | template: publish authority; overrides: none |
| `graded` | 分级 | permitted, but may diverge only on `overridable: [...]` fields | template: publish authority; overrides: the owning org's ordinary object permissions + FLS |
| `free` | 自由 | permitted on any field; an org may also hold rows whose key has no template | same as `graded` |

**Write authority introduces no new permission axis.** Template rows are org-less
(D3/T2) and C2 already restricts any write whose post-image carries a foreign
`organization_id` to a platform-admin / system context — which is exactly the
"publish" authority, and exactly what the commercial distribution tooling runs as.
Override rows are ordinary rows in the writing organization and keep their existing
permissions, FLS and RLS unchanged. Nothing here weakens an existing check.

**`graded` is enforced when the override row is WRITTEN, not when it is read.** A
write that diverges from the template on a non-overridable field is **refused**, with
the field and the policy named. It is not accepted-and-then-resolved-back-to-the-
template on read.

*项目长远合理性 / 防 AI 写元数据犯错* — a read-time overwrite means the row in the
table and the row on the screen disagree permanently, and the stored value is a lie
nobody is told about. That is the ADR-0049 defect class ("declared but unenforced")
in its purest form. A write-time refusal is also the only version an AI author can
learn from: it gets a loud error naming the policy and the field, instead of a write
that reports success and changes nothing.

*The cost*: tightening a policy (自由 → 分级, or shrinking `overridable`) can leave
existing override rows in violation. That is a migration with a pre-flight, on the
model of ADR-0120 D4's duplicate pre-flight for index tightening — the implementation
PR owes a "which orgs have diverged on a field you are about to lock" report before it
owes an auto-apply.

**Naming**: `group_controlled` / `graded` / `free` ship as the machine constants
(Prime Directive #3, `snake_case` data values); 集团统管 / 分级 / 自由 stay as the
customer-facing names in documentation and in the commercial policy UI.

### D6 — Reuse the D6/D9 grouping vocabulary verbatim; mint nothing

**Grouping-metadata dependency** (#4585 point ⑤). D10 adopts, unchanged:

- **`$root` / `$parent`** (`APPROVER_ORG_SYMBOLS`,
  `packages/spec/src/automation/approval.zod.ts:234`) as the portable way to name a
  publish target — `publishFrom: '$root'` means the same thing on every deployment,
  and an AI author needs no deployment knowledge to write it. A slug remains the escape
  for the shape symbols cannot express (a shared-services organization publishing a
  master it does not sit above), exactly as D9 allows.
- **"Shares a `parent_organization_id` root"** as the group-boundary predicate
  (`plugin-approvals/src/approver-org-scope.ts:186-197`), if and only if D3 resolves to
  T2-rooted. It is already the platform's one answer to "is this the same group", and a
  second predicate would be a second answer to the same question.
- **Refuse, don't ignore** as the posture-mismatch discipline (D1 above).

Explicitly **not** minted: a `layered`-specific organization hierarchy, a distribution
tree, a "publisher" org role, or any second grouping reference. Per D6 red line ① the
org tree stays reporting metadata; per C3 it may not become an authored authorization
input at all.

### D7 — The open/commercial line, stated rather than inherited

Per cloud ADR-0016's iron rule 「强制免费、治理收费」 and ADR-0105 D12 **as amended**
(#3570) — the split is **code vs. activation**, not code vs. code:

**Open, in the framework** (this is enforcement — the 强制 half):
- the `layered` declaration and its schema surface, including the JSON Schema every AI
  author reads;
- the D5 policy enforcement (write refusals) and its error vocabulary;
- the D4 resolution algorithm and the read-path seam it lives on;
- the D2 linkage / uniqueness gates and the D1 posture refusal;
- the D3 Layer 0 term, wherever it lands — the wall's implementation has always shipped
  open, exactly as `isolated`'s has.

**Commercial** (`@objectstack/organizations` + cloud — the 治理 half):
- publish / sync tooling: pushing a template revision out, replaying it per
  organization (the cloud#881/#884 machinery);
- the distribution policy UI and the per-object governance console;
- divergence reporting ("which plants have overridden what") and re-alignment actions;
- anything that manages the *lifecycle* of a distribution rather than enforcing its
  rules.

**Activation is entitled, and the failure is fail-fast.** `layered` only means anything
under the `group` posture, which already probes the enterprise `org-scoping` service
(ADR-0105 D12). A deployment that declares `layered` on any object while the probe is
absent **refuses to start**, on the ADR-0093 D5 guard, exactly as a `group`-configured
boot does. This is stated rather than inherited because the alternative reading —
"the declaration silently does nothing in the open edition" — is precisely the
silent-degradation hole #3570 was filed to close, and it would land here by default if
nobody wrote this paragraph. **Open code is not free activation.**

### D8 — What this ADR deliberately does not decide

- **Template versioning / effectivity dating.** Real ERP master distribution has
  effective-dated revisions and staged rollouts. Out of scope here and the single most
  likely follow-up; nothing in D1–D7 forecloses it.
- **Sub-field merge.** Resolution is per field. A JSON/array column resolves as one
  value; there is no deep merge inside it. (This is the same line ADR-0005 draws for
  metadata overlays.)
- **Cross-*group* distribution.** A template published to organizations that do not
  share a root is not a group master; it is a marketplace package (ADR-0025) or a
  reference-data object (`tenancy.enabled: false`), both of which already exist.
- **Any change to Layer 0 for objects that do not declare `layered`.** The wall's
  meaning for every existing object is untouched by every decision above.

---

## Non-goals

- No new permission axis, capability, or membership kind (D5).
- No permission inheritance along the organization tree — D6 red line ① stands, and D3
  is careful to say when it would be brushed against and why that is the maintainer's
  ruling to make (C3).
- No authored-metadata route to cross-organization visibility (C3/C4).
- No change to `PLATFORM_ADMIN` wall-crossing semantics.
- No implementation in this PR: this record is design material only.

---

## Alternatives considered

1. **Keep the Appendix A interim shape (OWD `public_read` + plant-scoped rows).**
   It is what the platform prescribes today and it is correct in the `single` posture.
   Under `group` it is defeated by C4: OWD is Layer 1 and cannot widen Layer 0, so the
   group's rows stop being readable across organizations the moment the wall turns on.
   The interim answer does not survive its own success.
2. **Resolution as an authored RLS policy or a sharing rule.** Closed by C3 at
   `error` severity, and by C4 in substance.
3. **Whole-object `tenancy.enabled: false` for the master.** The existing sanctioned
   escape hatch for cross-org catalogs (ADR-0105 D5), and it does make the template
   visible — but it removes the organization column from the object entirely, so
   per-org override rows lose engine scoping altogether. It answers half the
   requirement by deleting the other half. (Survives as the *template side* of T3.)
4. **A dedicated `sys_master_data_link` join object.** Adds a third row per logical
   master, an org-scoping question of its own, and a second place for the link to be
   wrong. L2's natural key needs no row at all.
5. **Resolving in the driver, alongside `tenantIds`.** Rejected under D4's constraint 1:
   it inherits a fail-toward-isolation fallback that means fail-toward-wrong-answer for
   a projection, and it makes the answer depend on whether the driver implements native
   scoping.
6. **Making resolution the default read semantics (R1-as-default).** Rejected under D4:
   it makes the table and the screen disagree with no signal, and it is unrecoverable
   for consolidated reporting, which is the reason the `group` posture exists.

---

## Consequences

**Positive.** The one remaining Phase 2 framework design item in ADR-0105 gets a
decision surface; cloud#874's "主数据分发管理" unblocks; the `group` posture gains the
master-data story its ERP peers (SAP `MARA`/`MARC`, NetSuite subsidiary-level item
records) have shipped for decades, expressed once in metadata rather than per customer
in application code; and the existing disagreement between the driver's native scoping
and Layer 0 over org-less rows (C1) gets resolved deliberately instead of being
discovered during an incident.

**Negative / costs.** D3 opens Layer 0 for the first time since ADR-0095 fixed it —
narrow, declared and read-only, but an opening, and it lands behind the
`authz-matrix-gate` snapshot with the same discipline ADR-0095 and ADR-0105 D4 used
(any visibility delta outside the intended one is a bug). D4 adds a read-path
projection stage with its own conformance rows. D5 adds a migration class (policy
tightening over existing divergence). D2's natural-key linkage has no database-level
referential integrity, which is a deliberate trade for portability and needs the
key-rename discipline named in D2 to be real rather than aspirational.

**Risks.** The largest is D3's flat-vs-rooted fork: choosing T2-flat and later needing
multi-group-per-environment means re-opening Layer 0 a second time, on live data, with
templates already published. Choosing T2-rooted up front costs a tree read on the
authorization hot path and a ruling against the grain of D6 red line ①. Neither is
cheap later; both are cheap now, which is why the fork is put to the maintainer rather
than defaulted.

---

## Open questions for the maintainer

Each carries a recommendation; none is settled by this draft.

1. **D3's fork — flat or rooted?** Recommended **T2-flat** (org-less templates,
   installation-global, multi-group-per-environment declared out of scope). T2-rooted
   buys multi-group at the price of an engine-owned exception to the org-axis red line.
   *This is the one decision the rest of the ADR bends around.*
2. **D4's default — is R2 (no implicit resolution) acceptable as the default read?**
   Recommended yes. The alternative (R1-as-default) is more convenient on a plant
   screen and permanently ambiguous everywhere else.
3. **D5's enforcement point — write-time refusal, confirmed?** Recommended yes
   (ADR-0049). The cost is a migration pre-flight when a policy tightens.
4. **D2's linkage — natural key, accepting no DB-level referential integrity?**
   Recommended yes, conditional on the key-rename discipline being built, not promised.
5. **Phasing.** Suggested: Phase A = D1/D2/D5 (declaration, linkage, policy — all
   write-side and all enforceable without touching Layer 0, deliverable against `single`
   and `group` alike); Phase B = D3/D4 (the wall term and the resolver); Phase C = the
   commercial distribution surface on cloud#874. Phase A is genuinely useful alone: it
   makes the governance declarable and enforced before the visibility question is
   settled.

---

## Appendix A — inputs to verify before acceptance

The drafting session could not read the `objectstack-ai/cloud` repository. The
following were supplied as an extract or named by #4585 and are recorded as
**inputs to verify**, not as established facts:

| Input | What was relied on | Status |
|:---|:---|:---|
| cloud#874 | "Master-data distribution management (D10: 集团统管 / 分级 / 自由 policies) — blocked on the D10 follow-up framework ADR, tracked in objectstack#4585", and its open/commercial listing | second-hand extract; D7 is written to match it and should be re-read against the live card |
| cloud#874 (2026-07-27 founder ruling) | cloud ADR-0016 铁律; enforcement open, but a deployment configured into the group posture without the entitlement **refuses to boot** | second-hand; D7's activation paragraph depends on it |
| cloud#2937 | cross-org mirroring contract — the `isolated`-posture analogue of distribution | **not read.** If mirroring already defines a template/override reconciliation vocabulary, D4 should reuse it rather than mint one |
| cloud#881 / cloud#884 | per-org seed/config replay — the "same rows, many orgs" machinery D2's portability argument leans on and D7 assigns to the commercial side | **not read.** D2's claim that a natural key survives replay unchanged should be confirmed against the actual replay implementation |

## Appendix B — the reserved text this ADR discharges

ADR-0105 D10, verbatim:

> **D10 — Layered master data (group template + org override).**
> A spec-level pattern for the SAP material-master / 用友-金蝶 distribution
> shape: an object may declare layered governance — group-level template rows
> (platform-global or group-org-owned, read-shared) plus per-org override rows
> linked to the template, with a resolution rule (org override wins). Mechanics
> (linkage field, resolution in the read path or a view layer, distribution
> policies: 集团统管 / 分级 / 自由) to be detailed in a follow-up ADR; this ADR
> reserves the concept and its place in Phase 2.

Mapping: "linkage field" → D2 (and the answer is a key, not a field);
"platform-global or group-org-owned, read-shared" → D3 (and the choice between the two
is the open fork); "resolution in the read path or a view layer" → D4 (read path; a
view layer is a consumer, not the seam); "resolution rule (org override wins)" → D4,
qualified by C5 — the rule needs a resolution *organization* before it means anything;
"distribution policies" → D5; the open/commercial line and the grouping vocabulary,
neither of which the reserved text mentions, → D7 and D6.

On acceptance, ADR-0105's D10 entry and its "D10 mechanics — reserved, follow-up ADR"
non-goal line should be updated to point here, and its Status line's "D10 stays reserved
pending its follow-up ADR" amended — a docs-only follow-up, deliberately not bundled
into this record.
