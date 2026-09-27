---
"@objectstack/plugin-security": patch
---

The delegated-administration gate resolves a position name **inside the caller's own organization** when it decides whether that position may be self-delegated and which permission sets it distributes. In a single-database multi-org posture (ADR-0105 D1 `group` / `isolated`) a position name shared by two organizations no longer lets one organization's row answer for the other.

`sys_position` is a per-organization catalog and its `name` carries no installation-wide uniqueness, yet the two position reads behind those decisions looked the row up by name alone, `limit: 1`, under a bare `{ isSystem: true }` context carrying no tenant — so whichever id the driver ordered first answered. Measured on a real engine over a real SQL driver, with the other organization's ids sorting first: a holder could **self-delegate a position their own organization never marked delegatable**, because the other organization's same-named row was; and a delegated administrator could **assign a position whose own bindings hand out a permission set outside their allowlist**, because the other organization's bindings were the ones checked — while positions their own organization bound correctly were refused.

- **What changed**: both reads now carry the caller's organization (`organizationId ?? tenantId`, the spelling the business-unit anchor read already uses) and keep only the caller's own row out of what comes back. The self-delegation check, the delegated-assignment allowlist and containment checks, and the `assignablePositions` list of `describeDelegableScope` all read the caller's own position.
- **Fail closed**: a position name with no row in the caller's organization is not delegatable and distributes no permission sets — never another organization's row. Under a walled posture an **organization-less** `sys_position` row no longer answers either question, as that posture already treats such a row as invalid state.
- **Unchanged where there is no boundary to cross**: a caller carrying no organization (the `single` posture) keeps the by-name answer it had.

No exported symbol, payload key, error code or refusal message was added or changed.
