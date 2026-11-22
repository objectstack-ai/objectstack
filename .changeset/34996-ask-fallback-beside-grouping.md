---
'@objectstack/service-analytics': patch
'@objectstack/mcp': patch
'@objectstack/skills': patch
---

fix(service-analytics): `list_datasets` no longer tells a client to ask "which number" when a word that falls back stands beside a grouping word

Clause-②: no
Metadata-protocol: none

A question such as "How many sales orders are in each status?" names its number. When no dataset measure answers to "sales orders" and none is offered as a candidate, the labelled fallback to the object query tools computes it. Until now the `nextStep` note of such an answer said two things at once whenever the grouping word equalled a dimension, or was near one: answer with the object query tools, and "A grouping alone is no answer: ask the user which number they mean." A client told both asked, and computed nothing.

- **`list_datasets` `nextStep.note`** (`@objectstack/service-analytics`): the "which number is meant" sentence is written only when every word sent is a grouping (it equals a dimension, or has only dimensions among its candidates). With an unknown word beside it, the note carries that word's labelled fallback and no question. `decision`, `terms`, `matches` and `candidates` are what they were. Unchanged: a word that equals several measures, and a word with a measure among its candidates (one candidate included), are still asked about and never selected.
- **`list_datasets` description**: the sentence "A dimension match alone picks a grouping, not a number: a measure must still match." now says when the question is owed (the words name only groupings) and that it is not owed beside a word that falls back.
- **`objectstack-ask` skill, step 2** (`@objectstack/skills`, and the copy `GET /mcp/skill` serves from `@objectstack/mcp`): the row "Only a dimension matches" becomes "No word for a thing measured, only grouping words", and the fallback row says the fallback is taken without asking, whatever a grouping word or another word matched. The sentence under the table that said the same about another word's matches is cut, since the row now holds it.
- **`objectstack-ask` skill, step 1**: a term keeps its counting head ("number of deals", not "deals"), so a phrase the dataset's owner declared as a synonym is sent whole and can equal its one measure.
- Three eval cases (21 to 23) cover the fallback beside a grouping candidate, the fallback beside a dimension match, and the whole counting phrase.

The skill file is 12 bytes shorter than before (1875 to 1872 tokens by the catalog's count).
