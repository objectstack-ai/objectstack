# @objectstack/scenarios

Private, unpublished. The schema (zod) and loader for the open scenario library under
[`docs/qa/scenarios/`](../../../docs/qa/scenarios/README.md) — that README is the format's
reference.

```ts
import { loadScenarios, readCapabilityAreas, formatRefusal } from '@objectstack/scenarios';

const areas = readCapabilityAreas('docs/qa/platform-checklist/areas');
const { cards, refusals } = loadScenarios('docs/qa/scenarios', { areas });
for (const r of refusals) console.error(formatRefusal(r)); // FILE: FIELD.PATH: message
// cards[i].truths[questionId] → the question's computed truth
```

- `src/schema.ts` — the card shape, one strict zod object per layer.
- `src/truth.ts` — evaluates a declarative truth spec over seed rows; refuses a truth the
  seed does not determine.
- `src/loader.ts` — reads a directory of cards, validates shape and cross-references, and
  returns typed cards or located refusals.

No build step (`exports` points at `src`), and nothing here calls a model or the network.
