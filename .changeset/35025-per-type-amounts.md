---
'@objectstack/scenarios': patch
---

fix(scenarios): travel_expense `file_and_submit_from_text` checks the per-type amounts, so per-night and per-day lines pass as well as quantity lines

Clause-②: yes (widening) — the run record gains a top-level `card: { id, sha256 }` and its scorecard a `cardStamp`; a card's post-state gains the optional `sum` / `each` members and relation-path `where` keys; new exports `CardStamp`, `cardStampOf`, `cardStampText`, `relationObjects`, `DeclaredLookups`, and `LoadedScenario.fileSha256`; `summary` gains a card dimension. Every card and record that loaded, graded or summed before still does: records written before the stamp keep summing with each other
Metadata-protocol: none

The `travel_expense` card's `file_and_submit_from_text` operation pinned the claim's lines to one hotel line of quantity 2 at 430 and one meals line of quantity 3 at 115. Two hotel lines and three meals lines of quantity 1 file the same claim (total 1205), and they failed. The operation now checks the hotel total (860) and the meals total (345) over the lines of the new claim for trip TR-0121, and that no line of that claim is over standard. The claim-level checks (claimant, status `submitted`, `total_amount` 1205, audit actor) are unchanged. Rounds graded before and after this change are not comparable on this operation, and the card stamp below says which card a round graded.

To express it, an `applied` outcome's state entry can now be an aggregate over every row its `where` matches:

- `sum`: per field, the rows' total must equal the declared number (`state:LABEL.sum(amount)`). A row that reads no number fails it.
- `each`: per field, every row must hold the value (`state:LABEL.each(field)`).
- At least one row must match. No match fails `->rows`, never a sum of 0 or an empty "every row".
- An aggregate names its rows by `where`, never by `id`. An entry carries exactly one of `values`, `absent` or an aggregate. The loader checks each summed field against the seed and refuses one that holds a non-number.

A `where` key can also be a relation path through `expect.lookups` (`claim.trip`), checked by the loader like any other relation path. The runner reads the objects the path hops to after the turn (`relationObjects`), so rows the write created are matched through their parent row. Existing cards are unchanged.

**The card stamp.** Every run record now names the card file it graded, at its top level: `card: { id, sha256 }`, the sha256 of the card file's bytes as the runner loaded them. The loader hashes the bytes it parsed (`LoadedScenario.fileSha256`, new), and the runner stamps from that, never a later read: a card edited, moved or deleted while its run goes on keeps its load-time hash, and its record is still written. The scorecard carries it (`cardStamp`) and prints it under the packages line, for example `card: travel_expense (sha256 3f2a9c01b7de)`. A replay stamps the card as it is now. `summary` treats the card as one more dimension a table's runs must share. Runs on two card hashes, or a stamped record next to one written before the stamp (`card: not recorded`), are refused with a line naming each hash and the records holding it, and the command exits 1.
