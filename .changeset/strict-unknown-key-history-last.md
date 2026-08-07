---
"@objectstack/spec": patch
---

fix(spec): put the unknown-key fix before the surface history sentence (#5955)

`strictUnknownKeyError` — the error map behind every `strictObject` authoring
surface — assembled its message as *front matter → history → fix*. The
`history` sentence a surface declares ("why this key used to be dropped
silently") therefore sat between the two things an author actually needs: the
name of the key that is wrong, and the key to write instead.

That was tolerable while these rejections were warnings. It stopped being
tolerable when #5762 promoted `flow-time-relative-descriptor-invalid` to
**error**, because several consumers render a finding on ONE line — `os
validate`'s `• where: message`, CI logs, and `validateFlowTriggerReadiness`,
which deliberately flattens the newlines out of the schema's own text so the
CLI's bulleted list stays aligned. `TimeRelativeTriggerSchema`'s history
sentence is 224 characters, so on the descriptor from #5496 the words
`Did you mean` landed at character 443 of a 480-character line, behind a
sentence about 2026 that carries no instruction. The author — often an AI —
reads the front of that line and acts on it.

The sentence now goes last:

```text
Unrecognized key(s) on {surface}: `k1`, `k2`.   which keys are wrong
[ Did you mean `k1` → `canonical`? ]            fix, channel 1 (renames)
[ newline + "  • " + {guidance} ]               fix, channel 2 (prescriptions)
{history}                                       why it used to be silent
```

Measured on `TimeRelativeTriggerSchema`, before and after:

| case | length before | length after | `Did you mean` at |
|---|---|---|---|
| #5496 descriptor (`field` + missing `dateField` + scalar `offsetDays`) | 480 | 480 | 443 → 219 |
| single misspelled key (`offsetDay`) | 366 | 366 | 329 → 105 |
| guidance hit (`schedule`) | 544 | 544 | n/a (bullet at 92) |

**Nothing was deleted, nothing became conditional.** Every declared `history`
is still emitted, verbatim, exactly once per message — message lengths are
byte-identical, only the position moved. Both fix channels moved ahead of it:
a `guidance` prescription is as actionable as a rename, so it could not be left
behind the sentence either.

**Migration.** No authoring change, and no schema change: `history` is still a
required option, spelled the same way, on all 62 `strictObject` surfaces and
44 direct `strictUnknownKeyError` call sites. A test that asserts the full
message text in order needs its expectation reordered; a test that asserts
fragments with `toContain` is unaffected. The order itself is now pinned in
`strict-object.test.ts`, so it cannot silently regress.
