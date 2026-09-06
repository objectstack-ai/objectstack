---
"@objectstack/spec": minor
---

feat(spec)!: `composeStacks` `objectConflict: 'merge'` refuses object pairs whose object-level collections cannot be merged (#14848)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is renamed, retired or re-typed: every object key, every `composeStacks` option and the `ConflictStrategySchema` enum (`'error' | 'override' | 'merge'`) parse exactly as before, so `objectstack migrate meta` has nothing to rewrite. What narrows is the ACCEPT SET of one option value at composition time — two stacks whose same-name objects both declare an object-level collection with different values are now refused under `'merge'` where they used to compose with the earlier stack's entries silently dropped. The refusal text carries the whole prescription (declare the collection in one stack, make the declarations identical, or use `'override'`), and the repository measures zero non-test call sites passing `objectConflict` at all (see below), so there is no stored artifact and no authored file for a migration to act on. -->

**BREAKING** accept-set narrowing on `composeStacks({ objectConflict: 'merge' })`
— shipped as `minor` under the repo's launch-window convention for breaking
changes. Maintainer ruling 2026-09-04 on #14848 (director decision batch #38
item 5, verbatim 「同意」): option 4, `'merge'` **refuses** what it cannot merge
instead of dropping it.

**What changed.** `'merge'` was implemented as
`{ ...existing, ...obj, fields: { ...existing.fields, ...obj.fields } }`:
`fields` was the only key merged, and every other key the later object carried
— `actions`, `indexes`, `listViews`, `validations`, … — replaced the earlier
package's value wholesale, with nothing at compose, build or boot saying so.
Two packages each embedding an action on one shared object composed to the
later package's array alone; the earlier package's action was gone.

Now, when both objects declare an object-level **collection** other than
`fields` with different values, `composeStacks` throws — the refusal shape
`'error'` uses — naming the object, the colliding collection and both stacks
by manifest id:

```
composeStacks conflict: object 'shared' is defined in multiple stacks and its 'actions' is declared with different values by 'com.example.a' (stack #0) and 'com.example.b' (stack #1).
objectConflict: 'merge' shallow-merges 'fields' only. Any other object-level collection (indexes, fieldGroups, requiredPermissions, validations, activityMilestones, highlightFields, listViews, searchableFields, actions) is not merged: the later declaration would replace the earlier one wholesale, silently dropping every entry 'com.example.a' (stack #0) wrote.
Fix: declare 'actions' on 'shared' in exactly one of the two stacks, make the two declarations identical, or use { objectConflict: 'override' } to hand the whole object to the later stack.
```

The refusal set is **derived from `ObjectSchema`'s shape** — every key whose
declared type is an array or a record (through optional/default wrappers and
into a union's members), except `fields` — not hand-listed, so a collection key
added to the object schema joins the refusal without an edit to the composer.
Today that set is `actions`, `activityMilestones`, `fieldGroups`,
`highlightFields`, `indexes`, `listViews`, `requiredPermissions`,
`searchableFields`, `validations`.

**What did not change.**

- `fields` keeps its documented shallow merge (later fields win, earlier
  fields kept).
- **Identical** declarations on both sides pass through and are carried once
  — the same reading `composeStacks` already gives identical top-level values
  — so two built stacks that each bind one standalone action to the same
  object (identical copies) still reach the cross-stack action-key check
  (#14662) and are refused there, by name, as before.
- A scalar or fixed-shape config object the later object declares (`label`,
  `sharingModel`, `enable`, `access`, …) still replaces the earlier one: the
  ruling narrows collections only, and the docblock now says so.
- The default `'error'` and `'override'` are untouched, message for message.
- An explicit `undefined` on the later object is read as no declaration — it
  neither counts as a differing value nor erases what the earlier stack
  declared (the bare spread used to let it).

**Who is affected.** Measured on `origin/main` @ `53cbad9f7`: **zero** non-test
call sites in `packages/**`, `examples/**`, `apps/**` pass `objectConflict` at
all — every real caller takes the default `'error'`. An external author who
opted into `'merge'` and relied on the later package's collection winning
silently now gets the refusal above; the fix is the one it names.

The `ConflictStrategySchema` docblock for `'merge'` states the rule.
