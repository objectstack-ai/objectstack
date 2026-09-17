---
'@objectstack/lint': minor
---

`security-anchor-high-privilege` now reads the stack's own `capabilities:` declarations, so a declared app capability token on an `isDefault` set lints clean (#18535).

The rule holds an `isDefault: true` set to the `everyone`-anchor tier at authoring time, and ADR-0090 D5 puts 「带 package provenance 的应用声明 capability 令牌」 outside that tier's offending list. The rule called `describeAnchorForbiddenBits(ps, 'everyone')` with no `AnchorBindingContext`, so it reported an error for a set the runtime — once it reads the same declarations — binds without complaint. A lint that refuses what the runtime accepts is the drift ADR-0049 says not to ship, in the direction that is hardest to notice: the author never gets to the runtime.

`validateSecurityPosture` now builds the context from `stack.capabilities` and passes it at that one call site. Nothing else about the rule moves:

- an **undeclared** `systemPermissions` token still errors — membership in the declaration list is what excuses a token, not the presence of a `capabilities:` collection;
- a **platform** capability still errors even when the stack declares a capability of that name: the platform floor lives inside the predicate, shared with the runtime gate;
- a stack that declares nothing gets the pre-#17811 verdict verbatim.

**What changes for a consumer:** `os validate` (and any other caller of this rule) stops reporting `security-anchor-high-privilege` on an `isDefault` set whose `systemPermissions` names only capabilities the same stack declares. A stack that was editing its set to silence this rule can declare the capability instead — which is what the ADR asks for, since the declaration is what the runtime reads at boot.

Clause-②: yes (widening)
