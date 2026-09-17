---
'@objectstack/spec': minor
---

**Declare the build-progress PHASE vocabulary on `@objectstack/spec/ai`.**

The `data-build-progress` stream frame has shipped as prose only: `AIToolContext.onProgress`
documents the channel and its example carries a `phase`, but nothing ever declared which
phases exist. Consumers filled that gap by guessing, and a guess here is not merely
unlabelled — the objectui chat panel coerces any value it does not recognise to `structure`,
which renders a "still building" spinner, so a build turn that has finished and moved on to
verifying itself keeps claiming to be building.

New exports (additive; nothing removed or renamed):

- `BUILD_PROGRESS_PHASES` / `BuildProgressPhaseSchema` / `BuildProgressPhase` — the CLOSED
  phase vocabulary: `structure`, `data`, `verify`, `done`, in lifecycle order. An
  out-of-vocabulary value is refused, and the refusal names the accepted set.
- `BuildProgressFrameSchema` / `BuildProgressFrame` — the frame's FLOOR: a required `phase`
  plus an optional `hop` (which post-apply verification hop) and `tool` (the tool that hop is
  running). Deliberately loose, not strict: the presentation fields the chat panel already
  reads ride the same frame and belong to it, so a strict schema here would refuse every
  frame shipping today.
- `BUILD_PROGRESS_FRAME_TYPE` — `'data-build-progress'`, the one literal both ends select on.

Producers emit these frames from the agent loop rather than from the applying tool: a tool's
`ctx.onProgress` handle dies when the tool returns, and the verification window opens after
it does. Consumers should compare phases by value and treat every phase as optional — a turn
that seeds no sample data never reports `data`.

Clause-②: yes (widening)
