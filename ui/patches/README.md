# Dependency patches

Patches applied to third-party packages at install time via pnpm's
[`patchedDependencies`](https://pnpm.io/package_json#pnpmpatcheddependencies)
(declared in the root `package.json`).

A patch here is a **temporary** workaround for an upstream bug we cannot wait on.
Every entry must name the upstream issue and the condition under which it is
deleted. Patches only affect builds produced from this repo (the console we
ship); consumers installing `@object-ui/*` straight from npm get stock upstream
until the fix lands there.

To edit a patch: `pnpm patch <pkg>@<version>`, change the files in the scratch
dir pnpm prints, then `pnpm patch-commit <dir>`. To drop one: remove the file,
its `patchedDependencies` entry, and re-run `pnpm install`.

> A version bump that makes a patch stop applying fails `pnpm install` outright.
> That is intentional — it forces a human to re-check whether the upstream bug is
> actually fixed before the patch is silently migrated forward.

---

## `@radix-ui__react-focus-scope.patch`

| | |
|---|---|
| Package | `@radix-ui/react-focus-scope@1.1.16` |
| Tracking | objectui#3183 |
| Remove when | upstream `radix-ui/primitives` cancels the pending stack eviction on an effect re-run |

`FocusScope`'s stack effect schedules `focusScopesStack.remove(scope)` inside a
`setTimeout(0)` cleanup. When the effect re-runs for a **still-mounted** scope (a
`container` ref flicker), the re-run re-`add`s the scope and the stale timeout
from the previous cleanup then evicts it. The scope's focus-trap listeners stay
alive while the scope is gone from the stack, so a popover opening on top of it
pauses nothing and the trap yanks focus back out of the popover forever — in the
production console this made a lookup field's search box untypeable inside a
create/edit modal.

The patch stores the pending timeout on the scope and clears it when the effect
re-runs for a live scope. A real unmount is untouched: nothing re-runs to cancel
it, so the delayed cleanup still dispatches `focusScope.autoFocusOnUnmount` and
removes the scope from the stack.

Regression coverage:
`packages/components/src/__tests__/dialog-popover-focus-scope.test.tsx` — the
first case reproduces the race deterministically and fails against stock radix.
Re-run it after any `@radix-ui/*` bump; if it passes with the patch removed,
upstream has fixed it and this patch should go.
