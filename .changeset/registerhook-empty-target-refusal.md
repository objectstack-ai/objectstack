---
"@objectstack/objectql": major
"@objectstack/spec": patch
---

<!-- adr-0087: registered hook-register-empty-object-target-refused -->

fix(objectql)!: `engine.registerHook` refuses an empty `object` target and a scope whose two faces cancel out (#6573)

`engine.registerHook` is a **public API**, and two option shapes that used to
register successfully now **throw at registration**. Both were already
refused on the metadata path by #4281 (`HookSchema.object`'s refine and
`hook-binder.ts`'s `normalizeObjects`); the code path went through neither, so
the ruling stopped at the door it never reached.

**1. An empty `object` target — `''`, `[]`, `['']`, or any blank list member.**

```ts
engine.registerHook('afterUpdate', h, { object: '' })    // was: a GLOBAL hook
engine.registerHook('afterUpdate', h, { object: [] })    // was: never fires
engine.registerHook('afterUpdate', h, { object: [''] })  // was: never fires
```

`''` is falsy, so the allow face was skipped entirely and the entry registered
as a **global** hook — #4281's headline failure mode, blank intent becoming the
broadest possible blast radius, reproduced verbatim. `[]` and `['']` are truthy
but admit no object name, so the entry could never fire (ADR-0078, no silently
inert declaration). All three now throw, reusing #4281's wording.

- FROM `{ object: '' }` (or `[]` / `['']`) → TO: name the object(s),
  `{ object: 'account' }` / `{ object: ['account', 'contact'] }`; or, if firing
  on every object is the intent, spell the wildcard — `{ object: '*' }` — or
  omit `object` entirely. `object: undefined` is unchanged and still means
  "global".

**2. An allow face fully cancelled by the exclusion face.**

```ts
engine.registerHook('afterUpdate', h, { object: 'account', excludeObjects: 'account' })
engine.registerHook('afterUpdate', h, { object: ['a', 'b'], excludeObjects: ['a', 'b'] })
```

`excludeObjects` (#5928) subtracts from `object`, so when `object` is a finite
enumeration and every name in it is also excluded, the admitted set is empty and
the entry can never fire — the same ADR-0078 inert declaration #5928's three
refusals exist to prevent, reached by arithmetic instead of by one bad name and
therefore outside that ruling's letter. Only a **finite** allow face is decided:
`object: '*'` and an absent `object` admit an open universe (objects can be
registered into a running engine), so they are left alone, and the one exclusion
that would empty them — `'*'` — is already refused by #5928.

- FROM a fully-cancelled pair → TO: widen `object` (or drop it for a global
  hook), or remove the overlapping names from `excludeObjects`. **Partial**
  cancellation is untouched — `{ object: ['a', 'b'], excludeObjects: ['b'] }` is
  exactly what the exclusion face is for.

**What did NOT change:** `hookMatchesObject`'s reading of `object: ''` as
"global" is deliberately left as-is. Teaching the matcher that `''` is an
unmatchable name would silently convert a hook firing on every object into one
firing on none — the same class of defect pointing the other way. The shapes are
closed at the registration door, so no live entry can carry them.

**Callers that forward a non-literal `object`** now surface these refusals
instead of registering a broken entry: `RecordChangeTrigger.start` forwards a
flow start node's `config.objectName` verbatim, and `ObjectQL.create({ hooks })`
forwards each `hook.object`. A flow authored with a blank `objectName` used to
bind a record-change trigger to **every** object; it now fails to bind, loudly —
the throw is caught by the automation engine's per-flow bind guard, which warns
and leaves the flow unbound for the binding audit to re-report.
