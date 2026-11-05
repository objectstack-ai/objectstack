---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol): an email template at a locale the base does not ship keeps its package-less write on a fresh install; the named-base refusal names `os migrate packageless-overlays`

Clause-②: no
Metadata-protocol: semantic

- **An added locale is writable before the pair exists.** Both overlay-write closes (the package-less write, and the write naming the read-only base with `?package=<base>`) stay open where the fix they would name cannot be taken: an `email_template` member at a locale the base does not ship is refused as a declared override, so its write stays open (ADR-0146 D11). The close asked the override write gate about the pair; on a fresh install the pair is not ensured yet, the gate's closure read answers nothing for a package that does not exist, and the close read that "not concerned" as "admitted". So `PUT /api/v1/meta/email_template/<name>` with a zh-CN body beside a base that ships en-US only answered `403 NOT_OVERRIDABLE`, naming a pair write that was refused too (`declared_package_ships_no_such_item`). The close now judges a pair that is not installed with the closure the ensure door gives it (the base and what the base reaches), so the write is accepted, as it is once the pair exists. A member the base ships is closed exactly as before.
- **The named-base refusal names the ceremony.** `os migrate packageless-overlays` moves a row stored bound to the read-only base into the pair with its declaration. The sentence for a save, publish or rollback naming the base now says such a row "is served until moved by `os migrate packageless-overlays`, overridden by the pair, or deleted naming the base". One spelling, every door; the code and status (`403 NOT_OVERRIDABLE`) are unchanged.
