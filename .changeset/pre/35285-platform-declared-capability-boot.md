---
'@objectstack/skills': patch
---

docs(skills): `objectstack-platform` says which declared capabilities fail the boot and which only warn

Clause-②: no
Metadata-protocol: none

The "Declaring is a demand" rule taught that any capability an app declares in `requires` with its provider package absent is a hard boot error. `os serve` does that for the tokens of the provider table and for `ai` / `ai-studio`. A declared enterprise or cloud token (`hierarchy-security`, `ai-seat`, `governance`, `audit-compliance`, `access-policy-console`) with no provider only prints a warning and the boot goes on; for `hierarchy-security` the hierarchy-relative scopes then fall back to owner-only. The rule now says so, so an agent no longer reads a clean boot as proof that those scopes are enforced, nor tells a user the app will refuse to start when it starts with narrower visibility.

Two restatements in the same file were cut to pay for the sentence.
