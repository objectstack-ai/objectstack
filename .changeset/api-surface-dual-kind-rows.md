---
"@objectstack/spec": patch
---

`api-surface/` now records the value half of a name declared as both a const and a type, so deleting it is a breaking change the gate reports.

TypeScript merges an `export const X` and an `export type X` into ONE symbol whose flags carry both. `build-api-surface.ts` mapped that symbol through a first-match-wins lookup that tested `TypeAlias` before `Variable`, so the shard recorded `X (type)` alone and the value half was never enumerated. Ablated: deleting `export const RestApiRouteRegistration` while keeping its type alias left all 17 shards byte-identical, the export total unmoved, and `check:api-surface` printing "public API surface + factory signatures unchanged" at exit 0 — on a removed public value export, which is the exact removal the ADR-0059 breadth gate exists to make loud. On the fixed generator the same deletion reports `- RestApiRouteRegistration (const)` as 1 breaking change and exits 1.

The generator now emits one row per DECLARED kind. The shipped `api-surface/` shards gain **134 rows across 10 of 17 entry points** — every one of them the previously-missing `(const)` half of a name that also declares a type — as a pure insertion: zero rows removed, zero modified, no reordering.

**Why `patch` and not `minor`, measured against what a consumer can observe.** No export was added, removed or renamed: `dist/` is byte-identical across this change, and the row grammar `Name (kind)` is untouched, so anything that parsed the artifact before parses it now. The 134 new rows describe exports that already existed — the record got more complete, no capability arrived. What changes is the accuracy of a shipped record and the strictness of this repo's own gate, which is a fix.

One consequence for the release seat, stated because it is not visible from the diff: `build-spec-changes.ts --previous-surface` is a release-time join, so a release crossing this change will list those 134 rows as `added` surface entries. They are not new API — they are the same exports, newly recorded.
