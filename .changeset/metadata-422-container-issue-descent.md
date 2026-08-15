---
"@objectstack/metadata-protocol": patch
---

fix(metadata): the `422 INVALID_METADATA` envelope descends `invalid_key` / `invalid_element`, so a rejected record key arrives with the rule it broke (#8783)

Zod raises a `z.record` / `z.map` **key** rejection as `invalid_key` and a
`z.map` **element** rejection as `invalid_element`, and in both cases the
issue's own `message` is a bare wrapper — `"Invalid key in record"` — with the
real diagnosis one level down in `issue.issues`. That is structurally the
`invalid_union` shape #4971 named: the prescription is produced and then
dropped by a walk that reads only the top level.

Both `packages/spec` walks learned to descend those codes in #5389.
`zodIssuesToMetadataIssues` — the walk behind `saveMetaItem`'s 422 (#5364) and
the read path's diagnostics (#5598) — expanded `invalid_union` only, so it
stopped at the wrapper. Three walks over one `safeParse`, two of them reaching
the prescription and the Studio-facing one not.

**It was reachable from ordinary authored metadata, not synthetic.**
`ObjectSchema.fields` is a record whose KEY schema carries the snake_case rule
(`spec/src/data/object.zod.ts`), and `object` is in the builtin
`getMetadataTypeSchema` registry. So the commonest authoring mistake on the
most-authored metadata type — writing `firstName` for a field key, which is
exactly what an agent coming from JS naming writes — produced:

```
{ path: 'fields.firstName', code: 'invalid_key', message: 'Invalid key in record' }
```

The author was told a key was invalid and never told what a valid one looks
like, so the next move was to guess. The declared message existed and was
correct; it just did not reach anyone. Now the same save answers:

```
{ path: 'fields.firstName', code: 'invalid_key',    message: 'Invalid key in record' }
{ path: 'fields.firstName', code: 'invalid_format', message: 'Field names must be lowercase snake_case (e.g., "first_name", …)' }
```

**Additive, and matched to the walks that already worked** rather than chosen.
The other two were measured over the card's own repro first: `formatZodIssue`
prints the wrapper line then the indented detail, and `zodIssuesToFields` emits
the `invalid_shape` wrapper entry then the detail entry. So the wrapper stays at
index 0 — it is the only entry naming the slot the client sent, and Studio's
designer keys on it — and the detail joins it on the same path. No entry that
shipped before is removed or renumbered.

**Targeted, not a widened walk.** Only the two container codes open the descent;
an `issues` array hanging off any other code is still ignored, `invalid_union`
still expands through the unchanged ranking, and the nesting bound now covers
both descents at the same depth of 3. Container issues are deliberately *not*
ranked the way union branches are: a union's branches are competing candidates,
while a container has one inner schema, so every issue it raised is a true
statement about the value.

The verdict is unchanged in every case — this moves what a refusal *says*, never
whether it is one. `union-branch-policy.cross-package-parity.test.ts` gains a §5
comparing the container descent across all three walks; its §1 (the policy is
not publicly exported from `@objectstack/spec`, so this package must run its own
copy) is untouched, and no export was added.
