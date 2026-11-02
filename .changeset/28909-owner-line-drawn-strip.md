---
'@object-ui/plugin-detail': patch
'@object-ui/app-shell': patch
---

fix(plugin-detail): the record's meta line leaves the owner out only when the highlight strip the page actually drew carries `owner_id`, so a phone page names the owner somewhere (#28909)

Clause-②: yes (widening)
Metadata-protocol: none

**The owner on a phone.** The meta line under the details leaves the owner out when the strip already shows it. It used to ask the object's declared `highlightFields` (up to six), while a phone's record header draws at most four highlights after its subtitle. With `owner_id` declared fifth or sixth behind four non-text highlights, a phone page named the owner neither in the header nor in the meta line. The meta line now asks the strip the page drew, on every width: on a phone that owner is back on the meta line; on a desktop, where the strip draws it, the meta line still leaves it out.

**`RecordMetaFooter` gains `drawnHighlightFields`** (optional, `readonly string[]`): the fields the host's highlight strip draws. The meta line leaves the owner out only when this list carries `owner_id`. Omitted, the strip is taken to be the object's declared highlights, as before. `RecordDetailView` hands it the `record:highlights` fields of the page it renders, which covers the phone header's shorter strip and a slotted page's own `highlights` slot.

No metadata key is added or changed.
