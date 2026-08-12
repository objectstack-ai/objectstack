---
"@objectstack/rest": patch
---

fix(rest): `GET /approvals/requests` refuses an unknown query parameter instead of returning every request (#7527)

`GET /api/v1/approvals/requests?assignedToMe=true` answered **200 with every
request the caller could see**. The handler read the keys it knew off the query
string and ignored the rest, so a caller who believed they had asked for "the
requests assigned to me" was handed the **unfiltered** list — and could not
tell, because an unfiltered result is shaped exactly like a genuinely broad
match. No status, header or field distinguished "your filter matched
everything" from "your filter was thrown away".

That is the anti-pattern #7463's defect 2 names, pointed the other way: there an
unrecognised key silently NARROWS to zero, here an unrecognised parameter
silently WIDENS to everything. Both are the server accepting a request it does
not understand and answering with something plausible.

**The route now declares a closed parameter set** and refuses anything outside
it with a located `400` — the ADR-0112 nested envelope
(`{ error: { code: 'VALIDATION_ERROR', message } }`), the same position and code
the repeated-parameter refusal on this same handler already answers with. The
message names the parameters that were not understood and lists every one that
is supported, so a caller can fix the request from the response alone.

The closed set was measured from the handler's own reads, not from the filter
list: the five filters (`object`, `recordId`, `status`, `approverId`,
`submitterId`), the free-text `q`, the paging pair (`limit`, `offset`), and the
`snake_case` alias spellings the handler honours. Paging is inside the set on
purpose — a whitelist built from the filters alone would have traded a silent
widening bug for a loud paging outage.

**`assignedToMe` is refused, not implemented.** The capability it reaches for
already exists and is already reachable: the Console asks exactly this question
as `approverId=<id>,role:user`, which the `approverId` multi-identity arm was
built for. A second spelling for a question that already has one is surface with
no pull behind it, and it would have to be carried forever; refusing costs one
error path and makes every future typo self-reporting.

**If you were sending `assignedToMe`** — nothing was ever honouring it, so no
filtering behaviour changes; the request that used to return everything now
returns a `400` telling you to use `approverId`. Every parameter the endpoint
actually reads is unaffected, including the unparameterised call that returns
the full list.
