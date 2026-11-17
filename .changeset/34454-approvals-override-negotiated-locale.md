---
'@objectstack/plugin-approvals': patch
'@objectstack/spec': patch
---

fix(plugin-approvals): a deployment's `errors.*` override of an approvals refusal is read for a bare `zh` writer

Clause-②: no
Metadata-protocol: none

Two plugin-approvals refusals are worded through the shared Operation Message Catalog: the record-lock refusal (`409 RECORD_LOCKED`, the `record_locked*` keys) and the non-submitter recall refusal (`approval_recall_not_submitter`). Both asked the `i18n` service for the deployment's `errors.<key>` override with the request's locale tag as sent. The service matches tags exactly, so a browser sending `zh` missed a deployment's zh-CN override and read the built-in zh-CN sentence instead. Both now negotiate the tag against the locales the service holds first, the way objectql's catalog callers do, so a bare `zh` reads the zh-CN override. The object label in the same sentence was already asked this way.

`renderOperationMessage` (`@objectstack/spec/system`) now asks the override for its template, without the parameters, and fills the placeholders once. Before, the `i18n` service filled them and the renderer filled the result again, so a value that itself contained a placeholder, such as a record titled `Q{{object}}`, was expanded on the second pass. An override's text now prints a record title exactly as written, as the built-in sentence already did. Overrides that use only `{{name}}` placeholders read the same as before.

The wire code, status and `CODE: message` envelope of both refusals are unchanged.
