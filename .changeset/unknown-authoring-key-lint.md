---
"@objectstack/spec": minor
"@objectstack/cli": patch
---

feat(spec,cli): report the authored object/field keys that get silently dropped (#3786)

`ObjectSchema` and `FieldSchema` are deliberately not `.strict()`, so a key they
do not declare **parses clean and is stripped on the way to storage**. No error,
no warning — the author configured something and it simply is not there. That is
the ADR-0104 failure class the `FieldSchema` prune tombstone already describes in
prose, and #4120 found five live instances of it inside `@objectstack/spec`
itself: a `pii` toggle, an `indexed` toggle and a `cascadeDelete` select that had
been rendering in Studio for releases while saving nothing.

**New rule — `lintUnknownAuthoringKeys` (advisory).** Every authored key an
object or field sets that its schema does not declare is now reported, naming the
path, the key, and what to do about it:

```
defineStack: objects.crm_case.fields.owner.pii: 'pii' is not a declared field key,
  so its value is dropped at load — the `dataQuality` governance family was pruned
  in 2026-06 as dead in both layers — it enforced nothing.
defineStack: objects.crm_case.capabilities: 'capabilities' is not a declared object
  key, so its value is dropped at load — did you mean 'enable'?
```

Two guidance tables carry the difference between a **rename** (`formula` →
`expression`, `cascadeDelete` → `deleteBehavior`, `capabilities` → `enable`, …)
and a **retirement** with no successor (`pii`, `indexed`, `encrypted`,
`startingNumber`, …). A retirement deliberately suppresses the edit-distance
fallback: `pii` is three edits from `min`, and "did you mean min?" reads as real
advice while being nonsense. Plain typos still get the fallback (`requred` →
`required`). Every entry was found in the wild, and a test asserts each rename
target is a key the schema really declares — so the advice cannot rot into
pointers at keys that no longer exist.

**It never rejects.** Making these two schemas strict is the destination — the
enforce side of ADR-0049, and the tier programme #4001 began on the flow and
permission schemas. But `object` and `field` are the two most-authored surfaces
in the protocol, so flipping them rejects metadata that parses today: a migration
event for every consumer, and one that deserves to be scheduled on evidence
rather than guessed at. This produces that evidence and costs nobody a migration.

Wired into every layer that performs the discard, all **pre-parse** (the parse is
what eats the key, so after it there is nothing left to report):

- **`defineStack`** — warns on the console, once per distinct path, in strict
  *and* non-strict mode, since the key is dropped either way.
- **`os validate`** — a non-blocking warning, and included in `--json` output
  rather than computed and discarded.
- **`os build` / `os compile`** — the same non-blocking warning. `defineStack`
  already covers configs authored through it; this catches the ones that skip it
  (a plain object default-export, `strict: false`), which would otherwise emit an
  artifact with the key quietly gone.

Verified against the three first-party example apps (`app-todo`, `app-crm`,
`app-showcase`): all clean, no false positives.

New exports from `@objectstack/spec` (root and `/data`): `lintUnknownAuthoringKeys`,
`formatUnknownAuthoringKey`, `FIELD_KEY_GUIDANCE`, `OBJECT_KEY_GUIDANCE`, and the
`UnknownAuthoringKeyFinding` / `AuthoringKeySurface` types. No authoring change is
required by this release: metadata that loaded before still loads, unchanged.
