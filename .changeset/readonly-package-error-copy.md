---
"@objectstack/metadata-protocol": patch
---

Rewrite the `writable_package_required` rejection message as user-facing remediation ("switch to a writable package in the package selector, or create a new one") instead of developer-facing copy that cited an internal ADR path — the message is surfaced verbatim as a Studio toast. The ADR pointer moves to a `docs` property on the error; `code`, `status`, and `packageId` are unchanged.
