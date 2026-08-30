---
"@objectstack/driver-memory": minor
"@objectstack/types": patch
---

fix(driver-memory): enforce field-level `unique`, so a colliding write is refused instead of landing silently (#13197)

`InMemoryDriver` enforced **no uniqueness at all**. `create` was a
`table.push()` and `syncSchema` allocated an array, so a `unique: true` field
was declared-and-not-enforced — the ADR-0078 / Prime-Directive-#10 shape the
platform refuses everywhere else. A colliding write did not fail; it landed, and
a read returned both rows.

The motivating instance is the worst-shaped one. The engine's
`createWithAutonumberResync` re-seeds the counter and re-issues a record number
when the STORE rejects it as a duplicate, so on a store that rejected nothing
the whole branch was unreachable: an autonumber allocated out of process
duplicated an existing business identifier with **no error anywhere**. The
remedy's location was already ruled in-tree at that method — «uniqueness
enforcement in the driver, NOT a pre-issue existence probe here» — and this is
that remedy. Nothing in the new code knows what an autonumber is; the defect was
that the driver constrained nothing.

**The refusal** carries the ADR-0112 envelope the SQL family answers a conflict
with: `code: 'UNIQUE_VIOLATION'`, `status: 409`, no `[driver-memory]` prefix. So
a suite that swaps this driver for SQLite sees one envelope — the parity
`memory-filter-refusal-envelope.test.ts` already states for the filter family,
now held for the constraint family. It is checked before the row is written, so
a refused write leaves the table exactly as it found it, and `updateMany`
prepares and checks the whole batch before mutating any of it.

**The scoping is `driver-sql`'s, measured — not a simpler invention.** Read off
`uniqueIndexesFromFields` (ADR-0120 D1/D3) and reproduced arm for arm:
`unique: 'global'` is platform-wide; bare `true` and `'organization'` are
per-organization (bare `true` is the POSITIONAL spelling of `'organization'` at
FIELD level — reading it as `'global'` is the #4986 trap and would make two
organizations' identical values collide on a constraint neither can see); both
degrade to a single column when the object has no tenant column, and a `unique`
declaration on the tenant column itself stays single-column. NULL values stay
NULL-DISTINCT, exactly as under SQL `UNIQUE`. The D3 NULL-organization fold
needs no `'__global__'` token here — that sentinel is a SQL-expression artefact,
and a JavaScript key holds `null` directly.

**Not** widened into: object-level declared `indexes[]` (composite uniques),
primary keys, or row-level tenant isolation. This driver still refuses to boot
multi-tenant (#6915) and that guard is untouched.

`@objectstack/types` (`patch`): `isUniqueViolationError` now reads the
platform's own registered `UNIQUE_VIOLATION` code on the `code` channel. Not
cosmetic — a conflict that predicate does not recognise leaves the autonumber
resync unable to re-seed, so the counter stays warm and every following insert
collides too (#5495's PROBE3 storm), i.e. a silent duplicate traded for a
non-converging insert loop. It is a tautology rather than a widened heuristic
(the code already MEANS this condition), and no existing in-repo producer's
classification changes: `@objectstack/rest`'s own response body is the only
other site carrying that string, and it is downstream of the predicate.

**Grade.** `minor` for the driver, not `patch`: a write that previously
succeeded is now refused (`409`), which is an accept-set narrowing under the
repo's launch-window convention for breaking changes, and the package also gains
public exports (`UNIQUE_VIOLATION_CODE`, `uniqueConstraintsFromFields`,
`tenantFieldOf`, `uniqueKeyOf`, `assertNoUniqueViolation`,
`uniqueViolationError`). `patch` for `@objectstack/types`: no API added or
removed and no in-repo verdict changes — the limb exists to serve the new
producer. Fixtures that relied on duplicates landing on a declared-unique field
must stop declaring `unique`, or stop writing the duplicate; the repo's own
suites were measured and none did.
