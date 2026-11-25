---
'@objectstack/spec': minor
'@objectstack/core': minor
'@objectstack/cli': minor
'@objectstack/verify': minor
---

feat(capabilities): `requires: ['record-context']` mounts the record-context service, so `get_record_context` is served over MCP without host code

Clause-②: yes
Metadata-protocol: added
Skills-docs: follow-up owed — skills/objectstack-platform/SKILL.md (the `requires` table lists no `record-context` row) and skills/objectstack-project/references/platform-catalog.md (the generated capability table, regenerated from `packages/spec/scripts/lib/platform-catalog.ts`)

An app that ships `aiContexts` packs can now serve `get_record_context` by declaring one token. Before this, the tool existed only where the host composed `RecordContextServicePlugin` in code, so an app booted from its stack file or a compiled artifact had packs that no tool read.

- **`@objectstack/spec`: the `record-context` capability token.** `record-context` joins `PLATFORM_CAPABILITY_TOKENS`, provided by `@objectstack/service-record-context` in the open edition (`PLATFORM_CAPABILITY_PROVIDERS`). `defineStack` accepts `requires: ['record-context']`; near misses (`record_context`, `recordContext`) are still refused as unknown capabilities. The token is requested, never on the always-on slate: whether an app exposes a read tool is the app's own declaration, not a side effect of shipping packs. The `aiContexts` description names the token.
- **`@objectstack/core`: the provider row.** `CAPABILITY_PROVIDERS['record-context']` names `RecordContextServicePlugin` (identities `com.objectstack.service.record-context` and the class name). `objectstack serve` and `@objectstack/verify`'s `bootStack` both read this table, so an app's tests get the service its server gets. A host that already mounts the plugin in `plugins[]` keeps its own instance; no second one is mounted.
- **`@objectstack/cli` and `@objectstack/verify`** depend on `@objectstack/service-record-context`, so the provider the token names resolves out of the box.

Without the token nothing changes: no service and no `get_record_context` tool. To turn it on:

```ts
export default defineStack({
  // …
  aiContexts: [policyBrief],
  requires: ['record-context'],
});
```

The hosted runtime is not covered by this change.
