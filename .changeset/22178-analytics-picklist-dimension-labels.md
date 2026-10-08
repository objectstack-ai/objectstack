---
'@objectstack/service-analytics': patch
---

fix(service-analytics): a picklist-bound select dimension now renders its category labels in the request's locale

Clause-②: no

A select field that references a shared list (`picklist: '<name>'`) is served with the list's options and with `picklist` kept, and its option labels translate under `picklists.<name>.options.<value>`. The analytics label pass translated a dimension's options through a synthetic field that carried `options` only, so the translator never looked at the `picklists` address. Every chart and report category on such a dimension showed the authored (usually English) labels under every `Accept-Language`, while `GET /api/v1/meta/object/:name` showed the same field translated.

The synthetic field now carries the dimension field's `picklist`. `POST /api/v1/analytics/dataset/query` answers the same labels the object-metadata endpoint serves for that field: a field-level entry (`objects.<object>.fields.<field>.options.<value>`) wins when one exists, and otherwise the list's label applies. A dimension with inline `options` renders exactly as before.

An `order` on a select dimension now sorts by the label the row renders in the request's locale, and a `limit` keeps the first rows in that order. The sort used the authored labels, so under `Accept-Language: zh-CN` or `ja-JP` the order followed the English text, for inline `options` and, once translated, for picklist-bound dimensions too. With no locale, or no translation for it, the order is unchanged.

Nothing you author changes: no key, export or parameter is added or removed.
