---
'@objectstack/lint': patch
---

fix(lint): the line-items and association inline-edit advisories read every inline-edit mode, not only `inlineEdit: true`

Clause-②: no
Metadata-protocol: none

`inlineEdit` on a relationship field accepts `true`, `'grid'` and `'form'`, and the platform edits the child inline in all three. Two `os lint` advisories read only `true`:

- `relationship/line-items-inline-edit` told a `*_line` / `*_item` child whose `master_detail` already declares `inlineEdit: 'grid'` or `'form'` to "consider inlineEdit: true", offering a fix that would replace the mode the author chose. It is now silent for any of the three values and suggests inline editing only when `inlineEdit` is absent or `false`.
- `relationship/association-inline-edit` warned an association child (comments, audit, activity) only for `inlineEdit: true`. It now warns for `'grid'` and `'form'` too, which clutter the parent's entry form the same way.

Rule ids, severities and messages are unchanged. Nothing is refused; both rules stay advisories.
