# Evidence for objectstack-ai/objectstack#27054 (never merged)

Screenshots from a local Studio (showcase app, `--fresh` database) on the PR branch
`claude/issue-27054-studio-related-list-controls`.

- `e1-field-inspector-related-list.png` — field inspector on `showcase_invoice.account` (a lookup that declares `relatedList: 'primary'`): the three-state control and the related-list filter builder. The package is read-only, so the controls are drawn disabled.
- `e2-new-record-page-form.png` — the metadata page-create form after choosing page type `record`: Kind follows the type to `slotted`, with the one-line explanation.
- `e3-designer-slotted-default.png` — the page designer right after the save: the "default record page" note, "Convert to full page", and every slot inherited.
- `e4-after-convert-to-full.png` — after "Convert to full page" and Save: a full page holding the synthesized regions, no spec banner.
- `e5-highlight-fields.png` — object settings on `showcase_account` (read-only): the ordered highlight list and the strip preview.
