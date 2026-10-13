---
"@objectstack/cli": patch
---

fix(cli): plugin scaffolds declare `vitest ~4.0.0`, so `npm install` works on npm 10

Clause-②: no

`objectstack init -t plugin` and `objectstack create plugin` now declare `vitest ~4.0.0` instead of `^4.0.0`. With `^4.0.0`, a fresh `npm install` of the emitted project crashed on npm 10, the npm that Node 22 bundles, with `Cannot read properties of null (reading 'edgesOut')`. npm 11 was not affected.

The cause is upstream. vitest 4.1.x accepts vite 8, and vite 8's optional devtools peers lead back to a `vitest@*` peer that npm 10 cannot resolve against an older vitest at the root. vitest 4.0.x accepts only vite 6 or 7, which carry no such peer. A scaffolded project now installs vitest 4.0.18 with vite 7.3.7 on npm 10 and npm 11.

Projects that were already scaffolded are unchanged. If one of them fails to install on npm 10, change its `vitest` devDependency to `~4.0.0`, or install with npm 11.
