---
'@object-ui/auth': patch
---

fix(auth)!: `createAuthClient().updateUser` declares `Promise<void>`, because the server answers a receipt, not the user

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (type-surface-only ui/packages/auth/src/types.ts#updateUser) A published TYPE-SURFACE narrowing of one member's return annotation. `AuthClient.updateUser` declared `Promise<AuthUser>`, but better-auth's `POST /update-user` answers the receipt `{ status: true }` and the client cast that receipt to `AuthUser`; the member now declares `Promise<void>` and the call resolves with nothing. No request byte, URL or refusal changes, and the diff touches no `packages/spec` path and no ADR-0087 shape surface. The affected party is a TypeScript consumer (a caller reading the result, or a host passing its own `AuthClient` as `AuthProviderOptions.client`), and the compiler delivers the break at their own site; `objectstack migrate meta`, `spec-changes.json` and the upgrade guide have nothing to rewrite. -->

**BREAKING** for a typed caller and for a host that implements `AuthClient` itself, shipped as `patch`: the change is not to the metadata protocol (`Metadata-protocol: none`). Nothing that worked at runtime breaks for a caller of `createAuthClient()`: the value it now drops was never a user.

The published typing narrows. `AuthClient.updateUser` was declared to return the updated user, but better-auth's `POST /update-user` answers `{ status: true }`, and the client passed that answer on as if it were a user. A caller that trusted the type read a user with no `id`, `name` or `email`.

- **FROM:** `AuthClient.updateUser: (data: Partial<AuthUser>) => Promise<AuthUser>`.
- **TO:** `AuthClient.updateUser: (data: Partial<AuthUser>) => Promise<void>`. At runtime `createAuthClient().updateUser` resolves with `undefined` instead of the receipt. A refusal still rejects, as before.
- **A caller that read the result** (`(await client.updateUser(data)).name`) no longer compiles. It read `undefined` at runtime. Read the stored fields with `getSession()` after the write. `useAuth().updateUser` already resolved with nothing and keeps the session user's identity, so React callers see no change.
- **A host that builds its own `AuthClient` and passes it as `AuthProviderOptions.client`**, with an `updateUser` that returns the user (`async (data): Promise<AuthUser> => …`), no longer assigns to the interface. Return nothing from it, or annotate it `Promise<void>`. `AuthProvider` never read that value.
