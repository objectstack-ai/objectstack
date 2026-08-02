---
'@objectstack/lint': minor
---

Nav targets that are not object names (`page` / `report` / `dashboard`) are now checked at author time — closing a hole *inside* an existing check.

`defineStack`'s `validateCrossReferences` already validates these three. But each arm is gated on the collection being non-empty:

```ts
if (nav.type === 'page' && typeof nav.pageName === 'string'
    && pageNames.size > 0 && !pageNames.has(nav.pageName)) { … }
```

So a stack that declares **no `pages` at all** has its page-nav check silently switched off, and `{ type: 'page', pageName: 'anything' }` sails through. That is exactly the state a stack is in when the target was never written — the most likely way to reach this bug, not the least.

Note the asymmetry the guard creates. The `object` arm of the same block has no size gate: it errors unless the item carries `requiresObject`, an **explicit** opt-in to "another package provides this". Objects have to say so out loud; pages, reports and dashboards got an implicit exemption that depends on an unrelated property of the stack.

`validateNavTargetRefs` joins `REFERENCE_INTEGRITY_RULES` (16 → 17), so it runs on `validate`, `lint` and `compile` with no CLI rewiring. It reports **warning**, not error, and that ceiling is deliberate: `validate-object-references` can say ERROR for an unresolved *object* because it resolves against the curated `PLATFORM_PROVIDED_OBJECT_NAMES` registry and knows which cross-package names are real. No such registry exists for pages, reports or dashboards, so "unresolved" cannot honestly be distinguished from "provided by a package we cannot see". Fixing the guard by tightening the parse-time throw was the other option and was rejected: a throw has no escape hatch for a legitimately cross-package page, and ADR-0072 D1's rule is that one dead finding costs more than a missed one. When `defineStack`'s check *is* live it still hard-fails first; this rule is what speaks when that check has switched itself off, and it says so in the message.

**Three nav types are deliberately NOT covered, each verified rather than assumed:**

- **`action`** — already owned by `validate-action-name-refs`, which walks app navigation explicitly. Adding it here would double-report.
- **`component`** — a verified NON-rule. An unregistered `componentRef` does *not* fail silently: `ComponentNavView` renders a named diagnostic ("Component not registered … Ensure the plugin that provides this surface is installed and has called `registerAppComponent()`"), and the registry exists precisely so plugin-provided surfaces may legitimately be absent. Flagging it would break valid plugin nav and prescribe a fix for something already reported better at runtime.
- **`url`** — external by definition.

Both NON-rules are pinned by tests, so "completing" the module by adding them fails there first.

**Scope honesty:** all 35 authored nav page/report/dashboard targets in this repo resolve, so this closes a latent hole rather than a shipped bug. The rule was proven to go red and then green through the real `validateReferenceIntegrity` entry point on a known-bad stack, not only in unit tests — a green check that has never been made to fail is the recurring defect this campaign keeps finding in its own instruments.
