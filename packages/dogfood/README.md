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

Runs in CI as the `Dogfood Regression Gate` job (and under `turbo run test`).
