---
"@objectstack/objectql": patch
"@objectstack/spec": patch
---

fix(engine-core): a system-context insert on a tenant-scoped object resolves the install's organization the way a session write does, or is refused — the runtime producer of the autonumber fork #8686's backfill cannot reach (#8844)

<!-- adr-0087: not-required (no-migration-prescription) No authorable key is
added, renamed, retired or tombstoned. One error code is registered in the
ADR-0112 ledger and one engine-internal module is added; the behavioural change
is that a system-context insert on a tenant-scoped APPLICATION object now
resolves an organization instead of landing NULL, and refuses rather than
guessing where none is derivable. Stored data is untouched: already-minted
duplicates are reported, never rewritten (the #8686 posture, ruled again here).
-->

#8686 fixed **one** producer of untenanted rows — the seed loader — and shipped
a one-shot backfill for what it had already written. This card is the **other
producer, which is still running**: an ordinary application write made under a
system execution context (a hook, a scheduled job, a custom endpoint, a
`runAs: system` flow). A backfill cannot reach it, because it mints a fresh
duplicate on every tick — which makes #8686's repair **self-undoing on any
install with server-side automation**, i.e. every business app.

**Measured on 17.0.0 GA**, a single-tenant EHR/MES install with ~44 autonumbered
objects: two records, same object, same install, the **same** value on a field
the app declared `unique`, with no error and no warning. The `notification` case
shows both producers side by side — `NT-00002 .. NT-00011` each existing twice,
copy A written by the "maintenance overdue" cron job, copy B by a user action.

**Mechanism.** A session write carries the caller's active organization, the SQL
driver stamps it onto the row (`injectTenantOnInsert`), and the autonumber
counter reads it back off the row (`fillAutoNumberFields`, resolving
`row[tenantField] ?? options.tenantId ?? null`). A system-context write carries
none, so the column lands `NULL` and the counter files the row under the
`__global__` pseudo-tenant. One object then runs two counters that cannot see
each other, each correct within its own scope, and the partitioned unique index
— `(COALESCE(organization_id, '__global__'), <field>)`, ADR-0120 D3 — cannot see
across the two partitions either.

⛔ **Not a counter bug**, and not fixed by making the allocator smarter: both
counters are already correct within their own scopes (the reasoning #8686
recorded, unchanged). The defect is upstream of the counter.

**The fix, per the 2026-08-15 maintainer ruling (Option 1)** — a system-context
write resolves the install's organization the way a session write does, at the
engine's stamp resolution, so every driver is covered at the source (which
matters here because `fillAutoNumberFields` is duplicated in `driver-sql` and
`driver-turso`; neither driver changed):

- **Single-tenant, exactly one organization ⇒ derive and stamp.** The
  `__global__` fork stops being minted by hooks, cron and system endpoints.
- **Multi-organization ⇒ carry an explicit organization or be REFUSED LOUDLY**,
  never silently defaulted. A walled posture (`group` / `isolated`), or a
  `single` posture whose data holds several organizations, has no derivable
  answer — the refusal is `ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED` (500,
  registered in the ADR-0112 ledger), thrown before anything reaches the driver,
  and its message names the condition, what would otherwise have been written,
  and both remedies.
- **Already-minted duplicates are reported, never rewritten** — the #8686
  posture, ruled again here. Nothing in this change renumbers anything.

**Three populations are outside the rule by construction, not by exemption**, so
that the refusal cannot break unattended automation that was never at risk:
objects with no organization column, objects declaring `tenancy: { enabled:
false }` (ADR-0066 — the *declared* way to hold org-less rows, rather than a
per-write bypass flag) and federated objects (ADR-0015); the platform namespaces
`sys_` / `cloud_` / `ai_`, whose rows are deliberately global (#8672's reasoning,
which this ruling confirms holds for platform objects and does **not** generalize
to application objects); and any write that already carries an organization — on
the execution context, on the record, or stamped by a `beforeInsert` hook.

**First boot is untouched:** before any organization exists there is nothing to
derive and no second partition to fork away from, so those rows still land
org-less for #8686's `sys_organization`-insert handoff to adopt.

Scoped to **insert**, deliberately: the ruling's yardstick is "the way a session
write does", and stamping the organization is an insert-side mechanism — an
update neither stamps it nor can fork a counter.
