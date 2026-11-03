---
'@objectstack/spec': minor
---

fix(spec)!: `defineConnector()` refuses a top-level key the connector does not declare, as every other connector door does

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: not-required (already-registered connector-entry-undeclared-key-refused) the same narrowing as that entry, reached through one more door; its surface now names defineConnector() -->

**BREAKING** accept-set narrowing on `defineConnector()` (`@objectstack/spec` and `@objectstack/spec/integration`).

- **Before.** The helper parsed the open `ConnectorSchema`, so a top-level key the connector does not declare was dropped without a word. Because the helper parses first, the closed authored entry behind `defineStack({ connectors })`, `os validate` / `os compile`, the artifact load and the metadata save door never saw the key either: the one helper every documented `connectors:` entry is wrapped in was the one door that stayed silent. TypeScript's excess-property check catches the key only in an object literal, so the gap was reached through a spread, a variable or a cast.
- **Now.** The helper parses the closed connector carrier, behind the same retired-default residue stage as `ConnectorSchema`. Such a key throws a `ZodError` naming it (`unrecognized_keys` at the root), with the message the authored entry gives: a credential-shaped key (`apiKey`, `token`, `secret`, `password`, …) meets the `auth.credentialRef` prescription, a provider setting written at the top level (`baseUrl`, `spec`, `transport`, `headers`, …) is pointed at `providerConfig`, and `timeout` / `timeoutMs` are pointed at `requestTimeoutMs`. The ADR-0010 protection envelope stays declared and a retired key's emitted default (`status: 'inactive'`) stays accepted as residue.
- **Unchanged.** The return type (`ConnectorParsed`). `ConnectorSchema`, the def a plugin hands to `registerConnector`, keeps its open posture. The stack-only rules of an authored entry (no inline `authentication`, `providerConfig` / `auth` need a `provider`, no `actions` on a provider-bound instance) stay at the stack doors, which still apply them to the value the helper returns.

## FROM → TO

```ts
// before: returned without `timeout`; the request timeout stayed the 30 s default
defineConnector({ ...billingApi, timeout: 5000 });

// after: `timeout` is refused by name and pointed at the declared key
defineConnector({ ...billingApi, requestTimeoutMs: 5000 });
```

Move a provider setting under `providerConfig`, put a secret into the secrets layer under the name `auth.credentialRef` gives, and delete any other undeclared key. The upgrade guide entry is `connector-entry-undeclared-key-refused`.
