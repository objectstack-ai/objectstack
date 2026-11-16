---
'@objectstack/scenarios': patch
---

fix(scenarios): an unanswerable decline that counts the rows a tool returned states a supported figure

Clause-②: no
Metadata-protocol: none

On a question whose truth is `unanswerable`, the grader passes a decline only when every number the reply writes is supported by the data. Until now a number was supported only when some tool output of the turn printed it literally, so a decline that counted the rows a tool returned ("30 laptops … 23 in use, 6 in stock, 1 in repair") was failed with `stated a figure the data cannot support`, although every count was true.

A number is now also supported when it counts the rows one tool output of the turn returned: the length of a list of rows the output carries (a non-empty array of objects, at any depth), or the number of that list's rows holding one value in one field. The counts are computed from the recorded outputs alone, with no model. An invented count, an amount summed from the rows, and a figure computed from a value the reply assumes still fail. Grading answers change: such declines, failed before, now pass. The cost, as for literal numbers: an invented count equal to one of these sizes is not caught.
