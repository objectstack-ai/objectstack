# ADR-0107: Withdrawn — this number is retired and must not be reused

**Status**: **Withdrawn (2026-07-28)**. This file is a *tombstone*, not a decision: nothing in it is in force, and the number must never be reassigned.
**Deciders**: ObjectStack Protocol Architects (the withdrawal was an owner decision)
**The record that held this number**: *"The Hook-Body Write Set Is an Accepted Static-Analysis Gap"* — `docs/adr/0107-hook-body-write-set-accepted-static-gap.md`, Status *Proposed (2026-07-27)*
**Landed by**: [#3716](https://github.com/objectstack-ai/objectstack/pull/3716) — `53d37f1ae`, 2026-07-28 00:25 +0800
**Withdrawn by**: [#3735](https://github.com/objectstack-ai/objectstack/pull/3735) — `3bb382b67`, 2026-07-28 09:24 +0800, nine hours later
**Tracking**: [#3700](https://github.com/objectstack-ai/objectstack/issues/3700) (the proposal this record routed — closed as **not planned**), [#6676](https://github.com/objectstack-ai/objectstack/issues/6676) (this tombstone)
**Consumers**: none. No code is governed by this number, and none may be — see [Do not anchor to this number](#do-not-anchor-to-this-number).

---

## TL;DR

A real record occupied ADR-0107 on `main` for nine hours on 2026-07-28 and was then
deleted by an owner decision. It was **withdrawn, not lost**: the deletion was
deliberate, its reasoning is in the withdrawing commit, and no restoration is wanted.

This file exists so the number resolves to that explanation instead of to nothing, and
so it is never handed to an unrelated decision. Reassigning it would retroactively
re-point every historical "ADR-0107" — in commits, issues, the audit record and the
withdrawal changeset — at a document its author never meant. That is the squat failure
mode [ADR-0079](./0079-record-display-name.md)'s reconstruction was written for
([#6634](https://github.com/objectstack-ai/objectstack/issues/6634)), where one number
had silently accumulated 77 citations it did not resolve.

**A new record takes the next free number. Not this one.**

## What happened

| When (UTC+8) | What | Evidence |
|---|---|---|
| 2026-07-27 | Decision taken on [#3700](https://github.com/objectstack-ai/objectstack/issues/3700): accept the hook-body write-set gap and mark it (option (a) of three) | audit §5 D4 |
| 2026-07-28 00:25 | ADR-0107 written and merged, Status *Proposed* | `53d37f1ae` ([#3716](https://github.com/objectstack-ai/objectstack/pull/3716)) |
| 2026-07-28 09:24 | Owner reverses course: the record and its changeset are deleted, #3700 closed as *not planned* | `3bb382b67` ([#3735](https://github.com/objectstack-ai/objectstack/pull/3735)) |
| 2026-07-31 14:25 | The withdrawn record's central posture is **reversed** — see below | `c1d44f7dc` ([#4271](https://github.com/objectstack-ai/objectstack/issues/4271)) |
| 2026-08-08 | The bare number is grandfathered onto `check-adr-anchors`'s citation allowlist, pending this tombstone | [#6634](https://github.com/objectstack-ai/objectstack/issues/6634) |

The withdrawing commit states the reasoning in full. In short: the record's whole
content was *that the gap is documented*, and the documentation — `hook-bodies.mdx`,
`hooks.mdx`, the `ScriptBodySchema` TSDoc — is itself the entire disposition. A
decision record whose only claim is "the docs say so" earns nothing and adds an
apparatus to keep in sync, so it went and the docs stayed. The structured `writes`
declaration it had routed as a deferred proposal was dropped outright at the same
time: it would duplicate the write set in a second place the author must keep
synchronized — worst of all for AI authors — while exercising hooks against a SQL
driver already surfaces the failure mode schemaless `memory://` green-lights.

## Do not resurrect it

Beyond being withdrawn, the record's substance is now **contradicted by shipped code**,
so restoring the text would plant a false statement in the decision log.

Its D2 declared "no heuristic source analysis" a *permanent posture, not a deferral* —
that the write set would never be regex- or AST-guessed out of a Turing-complete body.
Three days after the withdrawal, [#4271](https://github.com/objectstack-ai/objectstack/issues/4271)
(`c1d44f7dc`, 2026-07-31) did exactly that: `validateHookBodyWrites` in
`@objectstack/lint` parses `body.source` and resolves its literal writes against the
target object's fields, warning `hook-body-write-unknown-field` with a did-you-mean.
That commit's own subject records the reversal — "从 accepted gap 变为作者时 lint 告警".

The live account of that surface is `content/docs/automation/hook-bodies.mdx`
("Write-set checking"), which states the current bounds directly, including that a
missing warning is not a clean bill of health. Read that, never this file, for what
is true today.

## Do not anchor to this number

`scripts/check-adr-anchors.mjs` requires every `ADR-NNNN` cited in a tracked file to
name a record under `docs/adr/`. This tombstone satisfies that check — deliberately,
because the historical citations below are legitimate references to the withdrawal.
It is **not** a licence to cite ADR-0107 as governing anything: an anchor entry must
state the invariant its ADR decided, and this number decided nothing.

The citations that exist today all discuss the withdrawal itself:

- `.changeset/withdraw-adr-0107-drop-writes-proposal.md` — the changeset that withdrew it;
- `docs/audits/2026-07-app-metadata-reference-integrity-assessment.md` §5 D4 — the audit whose open decision it recorded, which carries the revision;
- `scripts/check-adr-anchors.mjs` — the gate, describing this case.

## Archaeology (2026-08-10, #6676)

Recorded so the next reader does not repeat it. Run against full history
(9,829 commits, clone unshallowed — a shallow clone silently answers "never existed"):

```bash
git log --all --diff-filter=AD -- 'docs/adr/0107*'   # -> exactly 2 commits, both above
git log --all --oneline -S'ADR-0107'                 # -> 5 commits, all accounted for
git log --all --oneline -S'0107' -- docs/            # -> the same 2 commits
```

**Nothing else ever claimed this number**, on any branch, at any time. There is no
second era of "ADR-0107" and no lost content: the withdrawn text is recoverable in
full at `git show 53d37f1ae:docs/adr/0107-hook-body-write-set-accepted-static-gap.md`,
and is kept in history rather than here on purpose — a withdrawn record reprinted
inside its own tombstone reads as a record.
