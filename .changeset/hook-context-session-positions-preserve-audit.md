---
"@objectstack/spec": minor
---

feat(spec): `HookContext.session` declares `positions` and `preserveAudit` (#5605)

Two keys the engine has been **producing** all along, that consumers have been
**reading** and the docs have been **teaching**, were missing from the contract:
`HookContextSchema.session` declared `userId` / `actor` / `organizationId` /
`accessToken` / `isSystem` / `skipTriggers` / `skipAutomations` and nothing else.
Both are now declared, per the maintainer ruling on #5605.

This is the mirror of the `session.roles` retirement (#5050). That key was
declared-never-produced, so it was removed; these two are
produced-never-declared, so they are added. Same `session` block, opposite
drift, opposite fix.

**What was broken.** `HookContextSchema` is deliberately not `.strict()` — it is
the runtime shape the engine hands a handler, and strictness there would make
every engine-side enrichment a breaking change for anyone parsing a context they
were given. The cost of that tolerance is that an undeclared key is **stripped
in silence**:

- `HookContextSchema.parse(ctx)` — the exact call the generated reference page
  documents as the way to consume a context — returned a session with the
  caller's `positions` and the import's `preserveAudit` dropped on the floor.
- A handler typed the way the automation docs teach, `(ctx: HookContext)`, could
  not read either key: `ctx.session?.positions` was a `TS2339`. The two
  `kernel/runtime-services` pages that teach
  `positions: ctx.session?.positions` compiled only because they annotate `ctx`
  as `any` — copying both the code and the documented annotation did not build.

**`positions`** (`string[]`, optional) is the ADR-0090 D3 placement vocabulary,
copied verbatim from `ExecutionContext.positions` by ObjectQL's `buildSession()`.
Its `.describe()` states the boundary the ruling asked for, because the boundary
is the whole reason this key needed a decision rather than a patch: it is
**readable context, never an authorization input**. A hook may forward it as the
sharing service's evaluation context, tailor a message, or log it. A hook must
not make the access decision itself by testing it — privilege is judged by the
security service on the execution context (capability grants `permissions`,
placements `positions`, and the derived posture). A hook re-deciding access from
this array decides, somewhere with no access to the grant model, something that
was already decided; that is structurally the mistake the `roles` tombstone
exists to prevent, one vocabulary later.

**`preserveAudit`** (`boolean`, optional) is the #3493 historical-import flag:
server-set, opt-in, absent on normal writes, and read by the built-in audit hook
to keep a caller-supplied `updated_at`/`updated_by` instead of stamping the
import instant. It has a live consumer, so it could only ever be declared.

Purely additive — both keys are optional, the shape stays non-strict, and no
existing context, handler or stored metadata changes. Contexts are built per
operation and never persisted, so there is nothing to migrate.
