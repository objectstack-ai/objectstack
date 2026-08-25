---
"@objectstack/spec": minor
---

feat(spec): `ComponentPropsMap['object-grid'].data` converges onto `ViewDataSchema` (#12039, objectui#6207 Option A)

**BREAKING** accept-set change on one props-map entry, shipped as `minor` under
the repo's launch-window convention for breaking changes.

Two spec authorities disagreed on the KIND of `object-grid`'s `data`:
`ViewDataSchema` — the authority objectui#5090 ruled the registry declaration
against, and what `ObjectGridSchema.data` resolves to — is an object
discriminated on `provider` (`object` / `api` / `value` / `schema`), while
`ComponentPropsMap['object-grid'].data` said `z.array(z.unknown())`. Measured
on `@objectstack/spec@17.2.0`: `{ provider: 'value', items: [] }` — the
pinned-legal form — was refused by the props-map entry while the bare array
parsed. Maintainer ruling (2026-08-25, objectui#6207, Option A): the props-map
entry converges onto `ViewDataSchema`; the bare-array form is the deprecated
`staticData` shortcut the objectui#4648 carve-out already refuses to publish.

Migration — FROM → TO, one wrapping object:

```ts
// before (refused now)
data: [{ id: 1, title: 'Inline row' }]
// after
data: { provider: 'value', items: [{ id: 1, title: 'Inline row' }] }
```

The ruled migration check ran with the change: the sweep of generated
artifacts, templates and first-party corpora (examples/, skills/,
create-objectstack, spec fixtures) found zero bare-array `data` authors, so no
rewrite ships. `staticData` (the legacy bare-array shortcut the renderer still
reads) keeps its shape but is not the prescription.

`ComponentPropsMap['element:number'].filter` (the sibling key of #12039 /
objectui#6206) is NOT changed here: the ruling's binding measurement-first
precondition measured the pinned adapter/runtime refusing the raw
`ViewFilterRule[]` form on the element's primary (analytics) read path, which
forks that key back to triage. objectui#6206 remains open.

<!-- adr-0087: registered object-grid-data-view-data-converged -->
