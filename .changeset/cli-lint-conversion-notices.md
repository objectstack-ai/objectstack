---
"@objectstack/cli": minor
---

feat(cli): `os lint` surfaces ADR-0087 conversion notices — a `conversions` key in `--json` and a printed notice for a human (#12297)

**Machine-contract widening on the `os lint --json` payload.** A consumer that
reads an exact key set from `os lint --json` sees one new key after this change.

## Proposed grade, and why

`minor`, matching the two nearest precedents on this lane rather than the
bug/feature framing: #13347 (adding `code`/`httpStatus` to the CLI's
`--format json` envelope) and the sibling `conversions` change on
`os validate` / `os build` (#12125) were both graded `minor` as additive
members on a published machine-readable surface. Triage graded this card a
`Bug` on declared-not-enforced grounds, and that reading is not in conflict:
restoring a parity contract can still widen a wire surface, and the grade
follows the surface. Nothing here is breaking — no existing key changes
meaning, none is removed, and the `total` / `errors` / `warnings` /
`suggestions` counts are byte-for-byte what they were.

## What was wrong

`os lint` called `normalizeStackInput(config)` with **no options object**, so no
`onConversionNotice` sink existed. The ADR-0087 D2 conversion layer runs inside
that call and always did — `os lint` converted the author's metadata on every
run — but with no sink the notices were never **produced**, in either face. An
anchored count over the whole file said so in one number:

```
grep -cE 'onConversionNotice|conversions' packages/cli/src/commands/lint.ts
0
```

This is the #3782 **parity** class, not the "computed, then dropped" family
(#11643 / #11391 / #11772 / #12047 / #12125): nothing was computed and
discarded, the producer was never wired. It is the exact gap `os build` was in
before #11772 / PR #12079.

`os lint` is one of the three authoring commands the #4409 registry holds to a
single bar, and it was the only one telling an author nothing about a
conversion its own load path had just applied. A conversion notice is the one
advisory class carrying an **expiry** — `retiresIn` names the protocol major
where the old shape stops loading, and five conversions are live today
(protocol 11 and 15). An author or CI job whose only authoring gate is
`os lint` got no signal at all, in either face, until the conversion retired
and their metadata stopped loading.

## What changed

| face | before | after |
| --- | --- | --- |
| console (`os lint`) | nothing | one `⚠` line per notice: the path, `'from'` → `'to'`, the conversion id, and the protocol major it retires in |
| `os lint --json` | no such key | `conversions`: the same structured notices, unconditionally present |
| `os lint --json`, thrown / caught | no such key | what the run had computed — `[]` for a throw at load |

The console wording is `compile.ts`'s, verbatim, so an author who runs two of
the three commands over one tree is told the same thing in the same words. The
`--json` key is the same `conversions` key `os validate --json` and
`os build --json` publish, carrying the same structured entries, so one
consumer reads all three authoring commands the same way.

## What a consumer should know

✅ `conversions` is **always an array** on `os lint --json`, success or
failure, so it can be read unconditionally. Each entry keeps its structured
`conversionId`, `surface`, `from`, `to`, `path`, `toMajor` and `retiresIn`
fields, so a CI job can gate on `retiresIn` without a second run.

⛔ `conversions: []` does **not** mean "this tree converts nothing" on the
caught-error payload — it means the run stopped before the conversion layer
ran. A config that fails to load reports `[]` by construction. Read the
`error` key to tell the two apart.

⛔ A consumer asserting an exact key set on `os lint --json` must add
`conversions` to it. No existing key changed: `total`, `errors`, `warnings`
and `suggestions` count exactly what they counted before, and exit codes are
untouched (errors still exit 1).

Conversion notices are **not** folded into `issues`. `issues` keeps meaning
"something to fix"; an auto-converted key needs no action to keep loading. The
related question raised on #12125 — whether `warnings` and `conversions` should
become one field on the sibling commands — is open and was not settled by the
2026-08-25 ruling, so this change mirrors the shipped sibling shape rather than
merging anything.
