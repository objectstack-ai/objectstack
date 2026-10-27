---
'@objectstack/spec': minor
'@objectstack/service-analytics': minor
---

feat(spec): a dataset measure declares its `polarity`, so a lower-is-better KPI draws a rising delta as bad news

Clause-②: yes (widening)
Metadata-protocol: added

`DatasetMeasureSchema` declares one optional key, `polarity`, with three values (`DatasetMeasurePolarity`): `'higher'` (a rise is good), `'lower'` (a fall is good: turnaround days, overdue counts, cost) and `'neutral'` (neither direction is good or bad). It is declared on the measure, the semantic layer, so every widget over the measure agrees, and not on a widget's `compareTo`, which is the executor's closed comparison directive. An undeclared polarity keeps today's colours: a rise green, a fall red. Nothing infers a polarity from the measure's name. The near-miss keys `betterWhen`, `direction`, `goodDirection` and `trendDirection` are pointed at `polarity`, and the boolean spellings `higherIsBetter` / `lowerIsBetter` are answered with the three values.

The dataset answer's column descriptor declares the same vocabulary as `fields[].polarity` (`AnalyticsResult` and `AnalyticsResultResponseSchema`), and the analytics service relays the measure's declared value onto it, on the live query and the draft-data preview alike, the measure's `__compare` column included. An undeclared measure and every dimension column carry no `polarity` key, so an answer over a dataset that declares none is unchanged.
