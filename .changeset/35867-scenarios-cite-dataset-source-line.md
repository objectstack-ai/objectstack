---
'@objectstack/scenarios': patch
---

fix(scenarios): the `cited` axis accepts the source a `query_dataset` answer tells the client to cite

Clause-②: no
Metadata-protocol: none

`gradeRun` passed `cited` only when a source line named the figure's object (its machine name or a label) or the reply linked `/record/OBJECT/`. A `query_dataset` answer's `sourceLine` names the dataset and its measures, never the object, and the door's `nextStep` tells the client to cite that line as given. So a reply that did exactly that, for example `Source: Metrics: Claimed amount, Claim count (dataset: Reimbursement)`, lost `cited` on every dataset-routed figure, while one that wrote the object name by hand passed.

Now a figure of the object a `query_dataset` answer was computed over (the answer's own `object`) is also cited by a source line naming that answer's dataset, by name or label as its `provenance` states them, or by a reply line carrying the answer's `sourceLine` verbatim, which covers the Chinese line that opens with 指标 and no source word. Read off the tool outputs only: an answer that states no `object` or no dataset `provenance` hands no citation, a dataset over another object cites nothing for this one, and a line that names neither the object nor the answer's dataset still fails.
