---
"@objectstack/driver-sql": minor
"@objectstack/plugin-auth": patch
---

feat(driver-sql)!: organization-scoped uniques are NULL-safe — `COALESCE(organization_id, '__global__')` key part + `unique: 'organization'` on declared indexes (ADR-0120 D3/D4, #5030)

SQL UNIQUE is NULL-distinct, so the `(organization_id, field)` composite #3696
introduced enforced **nothing** on rows whose organization is NULL — which on a
single-tenant stack (where the kernel injects the column and never fills it) is
**every row**: field-level `unique: true` was a silent no-op there, measured in
#5030. Per ADR-0120 D3, every organization-scoped unique now materializes its
organization key part as `COALESCE(organization_id, '__global__')`: NULL-organization
rows collapse into one platform bucket, unique among themselves; non-NULL rows
are untouched. Storage stays NULL — the sentinel exists only inside the index
key, and it is the same word the autonumber sequence table already uses
(`GLOBAL_TENANT`), so a constraint-violation error reads as "the platform
bucket collided", not as corrupt data.

What changes, concretely:

- **Field-level `unique: true`** (and the new explicit synonym
  `'organization'`) on a tenant-scoped object → composite
  `(COALESCE(tenantField, '__global__'), field)`. `unique: 'global'` and
  tenant-less objects are unchanged.
- **Declared indexes gain the ADR-0120 D1 scope vocabulary at the driver**:
  `unique: 'organization'` prepends the NULL-safe organization key part to the
  listed columns (degrading to the listed columns on a tenant-less object; a
  listed tenant column is made NULL-safe in place instead — the S6 respelling).
  `unique: true` / `'global'` on a declared index stays **verbatim** — the
  #3696 contract, now the `'global'` arm; the nine engine dedup/idempotency
  keys keep their exact physical shape. (The spec/lint side of the vocabulary
  lands separately via #4986; the driver deliberately merges first.)
- **Drift detection reads both sides through one normalization**
  (the #4884 discipline, extended to the tenant key part): the physical
  `COALESCE(organization_id, <literal>)` form is attributed to the column,
  compared **literal-agnostically**, and recognised as the sync's own
  vocabulary — a healthy database reports zero drift on every dialect.
- **Existing bare composites migrate through the ceremony (ADR-0120 D4)**:
  `(organization_id, X) → (COALESCE(organization_id, '__global__'), X)`
  surfaces as a `recreate_index` drift op — a pure tightening — gated by a
  **duplicate pre-flight probe**. Clean probe → the op grades `safe` and dev
  `autoMigrate: 'safe'` / a plain `os migrate apply` applies it. Duplicates
  (data the void constraint wrongly admitted) → the op is **blocked** with a
  per-group row report, the old index stays in place, and apply re-probes so
  even `--allow-destructive` cannot drop a constraint whose replacement is not
  creatable. Deduplicate, re-plan, apply.
- **`'__global__'` is reserved at the organization-minting seam**
  (plugin-auth): an organization whose id or slug equals the sentinel is
  rejected at creation with a prescriptive error (ADR-0120 D3 guardrail).

Migration note for operators: on databases with pre-existing
organization-composite uniques, the first `os migrate plan` after upgrading
shows one `recreate_index` per affected index. On healthy data it auto-applies
in dev and is a no-op content-wise; a blocked op means the #5030 defect
admitted real duplicate rows — resolve the listed rows first. MySQL < 8.0.13 /
MariaDB cannot express the functional key part: the driver degrades to the
bare composite, says exactly what is not enforced at `error` level, and keeps
reporting the tightening as drift for after the server upgrade.
