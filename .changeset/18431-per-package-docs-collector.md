---
"@objectstack/cli": minor
---

Clause-②: yes

`os build` reads package docs from **each package directory** of an ADR-0130 layout — `src/<pkg>/docs/*.md` — and attaches them to the **owning package's body** (`packages[i].manifest.docs`), linted against **that package's own `namespace`** (#18431).

A module can now ship its own docs. Before this, ADR-0046 collection was anchored at exactly one path, `<config dir>/src/docs`, so an ADR-0130 project that moved its docs into their packages lost all of them — loudly since #18428, but lost. The maintainer's ruling (batch #147 item 4) decided the two contract questions that blocked the widening, and both are implemented literally:

- **Where they attach**: to `packages[i]`, ⛔ never the artifact top level. A body's docs are served because the load path **registers every body**: `AppPlugin` hands the whole artifact to `getService('manifest').register(…)`, which runs `resolveArtifactPackageOrder` (every package body, when `packages` is present) and calls `registerApp(body)` for each; `registerApp` feeds `registerMetadataCollections`, whose `METADATA_ARRAY_KEYS` carries `docs`. A doc written onto a body therefore reaches the registry under its owning package, so a flattened copy would buy nothing and would destroy the ownership D1 is about.
- **Whose namespace the lint uses**: the owning package's. A doc outside any package keeps `stack.manifest.namespace`. A multi-package artifact therefore has **one prefix rule per package** and ⛔ no single global prefix — and ⛔ no fallback between the two: a package doc that fails its own package's prefix is refused, never re-tried against the artifact's.

**What it costs — the refused classes measured here.** Three classes of input that `os build` accepted before are refused now. Each follows from the ruled prefix rule — the owning package's `namespace`, ⛔ with no fallback to the artifact's — reaching docs the artifact's own prefix used to judge, or docs the docs lint did not reach at all; each needs the artifact to carry a `packages[]`, which `composeStacks(…, { manifest: 'preserve' })` produces from N authored stacks and which a hand-written entry also parses into (`ArtifactPackageSchema`); and each is pinned in the unit tier rather than only stated here.

**(1) A package doc carrying the ARTIFACT's prefix instead of its own.** A package that declares a namespace DIFFERENT from the artifact manifest's used to have its docs judged by the artifact's prefix; they are judged by its own now.

```
FROM  packages[i] with namespace "sales" inside an artifact whose manifest.namespace is "crm"
      shipping a doc named  crm_orders_guide     -> accepted before, REFUSED now
TO    rename it to          sales_orders_guide   (and the file to sales_orders_guide.md)
```

The refusal is `docs/namespace-prefix`, an error, and it names that exact spelling.

**(2) A package that ships docs and declares NO namespace at all.** `manifest.namespace` is optional, so such a body is legal and its docs used to be judged under the artifact's prefix — the one global rule. With one prefix rule per package and no fallback, that package's own namespace is the only one that can answer for its docs, and ADR-0046 §3.2 requires it.

```
FROM  packages[i] with NO namespace, inside an artifact whose manifest.namespace is "crm",
      shipping docs (inline, or now from src/<pkg>/docs/)  -> accepted before, REFUSED now
TO    declare  namespace: "sales"  on that package — its docs then take the "sales_" prefix
      or move those docs up to the stack level, where stack.manifest.namespace still judges them
```

The refusal is `docs/namespace-required`, an error, located at `packages[i].manifest.namespace` — the key to add.

**(3) A hand-written `packages[i].manifest.docs` entry with no copy of that doc at the artifact top level.** `packages` is an authorable key of the stack definition, and its docblock says a hand-written entry still parses — it is an assembled body carrying no collections. That body admits every collection the artifact envelope does not keep for itself, `docs` among them, and `DocSchema.name` says a namespace prefix is "recommended, not required". Before this change nothing linted such a doc at all: the CLI's docs pass read the stack's own `docs` and `src/docs/` and never looked at `packages[]`, and no `@objectstack/lint` rule reads `.docs`, so `os build` exited 0 whatever the doc was called. Clause 2 makes it that package's doc, so every docs rule now reaches it under that package's namespace.

```
FROM  packages[i] with namespace "sales" carrying  docs: [{ name: "playbook", ... }]
      and NO copy of that doc at the artifact top level    -> exited 0 before, REFUSED now
TO    rename it to  sales_playbook  — or fix whichever rule the message names, because
      the whole docs lint reaches it now, not the prefix rule alone
```

The refusal for that example is `docs/namespace-prefix`, an error, at `packages[i].docs/playbook`. A doc name a sibling package also declares is a cross-owner `docs/duplicate-name`; an image is `docs/no-images`; and so on through ADR-0046's v1 bans.

⚠️ **Those are the refused classes this change MEASURED — ⛔ not a claim that they are all of them.** Two of the three were added after a contract review of this card falsified an earlier draft of this note that had called the list complete; the closed claim is therefore dropped rather than re-made one class further out. The boundary that is honest: every refusal above is ONE rule — a package's docs are judged by that package's own `namespace`, with no fallback to the artifact's (the ruling's clause 2) — reaching a set of docs it did not reach before, and a shape nobody has measured yet can meet that rule the same way. If a build that was green fails on a doc, read the rule id the message carries: `docs/namespace-prefix` wants the owning package's prefix, `docs/namespace-required` wants that package to declare a `namespace`, `docs/duplicate-name` names both owners, and the content rules (`docs/no-images`, `docs/no-mdx`, `docs/filename`, `docs/flat-directory`) are ADR-0046's v1 bans, themselves unchanged.

