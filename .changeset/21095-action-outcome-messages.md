---
'@objectstack/spec': minor
'@objectstack/client': minor
'@objectstack/cli': patch
---

feat(spec,client)!: `ActionSchema` gains `outcomeMessages` — success copy per closed handler `outcome`, interpolating `${result.*}` — and `client.environments.delete` no longer guarantees `message` on its archive answer (#21095)

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (runtime-interface-only packages/client/src/index.ts#ObjectStackClient) the one narrowing in this changeset is the declared RETURN type of `ObjectStackClient.environments.delete`, a published SDK method of an exported class: its archive answer's `message` becomes optional, beside a new optional `outcome`. That class is not a Zod schema, not a spec contract, not an object definition and not referenced by one, so `objectstack migrate meta` has nothing to rewrite, and the compiler at the consumer's own read is the channel that reaches every affected consumer. The spec half is a widening only (a new optional key, refused solely where it would be inert), so no stored metadata changes meaning and no ADR-0087 entry is owed for it. The other categories are closed on facts: all three packages publish (not `unpublished`); no ADR-0087 id covers a client return type and this diff adds none (not `registered` / `already-registered`); and the diff touches `packages/spec`, which `type-surface-only` refuses. -->

**BREAKING for TypeScript readers of `client.environments.delete`'s archive answer**: `message` is now `message?: string`. Code that assigns it to a `string` stops compiling at that read. Nothing else in the SDK changes, and the request is unchanged.

**`ActionSchema.outcomeMessages`** (`@objectstack/spec/ui`). A server-executing action can succeed in more than one way: an environment delete archives, finds the environment already archived, defers a purge, or destroys it. One static `successMessage` cannot say which of these happened. The handler now reports a closed `outcome` fact in its success payload, and the action declares the copy for each outcome:

```ts
outcomeMessages: {
  archived: 'Environment ${result.environmentId} archived.',
  already_archived: 'Environment ${result.environmentId} was already archived.',
}
```

- Keys are snake_case outcome names; values are `I18nLabel`s. A key that is not snake_case is refused at its own path (`invalid_key`).
- The key is valid on `type: 'api'` and `type: 'script'` actions only, the two types with a success payload that can carry an `outcome`. It is refused with a prescription on `url` / `modal` / `flow` / `form`, beside `resultDialog` (which suppresses the success toast), and beside `operation: 'update'` (no handler, so no outcome).
- `successMessage` and each outcome message may interpolate `${result.*}`, the server-response scope `onSuccess.navigate` already declares. This is not a new dialect.
- The console picks `outcomeMessages[result.outcome]`, falls back to `successMessage`, and then to its default text. The console does not read it yet. Until it does, the key is accepted, validated, translated and extracted, and the liveness ledger grades it `planned`, so `os lint` tells an author who writes it that it is not shown yet.

**Translation.** `TranslationData` carries the copy beside `successMessage`: `objects.OBJECT._actions.ACTION.outcomeMessages.OUTCOME` and `globalActions.ACTION.outcomeMessages.OUTCOME`. Outcome keys there are snake_case too. `translateAction` overlays them per outcome (object-scoped first, then global) and only for outcomes the action declares. `os i18n extract` emits one key per declared outcome.

**`client.environments.delete`** (`@objectstack/client`). The control plane is replacing its English `message` with the closed `outcome` fact: the server returns facts, and the console composes the message in the user's locale. The archive answer declares `outcome?: 'archived' | 'already_archived' | 'purge_deferred'`, and the teardown answer declares `outcome?: 'destroyed'`. Both `outcome` and `message` are optional, because a 200 may carry either one or both depending on which control-plane release answers. To learn what happened, read `deleted` and `purgeDeferred`, which every answer still carries, or `outcome` when it is present.
