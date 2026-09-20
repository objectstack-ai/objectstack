---
"@objectstack/spec": minor
---

feat(spec): declare `navigation` on the standalone `object-kanban` / `object-calendar` element faces, and give `object-timeline` the `ComponentPropsMap` row it never had (#17987)

Clause-②: yes (widening) — one new optional key on two published element faces plus one new row, so the accept set grows. Nothing previously admitted is refused, nothing is renamed or retired, and no producer is required to write anything.

**What changes for an author.** A record-click navigation block written on a
STANDALONE element node is now declared where it is read. Before this, the same
document ran correctly in objectui's renderer and was refused by name at the
authoring door:

```
FROM  ComponentPropsMap['object-kanban'].safeParse({ objectName: 'task',
        navigation: { mode: 'drawer' } })
      -> success: false, unrecognized_keys: ['navigation']
TO    -> success: true, navigation: { mode: 'drawer', preventNavigation: false,
        openNewTab: false, size: 'auto' }
```

`object-calendar` moves identically. The value is `NavigationConfigSchema` —
the same def `ListViewSchema.navigation` already declares, taken by reference,
so a standalone element and a list view speak one vocabulary and the retired
`navigation.view` key (17.5.0) stays retired on every face that carries it.

**`object-timeline` gains a row.** It was registered in objectui and reachable
through the component type union's open string arm with no entry in
`ComponentPropsMap`, so the authoring gate skipped it entirely: a real key and
a typo rode through alike. The row declares the key set measured from the
renderer's own read points at the `.objectui-sha` pin this repo builds against
— `objectName`, `timeline`, `filter`, `sort`, `limit`, `data`, `items`,
`variant`, `dateFormat`, `rowLabel`, `minDate`, `maxDate`, `descriptionField`,
`mapping` and `navigation` — and refuses everything else, the flat `startDateField` /
`titleField` / `scale` handoff spellings with a prescription pointing at the
`timeline` config block that owns them.

**What does NOT change.** The view-level `navigation` on `ListViewSchema` is
untouched: the element key is an ADDITIONAL carrier for the standalone
placement, not a replacement, and both faces keep judging the same block. The
parse is unchanged for every document that did not author these keys, and the
component type union is not narrowed — an `object-timeline` node reaches
`PageComponentSchema` through the open string arm exactly as it did before.

Executes the objectui#8652 maintainer ruling (verbatim `B`).
