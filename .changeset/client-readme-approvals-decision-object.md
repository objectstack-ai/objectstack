---
"@objectstack/client": patch
---

The README's namespace tour calls `approvals.approve` / `approvals.reject` with the decision object they declare, and `auth.register` with the field its schema requires.

`approve` and `reject` take `(requestId: string, decision?: { actorId?: string; comment?: string; attachments?: string[] })`. The tour passed the comment as a bare string — `approve(requestId, 'LGTM')` — which a TypeScript reader hits as `TS2559` and a JavaScript reader does not hit at all: the string goes out as the request body where the route reads the decision object's fields, so the approval is recorded and its **reason is silently dropped**. In an approvals surface a lost reason is not a typo. The calls now read `{ comment: 'LGTM' }` / `{ comment: 'Incomplete' }`, the spelling the docs site's Client SDK page already carried.

Type-checking the whole fence against the package's own built `dist/index.d.ts` found one more call in the same defect class — a live method given the wrong argument shape. `auth.register` takes `RegisterRequest`, whose schema declares `name: z.string()` as required (and pins the rejection of a request without it); the tour passed only `{ email, password }`, failing `TS2345`. It now passes `name` as well, again matching the Client SDK page. All 35 calls in the fence type-check clean against the built declarations after this change.

No behaviour changes and no source change: this is the README, and `files` ships `README.md` inside the tarball, so correcting it moves what `@objectstack/client` publishes — it is the package's npm front page.
