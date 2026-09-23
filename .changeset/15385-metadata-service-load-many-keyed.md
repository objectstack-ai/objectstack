---
'@objectstack/spec': minor
---

`IMetadataService` declares `loadManyKeyed?` — the keyed plural loader read now sits on the contract beside its two declared siblings `loadMany?` and `loadDiagnosed?` (#15385).

Clause-②: yes

A verb family lives whole on the contract. `MetadataManager.loadManyKeyed(type)` shipped as a public member with no declaration on the interface its siblings are declared on, so the one cross-package caller — the ObjectQL governance audit — narrowed the service slot with a **local structural type** written beside the call site. That local type is deleted in the same change and the call site reads the contract.

The vocabulary is not new: `loadManyKeyed`, and the `{ name, data }` item shape it answers with, are already published on `MetadataLoader`, which declares the same member as optional over its own loader-local options type. What this adds is the member's place on `IMetadataService`.

```ts
loadManyKeyed?<T = unknown>(
    type: string,
    options?: Record<string, unknown>,
): Promise<Array<{ name: string; data: T }>>;
```

**What it is for.** The key is a fact about the **store** — `register()`'s own `name` argument — and it travels *beside* `data`, never folded into it, so `data` stays byte-identical to what the unkeyed plural read would return and no consumer ever sees a synthesised `name`. An item whose stored body has no top-level `name` is legal and deliberate (an org customization container's identity is the object it targets), and such an item has no identity at all in a plural read keyed by `data.name` — it is dropped, silently. That is why this is a second member rather than a widened return type on the existing one.

**What moves for consumers.** Nothing breaks. The member is **optional**, like `loadMany?` and `loadDiagnosed?` beside it, so every existing `IMetadataService` implementation still satisfies the contract unchanged and the `typeof … === 'function'` probe stays the way a caller asks for it. What changes is that a caller no longer has to declare the shape itself to stay typed: intersecting the slot with a hand-written structural type was the only way to reach the member without erasing the lookup to `any`, and that workaround is now unnecessary. `MetadataManager`, which already implements the member, needs no edit.

This is the position `loadDiagnosed` was in before #4127 batch 4 declared it, and it is resolved the same way. Ruled in decision batch #123 item 5 (2026-09-12), maintainer verbatim: 「同意」.

`content/docs/kernel/contracts/metadata-service.mdx` gains the member in the same change.
