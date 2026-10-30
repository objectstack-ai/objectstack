---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(setup): a new metadata item whose name the editor already refuses is not sent, and one mistake is one message

Clause-②: no
Metadata-protocol: none

- **Before.** On Setup › Permission Sets › New (and every metadata create page), a Name the editor flagged as invalid was sent on Save anyway. The page then showed the server's refusal ("is not a legal metadata item name"), and after the next edit also the summary banner ("does not match the spec — 1 validation error(s)") and the inline error under Name: three messages for one mistake.
- **Now.** While the editor's own check refuses the Name of a new item, Save sends nothing and the error under Name is the message; a Name filled in from the Label, never touched, shows its error there too once Save is pressed. The summary banner no longer repeats an error the form already draws on its field, and a server refusal that names a field the form draws is said on that field only.
- **Unchanged.** Every other check the editor runs while you type stays advisory: Save still sends, and the server has the last word (an existing item is never held by it). Errors the form cannot draw on a field (the whole item, a nested key, a field off screen) are still listed in the banner.
