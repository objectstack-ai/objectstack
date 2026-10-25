---
"@objectstack/console": patch
---

Console (objectui) refreshed to `b41ed7f68956`. Frontend changes in this range:

Derived from the changesets objectui declared over the range — 9 releasing of 10 changesets added across 15 non-merge commits; omitted: 1 release-nothing changeset, 6 commits carrying no changeset (they ship no package code).

- **minor** — The Console's first page load no longer downloads the chat UI (objectui#13410). The `plugin-chatbot` chunk (169.6 KB gzipped, the third-largest eager chunk) and most of `vendor-ma… (objectui `47138b718`)
- **patch** — Clause-②: yes Metadata-protocol: none (objectui `b41ed7f68`)
- **patch** — Clause-②: no Metadata-protocol: none (objectui `cd70b7818`)
- **patch** — Clause-②: no Metadata-protocol: none (objectui `cd70b7818`)
- **patch** — The `@objectstack/*` pin moves from `915e940499` to objectstack `e649c2d91e`, the 18.1.0 release commit (objectstack#25606), past objectstack#25483 and objectstack#25564, which sh… (objectui `0984c77e1`)
- **patch** — A `type: 'form'` action fired inside an app opens its form inside that app, headed by a label, with a Cancel (objectui#13433). (objectui `576fd257d`)
- **patch** — A create form no longer locks fields through `readonlyWhen`. The server does not apply `readonlyWhen` on insert, but the form evaluated it against the seeded defaults, so a predic… (objectui `a78608f38`)
- **patch** — `html` and `richtext` values are now sanitized with `rehype-sanitize`, the sanitizer the `markdown` pipeline already used, instead of a hand-written pattern filter. (objectui `f3044f708`)
- **patch** — Settings: a setting's `visible` predicate is evaluated with the renderer's expression interpreter, and a predicate that does not evaluate hides the setting. (objectui `06ce712fc`)

**In this console build, declared nowhere** — objectui merged 6 commits in this range with no `.changeset/*.md`. The code is inside the pin above and ships here, but nothing upstream declared them, so they appear in no objectui CHANGELOG and in no entry above. Listed by subject rather than counted, because a count cannot tell a dependency bump from a form-behaviour change (objectstack#6174); the upstream gate that would prevent this is objectui#3387.

- _(no changeset)_ chore(test): refresh the per-file test timings (objectui#12208) (#13028) (objectui `723776b5b`)
- _(no changeset)_ chore: release packages (#13289) (objectui `a3c0da922`)
- _(no changeset)_ ci: pin credential-holding third-party actions by sha and default ci.yml and check-links.yml to a read-only token (#13430) (objectui `798138418`)
- _(no changeset)_ fix(ci): the affected-tests fast path runs: the shard step compares the output value, not the selector's key=value line (objectui#13350) (#13358) (objectui `861fdff76`)
- _(no changeset)_ ci(test-shard-timings-refresh): push and open the refresh pull request as the fleet App so it runs CI (#13362) (objectui `cf2419005`)
- _(no changeset)_ ci(repo-gates): restore the build's turbo cache, save and prune on push only (#13360) (objectui `3688e5cd4`)

Metadata-protocol: none (the console refresh changes no key, value or type a metadata author writes)

objectui range: `2958f17e9c6a...b41ed7f68956`
