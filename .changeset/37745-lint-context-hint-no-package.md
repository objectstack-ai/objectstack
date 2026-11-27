---
'@objectstack/lint': patch
---

fix(lint): the `ai-skill-context-unknown` fix for two holders names no package when the stack has none

Clause-②: no
Metadata-protocol: none

A stack with no `manifest.id` whose skill `context` names a pack two packages of the artifact ship is refused by ADR-0150 D3 as `ambiguous-in-environment`. Its hint said "Keep one pack of that name in reach of this package", though the stack names no package. It now says "Keep one pack of that name across the artifact's packages, or name another pack". The rule id, the severity, the message and the hint of every other arm are unchanged.
