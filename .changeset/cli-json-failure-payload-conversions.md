---
"@objectstack/cli": minor
---

feat(cli): `os validate --json` and `os build --json` carry the computed `conversions` on every failure exit, not the success payload alone (#12125)

**Machine-contract widening on the `--json` failure payloads.** A consumer that
today branches on `conversions` being ABSENT from an `os validate --json` or
`os build --json` failure payload sees a different shape after this change.

## What was wrong

`conversionNotices` is filled by the `onConversionNotice` sink handed to
`normalizeStackInput`, which runs at **step 2** — above the schema parse and
above every later gate in both commands. The notice was therefore already in
hand when any failure exit fired, and was then discarded: `conversions:` was
published on the terminal SUCCESS payload alone.

An ADR-0087 D2 conversion notice is the one advisory class that carries an
**expiry** — `retiresIn` names the protocol major where the old shape stops
loading. So a CI job gating on `os validate --json` / `os build --json` could
not see that its tree depends on a conversion about to retire for as long as
the tree also tripped any unrelated gate — the notice was withheld exactly
while the tree was broken, which is when an author is most likely editing it.

This is the same "computed, then dropped on a failure exit" shape as the
`warnings` family (#11643 / #11391 / #11772 / #12047), one field over. #12079
added `warnings` to all nine `os build` failure exits and deliberately left
`conversions` untouched, so closing those cards did not close this one.

## What changed

`conversions` is now present on every `emitJson` exit of both commands —
6 in `validate.ts` (5 failure + success), 10 in `compile.ts` (9 failure +
success) — alongside each exit's existing keys, which are unchanged.

| command | exit | `conversions` before | after |
| --- | --- | --- | --- |
| `os validate --json` | protocol parse failure | absent | the computed notices |
| `os validate --json` | author-time rules failed | absent | the computed notices |
| `os validate --json` | capability provider check | absent | the computed notices |
| `os validate --json` | package docs failed | absent | the computed notices |
| `os validate --json` | thrown / caught | absent | what the run had computed |
| `os build --json` | all nine failure exits | absent | what the run had computed |

The success payloads are unchanged in content.

Notices are **carried, not recomputed**: the fix is a pure scope change — the
sink array is declared above the `try` so the catch-all exit can read it — and
`normalizeStackInput` still runs at exactly step 2. A run that throws in
`loadConfig`, above step 2, therefore reports `[]` honestly.

⭐ Note the two fields differ on `os build`'s two earliest exits. For `warnings`,
`--strict-body` and the protocol parse are empty by construction (nothing
advisory is computed that early); step 2 is **above** both, so `conversions` is
populated there. The field was measured per exit rather than inherited from the
sibling change.

## What a consumer keying off its absence should do instead

⛔ `conversions` is no longer a signal of which exit produced the payload, nor
of success. Read `valid` (validate) / `success` (build), and `error` /
`errors`, for that; a consumer that inferred "this is a failure payload" from a
missing `conversions` must switch to the explicit status field.

⛔ `conversions: []` on a failure payload does NOT mean "this tree converts
nothing". It means **this run stopped before the conversion layer ran** — a
config that fails to load reports `[]` by construction. A consumer that needs
the true conversion set for a tree must read it from a run that reaches at
least step 2.

✅ `conversions` is always an array on every `os validate --json` and
`os build --json` payload, success or failure, so it can be read
unconditionally — that shape constancy is the point of the change (maintainer
ruling 2026-08-25 on #11772/#12047, option 1 of three, applied here under the
same-family rule; option 2, "carry it only where the text face printed it", was
rejected as the hardest contract to declare).

✅ Each entry keeps its structured fields — `conversionId`, `surface`, `from`,
`to`, `path`, `toMajor`, `retiresIn` — on failure exits exactly as on the
success payload, so a CI job can gate on `retiresIn` without a second run.

Exit codes are untouched: every failure exit still exits 1. `--strict` on
`os validate` still reads the text face's own list, which folds conversion
notices in, so `os validate --json --strict` reaches the same verdict it did
before.

`warnings` and `conversions` remain **separate fields**. Whether the two should
be folded into one is a live question raised on #12125 and not settled by the
ruling; this change deliberately mirrors the `warnings` shape rather than
merging either field into the other.
