---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): disabled Studio and metadata-admin buttons now say why on hover, on keyboard focus and to assistive technology

Clause-②: no
Metadata-protocol: none

Six disabled buttons gave their reason to nobody using a keyboard or a screen reader: a natively disabled button takes neither hover nor focus, so Tab skipped it and no tooltip opened. Each now gets the treatment Studio's header Publish already had: a focusable wrapper that opens a tooltip with the reason, and both the wrapper and the button point `aria-describedby` at it. The button keeps its own name, and an enabled button is unchanged.

- Form designer: "Move group up" on the first group and "Move group down" on the last ("Already the first group" / "Already the last group").
- Every inspector's reorder pair, the field inspector's "Move up" / "Move down" included, at either end ("Already first" / "Already last"). A pair the host disabled (a read-only inspector) keeps the host's reason.
- The all-metadata object preview: "Move section up" / "Move section down" at either end.
- Studio's create dialog, shared by every create flow: the submit ("Save as draft", "Create") asks for a display name, then for an identifier.
- The all-metadata item page: a withheld Save keeps its accessible name "Save" and is described by why ("No changes to save", or the validation or server refusal holding it). Before, the reason replaced the name.

The wrapper is one shared component inside the package, `DisabledControlReason`, beside the panel-wide `InspectorReadOnlyReason`; the package entry exports nothing new. The new reason strings are in the Studio namespace catalogues (`en`, `zh`) of `@object-ui/i18n`.
