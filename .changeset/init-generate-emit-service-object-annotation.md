---
"@objectstack/cli": minor
---

`os init -t app`, `os init -t plugin` and `os g object` now emit an object file that compiles. All three wrote `const … : Data.Object`, and `@objectstack/spec/data` exports no member named `Object`, so the first command a new user runs produced a project that failed its own `pnpm typecheck`.

Measured against the **published** package a real user installs (`npm pack @objectstack/spec@17.3.0`, extracted and linked into a driven emission), not against the workspace:

```
error TS2694: Namespace '.../@objectstack/spec/dist/data/index' has no exported member 'Object'
tsc exit 2
```

Identical at TypeScript 5.3.3, 5.8.3 and 6.0.3, so it was never a compiler-version effect. `os create example` type-checked clean on the same tarball in the same run — the failure was specific to these emissions.

The annotation is now `Data.ServiceObject`, which is `z.input<typeof ObjectSchemaBase>` — the authoring shape of an object, and the exact structural analogue of the annotations the sibling generators already emit (`UI.View`, `UI.Action`, `UI.Dashboard`, `Automation.Flow` are each the `z.input` of their own schema). **Nothing was added to `@objectstack/spec`**: `ServiceObject` has always been exported from `@objectstack/spec/data`, and the hand-written docs already annotate authored objects with it (`concepts/metadata-driven.mdx`, `getting-started/quick-reference.mdx`). The scaffolders had simply drifted off the spelling the rest of the repo uses.

`content/docs/deployment/cli.mdx` taught the broken spelling too, and is corrected with them — a reader copying from the docs wrote the same uncompilable line.

The whole emitter roster was swept rather than the three reported sites: driving every `os init` template and every `os g` generator through `tsc --noEmit` under the tsconfig the scaffolder itself writes, `Data.Object` was the only non-existent member any of them named. In particular `UI.View` and `Automation.Flow` — named alongside `Data.Object` in the docs line and explicitly not swept when this was reported — are genuinely exported, and their generators compile at exit 0.

Why nothing caught this: both existing scaffold sweeps are runtime pins that load the emitted TypeScript through esbuild, which erases type annotations **without checking them**, so a broken annotation transpiles to byte-identical JavaScript and is invisible to them by construction. The scaffolds parsed, validated and loaded; they simply did not compile. A new pin runs the emitted projects through a real `tsc` program, with a canary that must fail with TS2694 so the harness cannot pass by resolving nothing.
