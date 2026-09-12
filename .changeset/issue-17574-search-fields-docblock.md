---
'@objectstack/spec': patch
---

Correct the `search-fields.ts` module docblock's ENGINE bullet: the `$search` expansion is not closed over the resolved set, and its clauses are not all `$icontains`.

The bullet claimed `expandSearchToFilter` expands a `$search` term into a `$or` of `$icontains` clauses "over exactly this set". Since the pinyin-recall companion column landed, an object whose deployment provisioned the hidden `__search` companion gets one additional clause per latin term on that companion — a field `resolveSearchFields` never returns and no `$searchFields` override can name, so it sits outside the set the sentence called exact. That one clause is `$contains`, deliberately: the companion is already lowercase on both sides, so a case-sensitive operator over two folded values is exact rather than a case bug, and the engine carries an explicit instruction at the site not to align the two operators. The docblock now states both facts and cites that instruction, so a reader does not "repair" the deliberate split.

Documentation only — no behaviour, schema or exported surface changes.
