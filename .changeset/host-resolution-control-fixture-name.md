---
'@objectstack/verify': minor
---

verify: let `bootStack` be told which package `multiTenant: true` resolves, so the
`declared-unresolvable` control can name a subject the workspace can never supply

`BootOptions` gains an optional `organizationsPackage`. It defaults to
`@objectstack/organizations` and production callers never pass it — the
operator-facing error still names that package literally, because in every
production boot it is the subject. Only the specifier moves.

Why it exists: a fixture whose whole content is "this host root DECLARED the
package and does not have it" cannot state the second half with a name the
workspace owns. Since ADR-0132 the multi-org runtime is a tracked workspace
package, pnpm's hoisted store carries it, and a `pnpm exec`-launched runner
exports a `NODE_PATH` that reaches that store — so such a fixture resolved the
package out of the ambient workspace the moment it had been built, and its
verdict became a function of an unrelated package's build state rather than of
its own directory. The harness's own host-resolution control now hands in a
`@fixture/*` name and proves the absence instead of assuming it, the repair
already landed for `packages/qa/dogfood` and `packages/types`.
