---
'@objectstack/spec': patch
---

`ManifestSchema.version`'s TSDoc no longer documents an `@example` its own regex refuses

The key documented two examples and accepted only one:

```
@example "1.0.0"          -> /^\d+\.\d+\.\d+$/ accepts
@example "2.1.0-beta.1"   -> /^\d+\.\d+\.\d+$/ REFUSES
```

An author who copied the second example verbatim got a `ZodError` out of
`ManifestSchema.parse`. The prerelease example is corrected to `"2.1.0"`, a
value the regex accepts.

**Nothing published moves except the comment.** The regex, the
`.describe('Package version (semantic versioning)')` string and the prose
`(major.minor.patch)` are byte-identical; no accept set, authorable key or
runtime behaviour changes. `@objectstack/spec` ships `src/**/*.zod.ts` in its
`files[]`, so this TSDoc line is itself published — which is why it carries a
changeset rather than `skip-changeset`.

**The refusal was already the settled reading, which is why this is a comment
fix and not a schema change.** Three artifacts agreed before this change and
still agree: the regex, the prose `(major.minor.patch)`, and
`manifest.test.ts`, which pins `'1.0.0-beta'` in `invalidVersions` on purpose.
Only the `@example` line dissented, so it was the artifact in error. Widening
the accept set to admit prerelease or build metadata would contradict that pin
and is deliberately NOT done here.

`PluginSchema.version` accepts a different grammar today; the two keys are
deliberately different and are not reconciled by this change.
