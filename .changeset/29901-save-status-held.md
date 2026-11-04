---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): the metadata editor's save-status chip says "Not saved" while a save is held, instead of promising an auto-save that never comes (#29901)

Clause-②: no
Metadata-protocol: none

On the metadata editor page (Studio's All metadata item page, Setup's metadata pages) with auto-save on, a draft the server refused with `422 INVALID_METADATA` stays dirty, and the chip beside Save kept reading "Auto-saving…" although the auto-save is held until the refused part changes and no further save is sent. The same happened while the inspector holds a fault it reports (a CEL predicate that does not parse), which holds the auto-save the same way.

The chip now has a held state: while either hold stands on a dirty draft it reads "Not saved — fix the errors to save" in the destructive tone, with the Save button's own explanation as its tooltip. It returns to the usual states as soon as the hold lifts: editing the part the server named, or fixing the inspector fault, lets the auto-save run and the chip reads "Auto-saving…", then "Saved". Nothing about when a save is sent or held changes. New string: `engine.edit.notSavedHeld` (en, zh).
