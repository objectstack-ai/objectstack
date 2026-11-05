---
'@objectstack/cli': patch
---

feat(cli): `@objectstack/cli/scenario-score` publishes the deterministic scenario scorer — `scoreGraph`, `scoreGraphShape`, `deriveShape`, `artifactToEvalGraph` and `gradeRun`, with their types

Clause-②: yes
Metadata-protocol: none

A new subpath of the published package, in the shape of `./hook-body`: a dedicated entry that re-exports, by name, the five functions an eval harness needs to score a built metadata graph and grade an agent's answer, and the types their signatures name (`EvalGraph`, `EvalGraphField`, `EvalGraphNavEntry`, `ScenarioExpectation`, `ShapeExpectation`, `ScoreResult`, `CheckResult`, `RunTruth`, `TruthFigure`, `HiddenScope`, `RunTranscript`, `RunToolCall`, `RunGrade`). Until now the scorer shipped in the tarball under `dist/lint/` behind the sealed `exports` map, so a consumer outside this repository could not import it and kept its own copy instead, without the two fixes this one carries: a nav target now passes only when an app navigates to it, and a dashboard widget bound to a dataset the build does not carry fails its measure check.

```ts
import { artifactToEvalGraph, deriveShape, scoreGraphShape } from '@objectstack/cli/scenario-score';

const graph = artifactToEvalGraph(JSON.parse(readFileSync('dist/objectstack.json', 'utf8')));
const { score, checks } = scoreGraphShape(graph, deriveShape(expectation));
```

The helpers beside them stay internal. Nothing existing changes, and the `dist/lint/` paths stay sealed.
