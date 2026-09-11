---
"@objectstack/service-analytics": patch
---

fix(service-analytics): an unrecognised `compareTo.kind` is refused, not answered with a previous-period window under a 200 (#17550)

`shiftRange` had one branch and a fall-through — `previousYear` was named, and
**everything else** landed in the `previousPeriod` arm. No `default`, no
exhaustiveness check. So `compareTo: { kind: 'previousQuarter' }` came back as a
previous-period comparison under an ordinary **200**, and the caller was told
nothing. The wrong answer is a comparison **window**: a number a dashboard
renders and a person reads as fact, with no status, header or field in the
response to distinguish it from a real answer.

`DatasetCompareTo.kind` has only ever declared two values
(`'previousPeriod' | 'previousYear'`), but `DatasetSelection` is a TypeScript
interface with no Zod schema anywhere, and `/analytics/dataset/query`'s door
parses only the seven members the selection shares with `AnalyticsQuery` —
`compareTo` is one of the four it projects away before its parse, and the route
forwards the caller's selection to the service untouched. So `kind` was checked
by `tsc` inside this repo and by nothing at all on the wire.

## FROM → TO

| Input | Was | Now |
|:--|:--|:--|
| `compareTo: { kind: 'previousPeriod' }` | the equal-length window before | **unchanged** |
| `compareTo: { kind: 'previousYear' }` | the same window one year back | **unchanged** |
| `compareTo: { kind: <anything else> }` | a previous-period window, **200** | `DATASET_INVALID` / **400**, naming the value received and both legal ones |

The fix is to name one of the two declared windows, or drop `compareTo` — which
is what the refusal says. No accept set widens, no new error code is minted: the
refusal is the fourth member of the `datasetInvalidError` family
`resolveCompareDimension` already raises three times for the same document, so it
arrives at the route through the envelope that route already classifies on.

## Why this is a `patch`

It pulls behaviour back onto the contract the type has always declared, rather
than narrowing past it: every input `DatasetCompareTo` permits returns
byte-identical windows, pinned by a control in the same change. What flips from
200 to 400 is input the declared contract never permitted. The reachable-today
population for that input was measured on the tree — the dashboard authoring path
is already doored (`DashboardWidgetSchema` parses the widget's `kind` as a
`z.enum`, so a third kind cannot arrive through a parsed widget), and no producer
in this repository sends a third value. What is not enumerable from here is a
consumer outside it calling the published `shiftRange` export, or posting a
hand-rolled body to the dataset route; for those, the refusal replaces a wrong
answer with a located one.

`alignedCompareBucketKey` reads the same two-valued `kind` and deliberately gains
no refusal of its own: it is not on the package's public surface, and its only
caller runs `shiftRange` first — both pinned, so exporting it turns the pin red
rather than silently reopening this defect.
