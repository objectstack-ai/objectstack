---
'@objectstack/scenarios': patch
---

fix(scenarios): travel_expense `file_and_submit_from_text` checks the per-type amounts, so per-night and per-day lines pass as well as quantity lines

Clause-②: no
Metadata-protocol: none

The `travel_expense` card's `file_and_submit_from_text` operation pinned the claim's lines to one hotel line of quantity 2 at 430 and one meals line of quantity 3 at 115. Two hotel lines and three meals lines of quantity 1 file the same claim (total 1205), and they failed. The operation now checks the hotel total (860) and the meals total (345) over the lines of the new claim for trip TR-0121, and that no line of that claim is over standard. The claim-level checks (claimant, status `submitted`, `total_amount` 1205, audit actor) are unchanged. Rounds graded before and after this change are not comparable on this operation.

To express it, an `applied` outcome's state entry can now be an aggregate over every row its `where` matches:

- `sum`: per field, the rows' total must equal the declared number (`state:LABEL.sum(amount)`). A row that reads no number fails it.
- `each`: per field, every row must hold the value (`state:LABEL.each(field)`).
- At least one row must match. No match fails `->rows`, never a sum of 0 or an empty "every row".
- An aggregate names its rows by `where`, never by `id`. An entry carries exactly one of `values`, `absent` or an aggregate. The loader checks each summed field against the seed and refuses one that holds a non-number.

A `where` key can also be a relation path through `expect.lookups` (`claim.trip`), checked by the loader like any other relation path. The runner reads the objects the path hops to after the turn (`relationObjects`), so rows the write created are matched through their parent row. Existing cards are unchanged.