In the other direction the same change is a widening, and the larger half: before it a package's `src/<pkg>/docs/` was not read at all, and a package could not ship a doc under its OWN prefix. An artifact whose every doc is package-owned also no longer needs a `stack.manifest.namespace` of its own.

⚠️ Same-prefix LINKS and metadata-embed references are deliberately NOT partitioned with the naming rule — both resolve across the whole artifact. A doc's prefix says who judges its NAME; a link asks whether the target EXISTS, and ADR-0130 D1 exists so that N packages may share a namespace and cross-link inside it. Partitioning links too would have turned an ordinary cross-package link into `docs/broken-link` and stopped an artifact that built green from building; that was caught by this card's contract review and is pinned in the unit tier.

Also in this change:

- **The #18428 warning stays**, and now says *why* a directory was not read. Unchanged, word for word, for a stack that declares no `packages[]` — where "read from `src/docs/` only" is still the whole truth. For a directory that names **no** package it lists the declared packages and the two spellings a directory is matched against (`id`, and the last dot-segment of that `id`); for one that names **more than one** it names the candidates and refuses to guess. ⛔ `namespace` is not a matching spelling: ADR-0130 D1 exists so that N packages can share one, so matching on it would be ambiguous exactly where it matters.
- **A cross-owner duplicate doc name stays an error.** It PRESERVES a refusal rather than adding one: before the split every doc reached the lint in one flattened array, so two owners declaring one name already raised `docs/duplicate-name`. Splitting the set per package would have dropped that silently, and ADR-0130 D1 lets packages of one artifact share a namespace, so the prefix does not keep them apart. The rule is authoring hygiene — ⛔ not a claim that one registration overwrites the other, which ADR-0048 §3.3/§3.4 retired.
- **`os dev` mirrors `os build`.** The config-load path collects the same per-package directories onto the same bodies, so dev serves what a built artifact serves.
- **The step line counts the whole collection**, package sets included, and says how many came from package directories — a build that read four package docs no longer announces `0 collected`.

Single-package projects are untouched: with no `packages[]` there is nothing to attribute, the flat `src/docs/` keeps attaching exactly where it always did, and the emitted artifact is byte-identical.
