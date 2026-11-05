---
'@objectstack/scenarios': patch
'@objectstack/cli': patch
---

feat(scenarios): the deterministic scenario scorer lives in `@objectstack/scenarios` and judges capability tags, agent-action exposure, write outcomes and per-persona answers against a loaded card

Clause-②: no
Metadata-protocol: none

- **`@objectstack/scenarios/score`** (private, unpublished): the entry the scenario runner calls. `scoreCardArtifact(card, artifact)` scores a built `dist/objectstack.json`; `gradeCardOperation(card, operationId, observation)` judges an observed write against its declared outcome; `gradeCardAnswer(card, { question, persona?, turn })` grades an agent's answer against the loader's computed truth for that persona. Each takes a card the loader returned, and the graders read the card schema's own types.
- **The scorer moved here from `@objectstack/cli`.** That covers the structural shape score, the artifact-to-graph reader and the Run grader, which were never released from the CLI. It now also carries:
  - **capability-tag checks**: a closed table of nine tags, listed in the package README. A tag outside it, or a row with nothing in the card to judge, is reported `unscored` and counted nowhere;
  - **agent-action exposure**: each declared action exists on its object, carries `ai.exposed: true` and, where the card says it asks first, `ai.requiresConfirmation: true`. A missing action fails;
  - **a write-operation grader**: `applied`, `refused` or `pending_confirmation`. An unobserved fact fails;
  - **per-persona Run grading**: a `withheld` truth is must-not-reveal, and an all-rows figure outside a scoped persona's rows is a leak.
- **`@objectstack/cli`**: `MetadataEvalCase` is now declared in `corpus.ts`, beside the golden corpus it types, and `metadata-eval.ts` re-exports it under the same name. No behaviour change, no new flag and no new package-entry export. The CLI carries no scenario code.

No model call anywhere.
