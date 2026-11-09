---
'@objectstack/core': patch
'@objectstack/cloud-connection': patch
'@objectstack/plugin-auth': patch
'@objectstack/plugin-hono-server': patch
'@objectstack/plugin-sharing': patch
'@objectstack/plugin-webhooks': patch
'@objectstack/service-datasource': patch
'@objectstack/service-messaging': patch
'@objectstack/service-print': patch
'@objectstack/service-settings': patch
'@objectstack/service-storage': patch
---

fix(core)!: every door that admits an API key records where the use came from on the `credential_use` row (#31898)

Clause-②: yes (narrowing) — `RequestExecutionContextInput.transport` in `@objectstack/core` becomes a required key, typed `{ remoteAddress } | undefined`: a caller of `resolveRequestExecutionContext` now states the transport's peer address, or states that it hands none.
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-interface-only packages/core/src/security/request-execution-context.ts#RequestExecutionContextInput) the narrowed member is an input key of a runtime TypeScript interface, which the compiler names at every caller (TS2741); no packages/spec schema, registered node type, stored row or ADR-0087 conversion surface names it, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a TypeScript caller of `resolveRequestExecutionContext`.

Since #31821 the `credential_use` audit row records the client address and user agent of the use that opened the window, but only REST, the runtime dispatcher (its `/mcp` face included) and the stdio MCP transport handed their client facts over. An API key admitted at any other door wrote `metadata.ip_address_absent: 'not_supplied'`. Every door that can admit an API key now hands them over, so no door writes `not_supplied`:

- the storage family (its sign-in gate reader, the parent-governed download authorizer and the upload attacher), the settings routes, the sharing-rule shareable-objects list, the share-link routes, the notification preference options, the datasource admin routes, the print route, the own-row delete routes, the organization settings door, the cloud-connection status and setup doors, and the marketplace local-plugin install.

Each door hands only its transport's own peer address and the request headers. The address recorded is the one the deployment establishes under its one client-address trust rule (`IAuthService.resolveClientAddress`): `X-Forwarded-For` / `X-Real-IP` only when `server.trustProxy` is declared, otherwise the peer. No door reads a forwarded header itself. `@objectstack/core` exports the one helper the doors use, `credentialUseClientFor(authService, { headers, remoteAddress })`, and `transportPeerAddressOf(c)` for a Hono door's socket peer.

Which credentials a door admits does not change. Doors that read only a session (`credentials: 'session-only'`) read no key and write no row; they state `transport: undefined`.

What to do on upgrade:

- A caller of `resolveRequestExecutionContext` that omitted `transport` no longer compiles (`TS2741: Property 'transport' is missing`). Pass `transport: { remoteAddress }` with the transport's own peer address (`undefined` when it has none), or `transport: undefined` for a call that hands no client facts, such as a `'session-only'` call. Never pass a forwarded header as `remoteAddress`: the auth service applies the trust rule.
