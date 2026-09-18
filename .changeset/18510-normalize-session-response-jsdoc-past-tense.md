---
"@objectstack/client": patch
---

fix(client): `normalizeSessionResponse`'s JSDoc records the `data.user.image` gap as closed, not as tracked (#18510)

Clause-②: no

No declaration, accept set, export or runtime behaviour moves. What moves is one
sentence of developer commentary and the pin that now holds it honest.

The block above `normalizeSessionResponse` says what the lift compensates for,
so it names the cards that opened and closed each compensation. One clause was
still in the present tense:

> … with one gap that is NOT this: `data.user.image` served `null` against a
> declared `string | undefined` (#17235, tracked separately).

Both halves went false when `SessionUserSchema.image` widened to
`z.string().nullish()` and #17235 closed — the sentence described a live gap
that no longer existed and pointed the next reader at a closed card as somewhere
to go look. It now reads in the past tense, naming the widening that closed it
and the residue list in `auth-login-register-envelope.test.ts` that is pinned
empty. Nothing else in the block moves.

**Why this is a `patch` and not `skip-changeset`, measured rather than
assumed.** "Only comments changed" is not "nothing published moves", and on this
package the two answers differ. `@objectstack/client` ships `dist`, `README.md`
and `CHANGELOG.md`; `dist` is six files (`index.js`, `index.mjs`, `index.d.ts`,
`index.d.mts` and a `.map` beside each of the two bundles — this package emits no
`*.cjs` and no `*.d.cts`). Built from the same tree before and after the change:

- the comment text reaches **none** of the six (`no longer residue`,
  `data.user.image` and `tracked separately` each 0 hits), while the positive
  controls land — `{@link normalizeSessionResponse}` appears 3× in each bundle
  and 3× in each `.d.ts`, carried there by the JSDoc of the **exported**
  `auth.login` / `auth.register` / `auth.me` that link to it, and `set-auth-token`
  4× / 3×. So comment text from this file does reach the published types; this
  block's own text does not, because the function it documents is not exported;
- `index.js`, `index.mjs`, `index.d.ts` and `index.d.mts` are **byte-identical**
  across the change (sha256, same build, reproducibility control re-run);
- both `.map` files **differ**. Neither carries `sourcesContent`, so no comment
  text ships inside them either — the position table shifts because the rewritten
  comment is two lines longer than the one it replaced.

So the published tarball's bytes do move, and a released package whose shipped
bytes move takes a changeset.
