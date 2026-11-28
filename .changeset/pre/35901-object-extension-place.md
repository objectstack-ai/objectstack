---
'@objectstack/spec': minor
'@objectstack/objectql': minor
'@objectstack/lint': minor
'@object-ui/app-shell': minor
'@object-ui/plugin-detail': minor
'@object-ui/i18n': minor
---

feat(spec): an object extension says where the fields, groups and child lists it brings go (`place`), and a child list another package brings is no longer hidden by the parent's `relatedLists`

Clause-②: yes (widening)
Metadata-protocol: semantic

An `objectExtensions` entry can now place what it brings on the object it extends:

```ts
objectExtensions: [{
  extend: 'account',
  fields: { tax_id: { type: 'text', label: 'Tax ID' } },
  place: [
    { field: 'tax_id', group: 'basic', after: 'industry' },
    { group: { key: 'tax', label: 'Tax' }, after: 'basic' },
    { list: 'contract', after: 'opportunity', label: 'Contracts', columns: ['name', 'amount'] },
  ],
}],
```

- **No `place`: nothing moves.** Fields still arrive after the object's own, and an extension that writes no `place` serves exactly what it served before.
- **One merge, every reader.** The registry fold applies the placements once, after every contributor's fields are merged, so the record page, the forms and Studio show one arrangement. Uninstalling or disabling the package takes its items off and leaves the object's own order as it was.
- **Placement arranges what the parent declares.** A list placement applies when the extended object declares `relatedLists`; a group or field placement when it declares `fieldGroups`. On a parent that declares neither, its automatic arrangement stays and nothing is dropped: the list shows in the automatic tab order, and its entry's `label` / `columns` are not applied either (write `relatedListTitle` / `relatedListColumns` on your child object's lookup field to title it on every parent); the field shows among the fields, its `after` / `before` not applied. The boot log names each placement that did not apply, with the object and the package. It is the main channel: `os validate` names it too (`extension-placement-not-applied`, warning) only when the extended object is in the same stack.
- **Anchors and order.** `after` or `before`, not both; neither means the end. An anchor may be an item another placement brings, whatever order the two are written or registered in. An anchor nobody has puts the item at the end of its group, of the groups, or of the tabs (before a trailing approvals / activity-stream run), and `os validate` warns (`extension-placement-anchor-missing`). A list placement's `columns` are fields of the child, checked by `os validate` as a `relatedLists` entry's are (`related-list-column-unknown`). Several packages at one anchor follow ascending `priority`, then package name, so every build gives the same order. When the object itself already names the list or lists the field, its own position wins.
- **An extension places only its own items.** A field outside its own `fields`, a field the extended object declares (also one the extension redeclares to relabel it), a group key the extended object already declares, or a list (placed as a tab or by a group's `relatedList`) that is not a child object of its package pointing at the extended object is refused at parse or at `defineStack`, and skipped by the merge with a warning naming whose item it is, whichever door registered the extension. The extension keys `fieldGroups` and `relatedLists` are refused with a prescription naming `place`.
- **Shipped behaviour change (flips #35897's hiding):** a child list another package brings is no longer hidden by the parent's declared `relatedLists`. Placed, it sits where its package puts it; unplaced, it shows at the end of the tabs. "Another package" means the child and the parent both belong to a package and the two differ; a child of the parent's own package, or one no package owns, is still hidden until an entry names it. This narrows the #35897 note "A child list another package adds is hidden too until the parent names it … letting a package place its own list is a later change": that change is this one.
- **Studio** (object settings, Record page tabs) shows such a list read-only among the unlisted rows with a "from <package>" badge, and the preview draws it where the record page does.

What to check in an app: on an object that declares `relatedLists`, every installed package's child lists of it now show, at the end of the tabs unless placed; name one in the parent's `relatedLists` to put it elsewhere, or set `relatedList: false` on that package's FK to hide it. Nothing in HotCRM changes meaning today: no module writes `place`, and no object declares `relatedLists`. Most HotCRM objects already declare `fieldGroups`, so a field or group placement there applies as soon as a module writes one; a list placement waits until the parent declares its `relatedLists` (follow-up #35902). ADR-0087 semantic entry `object-extension-place-and-cross-package-lists`; ADR-0146 D10 and ADR-0085 notes.
