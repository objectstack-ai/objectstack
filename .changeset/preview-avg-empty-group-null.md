---
'@objectstack/service-analytics': patch
---

Draft-preview analytics: `avg` answers the mean of the NON-NULL operands, and `null` when there are none — matching every live face

A dataset measure `{ aggregate: 'avg', field: 'amount' }` compiles to the cube
metric `{ type: 'avg', sql: 'amount' }`, and the draft-preview evaluator built
its operand list with `rows.map((r) => Number(r[field]))`. `Number(null)` is `0`
and `Number.isFinite` accepts it, so every NULL entered the average as a zero
OPERAND and was counted in the divisor. `AVG(col)` is defined over non-null
values in every SQL dialect, so a drafted chart showed a different number than
the published one, silently — and where a group's column was NULL in every row
the number it showed was `0`: a plausible-looking average that a reader cannot
tell from one somebody measured.

Measured on one dataset, one row set, two `AnalyticsService` instances differing
only in `draftRowsResolver` (the live half being `NativeSQLStrategy`'s generated
SQL on a real SQLite). Rows `{meals, null}` and `{meals, null}` answered
`avg_amount` null live and `0` on preview; rows `{travel, 10}`, `{travel, 20}`,
`{travel, null}` answered 15 live and 10 on preview. Both cells now answer the
live number.

The empty answer is READ from the platform's own ruling rather than restated
here: `emptyGroupValueFor` (`@objectstack/spec/data`) returns the identity `0`
where counting or summing nothing is a measured fact and `undefined` — spelled
`null` on this wire — where there is nothing to answer. It is the same function
`fillEmptyGroups`, `sql-driver` and `driver-turso` read, and the one #16203 cited
when it moved `min`/`max` off the same idiom in this function.

Unchanged, and pinned by the same differential: `sum` over a group with no values
still answers the ruled identity `0`, `count` over one still answers `0`
(#16218), `min`/`max` still answer `null` (#16203), and `avg` over a group that
has values still answers its mean. `sum` and the numeric `default` arm keep their
existing operand list — `0` is the additive identity, so the coercion never moved
`sum`'s answer, and the `default` arm serves the custom-SQL metric types, which
have no live standard to be moved towards.

The `null` fires on an EMPTY group and never on an incoherent one. "No numeric
operand" is two different situations: no row carried a value at all — the empty
group the policy rules on — or rows carried values that do not read as numbers,
such as a `date` column under `avg`. The second is an incoherent
aggregate/field-type pair that #16099 owns and no layer refuses yet; it keeps the
numeric identity it has always had, since the live face answers a different
number again (SQLite's numeric affinity over a TEXT column) and a `null` there
would invent a third answer. That boundary is pinned from both sides — by
`preview-aggregate-operand-type.test.ts` (#16203) and by a control in the new
differential.

The live path is unchanged.

Bumped `patch` rather than `minor`, on the same reasoning the sibling #16218
shipped under: the package's published surface is byte-unchanged — `src/index.ts`
is not in this diff and does not re-export `preview-evaluator.ts` at all, and
`aggregate()` is module-private — and the only user-visible effect is a drafted
chart's number moving to the number the published chart already showed. A value
correcting toward the live standard is a fix, not the backwards-compatible
feature addition `minor` denotes. It is a real value change for a consumer
reading the preview response (`0` becomes blank), which is why the card was filed
separately rather than ridden along with #16203 — but the `0` it replaces was
never a number the platform promised.
