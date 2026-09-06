---
"@objectstack/cli": patch
---

`os init -t app`, `os init -t plugin` and `os g object` now emit an object file that compiles. All three wrote `const … : Data.Object`, and `@objectstack/spec/data` exports no member named `Object`, so the first command a new user runs produced a project that failed its own `pnpm typecheck`.

Measured against the **published** package a real user installs (`npm pack @objectstack/spec@17.3.0`, extracted and linked into a driven emission), not against the workspace:

```
error TS2694: Namespace '.../@objectstack/spec/dist/data/index' has no exported member 'Object'
tsc exit 2
```

Identical at TypeScript 5.3.3, 5.8.3 and 6.0.3, so it was never a compiler-version effect. `os create example` type-checked clean on the same tarball in the same run — the failure was specific to these emissions.

The annotation is now `Data.ServiceObject`. That name was not chosen here — it is what [ADR-0122](https://github.com/objectstack-ai/objectstack/blob/main/docs/adr/0122-schema-type-alias-naming-convention.md) D1 already ruled: for a schema `XSchema`, the **bare** alias denotes the author state (`z.input<typeof XSchema>`), and it is "the name documentation, examples, skills and AI authoring surfaces use for the thing an author writes". An emitted scaffold is the thing an author writes, so the bare alias is the one it owes. The sibling generators were already on that convention — `UI.View`, `UI.Action`, `UI.Dashboard` and `Automation.Flow` are each the bare alias of their own schema — and only the object emitters had drifted off it.

**Nothing was added to `@objectstack/spec`**: `ServiceObject` has been exported from `@objectstack/spec/data` throughout.

The parsed-state alias is not an alternative here. Annotating the same emitted literal `Data.ServiceObjectParsed` fails all three cases with `error TS2740`, because every field literal is then missing the keys the schema supplies by default — which is exactly the author-state/parsed-state distinction ADR-0122 D2 draws.

`content/docs/deployment/cli.mdx` taught the broken spelling too, and is corrected with them — a reader copying from the docs wrote the same uncompilable line.

The whole emitter roster was swept rather than the three reported sites: driving every `os init` template and every `os g` generator through `tsc --noEmit` under the tsconfig the scaffolder itself writes, `Data.Object` was the only non-existent member any of them named. In particular `UI.View` and `Automation.Flow` — named alongside `Data.Object` in the docs line and explicitly not swept when this was reported — are genuinely exported, and their generators compile at exit 0.

Why nothing caught this: both existing scaffold sweeps are runtime pins that load the emitted TypeScript through esbuild, which erases type annotations **without checking them**, so a broken annotation transpiles to byte-identical JavaScript and is invisible to them by construction. The scaffolds parsed, validated and loaded; they simply did not compile. A new pin runs the emitted projects through a real `tsc` program, with a canary that must fail with TS2694 so the harness cannot pass by resolving nothing.
