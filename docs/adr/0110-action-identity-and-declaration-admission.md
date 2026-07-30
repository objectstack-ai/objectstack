# ADR-0110: An action's identity is its `name`; anything executable over a governed surface must have a declaration (the declaration-admission gate)

**Status**: **Accepted — implemented** (2026-07-29) in protocol 17 (`@objectstack/spec@17.0.0-rc.0`). The fail-closed inversion landed in that major rather than staging across two, joining its two siblings in the v17 breaking set: *"A flow run with no trigger user may not touch data"* (#3760 — missing identity fails closed) and *"A datasource that cannot connect fails the boot"* (#3741/#3758/#3826 — an unreachable dependency refuses rather than degrades).
Evidence: D1/D2 — `action-execution.ts` (`resolveActionHandlerKeys`, `executeRegisteredAction`) shared by `domains/actions.ts` and `invokeBusinessAction`, pinned by `http-dispatcher.actions-identity-addressing.test.ts` (the documented curl now gates AND dispatches). D3 — the trichotomy in `domains/actions.ts`, reading the `degraded` signal `MetadataManager.loadDiagnosed` supplies (`metadata-manager.ts`). D5 — `reconcileActionRegistrations` + `ObjectQLEngine.listRegisteredActions`, wired to the `kernel:ready` inventory in `app-plugin.ts`, covered by `action-reconciliation.test.ts`. D1 client — `../objectui` `useConsoleActionRuntime.tsx`. D4 + migration — `content/docs/ui/actions.mdx`, `content/docs/releases/v17.mdx`.
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove gate; a security property that parses but does nothing is worse than absent), [ADR-0066](./0066-unified-authorization-model.md) (D4 — action `requiredPermissions`, dual-surface, server is source of truth), [ADR-0078](./0078-no-silently-inert-metadata.md) (no silently inert metadata — this ADR is its **converse**: no silently ungoverned executable), [ADR-0096](./0096-execution-surface-identity-admission.md) (missing **identity** must not fail open; this ADR extends the same posture to missing **declaration**), [ADR-0104](./0104-field-runtime-value-shape-contract.md) (D2 — declared action param contract), [ADR-0109](./0109-ai-tool-authoring-model.md) (every declarative action materialises `action_<name>`; the declaration IS the AI-facing capability)
**Consumers**: `@objectstack/runtime` (`domains/actions.ts`, `action-execution.ts`), `@objectstack/objectql` (`registerAction` contract), `@objectstack/lint` (new reconciliation rule), `../objectui` (`useConsoleActionRuntime` invocation URL), `content/docs/ui/actions.mdx` (public REST contract)
**Surfaced by**: framework#3935 (target-bound actions skip the D4 gate on REST), found while verifying #3915/#3919/#3934 (REST action-type dispatch) against the running console.

---

## TL;DR

The spec already separates two concepts cleanly:

```ts
name:   SnakeCaseIdentifierSchema   // 'Machine name (lowercase snake_case)'
target: z.string().optional()       // 'URL, Script Name, Flow ID, or API Endpoint.
                                    //  Supports ${param.X} and ${ctx.X} interpolation.'
```

`name` is an **identity**. `target` is a **binding expression** — polymorphic
per `type` (URL / script key / flow id / FormView name / endpoint),
interpolatable at runtime, and legitimately **non-unique** (two actions may
bind the same handler). The runtime, however, lets the two leak into each
other's role, and the result is that the REST `/actions` route's security
gates hang off a lookup that its own primary caller misses:

- The route resolves the **declaration** (gate + param contract + type) by
  the URL's `:action` segment *as a name* — but dispatches the **handler**
  by the same segment *as a registry key*. One URL segment, two namespaces.
- The console posts `action.target || action.name` (the handler key); the
  public docs teach `curl .../actions/todo_task/complete_task` (the name).
  **Each caller works on exactly the half the other breaks**:

  | Caller | URL segment | Handler dispatch | D4 gate + 0104 params |
  |---|---|---|---|
  | Documented curl (`name`) | `complete_task` | ❌ `not found` (registry key is `completeTask`) | ✅ resolved |
  | Console (`target`) | `completeTask` | ✅ runs | ❌ **silently skipped** |

  The docs' claim that "the Console button and the API call run the same
  gate and handler" is currently false in both directions.

- When the declaration lookup misses, the route treats the action as
  "handler-only" and runs it **ungated** — collapsing three distinct states
  (declared-but-missed, metadata-plane-unreachable, genuinely undeclared)
  into one fail-open branch. Deleting a declaration today does not lock an
  action down; it **unlocks** it.

