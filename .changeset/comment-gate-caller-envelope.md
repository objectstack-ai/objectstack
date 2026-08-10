---
"@objectstack/plugin-audit": patch
---

fix(plugin-audit): forward the caller's full execution envelope to the `sys_comment` sharing gates (#7141)

`callerContext()` in `comment-access-hooks.ts` rebuilt a five-field projection
of the caller's `ExecutionContext` (`userId` / `tenantId` / `positions` /
`permissions` / `isSystem`) before handing it to `ISharingService.canEdit`,
whose contract declares the **full** envelope and whose doc block tells callers
they "MUST NOT rebuild a subset of it" (#6523 / the #6206 ruling). #7136 (PR
#7140) widened the return *annotation*; this is the body.

The projection was doing two jobs at once and only one of them was correct:

- **Dropping the middleware-private keys was correct**, and is preserved.
  plugin-security's middleware stamps the access DEPTH it resolved for the
  object of the operation in flight — `sys_comment` — onto the context in place
  (`sc.__readScope = …`), while these gates ask the sharing service about the
  **parent record's** object. Forwarding that whole would hand one object's
  widening to another object's owner-match, the stale-scope leak
  `resolveWriteScopeForSharing` was extracted to prevent. The keys are now
  dropped by the `__` **prefix** rather than by name, which also covers the
  engine's other operation-private markers on that channel (`__expandRead`
  waives the object-level CRUD check, `__referentialFieldClear` the
  referential-clear write) and cannot go stale when a fifth key is added.
- **Dropping the principal fields was the defect.** Two of them decide the
  verdict this gate then trusts:
  - `onBehalfOf` — `ISecurityService.hasWriteBypass`, the `modifyAllRecords`
    probe `SharingService.canEdit` consults last, is documented to fail CLOSED
    on a delegated context and implements that by reading exactly
    `context?.onBehalfOf?.userId`. Stripped, the guard could never fire on this
    path, and the `/mcp` OAuth agent principal that `resolve-execution-context`
    builds *with* the delegation link reached the bypass probe looking like an
    ordinary direct call.
  - `principalKind` — `resolvePermissionSetsForContext` keys the ADR-0090 D10
    rule "an agent's grants are EXACTLY its scope-derived ceiling" on
    `principalKind === 'agent'`. Stripped, the additive human baseline was
    appended to an agent's ceiling here, so the sets the bypass probe evaluated
    were a superset of what the user consented to.

  `systemPermissions`, `accessible_org_ids`, `posture`, `audience` and
  `rlsMembership` were dropped by the same projection and are forwarded now for
  the same reason.

The same envelope-minus-private-keys rule is applied to the read side's
parent-record probe, which spread the whole operation context into a `find` on
a different object.

No access depth is synthesised for the parent object: absent depth leaves the
sharing owner-match at its narrowest (`own`), which is the safe direction and
byte-for-byte what the projection produced. Resolving the parent's own depth
would WIDEN this gate and is deliberately left as a separate decision.

Enforcement effect: a delegated (`onBehalfOf`-carrying) principal is now refused
where the contract says it is refused. No caller gains access.
