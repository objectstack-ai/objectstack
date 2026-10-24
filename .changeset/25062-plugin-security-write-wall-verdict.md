---
'@objectstack/plugin-security': patch
---

fix(plugin-security): step 3.7's tenant write wall is composed by one method, and the write preview asks it about each row

Clause-②: yes (widening)

Metadata-protocol: none

The engine's write preview (`validate()`, the import dry run) runs no middleware, so it never heard the Layer 0 tenant wall's verdict on a row's `organization_id`.

- **One spelling of the wall.** Step 3.7's judgement (the no-active-organization pre-test with its delegator leg, the supplied-value forge guard, the emptied organization on update, the #24784 / #24821 no-active-organization insert arms, and whether the wall judges the organization) is composed by one method, `composeWriteTenantWall`. The middleware's payload half and its stored-image seam both call it. Behaviour, refusals and log lines are unchanged.
- **New: `SecurityPlugin.writeWallVerdict(object, operation, context, rows)`**, registered on the engine as `registerWriteWallVerdict`. It answers each row from that same method: admitted (and whether the wall judges its organization), or refused with the write's `PermissionDeniedError` code and message. It answers `null` for a system context, a context with no user, and a caller the context prologue refuses before the wall is reached. On an engine without the seam the plugin logs one warning at start and the preview keeps its old answer.
