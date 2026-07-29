# ADR-0110: An action's identity is its `name`; anything executable over a governed surface must have a declaration (the declaration-admission gate)

**Status**: Proposed (2026-07-29)
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
unreachable → 503, genuinely undeclared → refuse with a prescriptive error
(escape hatch `OS_ALLOW_UNDECLARED_ACTIONS=1`, staged warn-first);
**D4** "declared but hidden" is the blessed pattern for headless actions —
"undeclared but executable" has no remaining legitimate use;
**D5** a reconciliation lint + boot check: every `registerAction` key must
reconcile to a declaration; **D6** security-gate strictness is opt-**out**,
never opt-in.

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
and is fixed to `name` (objectui ships in lockstep with the framework — no
compatibility window is needed). The documented curl contract
(`content/docs/ui/actions.mdx`) is already D1-conformant and becomes true
once D2 lands.

*Transitional note*: until the objectui fix ships, the server MAY accept a
target-shaped segment **only** when it resolves unambiguously to exactly one
declaration on the routed object, gating on that declaration — and MUST
refuse on ambiguity. It never runs anything ungated because the segment
looked like a target (that is #3935's bug, not a compatibility feature).

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
| **Genuinely undeclared** | **Refuse** (404) with a prescriptive error: `Action 'x' on 'y' has no declaration — add defineAction({ name: 'x', … }) or register it under a declared action's target`. Escape hatch: `OS_ALLOW_UNDECLARED_ACTIONS=1` executes it (dev/bring-up mode) and warns at boot, listing every registered-but-undeclared handler key. |

**Staging** (the ADR-0096 D5 idiom — evidence-gated, not date-gated):

- **Phase 1 (now, with the #3935 fix)**: D1/D2 land; unreachable-metadata
  becomes 503; the undeclared branch **warns loudly** on every invocation
  (`[action-governance] executing UNDECLARED handler 'x' — this will be
  refused in a future major`) but still executes. This phase is
  non-breaking by construction: with D2 in place, every *declared* action
  resolves, so the warning fires only for genuinely undeclared handlers.
- **Phase 2**: the reconciliation lint (D5) ships; CI/dogfood run with
  refusal ON; boot telemetry counts undeclared invocations.
- **Phase 3**: refusal becomes the default at the next major, when
  telemetry shows the warning silent across dogfood and example apps.

The deletion inversion closes at Phase 1: deleting a declaration moves the
action from "gated" to "warn + (eventually) refuse" — removal now narrows.

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
acceptable shape for an *authorization* gate: D3's refusal stages toward
**strict-by-default with an opt-out escape hatch**, and any future gate
follows the same direction. A flag spelled `OS_ALLOW_*` (opt out of
enforcement) is the sanctioned shape for security; `OS_*_STRICT_ENABLED`
(opt in to enforcement) is reserved for non-security contracts. Existing
flags are not renamed by this ADR; new ones conform.

## Alternatives considered

- **Make the route resolve declarations by `target` too.** Rejected: it
  promotes a binding expression into a second identity namespace the
  platform must then keep unique, non-interpolated, and matchable forever —
  cementing the confusion #3935 exposed. Non-uniqueness alone is
  disqualifying (two actions sharing a handler is legal; which declaration
  gates the call?). The transitional note in D1 is the narrow, refuse-on-
  ambiguity exception, and it exists only until the lockstep client ships.
- **Keep fail-open and document it.** Rejected by ADR-0049 verbatim: a
  security property that parses but does nothing manufactures false
  compliance. The declaration *says* `requiredPermissions`; the surface
  must enforce or refuse, not silently skip.
- **Fix the client only (post `name`), leave the server.** Rejected:
  ADR-0066 D4 names the server as the source of truth precisely because
  clients vary; and without D2 the documented-curl half stays broken (no
  key rotation), while any non-console caller that posts `target` keeps
  executing ungated.
- **Big-bang: refuse undeclared handlers immediately.** Rejected for the
  staged ratchet (D3): Phase 1 must land D2 first — otherwise every
  *declared* target-bound action would be misclassified as undeclared and
  refused, manufacturing the outage the staging exists to avoid.
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

**Negative / cost.** A transitional target-acceptance path exists until the
lockstep objectui ships (bounded, refuse-on-ambiguity); genuinely
undeclared handlers — if any exist in the wild — get a warning phase and
then break at a major (the lint and boot listing make them findable long
before); the boot reconciliation adds a startup pass over the action
registry (bounded by registry size, warn-only).

**Explicitly out of scope.** Renaming existing env flags (D6 governs new
ones); the engine-side aliasing alternative (deferred); any change to how
`body` actions register (already `name`-keyed, already conformant).

## Sequencing

1. **#3935 fix** (unblocks everything, breaks nothing): D2 shared rotation
   + REST adopts resolve-then-address; D1 objectui `name` URL; D3
   503-on-unreachable + undeclared warning; docs curl gains a REST
   contract test. Lands as one lockstep change.
2. **D5 lint + boot reconciliation**; CI/dogfood flip refusal ON (Phase 2).
3. **Default flip at the next major** (Phase 3), evidence-gated on the
   Phase-2 telemetry; same PR flips this ADR to Accepted — implemented
   (the PRIORITIZATION status-hygiene rule).

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
