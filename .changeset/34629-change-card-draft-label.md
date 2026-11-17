---
'@object-ui/app-shell': patch
---

fix(console): the AI change card names a published object or field by the label its draft gives it

Clause-②: no
Metadata-protocol: none

The AI build chat's change card read an object or field label from the published registry first, and asked the draft overlay only for a name the registry did not know. So when a draft relabelled a published object or field (for example "Task" renamed to "Work item", or the field "Due" to "Deadline"), the card still showed the published label, the one the change is about to replace.

A published name now also asks the draft overlay (`GET /meta/object/:name?preview=draft`) for its object. The card shows the published label at once and the draft label as soon as the overlay answers; a name the draft did not change keeps its published label, and so does one whose overlay read fails. A label the draft changed is shown as written: the convention translation for that object or field was written for the published label and would hide the new one. A label the draft did not change still goes through the translation.

Cost: one more request per published object a card names, then at most one more per object each time the conversation moves on (a message lands, a turn starts or ends), and none while a read is in flight or on a re-render. A later relabel in the same conversation is therefore named on the next card. Drafted-only names keep the earlier rule (asked again only when the kept answer does not name them).
