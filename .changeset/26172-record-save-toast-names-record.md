---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): the record create and update toasts name the saved record

Clause-②: no (adds or rewords message keys; no key is removed, so `TranslationKeys` only widens; no exported runtime contract changes)
Metadata-protocol: none

A user entering several records in a row saw "Task created successfully" after each save and could not tell which record was just written. The Console's record-form save toasts now carry the saved record's display name (ADR-0079), for example `Task "Quarterly review" created` and `Task "Quarterly review" updated`. This covers the record-form overlay on a list and the child-record form opened over a parent record's page.

- **`@object-ui/app-shell`:** the name comes from the same display-name resolver the record page title and lookups use, read through the saved object's declared name field. A record with nothing nameable (the resolver would only answer `Record #ID`) keeps the object-label toast it showed before.
- **`@object-ui/i18n`:** two new keys under `form.` in all ten packs, `createdNamed` and `updatedNamed`, each with `{{object}}` (the object label) and `{{title}}` (the record's name). The existing `form.createSuccess` / `form.updateSuccess` strings are unchanged and remain the toast for a record with no name.

Settings saves and flow-completion toasts are unchanged.
