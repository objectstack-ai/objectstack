---
"@objectstack/metadata": patch
---

fix(metadata): `MetadataPlugin`'s `watch` option defaults to `false`, as its own doc comment documents (#9770)

`MetadataPluginOptions.watch` documents its default as ``Default: `false` (post PR-10e —
was previously `true`)``, directly above the field. The constructor implemented the
opposite, and it did so in **two** places, so both entry shapes resolved `true`:

- the options literal `{ watch: true, ...options }` — covering a caller who **omits** the key;
- the fallback `this.options.watch ?? true` — covering a caller who passes an explicit
  `undefined`.

Both non-test construction sites in this repo pass `watch: false` explicitly and are
unaffected either way, which is exactly why the drift was invisible to every test and
gate: no in-repo configuration exercised the default. `MetadataPlugin` is a public export
(`@objectstack/metadata`, `@objectstack/metadata/node`), so the consumers who did reach it
were **external** ones — and they reached it by doing the documented-safe thing and not
naming the key at all. What they got was the configuration both internal call sites go out
of their way to refuse, citing an **EMFILE** hazard at both: a recursive chokidar poll
(`usePolling: true, interval: 1000`) over the entire project root, with `node_modules`
excluded only by chokidar's default `ignored`.

The default now resolves `false`. The flag is normalized once in the constructor
(`watch: options.watch ?? false`) rather than spelled `{ watch: false, ...options }`,
because a spread preserves an explicitly-passed `undefined` verbatim and not every read of
the flag routes through a nullish fallback — the `start()`-time `FileSystemRepository`
`disableWatch` keys on `=== false`. Coercing once makes an omitted key and an explicit
`undefined` resolve identically at every downstream read, instead of trading one
two-spelling divergence for another.

This is a default flip, **not** a capability removal: an explicit `watch: true` still
attaches the scanner and its watcher, and the sealed-runtime carve-out
(`bootstrap: 'artifact-only'` forces watching off even against an explicit `watch: true`)
is untouched. Pins cover all four shapes, asserting on the **observable** — whether a
watcher object exists on the manager — rather than on the resolved options value alone.
