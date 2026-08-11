---
"@objectstack/spec": major
---

feat(spec): rule and enforce `submitBehavior.url` — relative-only, declared-field interpolation, URL-escaped (#7496)

⚠️ **This NARROWS an acceptance surface.** `FormView.submitBehavior: { kind: 'redirect' }`'s
`url` was an unconstrained `z.string()`, so `https://example.com/thanks`,
`//evil.example`, `javascript:alert(1)` and `''` all parsed. They no longer do.
Metadata authoring one of those forms now fails to parse — at `defineStack`, at
`os validate`, and at the save-time 422 — instead of reaching the renderer.

The reason it was open is that nothing had ever ruled what the key means.
objectui's `FormPage` redirects **verbatim** on this value, and objectui#4190
dead-ended asking what the value may be: path, address, or template was
undecided, so the consumer could not be hardened without inventing the contract
on the spec's behalf. The maintainer ruled the narrowest shape on 2026-08-11
(#7496), and this lands the spec half of it — documented **and** enforced:

1. **Relative paths only.** The value must start with a single `/`. Refused, each
   with its own message naming the rule and citing the ruling: absolute URLs
   (any `scheme:`, so `javascript:` and `data:` come with it), protocol-relative
   `//host` (the one that looks relative and is not), backslashes (browsers
   normalise `\` to `/`, so `/\host` leaves the origin exactly like `//host`),
   smuggled whitespace and control characters (browsers strip them before
   resolving, which is how a leading-slash check gets walked past),
   document-relative `thanks` / `./thanks`, and the empty string. This is what
   closes the open-redirect face: a post-submit target is authored metadata, and
   AI-authored metadata is precisely where an `https://` someone else chose gets
   copied in.
2. **Interpolation only from declared record fields**, spelled
   `{{record.field_name}}` — the ADR-0032 §3 double-brace dialect the platform
   already uses, narrowed to the `record.` root (the record just submitted is all
   a post-submit moment has) and to a flat field segment in the same lowercase
   snake_case grammar `object.fields` keys are declared under. Every interpolated
   value is **URL-escaped** when the redirect is built, so a token is a value in
   the path or query and can never add path structure. Any other brace shape —
   `{{page.x}}`, `{{os.user.id}}`, single-brace `{record.id}`, an unclosed token,
   a stray brace — is refused with the one spelling that works.
3. **A verbatim redirect on the resolved relative path is the intended
   consumption**, so `url` stays a plain `string` on the parsed output: wrapping
   it in a template `Expression` envelope would change what the renderer reads.

Widening (an allowlist of absolute origins, say) waits for measured demand — the
ruling took the narrowest shape deliberately.

**What is NOT enforced here, and where it belongs.** Parse time knows the string;
it does not know the object. Whether `{{record.foo}}` names a field this form's
object actually declares needs both, so it belongs to the reference-integrity
family in `@objectstack/lint`, which already resolves field references against
object declarations — not to this refine. Enforcing the shape loudly beats
enforcing none of it.

**Migrating.** Replace an absolute `url` with the in-app path
(`https://example.com/thanks` → `/thanks`). To send the browser out of the app
deliberately, that is an app navigation item (`{ type: 'url', url }`), which is
declared for external addresses — a form's submit behavior is not.

The consumer half — objectui resolving and escaping the tokens rather than
redirecting on the raw string — is scoped after this in objectui#4190. Until it
lands, the renderer still redirects verbatim, so a token would reach the browser
literally; the forms guide says so where the rules are documented.

<!-- adr-0087: not-required (no-migration-prescription) Nothing is retired: `submitBehavior.url` keeps its declaration, its spelling, its type and its arm — what moves is the set of VALUES the key accepts, from "any string" to the ruled relative-path shape. There is no tombstone to write, and no mechanical FROM/TO rule a ledger entry could state, because the transform is not derivable: the in-app path that should replace `https://example.com/thanks` is a decision about where that form's submitter belongs, and no codemod can read it out of the old value — the old value is precisely the destination the ruling says must stop being honoured. `objectstack migrate meta` would therefore have nothing to apply, and a ledger entry naming this surface would promise an automatic rewrite that cannot exist. The upgrade channel is the schema rejection itself, which is strictly more specific than any ledger line could be: it fires at the author's own path, names which of the six refused forms was written, states the rule and the ruling date, and prescribes the fix (write the in-app path; use an app navigation item for a deliberate external link). Measured blast radius in this repo: zero — no `examples/*` app, fixture or test authors a non-conforming `submitBehavior.url` (the only `kind: 'redirect'` fixtures are `view-strictness-batch18.test.ts`'s `'/x'` and `'/done'`, already conforming), and the one absolute URL that existed was a commented-out example in `content/docs/ui/forms.mdx`, corrected in this PR. -->

