---
"@objectstack/service-settings": patch
---

test(service-settings): resolve the remaining three workspace deps from source, emptying this package's `check-test-source-alias` registry entry (#8104)

#8063 gave this package its first `vitest.config.ts` and aliased two workspace
deps to source (`@objectstack/objectql`, `@objectstack/core`) — the two that
gate named when the package's first real-engine test landed. The other three,
`@objectstack/spec`, `@objectstack/platform-objects` and `@objectstack/types`,
stayed on their registered entry in `KNOWN_UNALIASED_TEST_IMPORTS` and kept
resolving through `exports` to **`dist/`**. They are now aliased to source and
the entry is deleted.

**How much of the suite was actually reading the artifact: 17 of 20 files.**
Measured, not inferred — with the three `dist/` trees removed from the checkout
and the pre-#8104 config in place, 17 test files fail to load at all
(`Cannot find package '@objectstack/spec/system'`) and only 58 of 413 cases run.
With the aliases below, the same tree with no `spec`, `platform-objects` or
`types` build output anywhere passes 413/413. The build artifact is off the
resolution path rather than merely shadowed by a fresh copy of it.

**The subpath entry points were the whole job, and the obvious shape does not
do it.** This package imports **no bare** `@objectstack/spec` and **no bare**
`@objectstack/platform-objects` at run time. Every specifier its tests can reach
for those two is a subpath — `spec/api`, `spec/contracts`, `spec/data`,
`spec/system`, `platform-objects/system` — joined by `spec/security`, reached
transitively through `@objectstack/types` ([ADR-0105 D1] tenancy posture) once
types itself resolves to source. So the two shapes that suggest themselves both
fail, in opposite directions:

- the **object** form matches by **prefix**, so a bare key whose replacement is
  a file swallows the subpaths into `…/index.ts/system` — `ENOTDIR` at run time
  in a config that reads as correct (#7778);
- the **anchored bare** form (`/^@objectstack\/spec$/`, the shape #8063 left
  behind) does not swallow them but does not **cover** them either — all six
  specifiers stay on `dist` and the registry entry cannot come off.

What covers them is a subpath rule. `spec` takes the one-rule-for-all-namespaces
form `/^@objectstack\/spec\/([a-z-]+)$/` with the capture group inside the path,
because its export map is uniform (`src/<ns>/index.ts` throughout) — so a new
namespace import cannot make it stale. `platform-objects` gets an **explicit**
`platform-objects/system` entry instead, because its map is *not* uniform:
`./plugin` is `src/plugin.ts`, a file, so a `([a-z-]+)` rule would send
`platform-objects/plugin` to `src/plugin/index.ts`, a path nobody wrote, failing
on whoever next adds that import. `plugin-audit` writes its
`platform-objects/audit` entry the same way for the same reason.

**The registry deletion is half the change, not its cleanup.**
`KNOWN_UNALIASED_TEST_IMPORTS` is audited for set equality in both directions,
so the two halves constrain each other and neither is green alone: with the
aliases complete and the entry still present the gate fails *"registry entry is
no longer needed … Delete the entry"*; with the entry deleted and any one alias
missing it fails *"tests import 1 workspace package(s) that resolve to `dist/`
with no source alias"*. The gate goes from 62 registered packages to 61.

No test turned red and no assertion moved: 413 passed / 20 files before and
after, and **no change under `src/`**. That is the expected reading for a
checkout whose `dist` was built from the same commit — dist and source agree
here, which is exactly the condition under which the old setup looked fine. What
changes is that the suite no longer has an opinion about build state at all.
