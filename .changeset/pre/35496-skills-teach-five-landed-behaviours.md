---
'@objectstack/skills': patch
---

docs(skills): the data, query and ui skills teach five landed refusals and behaviours

Clause-②: no
Metadata-protocol: none

Five pieces of published skill text, one per landed behaviour the skills did not teach. Each comes with its own eval case.

**The `{current_iso_week}` period key.** objectstack-query's `rules/filters.md`, section "Date Macros", now names the period key beside the date macros and the session tokens. `{current_iso_week}` (or `${current_iso_week}`) resolves to today's ISO week key, `YYYY-Www`, in the workspace time zone: Monday-start weeks, the ISO week-year at year edges. It is text, for a text field that stores week keys. A `date`, `datetime` or `time` field refuses it with `INVALID_FILTER` / 400, as it refuses the literal key; a date dashboard filter's `defaultValue` and `calendar.initialDate` refuse it too. On a date field write `{current_week_start}` / `{current_week_end}`. The section also names `resolveFilterPlaceholders()` as the client resolver for all three vocabularies and `isKnownFilterToken()` as the one spelling check. One eval case covers the text-field / date-field split.

**A hook or job `js` body that does not compile is refused.** objectstack-data's `references/data-hooks.md`, "Sandbox restrictions":

- A new bullet says a `js` source is compiled, without being run, inside the `(async (ctx) => { … })` wrapper the runtime runs it in, where `ctx` is already declared. `const ctx = ctx.input || {};` (or `let ctx`, one name declared twice, any syntax error) is `hook-body-does-not-compile`: an error from `os validate`, `os build`, `os lint` and a runtime hook save (`422 INVALID_METADATA`), naming the hook, the `SyntaxError` and its line. The fix is to use `ctx` as it is or rename the local (`const input = ctx.input || {};`). A job's `js` body runs in the same wrapper and is `job-body-does-not-compile` from the three commands. A regular-expression pattern the checking engine refuses is a warning: the runtime may accept it.
- Six restatements in the same file were removed to pay for the new text; the file is four lines shorter and no larger in tokens than before.

`evals/hooks-security-seeds-datasources.json` gains one case on the refusal and its fix.

**A seed record with a blank key field is refused at load, and a saved seed naming an unknown object is refused 422.** objectstack-data's `references/seeds.md`:

- "`externalId` selection" says every record carries a value for each `externalId` field (each field of a list, or `name` when the seed names none), and that a record leaving one blank (no value, `null` or `''`; whitespace is a value) is refused at load in every mode: the load result names the object, the record index, the field and the fix, and the other records still load. The `externalId` row of the field table points at it.
- The note under the field table says a `seed` saved at runtime names its `object` itself, and that one resolving to nothing is refused with `422 INVALID_METADATA` at `object` ("which is not defined"). The fix is the object's full name (`crm_lead`, not `lead`) or creating the object first: a draft of it is enough for a draft seed, a live seed needs it published. The `object` row points at the note.
- Three restatements in the same file were removed to pay for part of the new text: the `columns` row's shape literal, the one-row best-practices table (now a sentence) and the second telling of what a refused seed value leaves behind.

`evals/hooks-security-seeds-datasources.json` gains one case on each refusal.

**A `master_detail` child is a record-page body table by default.** The record page draws a `master_detail` child as a full-width body table whenever its FK declares no `relatedList`. The skills still tied that to `inlineEdit`. They now teach the rule the runtime applies.

- objectstack-data's `rules/relationships.md`, "Detail-page related lists": a `master_detail` child is a body table by default and a `lookup` child is a panel. `inlineEdit` governs entry in the parent's form only. The `relatedList` list reads `'primary'` (the `master_detail` default), `true` (the `lookup` default) and `false`. The example no longer writes `inlineEdit` and `relatedList: 'primary'` on a `master_detail` field to get the table.
- objectstack-ui's `rules/record-page.md`, step 2: the same defaults, the body table is drawn after the open field sections (it used to say after the first one), and "put the tasks first" is the parent's `relatedLists`. The example field drops its `relatedList: 'primary'`.
- objectstack-ui's `evals/record-page.json`, case 1: the expected answer adds no placement flag to a `master_detail` field, and an answer that authors `inlineEdit` fails the case. `evals/README.md` follows.

Both of those rules files are shorter than before, and neither one's token ceiling moves.
