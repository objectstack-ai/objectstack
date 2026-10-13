---
'@objectstack/cli': patch
---

fix(cli): a hook that destructures a renamed key off `ctx` is no longer refused as not-lowerable (#22459)

Clause-②: no

- **What changed.** The free-identifier scan behind `objectstack lint`'s `hook-body/not-lowerable` rule and `objectstack build`'s hook lowering counted a renamed destructuring key as a free identifier. For `const { event, input, previous: prev } = ctx`, it reported `previous`, a property read off `ctx`, although the only name the pattern binds is `prev`. So `objectstack lint` failed the hook with the advice "reach them through `ctx`", which the hook already did, and `objectstack build` shipped it as a bundled closure instead of a metadata-only body. A non-computed destructuring key is now a key, as the key of `{ key: value }` already was. Nested patterns (`{ a: { b: c } } = ctx`), patterns inside array patterns, the parameters of a callback inside the handler, and `catch` clauses are covered by the same rule.
- **What is still refused.** A destructuring default or a computed key that names something out of scope is still free: `const { key: alias = FALLBACK } = ctx` and `const { [KEY]: v } = ctx` report `FALLBACK` and `KEY`, as before. A genuinely free `previous` that is not read off `ctx` is still refused.
- **What to do.** Nothing. A hook written this way now lowers to a body on the next `objectstack build`, and `objectstack lint` stops reporting it. The un-renamed spelling (`const prev = ctx.previous`) keeps working as before.
