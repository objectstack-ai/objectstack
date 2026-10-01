---
'@objectstack/driver-turso': minor
'@objectstack/spec': patch
---

fix(driver-turso)!: a tenant-scoped call on the remote (libSQL) face reaches the rows the local face reaches, and a remote `create` stamps the caller's organization (#21226)

Clause-②: no (narrowing)

<!-- adr-0087: registered driver-remote-doors-tenant-scoped -->

**BREAKING for callers of a remote-mode `TursoDriver` that pass `tenantId`.**

**What changed.** The engine hands every driver the caller's organization as
`DriverOptions.tenantId`, and the group posture's membership set as `tenantIds`
(ADR-0131 D8). The local face applies them through `SqlDriver.applyTenantScope`
on every read and on every update and delete predicate, and stamps the
organization on a new row. The remote face's doors received no driver options,
so their statements carried the caller's filter and nothing else. Now:

- **`find`, `findOne`, `count`, `aggregate`, `update`, `delete`, `bulkUpdate`,
  `bulkDelete`, `updateMany` and `deleteMany` carry the caller's tenant scope on
  the remote face.** The predicate is not a second copy: the remote face asks the
  local face's own chokepoint for it and ANDs what that compiles to onto each
  statement. So the rows a scoped call reaches are the same on both faces: the
  caller's organization, rows with no organization, and, under the group posture,
  the caller's membership set.
- **A remote `create` (and `bulkCreate`) stamps the caller's organization** on a
  row that names none, as the local `create` does. An explicit value on the row
  is kept.
- **`distinct` still refuses a tenant-scoped call on the remote face**, as before.
- A scope the remote face cannot read is refused (`INTERNAL_ERROR` / 500), never
  sent without the scope.

Where the engine's tenant wall composes a predicate above the driver, it already
kept other organizations' rows out of these answers. Where it composes none (the
posture in which that wall is inert, or an elevated caller that carries its
organization), the driver scope is the only fence, and the remote face had none.

## FROM → TO

| you relied on | now |
|:--|:--|
| a tenant-scoped remote `find` / `findOne` / `count` / `aggregate` reading another organization's rows | those rows are excluded (`findOne` answers `null`); call without `tenantId` to read every organization, as on the local face |
| a tenant-scoped remote `update` / `delete` by id reaching another organization's row | `update` answers `null` and `delete` answers `false`, and the row is untouched |
| a tenant-scoped remote `updateMany` / `deleteMany` / `bulkUpdate` / `bulkDelete` reaching another organization's rows | only rows in scope are written; the count reports them |
| a tenant-scoped remote `create` landing a row with no organization | the row carries the caller's organization; to write a row with none, call without `tenantId` |

**What is not affected.** A call without `tenantId`, or on an object with no
tenant column, sends the same statement as before. The local and embedded-replica
faces are unchanged. A scoped call's answer for the caller's own rows, and for
rows with no organization, is unchanged.
