---
'@objectstack/spec': patch
---

Clause-②: no

The `ActionParam` `options` docblock in `src/ui/action.zod.ts`, and the comment above that option
shape's `guidance` table, no longer say that objectui's `normaliseOptions` rebuilds each option a
field-backed param inherits as a bare `{ label, value }` pair. At the console pin (`.objectui-sha`
`f8267df93aba`) it keeps every key of an inherited option by spread
(`packages/fields/src/resolveActionParams.ts:515` in objectui). The comments now give the reason
that remains for the `guidance` texts not telling an author to make a param field-backed and
inherit `color`, `icon` or `disabled`: the keys survive, but no reader of them on that path is
measured. No key, schema, export, accepted value or message text changes.
