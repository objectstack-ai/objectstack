---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): every copy button in an action's result dialog has an accessible name, and the copied state is announced

Clause-②: no (a renderer accessibility fix; no schema, accept set, error code or result field changes)
Metadata-protocol: none

The result dialog shows a value the user must copy now, such as an invite link, a new API key or a 2FA secret. Its per-value copy buttons were icon-only with no name, so a screen-reader or voice-control user reached a bare "button" and could not ask for it by name. Nothing announced that the copy worked either.

- **Names.** An icon-only copy button is named after its field: "Copy Email" when the field has a label, "Copy value" when it has none. Each code of a code list is named by its position ("Copy Backup codes, item 2", or "Copy item 2" when unlabelled). "Copy all" keeps its visible text as its name.
- **Copied state.** A polite live region next to each copy button, mounted empty, reads "Copied to clipboard" when the value reaches the clipboard.
- **Translations.** The new `actions.resultDialog` keys `copyField`, `copyValue`, `copyFieldItem`, `copyItem` and `copied` are in all ten packs.
