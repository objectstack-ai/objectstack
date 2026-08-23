---
"@objectstack/spec": patch
---

Declare the package's browser boundary in the `exports` map (#11072): the five
entries whose module graph reaches the driver-config validators (`.`, `./data`,
`./system`, `./kernel`, `./cloud`) now carry a `browser` export condition
pointing at bundles (`dist/browser/**`) in which the postgres `url`
refinement's pg-grammar arm is excluded. `pg-connection-string` — the parser
`pg` itself uses, and the one the #9091 refusal deliberately asks — statically
resolves `require('fs')`, so any browser bundler whose client graph reached one
of these entries failed on `Can't resolve 'fs'` (measured on objectui's docs
site, Next.js/Turbopack).

Patch, not minor/major, because the change is additive resolution surface with
zero Node-side movement: Node's resolver never matches `browser`, every
existing `import`/`require` condition still points at the same files, and the
full #9091 DSN refusal (multi-host, non-numeric port, scheme-less non-URL)
still runs for every Node consumer — the existing `postgres.test.ts` pins hold
it. In the browser-conditioned bundles the refinement degrades to the
shape-only checks it already performs before `parse` (the unix-socket
short-circuit and the fs-reading `?sslcert=`/`?sslkey=`/`?sslrootcert=`
refusal); publish-time validation never legitimately runs in a browser.

The boundary is enforced at this producer from now on:
`check:browser-reachable-entries` refuses any browser-resolvable bundle —
browser-conditioned or not — that links a Node builtin or a declared
server-only package, with a positive control on the Node side, so the next
Node-only import fails this package's own CI instead of a downstream bundler.
