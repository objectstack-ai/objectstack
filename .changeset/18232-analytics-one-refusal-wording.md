---
'@objectstack/service-analytics': patch
'@objectstack/core': patch
---

analytics `dateRange`: one condition, one refusal wording

An array `dateRange` that is not a two-bound window is refused by the
`service-analytics` faces with the platform's ONE shared sentence
(`analyticsDateRangeRefusalMessage`, origin `runtime`) instead of a
package-private second wording. The envelope is unchanged —
`ANALYTICS_DATE_RANGE_UNRECOGNIZED` / 400 — so nothing that classifies on
`code`/`status` is affected; only the `message` text changes, and it now agrees
byte-for-byte with the sentence the schema door answers with for the same value.

The second wording existed because the shared sentence used to judge a bare
string against the preset vocabulary and to end with "Refused at the schema",
neither of which is true of an array refused past the schema door. Both grounds
were removed when `analyticsDateRangeRefusalMessage` gained its required
`origin` parameter and began describing a non-string by what is wrong with it.

⛔ If you match on the old text (`[service-analytics] dateRange …`), match on
`error.code === 'ANALYTICS_DATE_RANGE_UNRECOGNIZED'` instead — the message was
never the contract, the envelope is.
