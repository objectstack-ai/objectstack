---
'@object-ui/app-shell': patch
---

fix(studio): the field inspector's API name box refuses a name another field holds, and saves no trailing underscore

Clause-②: no
Metadata-protocol: none

Typing another field's API name into the field inspector used to drop the last keystroke without a message and save the half-typed name (`status` saved as `statu`), and a trailing punctuation mark saved a trailing underscore (`Estimated Hours!` saved as `estimated_hours_`). The box now shows what the author typed, says the Add field popover's own refusal ("Another field is already named status. Type a different API name."), and keeps the name the field had before the edit. The name written is normalised the way the new-object dialog normalises an identifier, so a trailing underscore is never saved; an underscore can still be typed mid-word. Leaving the box shows the name the field carries.
