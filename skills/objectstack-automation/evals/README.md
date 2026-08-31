# Evaluation Tests (evals/)

Evaluation tests (evals) validate that AI assistants correctly understand and
apply the rules defined in this skill when generating automation metadata —
flows, approval chains, triggers, and scheduled sweeps.

## Current evals

| Eval | Covers |
|:-----|:-------|
| [approvals/test-revise-loop.md](./approvals/test-revise-loop.md) | ADR-0044 send-back-for-revision: the `revise` branch, the `approval_revise` window, and the resubmit edge `type: 'back'` |

## Planned structure

Future evals extend the same layout, one folder per automation concern:

```
evals/
├── approvals/
│   ├── test-revise-loop.md        ← implemented
│   └── test-quorum-behaviors.md   (planned — quorum / per_group sign-off)
├── flows/
│   ├── test-schedule-binding.md   (planned — cadence on the start node, never top-level)
│   └── test-decision-edges.md     (planned — edge-condition branching; unguarded edges run in parallel)
└── triggers/
    └── test-time-relative.md      (planned — timeRelative sweep vs record-change date-equality)
```

## Format

Each eval file contains:
1. **Scenario** — Description of the task
2. **Expected Output** — Correct implementation
3. **Common Mistakes** — Incorrect patterns to avoid
4. **Validation Criteria** — How to score the output

## Contributing

When adding evals:
1. Each eval should test a single, specific rule or pattern from `SKILL.md`
2. Include both positive (correct) and negative (incorrect) examples
3. Name the `SKILL.md` section the eval enforces
4. Use realistic scenarios from actual ObjectStack projects