**Decision.** Six rulings: **D1** an action's invocation identity is `name`,
on every surface — `target` is never an identity key; **D2** every dispatch
surface resolves the declaration *first* and derives handler-key candidates
*from* it (the MCP order becomes the shared order); **D3** declaration
resolution is a trichotomy — found → gate-then-dispatch, metadata plane
unreachable → 503, genuinely undeclared → **refuse, fail-closed in 17,
with no opt-out** (see the D3 revision note); **D4** "declared but hidden" is the blessed pattern for
headless actions — "undeclared but executable" has no remaining legitimate
use; **D5** a reconciliation lint + boot check: every `registerAction` key
must reconcile to a declaration; **D6** security-gate strictness is
opt-**out**, never opt-in.

---

## Context

### The mechanism, concretely

`packages/runtime/src/domains/actions.ts` (the REST `/actions/:object/:action`
route) after #3915/#3919:

```ts
const declaration = await actionExec.resolveRouteActionDeclaration(deps, {
    ql, objectName, actionName, ... });          // ← actionName as NAME
...
} catch {
    /* schema unresolved → no declared gate to enforce (handler-only action) */
}
...
ql.executeAction(obj, actionName, actionContext); // ← actionName as REGISTRY KEY
```

Handler registration is split by whether the action has a `body`:

