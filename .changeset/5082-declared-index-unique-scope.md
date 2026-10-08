---
'@objectstack/spec': minor
'@objectstack/lint': minor
'@objectstack/platform-objects': patch
'@objectstack/metadata-core': patch
'@objectstack/metadata-protocol': patch
'@objectstack/plugin-security': patch
'@objectstack/plugin-auth': patch
'@objectstack/plugin-sharing': patch
'@objectstack/service-messaging': patch
'@objectstack/service-automation': patch
'@objectstack/service-realtime': patch
---

A declared index states its uniqueness scope: bare `unique: true` on `indexes[]` is refused (protocol 18, ADR-0120 D1/D7), stored metadata converts it to `unique: 'global'` with zero drift, and `VISIBILITY_STRICT_OPTIONS` leaves `@objectstack/spec`'s public surface.

Clause-②: no (narrowing)

<!-- adr-0087: registered declared-index-bare-unique-true-retired, visibility-strict-options-unexported -->

**BREAKING**: an accept-set narrowing on a published authoring surface and one export removal, shipped as `minor` under the launch-window convention for accept-set narrowings (Changesets pre mode is not in on `main`).

**Why.** On a declared index, bare `unique: true` was the one `unique` spelling whose scope was positional. It built the index over exactly `fields`, one holder across the whole installation, while reading like "unique per organization" to an author who knew the field-level meaning. 17.x warned (lint `unique/unscoped-declared-index`). Protocol 18 refuses it, so the scope is always stated.

**What is refused.** A declared index (`objects[].indexes[]`, `objectExtensions[].indexes[]`) whose `unique` is bare `true`. The refusal names both replacements, and says which one keeps the index bare `true` built. It is raised by:

- the schema (`IndexSchema.unique`, now `false | 'global' | 'organization'`), at every door that parses: `ObjectSchema.create()` and `ObjectSchema.parse()`, `defineStack`, `os validate`, `os build`, and the runtime save door (`422 INVALID_METADATA`). `tsc` refuses it too, because the input type no longer admits `true`;
- lint `unique/unscoped-declared-index`, now an `error` and a gating rule on all three commands. It is what refuses the spelling under `os lint`, which never parses.

**What converts.** The protocol-18 ADR-0087 conversion `declared-index-unique-scope` rewrites a declared index's bare `true` to `'global'` on every data-at-rest seam: stored `sys_metadata` rows (`applyConversionsToStoredItem`), built artifacts inside their declared-floor window, and `os migrate meta --from 17`. `'global'` is exactly the index bare `true` built, so the physical index is byte-identical and the drift plan is empty. It is retired from the authoring funnel, so a live author is refused and taught instead of converted silently.

**What stays accepted.** Field-level `unique: true` still means one holder per organization and stays valid indefinitely. On a declared index, `unique: false` or omitted, `'global'` and `'organization'` parse exactly as before.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `indexes: [{ fields: [...], unique: true }]` | `indexes: [{ fields: [...], unique: 'global' }]`: the same index, nothing on disk changes |
| …the same, when you meant one holder per organization | `unique: 'organization'`: the driver prepends the NULL-safe organization key part at registration, and `os migrate plan` shows the index change |
| `import { VISIBILITY_STRICT_OPTIONS } from '@objectstack/spec/shared'` (or the root entry) | delete the import: it was an internal option bag for the spec's own visibility-carrying schemas, and those schemas are unchanged |

**The one-line fix: on every declared index, write `unique: 'global'` where you wrote `unique: true`.** Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.

**Who is affected, measured.** At `e67ba80049`, an AST census found 48 declared indexes with bare `unique: true` in 39 source files of this repository, all platform and plugin objects. Every one is respelled `'global'` in this change, and the nine-key S5 corpus is pinned to build byte-identical indexes before and after (`driver-sql`'s `sql-driver-unique-tenancy.test.ts`). `examples/**` and `apps/**` carry none. Deployed metadata and other repositories were not measured.

### The kit

- **The refusal.** `IndexSchema.unique` in `data/object.zod.ts`, with its own prescription. The lint rule moved from `warning` to `error` and from advisory to gating.
- **The conversion.** `declared-index-unique-scope` (`toMajor: 18`, retired from the load path, `retiredAfter: '17.7.0'`), with its S4/S5 fixture.
- **The ledger.** The D3 semantic entries `declared-index-bare-unique-true-retired` (the scope each respelled index really meant is the author's call) and `visibility-strict-options-unexported`, plus a step-18 rationale fragment.
- **The export.** `VISIBILITY_STRICT_OPTIONS` moved to the unbarrelled `shared/visibility-strict-options.ts`, beside its type `StrictObjectOptions`. `check:api-surface` counts the removal.
- **The pins.** The "`'global'` is a synonym of `true`" driver pin retired with the bare spelling. The verbatim pin is stated in `'global'`.
