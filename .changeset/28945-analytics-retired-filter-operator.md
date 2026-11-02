---
'@objectstack/service-analytics': patch
---

fix(service-analytics): a retired filter operator (`$regex`, `$options`) in an analytics `where` or dataset `runtimeFilter` is refused with the retirement's prescription naming `$icontains`, as the data door refuses it (#28945)

Clause-②: no
Metadata-protocol: none

The analytics filter already refused `$regex` and `$options` with `INVALID_FILTER` / 400, but its message was the generic "Unsupported filter operator … Supported: …" list. The message now says the operator is RETIRED, says `Write "$icontains" instead.`, and then prints the retirement prescription from `RETIRED_FILTER_OPERATORS` word for word, the way the data door's refusal does. When one field constraint carries both keys, the message names both. Every analytics face answers it from one check: `/analytics/query`, `/analytics/dataset/query` (runtime, dataset and measure filters), `/analytics/sql` and the draft preview. The status, the error code and what is refused are unchanged, and an unknown operator keeps the generic list.

What to do: nothing. A stored widget filter that still uses `$regex` was refused before this change and is still refused. The message now names the fix: write `$icontains`.
