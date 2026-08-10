---
'@objectstack/spec': patch
---

The ADR-0010 envelope-declaration gate now also walks `UNREGISTERED_KIND_SCHEMAS`.

`metadata-type-schemas.test.ts` holds the invariant that every metadata type either
declares `...MetadataProtectionFields` or sits on an explicit debt list, and its debt
list is empty — which read as total coverage. It was not: the walk iterates
`listMetadataTypeSchemaTypes()`, which deliberately excludes the three non-KIND stack
collections bound in `UNREGISTERED_KIND_SCHEMAS` (`webhook` / `connector` /
`sharing_rule`). Those three are real parse doors — #6245 wired them to
`PUT /api/v1/meta/:type/:name` — so the one gate that exists to catch "declares no
envelope" never ran over any of them, and each had to be judged by hand instead:
`sharing_rule` surfaced as a hard 422, `connector` only after a silent seven-key strip
and a separate card a day later (#6362 / PR #6900), and `webhook` was fine by accident
of #4001 batch 11 with nothing verifying it.

A second `it.each` now asserts the envelope property — and only that property — over
those names, sharing the same structural walker as the registered walk so the two
iterations cannot drift. All three pass today, so this closes no live bug; the value is
prospective, for the fourth entry.

New export, `listUnregisteredKindSchemaTypes()` (`@objectstack/spec/kernel`): the names
in that map, so the check enumerates the set rather than hand-listing it. It returns
names and grants nothing else — no `MetadataTypeSchema` membership, no
`DEFAULT_METADATA_TYPE_REGISTRY` entry, no create seed, no authorization verdict, and no
place in the #4001 campaign count. `listMetadataTypeSchemaTypes()` is unchanged, output
included; #2657's B/C decision on promoting these to kinds stays open.
