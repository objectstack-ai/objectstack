---
"@objectstack/spec": minor
---

Schema-free `/meta` spelling entry, and the package becomes tree-shakeable (#10096, #10031).

- New fine-grained export `@objectstack/spec/meta-spelling`: the `/meta/:type`
  URL-spelling contract — `META_URL_TO_SINGULAR`, `canonicalMetaUrlType`,
  `metaUrlSpellingRefusal`, `unrecognisedMetaTypeRefusal` — importable for a few
  hundred bytes instead of the schema graph the same symbols cost through
  `/shared` (measured +246.9 KB minified / +69.7 KB gzipped marginal on a graph
  already carrying `/ui` + `/kernel`). `/shared` keeps all four symbols
  (re-exported from the one declaration); nothing moves or breaks.
- The map is now materialized at build time (`gen:meta-url-spelling`, gated by
  `check:meta-url-spelling`). The module-load `assertMetaUrlSpellingsAgree()`
  moved into that gate — same assertion, build-time enforcement home.
- `package.json` declares `sideEffects: false` (module-scope evaluation purity
  measured per entry), and emitted bundles carry `/* @__PURE__ */` on deferred
  schema construction, so consumer bundlers can drop schemas an entry never
  reaches instead of retaining a subpath's whole module graph.
- Standing principle recorded in the package docs: a browser-reachable spec
  export surface must be schema-free (maintainer ruling 2026-08-20, #10096).
