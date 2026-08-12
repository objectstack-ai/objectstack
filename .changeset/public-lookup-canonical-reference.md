---
"@objectstack/rest": patch
---

fix(rest): resolve the public-lookup picker target from the canonical `reference` key (#7486)

`GET /forms/:slug/lookup/:field` treats `publicPicker.object` as an optional
override: omit it and the server is supposed to resolve the target from the
field's own definition on the parent object. It could not. The fallback chain
read three **legacy** spellings only —

```ts
referenceTo = def?.referenceTo ?? def?.target ?? def?.options?.objectName;
```

— while `packages/spec/src/data/field.zod.ts` folds `relatedTo` / `referenceTo`
/ `target` / `targetObject` / `lookupObject` **all onto `reference`** at parse.
A parsed, canonical object schema therefore carries none of the three keys the
route read: the chain resolved `undefined` and the route answered
`500 LOOKUP_TARGET_MISSING` for exactly the well-formed metadata the platform
produces. Net effect, `publicPicker.object` was de-facto **required** while the
schema and the docs presented it as optional.

The canonical `reference` now heads the chain. A field declared
`{ type: 'lookup', reference: 'sys_user' }` resolves with no `object` override,
which is the form authors are told to write.

The three legacy spellings are **kept after it**, not replaced: rows stored
before the alias fold never went through the alias table and still carry them,
so this widens the resolution rather than moving it. Precedence is
`reference` → `referenceTo` → `target` → `options.objectName`, so a
partially-migrated def carrying both follows the canonical key.

`LOOKUP_TARGET_MISSING` did not become unreachable — it became rare. A field
naming no target object at all (or one whose object metadata cannot be read)
still gets the loud 500 rather than a silent search of nothing.

No spec change: the spec was already right, the consumer was reading the wrong
keys. The docs table in `content/docs/ui/forms.mdx`, which pointed authors
hitting this 500 at declaring `object`, is corrected in the same change.
