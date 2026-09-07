---
"@objectstack/hono": patch
---

`createHonoApp` no longer discards the status and body of a dispatcher result that is already a `Response` — it hands the object on unchanged.

`HttpDispatcherResult.result` is declared for direct response objects ("For flexible return types or direct response objects (Response/NextResponse)"), and the runtime really puts one there: the `/auth` domain returns whatever the auth service answered as `{ handled: true, result: response }`. The adapter's `toResponse` had no arm for that. It tested `result.type` for the `redirect` and `stream` descriptors, a `Response` spells neither, and the fall-through was `c.json(res, 200)` — so the real status was replaced by a literal `200` and the real body by `JSON.stringify` of a `Response`, which is `{}` because a `Response` has no own enumerable properties.

Measured on a real boot through this adapter (a real kernel, the real dispatcher, `prefix: '/api/v1'`), an auth service answering an honest 404 on a path it does not serve:

```
GET /api/v1/auth/me/permissions
  the door answered : 404 {"message":"Not found","code":"NOT_FOUND"}
  the caller read   : 200 {}
```

A discarded status is not a missing answer, it is a wrong one that reads as success: `res.ok`, `status === 200` and "nothing threw" all report a refusal, a 404 or a 500 as a completed operation, and a fail-closed guard written as `if (!data) return false` does not fire on `{}` because `{}` is truthy. Callers embedding this adapter now see the status and the body the door actually produced, along with its headers, and a non-JSON body arrives byte-identical instead of being re-serialized.

The check is `instanceof Response` and nothing else: the `redirect` and `stream` descriptor arms, the plain-object rendering after them, and the separate `response` arm all behave exactly as before.
