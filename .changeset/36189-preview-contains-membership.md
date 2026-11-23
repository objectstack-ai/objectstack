---
'@objectstack/service-analytics': patch
---

fix(service-analytics): the draft preview answers `$contains` on a multi-value field as membership, as the published dataset does

Clause-②: no
Metadata-protocol: none

The draft preview (`POST /api/v1/analytics/dataset/query?preview=draft`, what Studio's preview mode reads) evaluated `$contains` as a case-folded substring of the value's string form on every column. On a field declared multi-valued (`multiple: true`) or stored as JSON (`tags`, `multiselect`, `json`, …) that searched the drafted list as text: `$contains: 'a'` counted a row holding `['ab']` or `['A']`, and `$contains: 'a,b'` counted a row holding `['a', 'b']`. The published dataset counts none of them, so a drafted chart showed numbers that changed at publish.

On such a field the preview now asks whether the comparand is a member of the stored list, reading the comparand as every SQL face does (`'1'` names the string `'1'` or the number `1`; a nested list, an object or a value that is not a list holds no member). On any other column it is the case-exact substring of a stored string, the `$contains` family's rule everywhere else on the platform: `$contains: 'acme'` no longer matches `ACME Corp`, and a stored number never contains a substring.

`$notContains` was refused `INVALID_FILTER` / 400 on the preview; it is now answered, as the exact complement, with the same answers the live faces give (a row with no value satisfies it).

A drafted filter that relied on the preview's case folding (`$contains: 'acme'` over `Acme`) now counts what the published dataset counts; write the case the data holds. `$icontains` is still refused on the preview.
