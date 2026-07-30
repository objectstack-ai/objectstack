---
"@objectstack/rest": minor
---

feat(rest): `audience: 'public'` publishes a book anonymously on a secure-by-default deployment (#3963)

`book.audience: 'public'` was a declared per-book capability that in practice
required the deployment to open its **entire** data plane. The `/meta` umbrella
gate refused every anonymous caller unless `api.requireAuth` was `false`, so a
`public` book was only ever reachable inside a globally-public deployment — the
audience model was *re-narrowing* what that flag had already opened, not granting
anything of its own. ADR-0046 §6.7 recorded exactly that as ground truth ("the
gate is the optional global `requireAuth` … not the handler").

The exemption is now derived from the declaration, the same shape ADR-0056
Option A chose for public form submission (`publicFormGrant`): the umbrella gate
admits an anonymous **GET** of the book/doc read surface, and the §6.7 audience
gate inside the handler is what authorizes it.

Narrow in three independent ways:

1. **Only when no execution context resolved.** An authenticated caller still
   goes through `enforceAuth` unchanged, so the ADR-0069 auth-policy gate
   (expired password, enforced MFA) keeps governing a gated session's book reads.
2. **Only GET, only book/doc.** `GET /meta/:type`, `GET /meta/:type/:name` (type
   `book` or `doc`, either spelling — #3984) and `GET /meta/book/:name/tree`.
   Every other type stays 401 for anonymous, writes stay 401, and `GET /meta`
   itself stays 401. The predicate keys on the REGISTERED route path plus the
   normalized `:type`, so a route added later cannot fall into it by accident.
3. **Reachability, not authorization.** `audienceAllows` admits `'public'` only;
   `org` and `{ permissionSet }` books require `caller.authenticated` and
   unresolvable holdings fail closed, so an anonymous read of a gated book is
   still `401`.

A deployment can now publish a public manual with `requireAuth: true` — which is
the prerequisite for retiring that flag entirely (#3963 step 2). ADR-0046 §6.7
carries an amendment recording the new gate; its SEO and tenant-from-host
reasoning is unchanged, having never depended on the flag.
