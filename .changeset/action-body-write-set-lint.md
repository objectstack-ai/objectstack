---
"@objectstack/lint": minor
"@objectstack/spec": patch
---

feat(lint): L2 action-body writes to undeclared fields warn at author time (#4271)

The write-set lint that #4305 gave L2 hook bodies now covers the other surface
that carries one. An action body is the same artefact: the same
`HookBodySchema` union, parsed by the same `HookBodySchema.safeParse` in
`actionBodyRunnerFactory`, run in the same QuickJS sandbox. So it fails the
same way — `ctx.api.object('crm_deal').update({ stag: 'won' })` inside an
action reaches the driver unfiltered, and the outcome splits by driver: on SQL
the stray column fails the whole call with a driver-level error far from the
authoring site, and on a schemaless driver the stray key is persisted. Half
the surface was still blind.

**New rule — `action-body-write-unknown-field` (advisory).** Wired into
`REFERENCE_INTEGRITY_RULES`, so `os validate`, `os lint` and `os compile` all
report it; it never blocks a build. Both places the runtime reads actions from
are walked — top-level `actions` and `objects[].actions` — and a
`defineStack`-merged action, which lives in both, is reported once at its
authored path. That dedupe is by VALUE (bound object + name + body source), not
by object identity the way `collectBundleActions` can afford: the suite runs on
the schema-PARSED stack, and parsing rebuilds every node, so the two copies
arrive as distinct objects that are merely equal. An identity check passes a
shared-reference unit fixture and then reports the showcase app's one warning
twice — which is exactly what it did before the end-to-end run caught it.

**Only the `ctx.api` write family carries over, and that is the point.** An
action's `ctx.input` is its PARAMS bag (`input: unwrapProxyToPlain(actionCtx
?.params)`), not a record, so resolving those names against object fields would
flag every correctly-named parameter — a pure false-positive machine, and a
false positive kills an advisory lint. `ctx.record` is not a write surface
either: the runner hands the body a plain snapshot and never writes it back, so
`ctx.record.x = …` is discarded for *declared* and undeclared fields alike —
a different defect from "the unknown column vanishes", and flagging only its
undeclared half would imply the declared half persists.

So the rule ships a declared **partition** of the shared
`HOOK_BODY_WRITE_PATTERNS` rather than a second ledger:
`ACTION_BODY_WRITE_PATTERN_IDS` (today: `api-crud-literal`) and
`ACTION_BODY_WRITE_EXCLUSIONS` (`input-property-assign`,
`input-object-assign`), each exclusion carrying its reason. The two halves are
tested to cover the shared ledger exactly, so a fourth pattern landing on the
hook side fails this rule's test until someone classifies it — silence is not a
decision. Every applicable pattern is additionally proved end-to-end through
the full validator (prefilter, pattern filter and field check included), and
every exclusion is proved to be about applicability rather than an
unextractable shape: the shared extractor still sees it, and this rule still
reports nothing for it.

One extractor, one field index, one implicit-field set, shared with the hook
rule rather than copied. The action rule is the same check on the other body
surface, so a second copy of `IMPLICIT_FIELDS` would drift exactly the way the
five hand-copied system-field lists #4330 collapsed did.

The lint stays off the kernel boot path, and lands one notch tighter than the
hook side: the only applicable pattern is rooted at `ctx.api`, so an action
body that never mentions it does not even parse, let alone load the ~9 MB
TypeScript compiler. Guarded by `lazy-deps.test.ts`.

`@objectstack/spec`: `ScriptBodySchema` and `ActionSchema.body` now point at
the action-side rule and spell out that `ctx.input` (params) and `ctx.record`
(a discarded snapshot) are not record-write surfaces — doc comments only, no
schema or generated-artifact change.
