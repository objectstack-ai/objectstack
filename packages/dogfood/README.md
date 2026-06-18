# @objectstack/dogfood

Runtime regression gate. Private (never published).

## Why

Static gates — `build`, unit tests, spec-liveness, CodeQL — verify each layer in
isolation, usually against mocks. They cannot catch a break that only appears
when the **real engine + strategies + services + HTTP context run together**.

The canonical example is [#2018](https://github.com/objectstack-ai/framework/pull/2018):
"organization timezone drives analytics date bucketing" was broken across three
seams (analytics strategy routing, in-memory count, REST execution-context).
Every static gate was green — 900+ unit tests included — because each layer was
individually correct and individually mocked. The bug was only visible by
booting the app and comparing a date bucket under UTC vs a non-UTC org timezone.

This package boots **real example apps in-process** (in-memory SQLite), wired
with the same service plugins `objectstack dev` loads, and exercises them
through the **real HTTP surface** (Hono request-injection — no ports, no
sockets, CI-stable). Tests act as a browser client would: sign in, hit
`/api/v1/...`, assert on real responses.

## Layout

- `src/harness.ts` — `bootDogfoodStack(config)` → `{ kernel, api, raw, signIn, apiAs, stop }`.
- `test/*.dogfood.test.ts` — golden flows. Each should assert on **observable
  output** (a number, a bucket label, a row count), not just "no error".

## Adding a golden test

1. Pick a real user flow that a static test can't cover (it spans engine +
   service + HTTP, or depends on seeded/written data).
2. `bootDogfoodStack(<appConfig>)`, `signIn()`, drive it via `api()/apiAs()`.
3. Assert on the concrete result.
4. **Prove it catches the bug**: temporarily revert the relevant fix and confirm
   the test goes red. A green-on-the-bug test is not a gate.

## Capability matrix (the AI-authoring angle)

This is a **development platform**: third parties have an AI author arbitrary
metadata. The risk is not "a platform change broke the CRM example" — it's "the
AI used a valid primitive the examples don't exercise, and it silently breaks at
runtime." So beyond pinning the example apps, the gate is growing into a
**capability matrix**: every authorable primitive gets a runtime round-trip
proof.

`test/field-zoo-roundtrip.dogfood.test.ts` is the first block — it writes one
record covering many field types over the real REST API and asserts each reads
back with type fidelity. On its first run it surfaced three real gaps
(`rating`/`slider`/`toggle` read back as strings), which are **quarantined**, not
hidden:

```ts
// Known type-fidelity gap → it.fails passes while broken and turns RED the day
// it's fixed, forcing the quarantine to be lifted instead of rotting.
const runner = c.xfail ? it.fails : it;
```

Roadmap (each its own slice, see the ADR): flow-node matrix, form-widget matrix,
RLS-pattern matrix; then a generative pass that emits random valid metadata from
the spec's zod surface; then run the AI **template corpus** through the harness.
The binding policy — every authorable+live primitive must carry a runtime proof
— is the subject of a dedicated ADR.

## Authorization gate (RLS / #1994)

The capability matrix above proves *data* round-trips. The authorization
dimension proves a record the caller must not touch stays untouched. The
app-agnostic invariant (`src/rls.ts`, `runRlsProofs`):

> **A user who cannot READ a record must not be able to WRITE it.**

[#1994](https://github.com/objectstack-ai/framework/pull/1994) was exactly this
hole: a single-id `update`/`delete` goes straight to `driver.update(object, id)`
and builds no query AST, so the row-level `where` filter the middleware injects
on the *read* path was never applied to *by-id writes*. Any member could PATCH a
record they couldn't even see. The fix is a **pre-image check** in
`plugin-security` (re-read the target row under the write-op RLS filter before
mutating; deny if invisible).

### The runner, and why it needs a fixture

Per object: admin creates a record → a fresh member (`signUp`, no grants) tries
to read it, then mutate it by id → re-read as admin decides if the row actually
changed. Verdicts: `rls-consistent` (can't read **and** can't write — good),
`rls-hole` (can't read **yet** wrote — the #1994 bug), `member-visible`
(member *can* read it — inconclusive, not a cross-owner scenario).

`auto-verify-rls.dogfood.test.ts` runs this over the example apps, but they boot
**single-tenant**, where every object comes back `member-visible` — so the
by-id-write path is never actually exercised. Two ways to create real isolation:

### 1. Owner-scoped fixture — `test/rls-fixture.dogfood.test.ts` (hard gate)

`fixtures/rls-owner-fixture.ts` is a one-object app (`rls_note`) whose member
permission set carries `RLS.ownerPolicy('rls_note', 'created_by')`. The predicate
is `created_by = current_user.id` — keyed on the column the engine stamps on
every record and referencing `current_user.id`, **not**
`current_user.organization_id`, so it survives single-tenant policy stripping. A
fresh member genuinely can't read the admin's note. `bootDogfoodStack` takes a
`security:` override so the fixture's permission set is the member's fallback:

```ts
bootDogfoodStack(rlsFixtureStack, { security: rlsFixtureSecurity(ownerScopedMemberSet) })
```

- **Green gate** (owner policy on `all` ops) → `rls-consistent`. Safe *only*
  because the pre-image check enforces the by-id write.
- **Automated red proof** (owner policy on `select` only) → `rls-hole`. Read is
  owner-scoped but no write policy applies, so the by-id write lands — the #1994
  hole class reproduced at the policy layer, on every CI run. A gate that can't
  go red isn't a gate.

**Manual revert proof** (confirms the *fix*, not just the hole class, is what
keeps the green gate green):

```sh
# 1. In plugin-security/src/security-plugin.ts, disable the pre-image check:
#    change `if (` to `if ( false &&` at the `(opCtx.operation === 'update' …` block.
pnpm --filter @objectstack/plugin-security build   # package resolves to dist
cd packages/dogfood && npx vitest run test/rls-fixture.dogfood.test.ts -t "owner-scoped"
#    → rls_note flips to [rls-hole]: "GET 404 yet MUTATED it by id (PATCH 200)".
git checkout -- ../plugins/plugin-security/src/security-plugin.ts && pnpm --filter @objectstack/plugin-security build
```

### 2. Org-scoped / multi-tenant — `test/rls-multitenant.dogfood.test.ts`

Why the single-tenant example-app run is all `member-visible`: `member_default`
scopes rows with a wildcard `tenant_isolation` policy
(`organization_id = current_user.organization_id`), and
`SecurityPlugin.collectRLSPolicies` **strips** every `current_user.organization_id`
policy when the org-scoping plugin is absent — while `member_default` carries no
owner-scoped *read* policy. So the member reads everything. That is the harness
booting single-tenant, **not** a broad-read default of the app (hotcrm's 9
sharing files / `requires: ['sharing']` rely on exactly this org boundary).

Faithful fix — boot multi-tenant so `@objectstack/plugin-org-scoping` registers
before `SecurityPlugin` and the `organization_id` policies apply:

```ts
bootDogfoodStack(crmStack, { multiTenant: true })
```

The dev admin is bound to the seeded default org; a fresh `signUp` member is not,
so the admin's org-scoped records are invisible to them. Empirically CRM flips
from *every object `member-visible`* (single-tenant) to **`4 consistent, 0
holes, 0 member-visible`** (multi-tenant) — the runner now exercises the #1994
by-id-write invariant over org-scoped (not just owner-scoped) RLS.

Runs in CI as the `Dogfood Regression Gate` job (and under `turbo run test`).
