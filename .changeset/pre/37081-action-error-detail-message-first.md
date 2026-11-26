---
'@object-ui/core': patch
---

fix(core): a refusal that carries a `message` beside a bare-string `error` code shows the message

Clause-②: no
Metadata-protocol: none

`actionErrorDetail` returned a bare-string `error` before it read `message`. Against the REST seam's flat 401 body, `{error: 'UNAUTHENTICATED', code, message}`, every caller showed the user the code `UNAUTHENTICATED` instead of the sentence. Now, when the body has both a non-empty string `error` and a non-empty string `message`, the message is returned. A body with only `{error: 'sentence'}` still returns that sentence, the nested `{error: {message}}` envelope is read as before (still ahead of a top-level `message`), and the fallback is unchanged.
