---
'@object-ui/console': patch
'@object-ui/i18n': patch
---

fix(console): a refused edit-form record read says a localized line, never the response body

Clause-②: yes (widening)
Metadata-protocol: none

An edit form (`/forms/NAME?recordId=ID`, and the in-app edit route) reads its record before it draws. When that read was refused, the banner said `Could not open record "ID" of OBJECT for editing (403): {"error":…}`: the record id, the object's machine name, the status and the server's JSON, in English. The load now reads its refusal through the same `WriteRefusal` the submit uses, and the banner says one localized line:

- a denial (`403`, `PERMISSION_DENIED`, `FORBIDDEN`) as "You don't have access to this record.";
- a `404` as "This record doesn't exist, or you don't have access to it." Row-level security answers a hidden row with the same `404`, so the line never tells the two apart;
- anything else as "Could not open this record. Please try again."

The response body stays on the thrown error for a debugger and never reaches the page. The three lines are new `form` keys (`noPermissionToOpenRecord`, `recordNotFoundOrHidden`, `openRecordFailed`) in all ten packs.
