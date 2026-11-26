---
'@object-ui/auth': patch
---

fix(auth): `createAuthClient().updateUser` declares `Promise<void>`, because the server answers a receipt, not the user

Clause-②: no
Metadata-protocol: none

The published typing narrows. `AuthClient.updateUser` was declared to return the updated user, but better-auth's `POST /update-user` answers `{ status: true }`, and the client passed that answer on as if it were a user. A caller that trusted the type read a user with no `id`, `name` or `email`.

- `AuthClient.updateUser`: `(data: Partial<AuthUser>) => Promise<AuthUser>` → `(data: Partial<AuthUser>) => Promise<void>`.
- At runtime the call now resolves with `undefined` instead of the receipt. A refusal still rejects, as before.
- To read the stored fields after a write, call `getSession()`. `useAuth().updateUser` already resolved with nothing and keeps the session user's identity, so React callers see no change.
- TypeScript code that reads a field off the result no longer compiles. It read `undefined` at runtime before this change.
