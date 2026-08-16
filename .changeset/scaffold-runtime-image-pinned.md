---
"create-objectstack": patch
---

fix(create-objectstack): the scaffolded Dockerfile pins the runtime image to the CLI that builds the artifact, instead of `latest` under a comment saying to pin (#9017)

`src/templates/blank/Dockerfile` shipped `FROM ghcr.io/objectstack-ai/objectstack:latest`
directly beneath a comment instructing the reader to "pin the tag to the
`@objectstack/cli` version in your package.json so the runtime matches the CLI that built
the artifact" — an instruction the scaffold itself did not follow. Every app made with
`npx create-objectstack` shipped that contradiction from day one, and `docker/README.md`'s
tag table already scopes `latest` to quick starts while documenting `X.Y.Z` as the
production pin.

Measured on scaffolded output rather than the template's bytes, before the fix:

```
emitted package.json cli range : ^17.0.0
emitted Dockerfile FROM        : FROM ghcr.io/objectstack-ai/objectstack:latest
agreement (tag vs cli range)   : DISAGREE
```

**The tag is resolved after `install`, from the installed CLI — not from the generated
`package.json`.** That file carries a caret RANGE, and the two are not interchangeable:
npm resolves `^17.0.0` to the newest 17.x, so pinning the range's floor would ship a
runtime image *older* than the CLI that built the artifact — breaking the same promise in
a new way. The rolling `:17` tag does match the range's float window but is exactly what
the tag table tells production not to use. The resolved version is the only value that
makes the sentence true, and it is the rule the repo already applies for this purpose in
`.github/workflows/scaffold-e2e.yml` ("Pin the runtime's CLI to the SAME version the
generated project actually resolved to — NOT a hardcoded `latest`").

**Both halves move together.** Pinning the line while leaving an imperative to pin by hand
would relocate the contradiction rather than remove it, so the comment above the `FROM`
line is replaced in the same rewrite. With `--skip-install` there is no resolved version:
the tag stays `latest` and the comment keeps telling the reader to pin — which is true on
that path, because there the user really must do it by hand.

The regression proof asserts on **scaffolded output**, never on the template: it scaffolds
with the real copy/sync/pin path, plants an installed CLI whose version is deliberately
*not* the range's floor (the normal case, and the one that a package.json-derived tag
would get wrong), and checks the emitted `FROM` tag against the emitted `package.json`
range with a satisfies-check rather than equality.

`.github/workflows/scaffold-e2e.yml` now reads the tag it builds its local runtime image
under **out of the generated Dockerfile** instead of hardcoding `:latest`. Those were two
hand-matched literals; had they skewed, Docker would have quietly pulled the last
published image instead of the one built from this checkout, and the job's own stated
hermeticity would have been false while it stayed green.