- `app-plugin.ts` auto-registers **body** actions under `name` ("Actions
  without a body are left for legacy imperative `engine.registerAction(...)`
  registration in user code");
- user code registers **target-bound** script actions under `target`
  (`engine.registerAction('todo_task', 'completeTask', completeTask)` — the
  app-todo example, mirroring the docs).

So the URL segment can only ever match *one* of {declaration, handler} for a
target-bound action, whichever the caller happened to send. The console
(`useConsoleActionRuntime.tsx`: `const targetName = action.target ||
action.name`) sends the handler key; the gate misses; `actionDef` is
`undefined`; both `actionPermissionError(deps, undefined, …)` and
`enforceActionParams(deps, undefined, …)` return `null`. ADR-0066 D4 and
ADR-0104 D2 are **declared-but-unenforced on the platform's primary calling
surface** — the exact fourth state ADR-0049 prohibits.

The MCP path (`invokeBusinessAction`) already has the correct order: resolve
the declaration by `name`, enforce every gate against it, *then* rotate
handler-key candidates derived from the declaration:

```ts
const primary = action.body ? action.name : (action.target || action.name);
const candidates = [primary, action.target, action.name].filter(…);
for (const obj of [objectName, '*']) for (const key of candidates) { … }
```

Identity first, addressing second. The REST route has neither the order nor
the rotation; it was masked by the console coincidentally posting the key
that dispatch needed (and never the one the gate needed).

### What "handler-only" actually is

The fail-open `catch` names its assumption: *no declaration ⇒ author wanted
no gate*. But the branch conflates three states with opposite meanings:

1. **Declared, but the lookup missed** — #3935 itself. The author declared
   `requiredPermissions`; the platform skipped them. A routing bug read as
   an authorization decision.
2. **Metadata plane unreachable** — the same `catch` swallows a down
   metadata service. An availability failure **widens access**: the
   endpoint an admin gated yesterday is open during today's outage.
3. **Genuinely undeclared** — a handler registered with no declaration
   anywhere. It executes **TRUSTED** (system-elevated, RLS/FLS-bypassing —
   the audit lines in both dispatchers say so), yet it is invisible to
   `list_actions`, ungoverned by D4, unchecked by 0104, absent from Studio,
   and — per ADR-0109 — materialises **no** `action_<name>` tool, so the AI
   surface cannot see it *by construction*. Maximum trust, minimum
   description, on the same artifact.

State 3 deserves scrutiny on its own terms. Every imagined use decomposes
into either "*don't show a button*" — which is a **visibility** concern the
declaration already models (`visible`, `locations`, `ai.exposed`,
`requiredPermissions`), or "*only called by server code*" — which is a
**plain function**, not something that belongs on a public HTTP route. A
declaration hidden from every surface is strictly superior to no
declaration: still gated, still auditable, still enumerable by an admin.
"Executable over HTTP but undeclared" has no remaining legitimate use.

### Why this is a platform decision, not a bug fix

Three converging reasons:

1. **The deletion inversion.** On a metadata platform, removing metadata
   must narrow what the system does, never widen it. Today, deleting an
   action's declaration removes its gate while the handler stays registered
   — the one operation every authoring surface offers (delete) is a
   privilege-escalation primitive. No amount of documentation fixes a
   property that inverted.

2. **The AI-author failure path.** The platform's premise is that an agent
   holds the app *as metadata* and reasons about it. The most common
   AI-authoring error is **incomplete or slightly-wrong metadata** — a
   misplaced declaration, a missing `requiredPermissions`, a name mismatch.
   Under fail-open, that most-common error maps to *a publicly invocable,
   system-elevated endpoint, silently*. An agent can fix a prescriptive
   404 ("no declaration for 'x' — add `defineAction({...})`"); it cannot
   fix a hole it can never observe. ADR-0078 named the asymmetry for inert
   metadata ("an AI gets a success envelope and reports done"); the same
   asymmetry holds here with the sign flipped — and a security consequence
   attached.

3. **The 0078 duality.** ADR-0078 prohibits declarations with no
   executable reader (*silently inert*). This ADR prohibits executables
   with no declaration (*silently ungoverned*). Together they close the
   bijection the platform's premise depends on: **everything declared runs;
   everything that runs is declared.** Either half without the other leaves
   the metadata a partial, untrustworthy map of the application.

## Decisions

### D1 — Invocation identity is `name`, on every surface

The `:action` segment of `POST /api/v1/actions/:object/:action`, the MCP
`run_action` `name` argument, and any future dispatch surface identify an
action by its declarative `name`. `target` is a binding expression —
polymorphic, interpolatable, non-unique — and is **never** accepted as an
identity key. (A `type:'url'` action's target is a URL; treating target as
identity means routing on URLs. The spec already rules this: `name` is the
`SnakeCaseIdentifierSchema` machine name.)

The console's `target || name` URL construction is a bug under this ruling
and is fixed to `name`. The documented curl contract
(`content/docs/ui/actions.mdx`) is already D1-conformant and becomes true
once D2 lands.

**No transitional target-acceptance path.** An earlier draft proposed the
server accept a target-shaped segment during a compatibility window, gated
on unambiguous resolution. That window does not exist: objectui ships in
lockstep with the framework, and both ship inside the 17 major. Admitting
`target` as an identity key "temporarily" would mean building the exact
second namespace D1 exists to prohibit, complete with a uniqueness rule, and
then removing it one release later. A caller that posts a `target` gets the
same treatment as any other unresolvable segment (D3).

### D2 — Resolve, then address: declaration first, handler-key candidates derived from it

Every dispatch surface follows the MCP order: (1) resolve the declaration by
`name`; (2) enforce every gate against it (D4 permissions, 0104 params,
type dispatch, AI exposure where applicable); (3) derive handler-key
candidates **from the declaration** (`body ? name : target || name`, the
existing rotation) and probe `objectName` then `'*'`. The candidate
rotation moves from `invokeBusinessAction` into a shared helper in
`action-execution.ts` consumed by both the REST route and MCP — one
addressing algorithm, not two.

This also fixes the REST route's *weaker-than-MCP* dispatch: today it only
rotates the object (`objectName → '*'`), never the key, which is why the
documented curl 404s.

### D3 — Declaration resolution is a trichotomy; only one branch dispatches

| State | Behaviour |
|---|---|
| **Declaration found** | Gate against it, then dispatch (D2). |
| **Metadata plane unreachable** | **503.** An availability failure is not an authorization decision; the gate an author declared must not evaporate during an outage. (The ADR-0096 posture — "no context" is a defect, never an authorization — applied to "no declaration source".) |
| **Genuinely undeclared** | **Refuse** (404) with a prescriptive error: `Action 'x' on 'y' has no declaration — add defineAction({ name: 'x', … }) or register it under a declared action's target`. No opt-out — see the revision note below. |

**Fail-closed in 17 — no cross-major staging.** An earlier draft staged this
over two majors (warn → CI-only → flip). Protocol 17 is in RC *now*, so the
breaking window this ADR was waiting for is the one already open, and
staging would keep a known-open authorization hole through an entire
additional major. Two rulings the platform already holds make waiting
untenable: ADR-0049 prohibits a security property that parses but does not
enforce — and a warn-only gate is precisely that fourth state; and v17
already lands two siblings of this exact inversion (a trigger-user-less flow
may not touch data; an unreachable datasource fails the boot). A third
fail-closed ruling belongs in the same release, not the next one.

Three things must ship **together, in 17**, or the refusal is undiagnosable:

1. **D2 first, unconditionally.** Without the shared handler-key rotation,
   every *declared* target-bound action misresolves and would be refused as
   "undeclared" — the refusal must land on top of correct resolution, never
   before it. This ordering is an invariant, not a preference.
2. **The D5 reconciliation lint**, so an app finds its orphaned handlers at
   build time *before* upgrading, not at runtime after.
3. **The boot listing** — startup enumerates every registered-but-undeclared
   handler key. A hard failure without an inventory is a support ticket; with
   one it is a checklist.

Plus a `content/docs/releases/v17.mdx` migration entry, alongside its two
siblings, naming the inventory as the migration path.

> **Revision (2026-07-30, before 17 shipped) — the migration valve is gone.**
> As accepted, D3 shipped `OS_ALLOW_UNDECLARED_ACTIONS=1`: an opt-out that ran
> the undeclared handler anyway, warning per invocation, "slated for removal in
> 18". It was removed before the release on two grounds.
>
> **It contradicts the ruling it accompanies.** A flag that executes an
> ungoverned, system-elevated handler *is* the fail-open D3 closes. Shipping it
> would have preserved the hole in configurable form, and ADR-0049's trichotomy
> does not have a "enforced unless a flag says otherwise" state.
>
> **It had no observed users.** A reconciliation sweep across the platform
> packages, every example and every plugin found the only `engine.registerAction`
> call sites are `app-todo`'s eight, all declared. The valve would have shipped
> a documented way to reopen the gate for a population nobody has ever seen —
> and escape hatches with no users are the ones that quietly become permanent,
> which the removal-in-18 note was itself an admission of.
>
> What the valve was buying is covered without it: the app still boots, every
> declared action still works, D5's inventory names each offender at startup,
> and the 404 names the `defineAction` to add. The migration costs a code
> change rather than an env var — which, for reopening an authorization gate,
> is the correct price.

The deletion inversion closes in 17: deleting a declaration moves the action
from "gated" straight to "refused". Removal narrows, immediately.

### D4 — "Declared but hidden" is the blessed headless pattern

An action meant to be invocable but not user-facing declares itself and
hides: no `locations` / `visible: false` for the UI, `ai.exposed: false`
(the default) for the AI surface, `requiredPermissions` for the capability
boundary. This is documented in `content/docs/ui/actions.mdx` as *the*
pattern, replacing any residual notion that omitting the declaration is how
you hide an action. Server-internal logic that should never be invocable
over HTTP is a plain exported function — `registerAction` is an HTTP/MCP
admission, not a code-organisation tool.

### D5 — Reconciliation lint + boot check (the 0078 converse, mechanised)

A new `@objectstack/lint` rule (sibling of `validate-action-name-refs`)
reconciles the two halves in both directions within an app bundle:

- every `registerAction(obj, key, …)` key must match some declaration on
  `obj` (or `'global'`/`'*'`) by `name` or `target` — else
  `undeclared_action_handler`;
- every declared **script** action must resolve a handler (`body`, or a
  `target`/`name` registration) — else the existing dead-declaration
  finding (ADR-0078's side).

The same reconciliation runs best-effort at boot (warn-level, listing
orphans on both sides), so runtime-registered handlers that lint cannot see
statically are still surfaced. This is the highest-leverage piece for AI
authors: it converts a silent runtime hole into a build-time message an
agent can act on.

### D6 — Security-gate strictness is opt-out, never opt-in

`OS_ACTION_PARAMS_STRICT_ENABLED` (opt-**in** strict) is an acceptable
shape for a *param-contract* ratchet (DX concern, warn-first). It is not an
acceptable shape for an *authorization* gate: an enforcement that ships off
for everyone who never read the release notes is not enforcement. A flag
spelled `OS_ALLOW_*` (opt **out** of enforcement) is the sanctioned shape
where a security escape hatch is warranted at all; `OS_*_STRICT_ENABLED`
(opt in to enforcement) is reserved for non-security contracts. Existing
flags are not renamed by this ADR; new ones conform.

**The strongest form of this rule is no flag at all.** D3 originally carried
an `OS_ALLOW_UNDECLARED_ACTIONS` opt-out — correctly *spelled* under this
ruling, and still wrong, because what it opted out of was the gate itself
rather than a strictness dial around it (see the D3 revision note). So D6
governs the naming and direction of a security flag *where one is
justified*; it is not a licence to add one. An authorization boundary with a
documented bypass is the boundary its bypass describes.

## Alternatives considered

- **Make the route resolve declarations by `target` too.** Rejected: it
  promotes a binding expression into a second identity namespace the
  platform must then keep unique, non-interpolated, and matchable forever —
  cementing the confusion #3935 exposed. Non-uniqueness alone is
  disqualifying (two actions sharing a handler is legal; which declaration
  gates the call?). Also rejected in its narrow, transitional form (accept
  only on unambiguous resolution, for one release): with objectui shipping
  lockstep inside the same major, that window is empty, and building a
  second namespace to delete it a release later is pure cost.
- **Keep fail-open and document it.** Rejected by ADR-0049 verbatim: a
  security property that parses but does nothing manufactures false
  compliance. The declaration *says* `requiredPermissions`; the surface
  must enforce or refuse, not silently skip.
- **Fix the client only (post `name`), leave the server.** Rejected:
  ADR-0066 D4 names the server as the source of truth precisely because
  clients vary; and without D2 the documented-curl half stays broken (no
  key rotation), while any non-console caller that posts `target` keeps
  executing ungated.
- **Stage the refusal across two majors (warn in 17, refuse in 18).** The
  original draft's plan; rejected once the timing was checked. It keeps a
  known authorization hole open for a full extra major in exchange for a
  softer landing that the D5 lint and the boot inventory already provide —
  and it parks the gate in ADR-0049's prohibited "parses but does not
  enforce" state for that whole period. What the staging was really
  protecting against is refusing *correctly declared* actions; the D2-first
  invariant addresses that directly and is preserved verbatim in D3.
- **Register every handler under both `name` and `target` at
  registration time (aliasing), instead of candidate rotation at dispatch.**
  Deferred, not rejected: it would simplify dispatch but touches the
  engine's registration contract and package-teardown bookkeeping
  (`removeActionsByPackage`); the rotation helper achieves the same
  observable behaviour without a registry migration. Revisit if the
  rotation shows up in profiles.

## Consequences

**Positive.** The D4 gate and 0104 param contract hold on the surface users
actually click; the documented REST contract becomes true; deleting a
declaration narrows instead of widens; the metadata becomes a total map of
the invocable surface (the 0078 bijection); AI authors get a prescriptive
build-time error instead of an unobservable runtime hole; one addressing
algorithm serves both dispatch surfaces.

**Negative / cost.** Genuinely undeclared handlers break at 17 rather than
18 — mitigated by the build-time lint, the boot inventory, the migration
valve, and a v17 migration entry, but it is a real break and is owned as
one. A caller (script, integration, bookmark) that posts a `target` segment
starts 404-ing at 17 with no transitional acceptance; the prescriptive error
names the correct `name` to use. The boot reconciliation adds a startup pass
over the action registry (bounded by registry size, warn-only).

**Explicitly out of scope.** Renaming existing env flags (D6 governs new
ones); the engine-side aliasing alternative (deferred); any change to how
`body` actions register (already `name`-keyed, already conformant).

## Sequencing — one release (17), ordered within it

1. **D2 + D1** — the #3935 fix: shared handler-key rotation in
   `action-execution.ts`, REST adopts resolve-then-address, objectui posts
   `name`, 503 on an unreachable metadata plane, and a REST contract test
   pinning the documented curl. Lands as one lockstep change and is
   non-breaking for every correctly-declared action.
2. **D5** — reconciliation lint + boot inventory, so orphans are findable
   before the refusal exists.
3. **D3/D6** — refusal ON by default with no opt-out, plus the `v17.mdx`
   migration entry. Same PR flips this
   ADR to `Accepted — implemented` with evidence (the PRIORITIZATION
   status-hygiene rule).

Steps 1→3 may land in separate PRs but **must not ship in separate
releases**: step 3 without step 1 refuses correctly-declared actions.

## References

- framework#3935 (the surfaced gap), #3915 / #3919 / #3934 (the REST
  type-dispatch chain that exposed it)
- `packages/runtime/src/domains/actions.ts` (fail-open catch; single-segment
  double duty), `packages/runtime/src/action-execution.ts`
  (`resolveRouteActionDeclaration`, `invokeBusinessAction` rotation),
  `packages/runtime/src/app-plugin.ts` (body-only `name` registration)
- `../objectui` `packages/app-shell/src/hooks/useConsoleActionRuntime.tsx`
  (`target || name` URL construction)
- `packages/spec/src/ui/action.zod.ts` (`name` vs `target` semantics),
  `content/docs/ui/actions.mdx` (public REST contract + the equal-gate claim)
- `content/docs/releases/v17.mdx` — the target major, and the two sibling
  fail-closed inversions this one joins: *"A flow run with no trigger user
  may not touch data"* (#3760) and *"A datasource that cannot connect fails
  the boot"* (#3741, #3758, #3826)
