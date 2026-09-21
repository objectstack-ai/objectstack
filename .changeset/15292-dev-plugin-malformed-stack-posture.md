---
"@objectstack/plugin-dev": patch
---

`DevPlugin`'s boot posture on a malformed stack is now written down: dev boot tolerates and reports; `os validate` / build / publish refuse (#15292).

Clause-②: no

No behaviour changes. `DevPlugin` already degraded a stack the platform would reject, and the posture — ruled, not invented here — is that it should: the contract refuses at the production door, while the developer's inner loop tolerates incomplete input and never hides it. Metadata that is incomplete halfway through an edit is the normal state of a project under active development, so refusing at dev boot would charge the cost to the only user group this plugin exists for, for a consistency the production doors already provide. What was missing was the written posture and one load-bearing correction to it.

- **The two branches are not one defect handled two ways.** `new AppPlugin(stack)` reads `manifest.id` / `manifest.name` and nothing else; `collections` is a lazy getter first touched in `init()`. A malformed `packages[]` therefore passes the constructor untouched and is refused one branch later, from `AppPlugin.init()`, inside `DevPlugin`'s child-`init()` loop. The in-file comment reading *"a malformed stack throws HERE"* overclaims for that reason, and is corrected.
- **The two malformations are exact complements, measured with a lit control.** An app payload with no `manifest.id` / `manifest.name` throws from the constructor (a bare `Error`, no ADR-0112 `code` / `status`) and is invisible to the package-list parse; a `packages[]` entry that is not a package entry (ADR-0130 D4) is invisible to the constructor and refused by the parse as `INVALID_ARTIFACT_PACKAGE_ENTRY` / `422`. A stack carrying neither is silent on both. So a clean boot past one branch is no evidence about the other — which is why the division is now documented rather than left to be re-derived.
- **Tolerating is not hiding.** The posture's second half is that a boot which skipped something is never byte-identical to a healthy one: a silent degrade lets an author, or a coding agent, read "it started" as "I wrote it correctly".
- **What ships**: the `DevPlugin` docblock (which reaches the published `dist/*.d.ts`) and `content/docs/plugins/packages.mdx`, plus a test pinning the posture and its division. The wording of the malformed-metadata diagnostic itself is deliberately not pinned — that text is a sibling change.
