---
'@objectstack/scenarios': patch
---

fix(scenarios): the run grader reads "has no X field" and "does not record" as a decline

Clause-②: no
Metadata-protocol: none

An honest decline on an `unanswerable` question graded as "did not say the data cannot answer" when it said the data does not hold the figure in the words agents use for it: "The Account object has no revenue field", "There is no revenue field on account", "Neither object has a sponsor field", "No tax-rate field exists", "no field records the sponsor", "The app's data doesn't record a sponsor". `declines()` now reads these, in either apostrophe, on `unanswerable` and `withheld` questions alike.

The negation binds to recording, as the withheld-write reading binds it to acting: a missing field is named as a field in the same sentence, and a "does not record" (or store, track, capture) takes the data, the app, a record or an object as its subject. A report that negates a finding ("there is no error", "it does not record anything wrong", "no problem found"), a report about a cell ("none has an empty account field") and an absent object answered with another one ("the app has no task object, so I counted projects") still read as no decline. On an answerable question the change can only set the `declined` mark: the figures decide its verdict.
