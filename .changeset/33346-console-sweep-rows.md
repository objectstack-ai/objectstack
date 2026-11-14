---
'@object-ui/plugin-detail': patch
'@object-ui/console': patch
'@object-ui/app-shell': patch
---

fix(console, plugin-detail, app-shell): a connector action switch resets its inputs, a multi-field save conflict lists each field, the share page lists fields by the record page's rule, the Studio error box wraps

Clause-②: yes (widening) — `@object-ui/plugin-detail` exports the new `ConcurrentUpdateFieldConflict` type, and `ConcurrentUpdateConflict` gains the optional `fields` list. Nothing is removed or narrowed.
Metadata-protocol: none

- **Flow designer (Studio).** Changing a `connector_action` node's connector or action resets `connectorConfig.input` to the new choice's inputs. Before, the previous action's input keys stayed in the map: they showed as extra Input rows, were saved with the flow, and were handed to the new action at run time. Inputs set aside by a switch come back if you return to the same connector and action while the inspector is open; they are never saved meanwhile.
- **Inline edit conflict.** When a save that changed several fields meets a newer version (409 `CONCURRENT_UPDATE`), the dialog lists each field with its label, your edit and the current value, instead of printing both as raw JSON. A one-field conflict looks as before.
- **Share-link page.** The landing page lists the record's fields the way the record page does: the framework's system columns and the audit columns (`created_at`, `created_by`, `updated_at`, `updated_by`) are not listed, and only fields the object declares are shown when the server sends the field labels.
- **Studio editor error box.** A refusal that is one unbroken token (a field-type enum list such as `"text"|"textarea"|…`) now wraps inside the box instead of running past the right edge of the window, so the whole message stays readable.
