---
"@objectstack/spec": major
---

feat(spec)!: a `view` body must be a view before the union judges it (#5599)

`ViewMetadataSchema` — the schema the `view` metadata type registers, and so the
one both `saveMetaItem`'s 422 gate and the read-time `_diagnostics` badge consult
— accepted **any object at all**. Measured on `origin/main`:

```
getMetadataTypeSchema('view').safeParse({ nope: 1 })  ->  success, data = { type: 'simple' }
getMetadataTypeSchema('view').safeParse({})           ->  success, data = { type: 'simple' }

saveMetaItem({ type: 'view', name: 'garbage_view', item: { nope: 1 } })
  ->  { success: true, state: 'active', seq: 1 }
      persisted body = {"nope":1,"name":"garbage_view"}
```

The union's fourth member (`FormViewSchema.extend(…).strip()`) both strips
unknown keys **and** declares no required key — `type` even carries a `'simple'`
default — so it matched every object and handed the whole union a wildcard. The
`.strip()` is deliberate and load-bearing (#5074: it is what carries Studio's
round-trip keys); the defect is that an arm which strips *and* requires nothing
is a universal match. So `view` was the one common overlay type whose declared
write-path spec validation (ADR-0005 §Validation) could be bypassed outright — a
`declared ≠ enforced` gap at union **member selection**, one level above the
object schemas #4001 closed.

Because `saveMetaItem` persists the *original* body rather than the parse output,
a wrong-shaped view — an AI-generated body in the wrong dialect, a hand-written
one with every key misspelled — did not fail loudly. It became an **active** view
overlay that renders nothing, and the read path then re-parsed it through the same
schema and badged it `_diagnostics.valid: true` (#5598), so Studio agreed it was
fine.

**The fix.** A minimal identity precondition now runs ahead of all four arms: a
`view` body must carry at least one key some member declares, discounting the
keys the write path stamps onto every body itself (`name` always, plus
`viewKind`/`object`/`label` inherited from a shadowed registry entry — #2555).
The bar is *shape*, not completeness: `{ isPinned: true }` is not a renderable
view either, but it is unambiguously a view operation and still saves. No arm's
`.strip()` changed, and `/api/v1/meta/types/view` emits a byte-identical
`anyOf` of four in both the output and input directions, so Studio's SchemaForm
renders exactly as before.

**Behaviour change** (why this is major — it is an enforcement close, not a new
capability):

| `view` body | Before | After |
|:--|:--|:--|
| `{ nope: 1 }`, `{ id: 'x' }` — no recognized key | saved, stored **active** | **422** |
| `{}` | saved, stored active | **422** |
| identity only (`{ name }`, `{ name, object, viewKind, label }`) | saved | **422** |
| `{ isPinned: true }`, `{ hidden: true }`, `{ sortOrder: 3 }`, `{ order: 2 }` | saved | unchanged — saved |
| any container / ViewItem record / flattened overlay | as before | unchanged |
| a body mixing garbage **with** a real view key | stripped and saved | unchanged — still stripped and saved |

That last row is the deliberate residue of the minimal fix: the precondition asks
"is this a view", never "is every key meaningful". Closing it means closing the
arms, which would break the round-trip capability #5074 exists to protect.

**FROM → TO.** Existing projects whose stored views carry stray-key bodies will
start seeing 422 on the next save of those views. Reads are unaffected — nothing
is deleted or rewritten — but the same documents now badge `valid: false`, which
is how you find them. The platform ships a sweep endpoint for exactly this:

```bash
curl -s "$OS_URL/api/v1/meta/diagnostics?type=view" -H "Authorization: Bearer $TOKEN" \
  | jq -r '.entries[] | "\(.name)\t\(.diagnostics.errors[0].message)"'
```

Each row names the view and why it is rejected. The fix is per row: give the body
a real view shape, or delete the overlay if it was never a view to begin with.

```diff
- { "nope": 1, "name": "crm_lead.all" }
+ { "name": "crm_lead.all", "object": "crm_lead", "viewKind": "list",
+   "config": { "type": "grid", "columns": ["name"] } }
```

The rejection carries its own prescription rather than a rootless
`Invalid input` — it names the key classes a view may open with, separates keys
it does not recognize from identity keys it recognizes but discounts, and it is
one issue, not one plus four `invalid_union` branches.

**New export.** `VIEW_WRITE_PATH_IDENTITY_KEYS` (`@objectstack/spec/ui`) — the
discounted set, exported so the producer side can be pinned against it. It is:
`normalizeViewMetadata` must never stamp a key absent from that set, or the key
silently becomes evidence again and re-opens this hole; a behavioural test in
`@objectstack/metadata-protocol` fails in the file that would introduce it.

Direction A from the issue — giving the form arm a required floor — remains
deliberately **not** taken. It needs Studio's flattened round-trip bodies
measured first, or it 422s writes the platform itself makes; the ruling on #5599
deferred it as a possible second tightening on top of this one.

<!-- adr-0087: registered authoring-schemas-strict-unknown-keys -->
