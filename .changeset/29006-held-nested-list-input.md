---
'@object-ui/app-shell': patch
---

fix(studio): a dashboard Global Filter whose Options From is begun but not finished is held, instead of autosaving a filter the draft door refuses

Clause-②: no
Metadata-protocol: none

Studio already held a list item just added under Properties (Global Filters, header Actions, a report's Order or Blocks) until its required inputs are set. It only asked for an unset input directly below the item, so a filter with Input Type `select` and Options From given its Object but not yet its Value Field and Label Field read as finished. The autosave sent it, the draft door answered 422, and every later edit (Description, Label) carried the same filter and was refused too, then lost on reload. The rule now follows each refusal down from the item: an input left unset at any depth below it (absent, or a text cleared to blank) holds the item, named by the item's own form row ("Options From on item #1 of “Global Filters” needs a value"). Every later edit is kept and sent once the item is finished. An item refused for a value the author gave, at any depth, is still sent, so that refusal stays on screen.
