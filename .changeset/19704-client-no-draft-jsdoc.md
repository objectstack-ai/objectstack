---
'@objectstack/client': patch
---

`publishItem`'s JSDoc, which ships into `dist/index.d.ts`, is corrected to the refusal spelling the runtime has emitted since PR #19683 (#16245): `404 \`NO_DRAFT\`` on the `code` axis, instead of the retired bracketed lowercase opener `[no_draft]` that PR removed from the message. No behaviour change — the SDK method, its request and its return type are untouched; only the doc comment's stale prose is corrected (#19704).
