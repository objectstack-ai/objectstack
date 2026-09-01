---
"@objectstack/cli": minor
---

fix(cli): make `os migrate plan`'s "writes nothing" a property of the mechanism, not of an unwritten host convention (#13332)

`composeForDeclarations` documented the plan path's guarantee in its own words —
*"(init runs, start does not — a plan writes nothing)"* — and implemented it as a
Proxy whose only override is `start`. `packages/core/src/kernel.ts` then fires
three phases unconditionally after the suppressed start pass: `kernel:ready`
(Phase 3), `kernel:bootstrapped` (Phase 3.5) and `kernel:listening` (Phase 4). A
writing hook **registered from `init()`** survives the suppression and executes
on all three. The guarantee was therefore a property of plugins that happen to
seed from `start()` — the shape of the one plugin that had been measured — and
not of the plan path.

Measured, twice. The module header records 14 `Insert operation failed` rows
against `sys_permission_set` from a deferred `plan` boot, and notes that on a
database whose tables already exist those inserts **succeed**: a command
documented as writing nothing seeds rows into an operator's production control
plane. Downstream, a control plane hit exactly this on the `apply=false` run
that is its mandatory human review gate before a production schema apply
(`driver.create` / `driver.update` on `sys_ai_model`, from an
`init()`-registered `kernel:ready` hook).

**What changed.** For the length of the kernel bootstrap, `os migrate plan` /
`os migrate apply` now refuse the row-write members of the data-driver contract
(`IDataDriver`: `create`, `update`, `upsert`, `delete`, `bulkCreate`,
`bulkUpdate`, `bulkDelete`, `updateMany`, `deleteMany`) on every `driver.*`
instance the kernel publishes. The refusal sits at the driver, not at a list of
lifecycle phase names: it is phase-agnostic (a phase added tomorrow is covered
on the day it ships), it covers writes that arrive through the ObjectQL engine
as well as direct `driver.*` calls (the engine holds the same instance), and
read/log-only hooks still run — which is what an operator reading a plan before
a production apply needs them to do. A refused write returns a contract-shaped
value rather than throwing (boot hooks dispatch propagating, so throwing would
abort the bootstrap and leave the operator with no plan at all), and every
refusal is reported: one warning on stderr per driver/method/object triple,
plus a line in the composition notes the plan prints and `--json` carries.

The contract's raw-execution escape hatch — `IDataDriver.execute()`, a required
member on every driver — is FORWARDED and REPORTED rather than refused: a raw
command is `unknown` by contract ("SQL string, shell command, or API payload"),
and SQL text cannot be classified as read-vs-write reliably, so refusing would
break boot-legitimate reads and the framework's own index DDL on a guess. A
boot-window `execute()` is counted per driver, warned once per driver on
stderr, and named in the composition notes — and on such a run the notes do
NOT claim the plan wrote nothing, because the guard cannot verify it.

The guard is disarmed the moment the bootstrap returns, so `os migrate apply`'s
confirmed DDL flush and the coverage measurement are untouched.

**Who this affects.** A host whose plugins write during a `plan`/`apply` boot
from anywhere other than a suppressed `start()`. Contract row writes previously
landed and now do not; the run says so. A host whose plugins call raw
`execute()` during the boot keeps its behaviour (the call is forwarded) and
now sees it reported. A host that did neither sees no change at all — no
disarm note is emitted when nothing was refused and no raw command went
through.

Boundaries stated rather than hidden: `execute()` is reported, never refused
(above); `getKnex()` (a driver-sql extension, genuinely off-contract) is not
intercepted. DDL splits: `deferSchemaDdl` holds back the
`initObjects`/`syncSchema` path (flushed on purpose by `apply` once the
operator confirms), while `dropTable`/`rotateShards` are NOT held back by that
deferral — they are gated only by `assertSchemaMutable`
(schemaMode/dialect) and stay a genuinely open boundary during the boot.
Drivers the engine holds for a NON-default datasource are never published as
`driver.*` (`DatasourceConnectionService.connect()` hands them to
`engine.registerDriver` directly), so they are invisible to the guard's scan
and objectql-mediated writes to objects bound to them would land. The guard
also does not cover writes a plugin makes outside the database, or work a hook
defers past the end of the bootstrap.
