---
'@objectstack/verify': minor
'@objectstack/cli': minor
---

feat(verify): the unique-scope family — every field declared `unique` collides as its declared scope says, runnable as `os verify --unique-scopes` (#15953)

Clause-②: yes

A fifth derived proof family beside `runCrudVerification`, `runRlsProofs`, `runReferenceShapeProofs` and `runDeleteBehaviorProofs`. It needs no hand-written test: from the app's own objects it takes every field whose `unique` the spec's own parse of the field (`FieldSchema`) declares — the value a built artifact carries, so an `autonumber` that authors no `unique` states `'organization'` — and asks the engine what a second holder of one value meets, through two doors: the REST data route as a signed-in caller, and the engine's own write as the system principal.

- **Within one organization** — by insert and by update — the second holder must be refused, whatever the scope. On a `single`-posture boot that organization is the install's one: the untenanted install, where every write lands in it.
- **Across two organizations** — on an org-scoped boot only — the family provisions a second organization the way a user makes one (`signUp`, then `POST /auth/organization/create`) and offers it the value. A `true` or `'organization'` field must admit it; a `'global'` field, or any field of an object with no organization column (`tenancy.enabled: false`), must refuse it. On a boot with one organization this leg is reported not run, with the reason, on the report's `boot`.

A refusal proves the collision only when it is the platform's unique refusal (`UNIQUE_VIOLATION` at the REST door, `DUPLICATE_RECORD` at the system door) and it is this field's: it names the field, or it names none, the same record with only the probed value changed is admitted, and no unique `indexes[]` entry covers the field. A per-organization constraint is an expression index, which the driver reports by index name, so its refusal carries no `field`, and that twin is what attributes it; a unique `indexes[]` entry over the same column refuses the same write naming no field either, so there a field-less refusal is not attributed. Any other refusal (an app hook's own dedupe, a validation rule, a permission, a constraint on another field) is `unattributed`, so an engine that refused every write would not read as a proven scope. A field is `proven`, `contradicted` (a second holder met something other than its scope), `failed` (a door faulted), `inconclusive`, `excluded` or `not-derivable`. `contradicted + failed` is the report's `hardFailures`.

A field the caller cannot set (`readonly`, `system`, a runtime-issued `autonumber`) is probed through the system door only, which keeps an explicit value. A derived value (`formula`, `summary`) is `excluded`; a field with no fresh values to offer (a `boolean`, a `select`, a multi-valued reference, a target the app does not declare) is `not-derivable`. The population is the field-level declaration: a unique `indexes[]` entry is a different surface, with its own meaning of bare `true`, and is not in it.

**`@objectstack/verify` — new exports.**

- `runUniqueScopeProofs(stack, token, config, { doors? })` → `UniqueScopeReport`. Run it on a fresh stack of its own: it writes duplicates on purpose. Boot the stack with `{ multiTenant: true }` to run the cross-organization leg.
- `deriveUniqueScopeCases(config)`, `formatUniqueScopeReport(report)`.
- Types: `DeclaredUniqueScope`, `UniqueScopeCase`, `UniqueScopeDoor`, `UniqueScopeLeg`, `UniqueScopeOperation`, `UniqueScopeAnswer`, `UniqueScopeProbeResult`, `UniqueScopeFieldStatus`, `UniqueScopeFieldResult`, `UniqueScopeReport`, `UniqueScopeProofOptions`.

```ts
import { bootStack, runUniqueScopeProofs, formatUniqueScopeReport } from '@objectstack/verify';

const stack = await bootStack(myApp, { multiTenant: true });
const report = await runUniqueScopeProofs(stack, await stack.signIn(), myApp);
console.log(formatUniqueScopeReport(report)); // report.boot names the legs this boot ran
expect(report.summary.hardFailures).toBe(0);
await stack.stop();
```

**`@objectstack/cli` — `os verify --unique-scopes`.** Opt-in, like `--reference-shapes` and `--delete-behaviors`, on a fresh boot of its own; with `--multi-tenant` it runs both legs. A second holder met wrongly, or a door that faulted, counts in `hardFailures` and fails the run. The `--json` document carries the report as `uniqueScopes` when the flag is given; without the flag the run and its document are unchanged.
