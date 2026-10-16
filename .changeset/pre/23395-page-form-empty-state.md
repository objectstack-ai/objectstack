---
'@objectstack/spec': patch
'@objectstack/platform-objects': patch
---

feat(spec): the page form offers the list page's own empty state, `interfaceConfig.emptyState`

Clause-②: no

The console's list page draws the page's own `interfaceConfig.emptyState` in place of the source view's, so the page metadata form now offers it.

- **`@objectstack/spec`**: `pageForm`'s Interface section gains an `emptyState` control under `interfaceConfig`, a popover of the list view's `EmptyStateSchema` keys (`title`, `message`, `icon`, `link`), placed after the add-record entry point. No schema changes: `InterfacePageConfigSchema.emptyState` already parsed, so every page that was valid before is valid now, and nothing new is accepted.
- **`@objectstack/platform-objects`**: the metadata-forms translation bundles carry the new control's label and help text, translated in `zh-CN`, `ja-JP` and `es-ES`.
