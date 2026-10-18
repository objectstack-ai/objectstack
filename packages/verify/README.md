# @objectstack/verify

Boot any ObjectStack app **in-process** and verify it through the **real HTTP
stack** — no mocks, no ports, no sockets. Seven app-agnostic proof families, all
derived from your own metadata:

- **Data fidelity** — author one record per object covering every field type,
  write it over the real REST API, read it back, assert each field round-trips
  with type fidelity.
- **Authorization** — the cross-owner RLS invariant: *a user who cannot READ a
  record must not be able to WRITE it.*
- **Reference-value shape** (opt-in) — *every client-writable reference field
  refuses a value that is not a record id* (ADR-0104): a boolean, a number or an
  embedded record object is written into each `lookup` / `master_detail` /
  `user` / `tree` field, on insert and update, through the REST door and the
  system door, and the engine must refuse it naming the field.
- **Declared delete behaviour** (opt-in) — *every `deleteBehavior` a reference
  field declares is what a delete of the referenced record does*: per field, a
  fresh target record and a holder referencing it, then the target is deleted
  by id through the REST door and the system door. `cascade` must remove the
  holder, `set_null` must keep it with the link cleared, and `restrict` must
  refuse the delete (`DELETE_RESTRICTED` naming the holder's object); a second
  holder of another target record must be left alone either way.
- **Declared unique scope** (opt-in) — *every field declared `unique` collides
  as its scope says* (ADR-0120): per field, a first record holds a value and a
  second one is offered it, by insert and by update, through the REST door and
  the system door. Within one organization the second holder must be refused
  (`UNIQUE_VIOLATION` / `DUPLICATE_RECORD`, attributed to the field). On an
  org-scoped boot a second organization is provisioned too, and there a
  `true` / `'organization'` value must be admitted while a `'global'` one, or
  one on an object with no organization column, must be refused.
- **Parent-derived write reach** (opt-in) — *a write on a `controlled_by_parent`
  detail is admitted exactly when the caller holds that verb on the detail's
  object and can edit its master* (ADR-0055 §3): per detail object, persona and
  master chain, an edit, a delete and a create through the engine as that
  persona, each compared with that conjunction — the caller's effective grants
  on the detail, and its edit of the master MEASURED by an empty update of the
  master.
- **Dashboard date windows** (opt-in) — *every widget a dashboard's `dateRange`
  binds counts, under each preset of the picker, the rows that window selects*:
  per bound widget and measure (a count, a sum, or a derived measure over
  those), fixture rows are written on known days
  around every preset's edges, and the widget is asked through the dataset door
  with no window and under each of the 13 presets, before and after the
  fixtures. Each difference must equal the fixture rows the window selects; a
  window that answers nothing is `blank`, and one that never narrows is inert.

And, on the same booted stack, an **in-process handle** so an app's own tests
can run a hook, a validation rule, a flow, an action, a seed or a read against
the **real** engine and assert on what it did — no HTTP round-trip, no
hand-rolled `ctx.api`, no copied permission check.

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

# also prove every reference field refuses a value that is not a record id
objectstack verify --reference-shapes

# also prove every declared deleteBehavior is what a delete does
objectstack verify --delete-behaviors

# also prove every declared unique collides where its scope says (both legs)
objectstack verify --unique-scopes --multi-tenant

# also prove every controlled_by_parent detail write follows its master
objectstack verify --parent-write-reach

# also prove every dashboard date picker counts the rows its window selects
objectstack verify --dashboard-windows
```

`--reference-shapes` is opt-in, on a fresh boot of its own: the engine still
admits wrong-shaped ELEMENTS on a `multiple: true` `lookup` / `user` field, so
on an app that declares one the family reports holes and fails the run until
the engine refuses them.

`--delete-behaviors` is opt-in, on a fresh boot of its own. The declaration is
read as the spec's parse of the field states it, which is what a built
artifact carries: a `lookup` or `tree` that authors nothing states `set_null`.
A `tree` field's delete is not honoured today (deleting the parent leaves the
child's reference in place), so on an app that declares one the family reports
a contradiction and fails the run.

`--unique-scopes` is opt-in, on a fresh boot of its own (it writes duplicates on
purpose). The scope is read as the spec's parse of the field states it: an
`autonumber` that authors no `unique` states `'organization'`. A field the
caller cannot set (`readonly`, `system`, a runtime-issued `autonumber`) is
probed through the system door only, which keeps an explicit value. Without
`--multi-tenant` the boot has one organization and no wall, so the
cross-organization leg is reported **not run**, with the reason, on the
report's `boot` — run it org-scoped to prove that `true` / `'organization'`
lets two organizations hold one value (the walled boot needs a declared
membership policy: the `auth.membership_policy` setting or
`OS_AUTH_MEMBERSHIP_POLICY`). A refusal proves the
collision only when it is the platform's unique refusal and it is this field's:
it names the field, or it names none (a per-organization constraint is an
expression index, which the driver reports by index name) and the same record
with only the probed value changed is admitted. Where a unique `indexes[]`
entry covers the field, a refusal that names none is `unattributed`: that
entry refuses the same write, naming no field either, so it may be the
entry's rather than the field's own declaration.

`--parent-write-reach` is opt-in, on a fresh boot of its own that registers
the three verifier personas' permission sets (`parentWriteReachSecurity`). The
population is every object the spec's parse declares `controlled_by_parent`
with exactly one `master_detail` field, and the chain of masters above it. The
writes are made by three verifier personas — the root master by the
all-records grant (`modifyAllRecords`) with every verb on the detail; the root
master readable but not editable with every verb on the detail; the
all-records grant with no delete on the detail — and by one persona per
declared position (its capability is what the app binds to the position), each
under a master chain another principal owns and one it owns, and on a detail
another principal owns and one it owns. The writes go through the engine as
the persona (the insert, update and delete by id the REST data route makes,
with the caller's context): there a refusal keeps the object and operation it
names, while the REST envelope names the route's object whatever was refused.
A refusal holds only as the platform's `403 PERMISSION_DENIED` naming the
detail and the operation; any other refusal (a rule, a hook's own code, a
refusal on another object) is `unattributed`. The system door bypasses
authorization and is not asked. A detail two levels below its root master is
answered the same way: its write is admitted exactly when the caller holds the
verb on the detail and may update the middle master directly, which also needs
edit access to the root, and refused otherwise, so the family reports such a
chain `proven`.

`--dashboard-windows` is opt-in, on a fresh boot of its own (it writes fixture
rows). The population is every dashboard the spec's parse gives a `dateRange`,
and every widget it binds: the window lands on the field
`filterBindings.dateRange` names, or on `dateRange.field` (`created_at` when
unauthored) where the widget declares no binding, and a widget with
`filterBindings: { dateRange: false }` is `unbound`. The field resolves against
the object behind the widget's dataset, as the stack registers it, and must be
a `date` or `datetime` field. Each preset of `DATE_RANGE_PRESETS` is handed to
`POST /analytics/dataset/query` as its `{date-macro}` window from the spec
(`DATE_RANGE_PRESET_MACRO_WINDOWS`, e.g. `{ $gte: '{7_days_ago}', $lte: '{today}' }`), ANDed
with the widget's own filter as `runtimeFilter`, as the signed-in admin; the
server resolves the tokens, and the ground truth resolves the same window with
`@objectstack/core`'s `resolveFilterTokens` on the caller's reference timezone
(UTC unless the `ExecutionContext` carries one). Fixture rows are written
through the seed door on each preset's first and last day and the day either
side (never after today), each stamped at UTC noon (a `date` field takes the
day), owned by the caller, with every column the widget's filter, the
dataset's filter and the measure's filter compare held to a value they select,
and read back before anything is judged. A row is the smallest record the CRUD
derivation offers (its required fields); if the seed door refuses that (an app
rule that requires a field only in some state), every field it synthesizes. Every count is a difference (after
the fixtures minus before, under the same window), so the app's own rows
cancel out, and the widget with no window must count every fixture row before
any window is judged. A count measure is probed (a `count` of a named field
gets a non-null value); an average, a sum or a derived measure is counted as
excluded. A held column is an equality, an `$in` (its first member), a
`$nin` or `$ne` on a field that declares its options (the first option it does
not exclude) or `{current_user_id}` (the caller); any other filter the ground
truth cannot model (`$or`, a range, a relationship path, another placeholder, a
condition on the window's own field) is excluded, and so is a dataset over an
object the app does not declare. The shipped console closes the three rolling windows at `{today}` as
well; the fixtures carry no later day, so both select the same rows.

Exit code is **non-zero** on real failures (`create-failed`, `read-failed`,
`fidelity-gaps`, `rls-hole`, with `--reference-shapes` a field with `holes` or
`failed`, with `--delete-behaviors` or `--unique-scopes` a field
`contradicted` or `failed`, with `--parent-write-reach` an object
`contradicted` or `failed` or a persona that could not be provisioned, and
with `--dashboard-windows` a widget `contradicted` or `failed`) so
it drops straight into a CI gate. Inconclusive
verdicts (`needs-fixture`, `skipped`, `member-visible`) are warnings and exit 0.

## Programmatic (embed in your own test runner)

```ts
import {
  bootStack, runCrudVerification, runRlsProofs, formatReport,
  runReferenceShapeProofs, formatReferenceShapeReport,
  runDeleteBehaviorProofs, formatDeleteBehaviorReport,
  runUniqueScopeProofs, formatUniqueScopeReport,
  runParentWriteReachProofs, formatParentWriteReachReport, parentWriteReachSecurity,
} from '@objectstack/verify';
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

// Reference-value shape, on a fresh stack: a door that admits a probe lands a row
const shapeStack = await bootStack(myApp);
const shapes = await runReferenceShapeProofs(shapeStack, await shapeStack.signIn(), myApp);
console.log(formatReferenceShapeReport(shapes));
expect(shapes.summary.hardFailures).toBe(0);
await shapeStack.stop();

// Declared delete behaviour, on a fresh stack: every `restrict` probe leaves rows behind
const deleteStack = await bootStack(myApp);
const deletes = await runDeleteBehaviorProofs(deleteStack, await deleteStack.signIn(), myApp);
console.log(formatDeleteBehaviorReport(deletes));
expect(deletes.summary.hardFailures).toBe(0);
await deleteStack.stop();

// Declared unique scope, on a fresh stack: it writes duplicates on purpose.
// Boot it with `{ multiTenant: true }` to run the cross-organization leg too.
const uniqueStack = await bootStack(myApp);
const uniques = await runUniqueScopeProofs(uniqueStack, await uniqueStack.signIn(), myApp);
console.log(formatUniqueScopeReport(uniques)); // `uniques.boot` says which legs ran
expect(uniques.summary.hardFailures).toBe(0);
await uniqueStack.stop();

// Parent-derived write reach, on a fresh stack that registers the verifier personas' sets
const parentStack = await bootStack(myApp, { security: parentWriteReachSecurity(myApp) });
const reach = await runParentWriteReachProofs(parentStack, myApp);
console.log(formatParentWriteReachReport(reach)); // `reach.personas` says who wrote
expect(reach.summary.hardFailures).toBe(0);
await parentStack.stop();
```

## The in-process handle (drive the real engine from a test)

Every `VerifyStack` carries it; nothing extra to boot. Each method is a thin
facade over a door the kernel wired at boot — the ObjectQL engine's own write,
dry-run and read calls and its middleware chain, the runtime's `/automation`
and `/actions` routes driven in-process, the automation engine's condition
evaluator, the `SchemaRegistry`, the `tenancy` service — with **zero
re-implemented semantics**: the handle assembles no execution context, orders
no hooks, evaluates no permission. What the engine does is what you assert on.

```ts
import { bootStack } from '@objectstack/verify';
import myApp from './objectstack.config.js';

const stack = await bootStack(myApp, { automation: true });
await stack.signIn();                                  // seeds the dev admin
const rep = await stack.signUp('rep@example.com');     // a plain member

// A hook: one real write as `rep` — before* hooks, validation, the driver,
// after* hooks, and the permission check the caller is subject to.
const deal = await stack.hooks.run('crm_opportunity', 'insert',
  { name: 'Globex', amount: 10_000, stage: 'proposal' }, { as: rep });
expect(deal.expected_revenue).toBe(6_000);             // the hook derived it

// The same write a member may NOT make rejects with the engine's own error.
await expect(stack.hooks.run('crm_vault', 'insert', { name: 'x' }, { as: rep }))
  .rejects.toMatchObject({ code: 'PERMISSION_DENIED', statusCode: 403 });

// A write as the system principal (no user), the write an integration or a
// system job makes: no permission gate, but the hooks, the validations and the
// record-change flows all run, with no trigger user. Insert, update or delete.
await stack.hooks.run('crm_opportunity', 'update', { id: deal.id, stage: 'closed_won' }, { system: true });
const lead = await stack.hooks.run('crm_lead', 'insert', { last_name: 'Ada', company: 'Globex' }, { system: true });
// A delete-triggered flow is handed the pre-image, and the engine no longer
// holds the row: its `get_record` of that id finds nothing.
await stack.hooks.run('crm_lead', 'delete', { id: lead.id }, { system: true });

// A predicate update: one payload for every matched row, hooks and record
// flows once per row with that row's own `previous`. Resolves the count.
const n = await stack.hooks.updateWhere('crm_opportunity', { name: 'Globex' }, { description: 'Bulk note' }, { as: rep });

// A validation rule, without writing.
const verdict = await stack.validate('crm_opportunity', { amount: -1 }, { as: rep });
expect(verdict.valid).toBe(false);

// A screen flow: trigger, then resume with the screen's input.
const run = await stack.flows.run('quote_generation', { recordId: deal.id }, { as: rep });
expect(run.status).toBe('paused');
await stack.flows.resume(run, { quoteName: 'Q-1', discount: 10 }, { as: rep });

// A scheduled (or other self-triggered) flow declared `runAs: 'system'`: the
// trigger route refuses it to every person, the admin included (403
// PERMISSION_DENIED), so start it as its own trigger does, as the system
// principal. The engine's result comes back unchanged: a run that did not
// succeed resolves with `success: false`, so assert on it.
const sweep = await stack.flows.run('case_sla_monitor', {}, { system: true });
expect(sweep.success).toBe(true);

// An action body, through the route that carries its param contract.
const out = await stack.actions.run('crm_opportunity', 'apply_discount',
  { as: rep, recordId: deal.id, params: { discount: 10 } });

// A flow condition's truth table, on the engine's own evaluator, over
// variable shapes no write produces. A start gate's, an edge's and a
// decision branch's condition reach it as a CEL envelope, so pass one.
expect(await stack.automation.evaluateCondition(
  { dialect: 'cel', source: 'record.stage != previous.stage' },
  { record: { stage: 'closed_won' }, previous: { stage: 'proposal' } })).toBe(true);

// Fixtures and reads through the real engine.
const [acc] = await stack.seed('crm_account', [{ name: 'Globex' }]);
const mine = await stack.rows('crm_opportunity', { crm_account: acc.id }, { as: rep });

// What a hook handed the engine: every write the engine receives while the
// function runs, and what it answered. A hook's write the engine refused
// leaves no row; here it is, refused, with the engine's own error.
const writes = await stack.observeWrites(async (observation) => {
  await stack.hooks.run('crm_lead', 'insert', { last_name: 'Ada', company: 'Globex' }, { as: rep });
  // An `async: true` hook writes after the triggering write has returned.
  await observation.settled((w) => w.object === 'crm_task');
});
const refused = writes.filter((w) => w.outcome.status === 'refused');

// What the boot actually holds.
stack.metadata.object('crm_opportunity')?.fields;      // system columns injected
stack.metadata.items('permission');                    // the registry's singular names
stack.tenancy().posture;                               // 'single' | 'group' | 'isolated'

await stack.stop();
```

- `as` is always a bearer token minted by `signIn()` / `signUp()` on the same
  stack — the handle resolves it through the dispatcher's own identity resolver
  (`contextFor(token)` exposes that context for services the handle does not
  cover). There is no way to run as "nobody"; `seed`, the default `rows` and
  a write passed `{ system: true }` (`hooks.run` on `insert`, `update` or
  `delete`, and `hooks.updateWhere`) run as the system principal, deliberately
  and by name. `seed` fires no record-change flow (it is end-state fixture
  data); a `{ system: true }` write does. `flows.run(name, params, { system:
  true })` starts a flow as the system principal through the `automation`
  service's own `execute`, the call the schedule trigger's tick makes, never
  through the trigger route, and hands back the engine's result unchanged.
- A refusal from `flows.*` / `actions.run` is the route's ADR-0112 envelope
  (`VerifyRefusal`: `code`, `status`, `details`; `isVerifyRefusal(e)`); a
  refusal from `hooks.run` / `hooks.updateWhere` / `validate` / `rows` /
  `automation.evaluateCondition` is the engine's own error (a condition the
  engine cannot evaluate rejects, never answers `false`; on a stack with no
  automation service, `automation.evaluateCondition` rejects with the kernel's
  own `SERVICE_NOT_REGISTERED` error naming `automation`). `hooks.run` and
  `hooks.updateWhere` refuse a malformed call themselves, before the engine is
  touched, with `INVALID_REQUEST` / `400` (a caller named twice, or a
  `hooks.updateWhere` the engine would write by id). Assert on `code` (and
  `status` / `statusCode`), never on a message alone.
- `observeWrites(fn)` records each insert, update and delete the engine
  receives while `fn` runs (`object`, `operation`, `data`, `where`, `multi`,
  `context`) and what the engine answered (`pending`, then `resolved` with its
  result or `refused` with its error and that error's own `code`). It is one
  middleware on the engine's own chain that passes everything on unchanged,
  so it sits after the write gates the boot registered: a write a gate refuses
  (the permission check among them) never reaches it and leaves no entry,
  while every refusal past the gates (a validation rule, a hook's throw, a
  unique conflict) is recorded. An outcome is the engine's answer to that call,
  not a statement about stored rows: read those back with `rows`. The window is
  time, not cause, so filter by `object`. `observation.settled(match)` waits
  for a write that lands later, such as an `async: true` hook's (default
  timeout 2000 ms). To stage a refusal of a hook's write, arrange one the
  engine makes itself: seed the row that already holds a unique value, or set
  up the state a declared validation rule refuses. The handle has no switch
  that refuses a write in the engine's place.
- Many files, one boot: `bootStackOnce(config, opts?)` memoises `bootStack` per
  `(config, opts)` object identity for the life of the process. Share it from
  one module, under vitest `isolate: false`, and never `stop()` a stack other
  files still use.

### What the build ships: boot the compiled artifact

`objectstack build` lowers each inline hook `handler` and action `target` it
can into a metadata-only `body`, and a deployment runs that body in the
runtime's QuickJS sandbox, against the sandbox's `ctx`. A source boot runs the
function in-process instead. To test what ships, boot the artifact:

```ts
// After `objectstack build` (the handle lowers nothing; build first).
const shipped = await bootStack(myApp, { artifact: 'dist/objectstack.json' });

// Every door now runs the lowered body. A handler that passes in-process can
// refuse here: a body meets the sandbox's `ctx`, which has no
// `ctx.dispatch.scope`, for one.
await expect(shipped.hooks.run('crm_lead', 'insert', { last_name: 'Ada' }, { system: true }))
  .rejects.toMatchObject({ name: 'SandboxError' });
```

- The artifact is read by the runtime's own artifact loader and mounted as the
  app, in place of `config`; the rest of the stack is still composed from
  `config` (its `requires`, its `plugins`, its default profile), as
  `objectstack serve <config>` composes it. A relative path resolves against
  `hostRoot`.
- A refused body answers as the body-only path answers: the handle rejects with
  the sandbox's `SandboxError`, which carries a `code` and `status` the body
  declared on its throw; a body that crashes (a `TypeError`) has none, and REST
  answers it `500` `INTERNAL_ERROR`.
- A callable the build could not lower is bundled into
  `objectstack-runtime.*.mjs`, which a local artifact boot merges, so it runs
  in-process here as under `objectstack start`. `objectstack build
  --strict-body` refuses it at build time instead, and its artifact is
  body-only.
- Refused before anything boots: an artifact that cannot be loaded
  (`RESOURCE_NOT_FOUND` / 404; the boot never falls back to the source), one
  built from another app (`RESOURCE_CONFLICT` / 409), and a configuration
  carrying `onEnable`, which no artifact carries (`INVALID_REQUEST` / 400). A
  stale artifact boots stale bodies: build before the run.

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

**Reference-value shape** (`runReferenceShapeProofs`), per field:

| status | meaning |
| --- | --- |
| `proven` | every wrong-shaped write was refused, the refusal naming the field |
| `holes` | at least one wrong-shaped write was admitted **(failure)** |
| `failed` | a door faulted on a probe **(failure)** |
| `inconclusive` | a refusal named something else, or a probe could not be written (the reason is reported) |
| `excluded` | the field is `readonly` or `system`; the caller does not write it |

**Declared delete behaviour** (`runDeleteBehaviorProofs`), per reference field
and per door (by-id deletes only: a predicate or multi-row delete is not asked):

| status | meaning |
| --- | --- |
| `proven` | the delete did what the declared `cascade` / `set_null` / `restrict` says, through every door |
| `contradicted` | a delete did something else — the holder survived a `cascade`, was deleted or still references the record after a `set_null`, a `restrict` was not refused, or a holder of another record changed **(failure)** |
| `failed` | a door faulted **(failure)** |
| `inconclusive` | the delete was refused for another reason (a hook, a rule, a permission), or a fixture could not be created (the reason is reported) |
| `excluded` | the declaration states no outcome of its own: a `set_null` on a required reference (it cannot be cleared, so an engine rule decides), or a field the spec's parse gives no `deleteBehavior` (a bare `master_detail`, a `user`) |
| `not-derivable` | no fixture can be built from the app's metadata: the target is not an object the app declares (`sys_user`), the field is `readonly` / `system`, or the CRUD derivation cannot synthesize the holder or the target |

**Declared unique scope** (`runUniqueScopeProofs`), per field declared `unique`
(the field-level declaration; a unique `indexes[]` entry is a different surface
and is not in the population). Probes: `within` × door × insert and update, and
on a walled boot `across` × door × insert:

| status | meaning |
| --- | --- |
| `proven` | every second holder met what the declared scope says: refused within one organization; across, admitted for `true` / `'organization'`, refused for `'global'` or with no organization column |
| `contradicted` | a second holder was admitted where the scope refuses it, or refused where it admits it (the constraint is installation-wide, and its refusal tells one organization another holds the value) **(failure)** |
| `failed` | a door faulted **(failure)** |
| `inconclusive` | a refusal was not this field's unique constraint (an app's own dedupe, a rule, a permission, a constraint on another field, or one that names no field where a unique `indexes[]` entry covers the field), or a fixture could not be written (the reason is reported) |
| `excluded` | a derived value (`formula`, `summary`) is not stored, or the declaration does not parse |
| `not-derivable` | no fresh value can be built: a closed or tiny value space (`boolean`, `select`, …), a multi-valued reference, a target the app does not declare, or an object the CRUD derivation cannot synthesize |

**Parent-derived write reach** (`runParentWriteReachProofs`), per object
declared `controlled_by_parent`. Probes per persona and master chain (another
principal's, the persona's own): edit and delete of a detail another principal
owns and of one the persona owns, and a create. Each is expected `allowed`
exactly when the persona's effective grant on the detail (`/auth/me/permissions`,
folded by `objectPermissionGrants`) holds the verb and the persona's empty
update of the master was admitted:

| status | meaning |
| --- | --- |
| `proven` | every write met that conjunction: admitted where both halves hold, refused with `403 PERMISSION_DENIED` naming the detail and the operation where either does not |
| `contradicted` | a write met the other answer — refused where the persona holds the verb and edits the master, admitted where it does not, or refused while the record shows it landed **(failure)** |
| `failed` | a door faulted **(failure)** |
| `inconclusive` | a refusal was not the platform's authorization refusal of this write (a rule, a hook's own code, a refusal on another object), a fixture could not be written, or a master's edit could not be measured (the reason is reported) |
| `excluded` | the declaration names no one master: no `master_detail` field, two of them, a master the app does not declare, a cycle, or a chain at the write gate's depth bound |
| `not-derivable` | the detail or a master in its chain cannot be synthesized by the CRUD derivation |

A master chain a persona cannot read is outside its reach and is counted, not
probed (a write to a record the caller cannot read is the RLS family's
subject). A persona whose `/auth/me/permissions` answer names no permission set
is reported not run: that empty answer is also the endpoint's when it could not
compute one, so it is not read as "no grant anywhere". `summary.hardFailures` is
`contradicted + failed` objects plus personas that could not be provisioned.

**Dashboard date windows** (`runDashboardWindowProofs`), per widget a
dashboard's `dateRange` binds. Probes per measure that is a count, a sum or
derived over those: the widget with no
window, then each of the 13 presets, each counted before and after the
fixture rows:

| status | meaning |
| --- | --- |
| `proven` | under every preset the window counted exactly the fixture rows it selects |
| `contradicted` | under some preset the widget showed nothing where the window selects fixture rows (`blank`), or counted another number of them, or a derived measure showed another value than the server's evaluator makes of its operands; a window that answers what no window answers under every preset is also named `inert` **(failure)** |
| `failed` | the door refused or faulted on a windowed query while the widget's own query answered **(failure)** |
| `inconclusive` | a fixture row could not be written or did not read back as written (an app hook rewrote it, or the read omits the column), the widget with no window did not count every fixture row (its own selection does not meet the fixtures), its own query is refused, the UTC day turned after the run started, or the caller's reference timezone is not UTC |
| `unbound` | the widget opts out of the window (`filterBindings: { dateRange: false }`) |
| `excluded` | the family cannot compare it: no measure it can compare (an `avg`, `min`, `max` or `count_distinct` is not additive), a filter the ground truth cannot model, a window on a field that is missing or is not `date` / `datetime`, a dataset or dashboard that is undeclared or does not parse, or an object the app does not declare or the CRUD derivation cannot synthesize (`excludedKind` names which) |

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

- `bootStack(config, opts?)` → `VerifyStack` (`api` / `raw` / `signIn` / `signUp` / `apiAs` / `stop`, plus the handle:
  `hooks.run` / `hooks.updateWhere` / `validate` / `flows.run` / `flows.resume` / `actions.run` /
  `automation.evaluateCondition` / `seed` / `rows` / `observeWrites` / `metadata` / `tenancy` / `contextFor`).
- `bootStackOnce(config, opts?)` → the same, memoised per `(config, opts)` identity for the process.
- `deriveCrudCases(config)` → the auto-derived round-trip cases (write one, read one, assert) for every object.
- `runCrudVerification(stack, token, config)` → `VerifyReport`; `formatReport(report)` for a log summary.
- `runRlsProofs(stack, adminToken, memberToken, config)` → `RlsReport`; `formatRlsReport(report)`.
- `deriveReferenceShapeCases(config)` → one case per reference field; `runReferenceShapeProofs(stack, token, config, { doors? })`
  → `ReferenceShapeReport` (`summary.hardFailures` is what a gate reads); `formatReferenceShapeReport(report)`.
- `deriveDeleteBehaviorCases(config)` → one case per reference field, with its declared behaviour or the reason it is
  not compared; `runDeleteBehaviorProofs(stack, token, config, { doors? })` → `DeleteBehaviorReport`
  (`summary.hardFailures` is what a gate reads); `formatDeleteBehaviorReport(report)`.
- `deriveUniqueScopeCases(config)` → one case per field declared `unique`, with its parsed scope, its doors and what a
  second organization meets, or the reason it is not compared; `runUniqueScopeProofs(stack, token, config, { doors? })`
  → `UniqueScopeReport` (`boot` names the legs this boot ran; `summary.hardFailures` is what a gate reads);
  `formatUniqueScopeReport(report)`.
- `deriveParentWriteReachCases(config)` → one case per object declared `controlled_by_parent`, with the chain of
  `master_detail` hops a write on it walks, or the reason it is not compared; `parentWriteReachSecurity(config)` → the
  `SecurityPlugin` to boot with (registers the verifier personas' sets); `runParentWriteReachProofs(stack, config)` →
  `ParentWriteReachReport` (`personas` names who wrote and who could not be provisioned; `summary.hardFailures` is what
  a gate reads); `formatParentWriteReachReport(report)`.
- `deriveDashboardWindowCases(config)` → one case per widget of every dashboard with a `dateRange`: its bound field,
  dataset, object and count measures, or why it is unbound or not compared; `runDashboardWindowProofs(stack, token,
  config)` → `DashboardWindowReport` (`presets` names what each preset handed the door and how it resolved;
  `summary.hardFailures` is what a gate reads); `formatDashboardWindowReport(report)`.

`bootStack` options: `admin`, `authSecret`, `security` (a custom `SecurityPlugin`
for owner-scoped fixtures), `multiTenant` (also what decides the posture
`tenancy()` reports), `automation` (register the automation service so
`flows.*` and `automation.evaluateCondition` have something to drive; an app
that declares `requires: ['automation']` gets it without this), `orgContext`,
`databaseFile`, `extraPlugins`, `artifact` (boot the compiled artifact as the
app, so hooks and actions run their lowered `body`).

The `config` `bootStack` takes is `defineStack` output, as every example above
passes it: a raw object literal registers its fields as authored, without the
spec's parse defaults, so an `autonumber` that authors no `unique` gets no
unique scope and no index.

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
