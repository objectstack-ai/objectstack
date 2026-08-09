---
"@objectstack/spec": minor
"@objectstack/rest": patch
"@objectstack/cli": patch
---

fix(spec,rest,cli): validation diagnostics reach the real defect — named view-union branches, and `invalid_key` / `invalid_element` descent (#6391, #5389)

Two cases where a refusal fired correctly but its *diagnostic* could not reach the
element that actually failed. Both fixes change the DIAGNOSTIC face only: every
input that parsed before parses after, every input refused before is refused
after, and each refusal keeps its issue codes (ADR-0112 / #6142 — a better
diagnostic never weakens the envelope). Pinned in both directions.

**#6391 — `ViewMetadataSchema`'s union members are now contractual.** Three of
its four members were inline expressions with no name, so a consumer diagnosing a
failure could only reach a branch by indexing the nested `invalid_union`
`errors[]` **by member position**; objectui shipped exactly that and had to hold
the coupling down with a canary test (objectui#3606 / PR objectui#3624). The
union is now built from a named record:

- `VIEW_METADATA_BRANCHES` — the branch names, in the union's own order;
- `VIEW_METADATA_MEMBERS` — branch name → the schema the union actually holds
  (`viewItem` is identically `ViewItemWireSchema`, as before);
- `selectViewMetadataBranch(body)` — which branch a body claims, by the
  discriminants the members already declare;
- `diagnoseViewMetadata(body)` — the failing branch **named**, with that branch's
  own leaf issues and real field paths, so no consumer needs `errors[i]`.

The union is **not** converted to `z.discriminatedUnion`. That would move the
acceptance face — a discriminated union refuses an unknown discriminant outright
where this one falls through all four members, and several of these shapes carry
no discriminant at all. `ViewMetadataSchema` remains the only judge of
acceptance; the dispatch only explains a verdict it did not make, and a pin
asserts the two never disagree.

**#5389 — `invalid_key` / `invalid_element` are descended, in all three
consumers.** Zod hangs a failing record-key / map-element schema's real issues on
`issue.issues` — the same shape as `invalid_union`'s `issue.errors`, one property
name over. The family had already been fixed three times for `errors` (#4971,
#5014, #5341) and none of the three consumers read `issues`, so both codes
surfaced as a bare wrapper line with the prescription stranded in the payload.
Now `formatZodError`/`formatZodIssue` (spec), `zodIssuesToFields` (the REST wire)
and `formatZodErrors` (the CLI terminal) all descend it.

Before / after, a `z.record` with a constrained key:

```
  ✗ fields.First Name: Invalid key in record
```
```
  ✗ fields.First Name: Invalid key in record
    ✗ fields.First Name: Invalid identifier. Must be lowercase snake_case …
```

The expansion is strictly additive on every surface: the container's own line
(and, on the wire, its own `{field, code: 'invalid_shape', message}` entry) is
unchanged, and the leaves follow it. Unlike a union's branches — competing
candidates, therefore ranked and capped — a container's `issues` are the one list
the inner schema produced, so every one of them is reported.
