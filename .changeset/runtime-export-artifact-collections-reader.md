---
'@objectstack/runtime': patch
---

feat(runtime): export `resolveArtifactCollections`, the reader of every collection of a composed suite

Clause-②: yes (widening)
Metadata-protocol: none

`@objectstack/runtime` now exports `resolveArtifactCollections` (#32827). A suite composed with `composeStacks(packageStacks, { manifest: 'preserve' })` keeps each package's collections in that package's body, with no flattened copy, so `artifact.objects` alone reads none of them. `resolveArtifactCollections(artifact)` returns the artifact with every package-owned collection — objects, apps, flows, translations, hooks and the rest — merged across the top level and every `packages[]` body, the same merge the runtime's boot paths use. It is the route for an app's tooling (a whole-suite test view, a lint pass) that used a flat `composeStacks(packageStacks)` only to get one view of the suite's collections: a flat composition puts every package's app under one package id, which `composeStacks` refuses for a suite (`STACK_SINGLE_APP_VIOLATION`, ADR-0019 D3 as amended).

```ts
import { composeStacks } from '@objectstack/spec';
import { resolveArtifactCollections } from '@objectstack/runtime';

const suite = resolveArtifactCollections(composeStacks(packageStacks, { manifest: 'preserve' }));
```

Nothing that existed changes: an artifact with no `packages[]` comes back as the same object.
