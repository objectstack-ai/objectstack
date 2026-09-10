---
"@objectstack/verify": minor
---

**Clause-②: yes** — new exported symbols on a published package (`bootStackOnce`, `isVerifyRefusal`, and ten new members on the `VerifyStack` every `bootStack` caller already holds), so the accept set a consumer writes against widens. Contract-review tier.

Every `VerifyStack` now carries an **in-process handle** on the stack `bootStack` boots — a way to run a hook, a validation rule, a flow, an action, a seed or a read against the REAL engine and assert on what the engine did, instead of writing through HTTP and inferring from persisted rows, or rebuilding the engine's semantics in a test stand-in.

New members on `VerifyStack` (the same object `bootStack` returns; `api` / `apiAs` / `signIn` / `signUp` / `stop` are unchanged):

- `hooks.run(object, 'insert' | 'update' | 'delete', input, { as })` — one write through the engine's own door as the caller `as` (a bearer token from `signIn` / `signUp`). The bound hook chain, field defaults, declared validations and the SecurityPlugin middleware run inside it, in the engine's order, because this is the very call the REST data ingress makes. Returns what the engine returned; a refusal rejects with the engine's own error (`code`, `statusCode`).
- `validate(object, record, { as, mode? })` — the engine's dry-run validation pass (`ObjectQL.validate`), nothing written.
- `flows.run(name, params, { as })` / `flows.resume(run, input, { as })` — the runtime's `/automation` trigger and resume routes driven in-process (no Hono, no socket): the caller's resolved identity is forwarded exactly as the route forwards it, and the engine's `AutomationResult` comes back (plus `flowName`, so the value hands straight to `resume`). A never-dispatched refusal or a failed run rejects with the route's ADR-0112 envelope.
- `actions.run(object, action, { as, recordId?, params? })` — the `/actions/:object/:action` route driven in-process, the one door carrying the whole action contract (ADR-0066 D4 gate, ADR-0104 param contract, subject-record load, trusted body context). Returns the handler's value.
- `seed(object, rows)` / `rows(object, where?, { as? })` — real ObjectQL writes (the platform's own seed-replay context) and reads (system-scoped, or as a caller under that caller's grants and RLS).
- `metadata.object(name)` / `objects()` / `items(type)` / `types()` — the booted `SchemaRegistry`, by its own singular type vocabulary.
- `tenancy()` — the `tenancy` service AuthPlugin registered (`posture`, `requestedPosture`, `isolationActive`, `degraded`).
- `contextFor(token)` — the dispatcher's own request-identity resolution, exposed so a test can drive any kernel service as a real caller.

Also new: `bootStackOnce(config, opts?)`, a per-process memo of `bootStack` keyed on the `config` and `opts` object identities — the worker-scoped shared boot `packages/qa/dogfood` kept privately, promoted for suites that run many files under `isolate: false`.

Exported types: `VerifyHandle`, `VerifyRefusal` (with the `isVerifyRefusal` predicate), `AsUser`, `FlowRun`, `FlowRunRef`, `EngineRow`.

**Zero re-implemented semantics.** Every method is a thin facade over a door the kernel wired at boot; the handle assembles no `ExecutionContext`, orders no hooks, evaluates no permission. The package's own tests pin each method against the real service behind it (the PR's ablation record breaks each service in turn and shows only that method's pin going red), pin `hooks.run` against the REST write on the same row **and** the same refusal, and port one hotcrm exemplar (`opportunity_lifecycle`) onto `hooks.run` as the proof of ergonomics.

No boot option was added: the tenancy posture a stack runs under is still chosen by `multiTenant` (the `--multi-tenant` option `os verify` already has) and read back through `tenancy()`. `os verify`, `runCrudVerification` and `runRlsProofs` are unchanged.
