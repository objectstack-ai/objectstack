---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol): `getUiView`'s list branch honours `hidden` on the priority pass, not just the fill pass (#13259)

**BREAKING** response narrowing on `GET /api/v1/ui/view/:object/list`, shipped as
`minor` under the repo's launch-window convention for breaking changes.

`FieldSchema.hidden` is declared *"Hidden from default UI"*, and `getUiView` **is**
the default UI — it is the producer behind that route. Its list branch chose
columns in two passes and applied the visibility filter to the second one only:

```ts
let columns = fieldKeys.filter(k => priorityFields.includes(k));      // no filter
if (columns.length < 5) {
    const remaining = fieldKeys.filter(k => … && !fields[k].hidden);  // filtered
}
```

So a field declared `hidden: true` was withheld for eight of nine spellings and
**served — with its authored label — for the ninth**: whenever the author happened
to name it one of `name`, `title`, `label`, `subject`, `email`, `status`, `type`,
`category`, `created_at`. Those are the ordinary names an author reaches for, not
exotic ones, and nothing at authoring time said the flag stopped applying to them.
Because `searchableFields` is `columns.slice(0, 3)`, such a field could also be
offered as a search affordance.

The `form` branch of the same function already filtered every hidden field
uniformly, so two branches of one producer disagreed about what `hidden` means.
The priority pass is now brought to the side that already honoured the
declaration. This restores a stated invariant; it does not redesign what `hidden`
governs, and it adds no way to declare a column list.

**Blast radius, measured rather than assumed.** Across all 12,000+ tracked files,
every `hidden: true` declaration site was resolved to the field key it attaches to
(the walk was control-checked: it resolves 22 distinct keys, including
`previous_password_hashes`, `token` and `key`, so a zero from it is a reading). No
shipped platform object, no example app and no plugin declares a hidden field
carrying one of the nine priority names — the three real ones in
`packages/platform-objects` are all non-priority names and were already dropped.
The only in-repo `created_at` + `hidden` pair is a `@objectstack/objectql` unit
fixture that never calls `getUiView`. **In-repo consumers therefore lose no
column.** ⚠️ That is a measurement of this repo, not of the class: a downstream app
that declares, say, `status: { hidden: true }` is exactly the ordinary shape this
fixes, which is why the change is declared here rather than filed as invisible.

**For an app that was relying on the old output.** Nothing is renamed, nothing is
removed from the authoring surface, and no stored metadata becomes invalid — the
metadata was already correct and now simply takes effect. An app that wants the
column visible declares the field without `hidden: true`; an app that wants the
field hidden in forms but present as a list column authors an explicit list view
naming it in `columns`, which is the surface that exists for stating column choice.

<!-- adr-0087: not-required (no-migration-prescription) Nothing an author wrote changes spelling or meaning: no key is renamed or retired, no stored metadata is invalidated, and `objectstack migrate meta` has nothing to rewrite. The platform starts honouring a declaration it had already published, so there is no upgrade step to carry and no ledger entry to register. -->
