---
'@objectstack/scenarios': patch
---

feat(scenarios): `skill-evals --case BUNDLE/FILE_STEM#ID[,…]` plans the named eval cases alone, so a single-case acceptance round runs from the committed command

Clause-②: no
Metadata-protocol: none

The skill-evals runner selected whole bundles (`--skills`, `--skills-from`, `--triggers-only`) and never one case, so a round on one case needed a driver of its own. `--case` takes case keys as the summary and every run record print them (`objectstack-ai/skills-tools-knowledge#6`): ids repeat across a bundle's eval files, so a bundle and an id alone would not name one case. The round plans only those cases, a behaviour case on both arms and a trigger case on the with-skill arm. A key that names no case is refused with where it stopped matching (the bundle, the eval file or the id, and the ones that exist). Beside `--skills`, every named case must be of a `--skills` bundle, and `--skills` still sets what a trigger turn installs; the flag is refused beside `--triggers-only`, `--regrade` and `--self-test`. `round.json` gains `scope.selectedCases` (additive; absent on every other round), the summary header lists the keys, and `--regrade DIR` keeps that scope instead of reading the rest of the bundle as cases added since. The runner's header comment and README now name the `must_contain_any` form, and the README shows the summary's unmet-group form as the renderer prints it, each token in a code span.
