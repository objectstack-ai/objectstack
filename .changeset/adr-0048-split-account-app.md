---
"@objectstack/account": minor
---

feat(apps): reclaim `@objectstack/account` for the console Account app (ADR-0048)

Removes the deprecated standalone account-portal SPA (`apps/account`) and
reclaims the `@objectstack/account` name for the console Account app as its own
ObjectStack package (`com.objectstack.account`, namespace `account`) per
ADR-0048 "one app per package". Boot-neutral skeleton (transitional import from
platform-objects; not yet wired into the dev/serve plugin set — that switch
lands in a follow-up verified against a live `os dev` boot).
