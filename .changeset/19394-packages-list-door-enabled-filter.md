---
'@objectstack/runtime': minor
---

fix(runtime): `GET /api/v1/packages` honours the declared `enabled` query parameter (#19394)

Clause-②: no (narrowing)

**BREAKING for callers of the packages list door** — `?enabled=` is now read.
A request that supplies it gets a filtered list instead of the whole one, and a
value the declared type does not admit is refused `400` / `VALIDATION_FAILED`
instead of being dropped. Both used to answer `200` with every installed
package.

The accept set only shrinks back to what the published declaration has always
said. `ListInstalledPackagesRequestSchema` declares
`enabled: z.boolean().optional()` and the serving door never read the key, so a
caller filtering an installed-package list by `enabled` was handed the
unfiltered list with no refusal and no warning — «declared ≠ enforced» in the
silent direction, which nothing in the status, the headers or the body
distinguishes from a request served as asked.

**The semantics are the declaration's, not a plausible reading of it.** Absent
means NO filter, and it stays reachable: `.optional()` carries no `.default()`,
so an absent key is an absent key and never collapses into `false`. An explicit
`enabled=false` is a filter and selects the disabled rows only — so "omitted"
and "false" are two different requests, which is the distinction the first-party
SDK already spells (`client.packages.list({ enabled })` sends the key only when
it is not `undefined`). `enabled` is read off the row's own `enabled` state, not
off `status`; the two are independent keys on `InstalledPackageSchema` and a row
carrying no `enabled` at all counts as enabled, which is that schema's declared
`.default(true)`.

The coercion is the repo's one parser for a query parameter declared
`z.boolean()` (`parseBooleanParam`), the same one `GET /api/v1/notifications`
reads its identically-declared `read` with — so the wire has exactly the two
spellings the type has, and a third (`enabled=1`, `enabled=yes`, an empty
`enabled=`) is refused rather than guessed. A repeated `?enabled=a&enabled=b` is
refused with the sentence this door already uses for a repeated `?version=`.

**What is not affected.** `status` and `type` filter exactly as before, an
unmatched filter still selects nothing rather than erroring, and `hasMore` stays
the constant `false` it became when the request-side pagination keys were
retired. Boot-time and in-process installs never reach this branch.

**If you are refused.** Send `enabled=true` or `enabled=false`, the two
spellings the schema has always declared, or drop the key to get every row back.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is removed, renamed or reshaped: no spec key, no export, no stored row. `objectstack migrate meta` has nothing to reach, because there is no old spelling that maps to a new one — the door starts reading a key the declaration already carried. The refusal itself carries the remedy. -->
