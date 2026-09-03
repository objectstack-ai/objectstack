# ADR-0070: Package-first authoring — every runtime-authored item lives in a writable package (base); no orphans

**Status**: Accepted (2026-06-24) — P1–P3 implemented, merged & live-verified (see *Implementation status*); D4–D6 remaining
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0005](./0005-metadata-customization-overlay.md) (`allowOrgOverride` / runtime overlay model; one Zod source per type), [ADR-0048](./0048-cross-package-metadata-collision.md) (one app per package; package id is the addressing unit), [ADR-0033](./0033-ai-assisted-metadata-authoring.md) (AI authors metadata as drafts), [ADR-0067](./0067-commit-history-and-rollback-for-ai-authoring.md) (commit history & rollback for AI authoring)
**Consumers**: `@objectstack/objectql` (`protocol.saveMetaItem` write path), `@objectstack/spec` (metadata-type registry), `../objectui` (Studio create flow, package scope selector, `PackagesPage`), `../cloud` (`service-ai-studio` — `create_metadata` / `resolvePackageId` / `apply_blueprint`)

**Premise**: pre-launch — specify the target end-state. The platform already has the **package** primitive (ADR-0048) and a runtime overlay store (ADR-0005); what is missing is a *contract* that ties every runtime-authored item to a writable package and forbids package-less ("orphan") metadata. The **Airtable model** is the north star: you create a **base** (= a writable software package) first, then author objects/fields/views/flows **into it**; the base is the unit you organise, version, export, and **delete**. Items below are tagged **[existing]** / **[new]**.

