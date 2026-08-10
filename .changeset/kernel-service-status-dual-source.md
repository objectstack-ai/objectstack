---
"@objectstack/spec": minor
---

BREAKING(spec): `@objectstack/spec/system` renames `ServiceStatusSchema` → `KernelServiceStatusSchema` and gains the `KernelServiceStatus` type alias (#6604, ADR-0112 D9a)

`ServiceStatus` was published by two entry points for two disjoint concepts: `./api`'s
discovery health **enum** (`api/discovery.zod.ts`) and `./system`'s kernel service **state
object** (`system/core-services.zod.ts`, a `features`-bearing record). Per the maintainer
ruling of 2026-08-08 (Option B) the kernel side takes the domain-specific name, matching
its `KernelServiceMapSchema` sibling in the same file:

- `ServiceStatusSchema` → `KernelServiceStatusSchema` (`@objectstack/spec/system`)
- new: `export type KernelServiceStatus` — the alias `#4593`'s backfill had to skip,
  because declaring `ServiceStatus` on both entry points would have minted the #4411
  dual-source trap
- JSON Schema def `system/ServiceStatus` → `system/KernelServiceStatus`, carried through
  `RENAMED_DEFS` with all 6 authorable keys (`enabled` / `features` / `name` / `provider` /
  `status` / `version`) intact

**`@objectstack/spec/api`'s `ServiceStatus` is untouched** — it keeps its published name,
so no consumer of the discovery health enum changes. Nothing left the author-facing
contract: the renamed def re-emits every key byte-for-byte, which is why this rides the
rename table rather than the retirement kit. Consumers importing `ServiceStatusSchema`
from `@objectstack/spec/system` update the name; `tsc` reports TS2724/TS2305 on any that
does not.
