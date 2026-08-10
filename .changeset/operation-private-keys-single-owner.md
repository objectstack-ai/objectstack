---
"@objectstack/core": patch
"@objectstack/plugin-audit": patch
"@objectstack/service-storage": patch
"@objectstack/plugin-reports": patch
---

refactor(core,plugin-audit,service-storage,plugin-reports): give the `__` operation-private-key convention a single owner (#7284)

`withoutOperationPrivateKeys` — the rule that a consumer forwarding a caller's
execution envelope to a question about a DIFFERENT object must first drop the
`__`-prefixed keys plugin-security stamped for the operation in flight — had been
hand-copied into three packages: `plugin-audit`'s comment access hooks (#7141),
`service-storage`'s attachment access hooks (#7145) and `plugin-reports`' report
service (#7204). Each carried its own `OPERATION_PRIVATE_KEY_PREFIX` and its own
doc block, and the prose had already diverged while the code still agreed — the
shape that makes a later divergence in behaviour hard to notice.

The helper now lives once, in `@objectstack/core`
(`security/operation-private-keys.ts`), exported from the package root. Core is
the only candidate all three consumers already depend on: `plugin-security` is
the producer of the convention and the most honest owner, but none of the three
depends on it and a string-prefix filter does not justify three new dependency
edges onto a plugin; `@objectstack/spec` is fenced off by Prime Directive #2. The
new home sits beside `assemble-execution-context.ts`, which owns the other end of
the same lifecycle — that file is where an `ExecutionContext` is built at a
transport entry point, this one is where it is stripped back down before being
forwarded.

The full reasoning moved with the code rather than being thinned: which keys the
middleware stamps and why each is a widening input, why they are dropped by
PREFIX and never by a name list, and why the fresh copy is load-bearing in both
directions. Each consumer keeps only its own local half — which object *its*
gates actually ask about — and points at the shared home.

No behaviour change: the three copies were byte-equivalent, and all three
packages' suites pass unchanged. Two new pins at the home cover it — the rule's
own behaviour, which no package-level test had ever asserted directly, and a
repository-shape pin that turns red if a fourth file declares its own copy.
