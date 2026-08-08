---
'@objectstack/spec': minor
'@objectstack/plugin-security': minor
---

security: add a fail-closed authored-row-write verdict to `ISecurityService`

`ISecurityService` gains an optional, verdict-shaped, by-id method:

```ts
checkAuthoredRowWrite?(
  object: string,
  recordId: string,
  operation: AuthoredRowWriteOperation, // 'update' | 'delete'
  context?: SecurityContext,
): Promise< AuthoredRowWriteVerdict >;  // 'admit' | 'abstain'
```

It answers one question no existing surface could: does an **app-authored**
row-level security policy admit this row for this write, on its own, with the
platform's ownership floor taken out by provenance?

Every other method reports the **composed** RLS verdict, and sitting inside that
composition is the platform's own wildcard write floor (`created_by ==
current_user.id`, shipped on the `member_default` baseline every authenticated
member resolves additively). So "the composed RLS admits this row" is true for
the row's CREATOR whether or not any app policy mentions it — which makes it a
measurably different question, not a cheaper spelling of the same one. A caller
deferring to the composed answer would hand transferred records back to their
former creators.

`admit` iff at least one applicable, non-floor policy matches the row for the
operation. `abstain` in every other case — no authored policy, no match, an
unreadable or cross-tenant row, a principal-less or on-behalf-of context, or any
internal failure. The method never throws outward, and it is **optional**: a
deployment whose security service omits it behaves byte-for-byte as before,
because callers feature-detect and read absence as `abstain`.

`@objectstack/plugin-security` implements it on the registered `security`
service, reading the verdict off the same layered RLS computation the middleware
enforces with — no second RLS evaluator.
