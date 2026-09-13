---
'@objectstack/plugin-auth': minor
---

**BREAKING** — `GET /api/v1/auth/get-session` answers an anonymous caller with the
declared ADR-0112 failure envelope and HTTP 401, instead of HTTP 200 wrapping a JSON `null`.

Until now an unauthenticated session read answered:

```
HTTP 200
null
```

`ObjectStackClient.auth.me()` declares `Promise<SessionResponse>`, and
`SessionResponseSchema` requires `data.session` and `data.user` — so no value of that type
means "nobody is signed in", and the most ordinary call a logged-out caller can make
resolved to something outside the method's own declared type. Ruled by the director seat
(decision batch #117 item 4) under the charter rule
「spec 与代码不一致默认改代码,改协议单独立卡非选项」: the implementation is corrected to
the published contract. `SessionResponseSchema` is untouched.

What changes on the wire:

- **An anonymous or unresolvable credential ⇒ `401` with `error.code: 'UNAUTHENTICATED'`**
  and the message `Sign in first`, the same body a raw `/admin/` mount already answers the
  same caller with. No error code is minted: `UNAUTHENTICATED` is an existing
  `StandardErrorCode` member, derived from the status through ADR-0112's own map, so
  `ERROR_CODE_LEDGER` is unchanged.
- **Unchanged:** a signed-in read still answers `200` with `{ user, session }`,
  byte-identical. Every other `/auth/*` route is untouched, and so is the `404` that a
  method this route does not serve already answered — this change never invents a route.
- **Also unchanged:** better-auth's JS API. `auth.api.getSession()` still returns `null` for
  an anonymous caller, so every internal identity read — execution-context resolution, the
  platform-admin gates, the SSO bridges — behaves exactly as before. Only the wire moves.

**`@objectstack/client`:** `client.auth.me()` now **rejects** for an anonymous caller
instead of resolving with `null` — the SDK throws on every non-2xx before unwrapping. Every
value the method resolves with is now inside its declared `SessionResponse`. Callers that
inspected the resolved value must move to a `catch`:

```ts
try {
  const session = await client.auth.me();
  // …signed in
} catch (err: any) {
  if (err.code === 'UNAUTHENTICATED') {
    // …signed out; err.httpStatus is 401
  }
}
```

A caller that branches on the HTTP status directly reads `401` plus
`error.code: 'UNAUTHENTICATED'` where it used to read `200` plus an empty body.

<!-- adr-0087: not-required (no-migration-prescription) retires no metadata surface: no Zod schema, no authorable key, no export, no config field, and no stored sys_metadata row changes shape, so `objectstack migrate meta` has nothing to rewrite and no ledger entry can be written for it. What changes is an HTTP status plus an SDK method's promise contract, and the only channel that reaches those consumers is this changeset itself. -->
