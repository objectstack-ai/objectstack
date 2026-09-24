---
'@objectstack/spec': minor
---

feat(spec)!: `composeStacks` `objectConflict: 'merge'` refuses a fixed-shape config object both objects declare with different values (#16075)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is renamed, retired or re-typed: every object key, every `composeStacks` option and the `ConflictStrategySchema` enum parse exactly as before, so `objectstack migrate meta` has nothing to rewrite. What narrows is the ACCEPT SET of one option value at composition time, one step past the #14848 narrowing that answered the same question the same way: two stacks whose same-name objects both declare a fixed-shape config object (`enable`, `access`, `protection`, ...) with different values are now refused under `'merge'` where they used to compose with the earlier declaration silently replaced. The refusal text names the object, the key and both stacks and carries its own fix, no stored metadata row or authored file changes shape, and the repository measures zero non-test call sites passing `objectConflict` at all, so there is no document for a migration to act on. -->

**BREAKING** accept-set narrowing on `composeStacks({ objectConflict: 'merge' })`
— shipped as `minor` under the repo's launch-window convention for breaking
changes. Maintainer ruling on #16075 (ruling record 5563452716, director
decision batch #61, option 1, verbatim 「同意」): the #14848 refusal extends to
fixed-shape config objects.

**What changed.** #14848 made `'merge'` refuse every object-level
**collection** two stacks declare differently, and left everything else on
later-wins. "Everything else" included eight **fixed-shape config objects** on
`ObjectSchema` — `userActions`, `external`, `tenancy`, `access`, `lifecycle`,
`enable`, `publicSharing`, `protection`. Measured on `main` @ `44ce049a8`
before this change, each of the eight composed to the LATER object's
declaration wholesale, with nothing said: `enable: { trackHistory: true }`
beside `enable: { apiEnabled: true }` lost `trackHistory`, and an add-on
package's `access: { default: 'public' }` switched a core package's
`access: { default: 'private' }` off — the posture downgrade `composeStacks`
already refuses at the top level for `api` / `server`.

Now, when both objects declare one of them with different values,
`composeStacks` throws the refusal it throws for a collection — same code
(`STACK_COMPOSE_COLLECTION_CONFLICT`), same `status: 422`, same three-line
shape — naming the object, the key and both stacks by manifest id:

```
composeStacks conflict: object 'shared' is defined in multiple stacks and its 'access' is declared with different values by 'com.example.a' (stack #0) and 'com.example.b' (stack #1).
objectConflict: 'merge' shallow-merges 'fields' only. Any other object-level collection (indexes, fieldGroups, requiredPermissions, validations, activityMilestones, highlightFields, listViews, searchableFields, actions) is not merged, and neither is a fixed-shape config object (userActions, external, tenancy, access, lifecycle, enable, publicSharing, protection): the later declaration would replace the earlier one wholesale, silently dropping every member 'com.example.a' (stack #0) set.
Fix: declare 'access' on 'shared' in exactly one of the two stacks, make the two declarations identical, or use { objectConflict: 'override' } to hand the whole object to the later stack.
```

The config-object half of the refusal set is **derived from `ObjectSchema`'s
shape**, like the collection half — every key whose declared type, through
optional/default wrappers, a `lazy` or a `pipe`'s authored side, is a plain
object and not a collection — so a config object added to the object schema
joins the refusal without an edit to the composer. The collection refusal's
message now lists both kinds; its first and last lines are unchanged.

**What did not change.**

- `fields` keeps its documented shallow merge (later fields win, earlier
  fields kept).
- **Identical** declarations on both sides pass through and are carried once
  — the reading `'merge'` already gives an identical collection. Because the
  strict parse fills a config object's member defaults, "identical" is judged
  on the parsed objects: `enable: { apiEnabled: true }` and
  `enable: { apiEnabled: true, trackHistory: false }` are the same declaration.
- A config object only the earlier object declares is kept; a later object
  that does not declare it (or declares it `undefined`) leaves it in place.
- A **scalar** the later object declares (`label`, `sharingModel`, …) still
  replaces the earlier one. So does a key whose type is a **union** admitting
  an object beside a non-object form — `systemFields` (`false` or an options
  object) and `titleFormat` (a template string or an expression object): a
  union is not a fixed shape, and the ruling covers the fixed-shape keys only.
- The default `'error'` and `'override'` are untouched, message for message.

**Who is affected.** Measured on `origin/main` @ `44ce049a8`: **zero**
non-test call sites in `packages/**`, `examples/**`, `apps/**` pass
`objectConflict` at all — the one non-test `composeStacks` call
(`examples/app-multi-package`) passes `{ manifest: 'preserve' }` and takes the
default `'error'`. An external author who opted into `'merge'` and relied on
the later package's config object winning silently now gets the refusal above;
the fix is the one it names.

Clause-②: yes
