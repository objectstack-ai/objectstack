---
"create-objectstack": minor
---

`create-objectstack` now closes with a "Created files" summary derived from a
walk of the finished project directory, so it names everything the run wrote —
including the files written after the template copy (#10323).

The old summary was the template copy's own list, printed before
`<pm> install` and before `npx skills add`. Measured against published
`create-objectstack@17.1.0` (`create-objectstack demo-app`, then a full walk of
the result): 12 entries printed, 18,045 paths on disk, **18,033 of them
unreachable from the summary** — `AGENTS.md`, `.github/copilot-instructions.md`,
`pnpm-lock.yaml`, `skills-lock.json`, `node_modules/`, and two ~968 KB trees of
agent instructions at `.agents/skills/` and `agent/skills/`.

That mattered because the same run ends with the `skills` CLI printing *"Review
skills before use; they run with full agent permissions."* Advice to review
files the run never named, at paths it never showed, is advice a newcomer
cannot act on — the wrong failure direction for a security-flavoured warning.

The list could not have been correct where it stood: two of the three write
phases belong to other processes, and the `skills` installer's destination set
moves with **its** releases, not ours. Reading the directory afterwards makes
the summary self-correcting instead. Large directories collapse to one line
carrying their path, entry count and size, so the bulk stays reviewable without
18,000 lines of output, and the paths the skills installer created are marked
`⚠ skills` with the permissions warning tied to them.

Same run, after the change: 20 entries printed, **0 written paths unreachable**.
