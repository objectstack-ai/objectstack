---
'@objectstack/core': patch
'@objectstack/driver-sql': patch
---

Three source comments now state the registered position for the `door: 'none'` boot-refusal codes instead of the pre-#16404 one

`SERVICE_NOT_REGISTERED`, `PLUGIN_CONTRACT_VIOLATION` and — as the worked
example the `driver-sql` comment cites — `MONGODB_MULTI_TENANT_UNSUPPORTED` are
all registered in `ERROR_CODE_LEDGER`. #16649 registered fourteen `door: 'none'`
codes under the #16404 door-or-no-door ruling, and re-registered the MongoDB one
that #8035 had removed. Three TSDoc comments still asserted the position that
preceded that ruling — that these codes are deliberately not wire vocabulary,
and that registering one is "not something to start doing at a door" — and each
was false the moment #16649 landed. They also pointed at
`dispatcher-error-vocabulary.ts`'s `boot-refusal` verdict, which the same PR
ratcheted from fourteen rows to zero, so the pointer dangled.

These docblocks ship inside each package's `dist/*.d.ts`, which is why this is a
published change rather than an internal one: the sentence is what an agent or
an IDE reader sees at the point it decides whether the code needs registering.

⛔ No behaviour changes. Every reachability sentence is kept verbatim — none of
these codes reaches an HTTP door on this tree — no code is added, removed or
re-registered, and no gate moves. With every comment character removed by
`scripts/js-comment-mask.mjs`, all three files' executable token streams are
byte-identical to the commit this branched from.
