---
'@objectstack/spec': patch
---

fix(spec): an object's embedded `listViews` are served in the reader's language, from the `_views` keys `os i18n extract` already writes

Clause-②: no

- `GET /api/v1/meta/object` and `GET /api/v1/meta/object/:name` now translate each view in an object's `listViews`: its `label`, its `description`, and the copy of its `bulkActionDefs` (label, confirm prompt, confirm button, and each param's label, help and placeholder). They read the keys `os i18n extract` writes for those views, `objects.<object>._views.<view>.*`, where `<view>` is the view's key under `listViews`. For example, `sys_account`'s `mine` view is now served as `我的链接` to a `zh-CN` reader. It used to be served as the authored `My Links`.
- A view with no translation for the requested locale keeps its authored text. An object with no `_views` entries is served unchanged.
- A string that was changed after the package shipped still wins over the packaged translation, the same rule a served view document and a dashboard follow. The string is compared with the same view in the packaged object. If it differs, the changed string is served in every locale. A view the packaged object does not declare keeps all of its own strings.
- `translateObject` (and `translateMetadataDocument('object', …)`) in `@objectstack/spec/system` does the translating, so any caller of those functions gets the same result.