> **Trigger**: a business-user dogfood pass of Studio surfaced a family of related defects whose common root is the *absence of a package-first contract*:
> 1. **Read-only-after-publish** ([framework#2252](https://github.com/objectstack-ai/objectstack/pull/2252)): authoring a new object while a *code* package was selected stamped the new row with that code package's `package_id`, so it read back as "code-provided" and locked itself read-only the moment it was published — the user could not edit what they had just created.
> 2. **The orphan pile / no delete unit** ([objectui#1946](https://github.com/objectstack-ai/objectui/pull/1946)): the band-aid for (1) coerces such writes to `package_id = null`. That correctly unblocks editing, but it scatters runtime metadata into a package-less bucket that the package-scoped Studio lists filter *out* — items become hard to find and, critically, **there is no container to delete**: "how do I clean up a pile of loose metadata?"
> 3. **AI authoring can still orphan**: `../cloud`'s `service-ai-studio` resolves a target package with smart fallbacks (active package -> single-app package -> **auto-created `com.workspace`**) and rejects read-only code packages, but it never *requires* the user/agent to choose a base first — so it can silently default into a catch-all dumping ground.
>
> The fixes shipped so far (#2252, #1946) are deliberate **stopgaps**. This ADR replaces them with the proper model.

## Implementation status (2026-06-24) — P1–P3 done, live-verified

Built across the three surfaces and verified end-to-end in a real environment via the AI build flow.

- **P1 — Kernel (D1/D2)** — `@objectstack/objectql` ([framework#2285](https://github.com/objectstack-ai/objectstack/pull/2285)): `isWritablePackage` predicate; a runtime-only create targeting a read-only code/installed package is **rejected** with `writable_package_required` (422) instead of coerced to `null`.
- **P2 — Studio (D3)** — `../objectui` ([objectui#1970](https://github.com/objectstack-ai/objectui/pull/1970)): a create-flow gate that prompts/redirects to a writable base; `isLocalScope` / `writableBaseOptions` helpers; surfaces `writable_package_required` as an actionable error.
- **P3 — AI (D3)** — `../cloud` `service-ai-studio` ([cloud#479](https://github.com/objectstack-ai/cloud/pull/479), [cloud#481](https://github.com/objectstack-ai/cloud/pull/481); tests [cloud#480](https://github.com/objectstack-ai/cloud/pull/480)): drops the shared `com.workspace` catch-all and auto-creates an **intentional named** base via `protocol.installPackage` (a real, Studio-visible package); single-writable-base coherence groups an incremental build into one base; an explicit platform/system `packageId` is discarded; empty field props are sanitized.
- **Live dogfood (real LLM + runtime)**: a one-sentence magic build plus iterative business-user changes (add a related object, add a field) all landed in **one** app base (`app.iojn`), live and editable — no `com.workspace`, no orphans.
- **Remaining**: **D4** (package-as-lifecycle-unit: delete-cascade / export / duplicate), **D5** (orphan migration + stopgap removal), **D6** (framing). The P1 kernel rejection becomes the runtime backstop once the framework release is consumed by the cloud runtime (today's runtime links the published framework).

## TL;DR

1. **[new] No orphan authored metadata.** Every runtime-*created* metadata item is bound to a **writable package** (`package_id` is a real, writable package id — never `null`, never a code/installed package). The "package-less / `sys_metadata`-scope" state stops being an authoring destination; it remains only as a read-side rehydration detail and a migration source.
2. **[existing->ruled] Two package kinds.** *Code/installed* packages (manifest `source: 'filesystem'` / installed via marketplace) are **read-only** — you may org-overlay an item where `allowOrgOverride` (ADR-0005), but you may **not** author *new* items into them. *Writable* packages (DB-backed, user/AI-created "bases") are the only authoring targets.
3. **[new] Create-flow contract — "pick or create a base first".** Before any create, all three surfaces (Studio UI, the AI authoring tools, the kernel write path) resolve to a writable package or **prompt to create one** — no silent default. This is enforced in code, not just prompt guidance.
4. **[new] The package is the lifecycle unit.** Delete (cascade all its items + data), export, snapshot/version, and duplicate operate on a whole package. This is the answer to "how do I delete the mess."
5. **[ruled] Retire the stopgaps.** #2252's null-coercion evolves into *redirect-to-a-writable-package*; #1946's "Local / Custom" scope becomes a **migration affordance** ("move these loose items into a base") and is then removed.

---

## Context: what each surface does today

| Surface | Where new metadata's package comes from | Orphan possible? | Read-only code pkg? | Status |
|---|---|---|---|---|
| **Kernel** `protocol.saveMetaItem` (`@objectstack/objectql`) | `?package=` passed by caller; for a `runtime-only` write whose target is a *loaded code package*, the binding is **coerced to `null`** (`isLoadedPackage` guard, #2252) | **Yes** — by design today (the coercion *creates* nulls) | guarded (won't stamp into a loaded code pkg) | **[existing]** |
| **Studio UI** (`../objectui`) | the package **selector** (`StudioHomePage`/`DirectoryPage`/`ResourceListPage` read `?package=`); a "Local / Custom" scope (`sys_metadata`) surfaces the null bucket (#1946); `PackagesPage` *can* create a writable package, but the create flow doesn't **require** one | **Yes** — default scope is a code pkg or the null bucket | partially (object becomes read-only — fixed for editability, not for *where it lives*) | **[existing]** |
| **AI authoring** (`../cloud` `service-ai-studio`) | `resolvePackageId` (`metadata-tools.ts`): explicit `packageId` -> target item's pkg -> conversation active pkg -> single-app pkg -> **auto-create `com.workspace`**; read-only pkgs **rejected** (); `create_package` / `set_active_package` / `apply_blueprint` (`ensureAppPackage`) exist | **Soft** — auto-defaults into a catch-all instead of requiring a choice | **rejected** (`metadata-tools.ts`) | **[existing]** — most advanced of the three |

The primitives already exist on every surface (a package concept; a way to create one; a read-only/writable distinction in cloud). **What is missing is a single, enforced contract** so the three surfaces agree, and so authored metadata always has a managed home.

---

## Decision

### D1 — Authored metadata is package-bound; orphans are disallowed [new]

A runtime **create** (`intent = runtime-only`, i.e. not an overlay of an artifact item per ADR-0005) MUST resolve to a **writable** `package_id`. The kernel write path is the enforcement point of last resort:

- `protocol.saveMetaItem` gains a notion of *writable-package required for runtime creates*. When the resolved target is missing or is a **code/installed** package, the write is **rejected** with a structured, actionable error (`code: 'writable_package_required'`) rather than silently coerced to `null` (today's #2252 behaviour).
- `null` / `sys_metadata`-scope ceases to be a *write* destination for new items. It survives only as (a) the read-side rehydration tag for legacy rows and (b) the source set for the D5 migration.
- Overlays of artifact items (`intent = override-artifact`, `allowOrgOverride`) are **unchanged** — they keep their binding to the packaged item they customise.

### D2 — Two package kinds; only writable packages are authoring targets [existing->ruled]

- **Code / installed packages** — manifest `source: 'filesystem'`, or installed via the marketplace; scope `system` / `cloud` (already filtered out of the Studio selector). **Read-only.** New items may not be authored into them; only `allowOrgOverride` overlays are permitted (ADR-0005). This mirrors Airtable's installed apps/templates.
- **Writable packages (bases)** — DB-backed, created by a user or the AI (`PackagesPage` create dialog; cloud `create_package`). The only valid authoring destination. Scope `project`.

The kernel exposes a single predicate — *is this package writable?* — reused by all surfaces (cloud's `resolvePackageId:319` read-only check is the seed of this).

### D3 — Create-flow contract: select-or-create a base first, enforced everywhere [new]

Every authoring surface follows the same contract; none silently defaults into a catch-all:

- **Studio UI** [new]: the scope selector defaults to a *writable* package (the user's most-recent base) or, when none exists, the create entry points (`新建`) **prompt to create a base** (reuse the existing `PackagesPage` create dialog) before opening the designer. New items are bound to the active writable package. The "Local / Custom" (`sys_metadata`) scope is removed as a create destination (see D5).
- **AI authoring** [new] (`../cloud` `service-ai-studio`): `resolvePackageId` **drops the auto-`com.workspace` fallback** (`metadata-tools.ts`) and the `applyDraft` re-bind (); when no writable package is resolvable it returns an actionable error directing the agent to `create_package` or `set_active_package`. `apply_blueprint` requires a package context (its `ensureAppPackage` is invoked only after an explicit create/confirm). Skill prompts (`metadata-authoring-skill.ts`, `solution-design-skill.ts`) are updated to make "establish the base first" a hard step, not a hint.
- **Kernel** [new]: D1 is the backstop — even if a surface regresses, the write is rejected, not orphaned.

### D4 — The package is the lifecycle unit (delete / export / snapshot / duplicate) [new]

Operating on a *base* operates on all of its contents — this is the direct answer to "a pile of loose metadata, how do I delete it?":

- **Delete**: deleting a writable package **cascades** to all its metadata items (and, per the env's data-lifecycle contract, optionally its seeded/created data). Builds on `registry.uninstallPackage` (`@objectstack/objectql`), extended to a *writable-base delete* that removes the DB-backed items it owns.
- **Export / snapshot / version**: a base can be exported (the "app = package" north star) and snapshotted (ADR-0067 commit history is per-package).
- **Duplicate**: clone a base into a new writable package (the Airtable "duplicate base" gesture).

### D5 — Retire the stopgaps via a migration affordance [ruled]

- The framework #2252 *coerce-to-null* behaviour is replaced by D1 *reject/redirect-to-writable-package*. Existing `package_id = null` rows are not broken.
- The objectui #1946 *"Local / Custom"* scope is repurposed as a **one-time migration surface**: it lists the legacy package-less items and offers "move into a base" (assign them a writable `package_id`). Once an environment has no orphans, the scope is removed from the selector.
- A small migration (or admin action) can bulk-assign legacy orphans to a default base named for the environment.

### D6 — Single-tenant framing; no "org" dumping ground [ruled]

A metadata-customizable deployment is **single-tenant** (an *environment*; `project -> environment`); there is no per-org overlay dimension here. The relevant axis is **code package vs writable base**, not "org". The earlier instinct to make a package-less "org/local" scope the *default* is explicitly rejected: it reproduces the orphan pile. (Multi-tenant hosting keeps `package_id = null` overlays as a *tenant-overlay* mechanism; that is orthogonal and out of scope for this ADR.)

---

## Consequences

- **Positive**: every authored item has a managed home; bulk delete/export/duplicate become trivial (whole base); the three surfaces (kernel / Studio / AI) share one contract; AI output is never orphaned; the "read-only after publish" and "where did my object go" classes of bug are designed out, not patched.
- **Cost / migration**: a create now has a (cheap, one-time per environment) "create your first base" step; existing null-scope rows need the D5 migration; #2252/#1946 code is removed after migration. The cloud `resolvePackageId` fallback removal must be paired with good "no package selected" UX so the AI does not dead-end.
- **Risk**: over-strict enforcement could block legitimate flows (e.g. seed/import). Mitigation: the writable-package requirement applies to *interactive authoring*; bulk import paths may pre-create a base. Validate against the dogfood gate.

## Open questions

1. **Default base auto-provisioning**: do we auto-create a single "My workspace" base on first authoring (one-click, then required thereafter), or always force an explicit create? (Cloud currently auto-creates `com.workspace`; D3 removes the *silent* version but a *prompted* one-click is acceptable.)
2. **`allowOrgOverride` types in single-tenant**: in a single-tenant env, is org-overlay of a code item still meaningful, or should customising a code item also fork it into a writable base? (Leaning: keep overlay for surgical tweaks; "fork to base" for substantial changes.)
3. **Delete-cascade & data**: does deleting a base also delete the *records* of its objects, or only the schema? Ties to the data-lifecycle ADR (retention).
4. **Naming/id ergonomics**: bases need friendly names but stable ids (`app.<slug>` today). Surface a name; keep the id stable.

## Rollout (tracked separately — see the package-first epic)

1. ✅ Kernel D1/D2 predicate + `writable_package_required` rejection (`@objectstack/objectql`) — [framework#2285](https://github.com/objectstack-ai/objectstack/pull/2285).
2. ✅ Studio D3 create-flow + selector default (`../objectui`) — [objectui#1970](https://github.com/objectstack-ai/objectui/pull/1970). (PackagesPage delete/duplicate moves to D4.)
3. ✅ AI D3 in `service-ai-studio` (drop fallback, named base, skills) — [cloud#479](https://github.com/objectstack-ai/cloud/pull/479), [cloud#481](https://github.com/objectstack-ai/cloud/pull/481); tests [cloud#480](https://github.com/objectstack-ai/cloud/pull/480).
4. ⏳ D4 package-as-unit (delete-cascade, export/duplicate).
5. ⏳ D5 migration affordance; remove #2252/#1946 stopgaps.
6. ◐ Dogfood-gate coverage — live-verified end-to-end; automated gate pending.
