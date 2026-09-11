---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': patch
'@objectstack/runtime': patch
'@objectstack/verify': patch
---

`@objectstack/spec/kernel` exports `SEED_WRITE_EXECUTION_CONTEXT`, the one spelling of the seed-write posture every seeder now reads

The execution context a seed write must use — `isSystem`, `skipTriggers`,
`seedReplay` — had **no exported form**, so every seeder held a private copy of
it and nothing held the copies equal. There were three on `main`:
`SeedLoaderService.SEED_OPTIONS` (`@objectstack/metadata-protocol`),
`SEED_WRITE_OPTIONS` (`@objectstack/runtime`'s `AppPlugin`, whose own docblock
already recorded that it "mirrors" the first) and `SEED_CONTEXT`
(`@objectstack/verify`'s fixture writer, which spelled it a third time
specifically because the runtime kept its copy module-private).

**Why a shared constant rather than three accurate copies.** `skipTriggers` is
what suppresses "on create" automation for seed rows, and `isSystem` alone does
**not** suppress dispatch. A seed path that lost that flag once seeded with
automation live while the main path had it suppressed — a self-trigger loop that
wedged first boot (#3760). A constant whose divergence re-opens a boot-wedging
defect is a kernel semantic, not a local detail.

**What is exported, and what deliberately is not.** The **inner**
`ExecutionContext` value, and nothing wrapped around it:

```ts
import { SEED_WRITE_EXECUTION_CONTEXT } from '@objectstack/spec/kernel';

await ql.insert(object, rows, { context: SEED_WRITE_EXECUTION_CONTEXT });
```

The `{ context: … }` options bag stays at the call site. It is what all three
sites ultimately hand to `insert`, but it is an options envelope rather than the
posture: its type differs per engine method, so freezing one bag onto the
protocol surface would serve `insert` and no other operation, and it is
precisely the convenience bundle this export is not.

⛔ **No behaviour change.** The value is byte-identical to all three previous
copies, the three flags keep their existing meanings, and no seed path changes
what it writes or how. The three former copies now read this export, so the two
option bags are `{ context: SEED_WRITE_EXECUTION_CONTEXT }` and the `verify`
context is the export itself.

**Additive, so `minor` on `@objectstack/spec`**: one new name on the existing
`./kernel` entry point, no existing export removed, renamed or narrowed. The
three consumers take `patch` — their published `dist` changes (an import edge,
and the constant now resolves through `@objectstack/spec/kernel`) while their
own public surfaces do not move.
