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
| Tracking | objectui#3183, objectui#13466 (stack race); objectstack#33980 (mutation handler) |
| Upstream | [radix-ui/primitives#4226](https://github.com/radix-ui/primitives/issues/4226) (stack race, same root cause, Suspense trigger); related, closed: [radix-ui/primitives#4148](https://github.com/radix-ui/primitives/issues/4148). Mutation handler: no upstream issue filed |
| Last measured | 2026-10-25: stock `1.3.1` with the patch removed fails the race case (1 failed / 2 passed) |
| Remove when | both halves are fixed in a released `@radix-ui/react-focus-scope` and every regression case below is green on that release with this patch removed; a release fixing only one half keeps the other hunk |

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

The second hunk is in the trap's `MutationObserver` callback. Stock radix
focuses the container whenever a node under it is removed while focus sits on
`body`, reading that as "the focused element was removed". Between the blur and
the focus of a native Tab, focus does sit on `body`, so a node that a blur
unmounts — an inline tooltip closing under its trigger — pulled focus back to
the container and Tab could never leave that trigger (the import wizard's
Save-current reason, the Manage Views rows' Pin and Set-as-default buttons). The
patch refocuses the container only when the last focused element is no longer
inside it, which is the case the callback exists for: the focused element (or
an ancestor) was itself removed.

Regression coverage:
`packages/components/src/__tests__/dialog-popover-focus-scope.test.tsx` — the
first case reproduces the race deterministically and fails against stock radix;
the mutation-handler block's first case fails against stock radix and its
CONTROL (the focused element itself removed) passes either way. Native-keyboard
coverage of the mutation handler, which happy-dom cannot give:
`e2e/import-wizard-keyboard-tab-order.spec.ts` and
`e2e/manage-views-keyboard-tab-order.spec.ts`. Re-run them after any
`@radix-ui/*` bump; if they pass with the patch removed, upstream has fixed it
and this patch should go.
