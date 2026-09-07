---
"create-objectstack": minor
---

`npx create-objectstack` now declares the same TypeScript range as `os init` and
`os create`, and the value is generated rather than restated.

Three scaffolders write a new project's `package.json`, and the range that
decides whether that project type-checks at all had split: `os init` and
`os create` emitted `typescript: ^5.3.0` from a shared emission policy, while
this package's bundled template carried `^6.0.0`. Two projects created the same
day got different TypeScript **majors** depending on which documented entry
point the reader followed.

- **What changed for a scaffolded project.** Its declared `typescript`
  devDependency floor moves from `^6.0.0` to `^5.3.0`. Both resolve to the same
  installed compiler on a fresh install; what moves is the floor the project
  **declares**, and a floor is a support promise. `^5.3.0` is the promise the
  docs already make — "ObjectStack works with TypeScript 5.3+" on the getting
  started page, "TypeScript 5.3.0 or later" in the deployment troubleshooting
  page — and it is measured rather than assumed: TypeScript 5.3.3 type-checks
  every shape these scaffolders emit with results identical to 6.0.3. The repo's
  own `typescript@^6.0.3` devDependency is deliberately not this value; the same
  doc sentence states both halves ("…but the project itself is built and tested
  against TypeScript 6.x"). `engines.pnpm` was already in agreement and is now
  held there by the same mechanism.
- **Why the value is generated.** This package cannot import from
  `@objectstack/cli`: the dependency edge runs the other way, and the `npx`
  package must not pull the CLI's package closure. So the values are stamped
  into the bundled template at build time by
  `scripts/sync-scaffold-emission-policy.mjs`, read out of the same
  `SCAFFOLD_*` constants the other two scaffolders import, and
  `pnpm check:scaffold-emission-policy` reddens the moment the inlined values
  disagree with that source. Editing the two into agreement by hand would have
  left them free to diverge again on the next move, silently, for the same
  structural reason — which is how they diverged the first time.
