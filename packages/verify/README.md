# @objectstack/verify

Boot any ObjectStack app **in-process** and verify it through the **real HTTP
stack** — no mocks, no ports, no sockets. Two app-agnostic proof families, both
derived from your own metadata:

- **Data fidelity** — author one record per object covering every field type,
  write it over the real REST API, read it back, assert each field round-trips
  with type fidelity.
- **Authorization** — the cross-owner RLS invariant: *a user who cannot READ a
  record must not be able to WRITE it.*

## Why

Static gates — type-check, unit tests, schema validation — verify each layer in
isolation, usually against mocks. A whole class of regressions only appears when
the **real engine + strategies + services + HTTP context run together**: a date
bucket that ignores the org timezone, a field type that persists but reads back
as the wrong shape, a by-id write that skips the row-level security filter. Each
layer is individually correct; the break is at the seams.

`@objectstack/verify` boots the integrated stack (in-memory SQLite, the same
service plugins `objectstack dev` loads) and exercises it as a browser client
would, so those breaks are observable in CI.

This matters most on a **metadata platform**: the risk isn't "a platform change
broke the example app" — it's "a valid primitive your app uses, but the examples
don't exercise, silently breaks at runtime." Point this at *your* app.

> Posture: development / in-memory. The harness forces `NODE_ENV=development` to
> provision a known dev admin and uses an in-memory database. It never touches a
> real database or production data.

## CLI (zero-config)

```sh
# from an app directory (auto-detects objectstack.config.ts)
objectstack verify

# explicit config + the RLS invariant + multi-tenant isolation
objectstack verify --app ./objectstack.config.ts --rls --multi-tenant
```

Exit code is **non-zero** on real failures (`create-failed`, `read-failed`,
`fidelity-gaps`, `rls-hole`) so it drops straight into a CI gate. Inconclusive
verdicts (`needs-fixture`, `skipped`, `member-visible`) are warnings and exit 0.

## Programmatic (embed in your own test runner)

```ts
import { bootStack, runCrudVerification, runRlsProofs, formatReport } from '@objectstack/verify';
import myApp from './objectstack.config.js';

const stack = await bootStack(myApp);
const adminToken = await stack.signIn();

// Data fidelity
const report = await runCrudVerification(stack, adminToken, myApp);
console.log(formatReport(report));
expect(report.summary.fidelityGaps).toBe(0);

// Authorization (RLS / cross-owner): a fresh member must not write what it can't read
const memberToken = await stack.signUp('member@example.com');
const rls = await runRlsProofs(stack, adminToken, memberToken, myApp);
expect(rls.summary.holes).toBe(0);

await stack.stop();
```

## Verdicts

**Data fidelity** (`runCrudVerification`):

| verdict | meaning |
| --- | --- |
| `verified` | every asserted field round-tripped |
| `fidelity-gaps` | wrote a value, read back a different shape/type **(failure)** |
| `create-failed` / `read-failed` | the write or read errored **(failure)** |
| `needs-fixture` | the app's own validation rejected the auto-derived record (supply a fixture) |
| `skipped` | object has a required field that can't be auto-synthesized (e.g. a required lookup) |

**Authorization** (`runRlsProofs`):

| verdict | meaning |
| --- | --- |
| `rls-consistent` | member can't read **and** can't write — good |
| `rls-hole` | member can't read **yet** wrote it by id — RLS bypass **(failure)** |
| `member-visible` | member *can* read it — not a cross-owner scenario (inconclusive) |
| `probe-blocked` | the **object** gate refused the persona, so record scope was never consulted — never a pass (inconclusive) |

`member-visible` everywhere usually means the app is single-tenant; pass
`--multi-tenant` (or `{ multiTenant: true }`) to register org-scoping so tenant
isolation policies actually apply.

### Personas: who the invariant is run as

The invariant is run once per **persona**, and a report separates them because
they prove different things:

- The **base probe persona** authors its own capability (object read+edit on every
  declared object, plus an owner-scoped `select` narrowing). It proves the
  *platform's* by-id write gate — a refusal is attributable to the record gate
  rather than to the object gate.
- One **position persona per position the app declares** (`config.positions`,
  read from the app — never a list kept here). Each holds that position and
  nothing else, so its whole capability is what the app itself binds to the
  position. This is what exercises narrowing authored with `positions: [...]`,
  which is invisible to the base persona: a policy gated on a position the caller
  does not hold is never applicable to it.

`RlsReport.summary` is the base persona; `positionRuns[]` carries one entry per
position; `totals` sums them all (unit: one *object × persona* probe) and is what
a CI gate should read. `positionCoverage` reports the reach honestly: `declared`
vs `ran`, plus `notRun` for any declared position whose persona could not be
provisioned, and a `note` when the app declares no positions at all — "nothing to
run" must never read like "nothing to find".

## API

- `bootStack(config, opts?)` → `VerifyStack` (`api` / `raw` / `signIn` / `signUp` / `apiAs` / `stop`).
- `deriveCrudCases(config)` → the auto-derived round-trip cases (write one, read one, assert) for every object.
- `runCrudVerification(stack, token, config)` → `VerifyReport`; `formatReport(report)` for a log summary.
- `runRlsProofs(stack, adminToken, memberToken, config)` → `RlsReport`; `formatRlsReport(report)`.

`bootStack` options: `admin`, `authSecret`, `security` (a custom `SecurityPlugin`
for owner-scoped fixtures), `multiTenant`.

## Known limitations

- **Intentional write-transforms read back as fidelity gaps.** The fidelity
  check asserts an *exact* round-trip, so a field normalized on write — an
  `uppercase`/`trim` hook, a canonicalizing formula — is reported as a
  `fidelity-gaps` mismatch (e.g. `sku`: wrote `"abc-1"` → read `"ABC-1"`) and
  fails the run, even though the app behaves as designed. The report shows the
  exact `wrote → read` diff so it's diagnosable; letting an app declare such
  fields so the verifier can allow them is a planned enhancement.
- **A position persona holds the bare position, unanchored.** Narrowing that
  gates on a position held *together with* something else — a business-unit
  anchor, an organization membership, a sharing-rule grant — is still out of
  reach, and a position bound to a view-all set reads every row by design and so
  reports `member-visible`. Coverage is therefore reported per position; the
  fan-out is never N× the reach.
- **The auto-derived sweep is coarser than a hand-written matrix.** It exercises
  one synthesized record per object and skips fields it can't synthesize
  (required lookups / master-detail, media, computed). It's a broad runtime
  smoke test, not a substitute for targeted golden tests of specific behavior.
