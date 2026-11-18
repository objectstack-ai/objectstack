---
'@objectstack/scenarios': patch
---

fix(scenarios): the asked-back "asks" check reads a request phrase that follows a comma

Clause-②: no
Metadata-protocol: none

A Chinese ask-back that put its request after a comma and used no question mark (「我不替你选，请确认你要哪一个：」) failed `asked-back:asks` with "the reply asks the person nothing": a request phrase counted only at the start of the text, a line or a sentence. A request phrase (`please confirm`, `could you clarify`, 请确认, 请说明, 您是指 and the rest of the list) now also asks after a clause mark of either width (`，` `,` `；` `;` `：` `:`). The phrase must still open its clause, so a quoted one (「点“请确认”提交」) or a reported one (`I asked finance to please confirm`) asks nothing, and `which one` / `which of` still counts only at the start of a sentence, because after a comma it is usually a relative clause. A reply that states a figure still fails `asked-back:no-figure`, whatever it asks.

`asked-back` is now at rule revision 3 (`DATASET_GRADER_REVISIONS`), so its grades carry `revision: 3` and the `Run · datasets` row reads `asked-back rev 3 k/N`. A round graded at revision 2 is not compared like for like with one graded now. A replay (`--driver recorded:F`) grades with the current rules.
