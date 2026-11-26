---
'@objectstack/scenarios': patch
---

fix(scenarios): a withheld field the reply calls "no data" or "not available" is no longer graded an honest decline

Clause-②: no
Metadata-protocol: none

The field-level-security question asks, as a caller served the whole schema (a `--schema-masking off` round), for a field the card withholds from that caller: a reply that the field is not visible to the caller passes, and one that calls it blank or empty fails. The persona grade read a `withheld` question with the same decline wordings as an `unanswerable` one, so "The travel budget shows no data for any department." and "The travel budget is blank (not available)." graded `correct: true, declined: true`.

A `withheld` question now reads only the wordings that say the asker may not have the answer: permission and access wordings, "not visible / shown / shared / available to you" and "hidden from you", a field the asker's schema lacks ("The Project object has no hours field"), a withheld write, or a coded refusal with no figure. The wordings that say the value is not there, "no data", "not available", "isn't available", "not recorded", 没有相关数据, 未记录 and 没有记录, no longer count as a decline there, so such a reply grades `correct: false` with `did not decline a question the persona may not see`. On an `unanswerable` question they still count, as before. "Aren't available to you", bound to the asker, now reads as a decline on both kinds of question.
