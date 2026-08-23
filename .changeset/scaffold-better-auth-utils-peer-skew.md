---
"@objectstack/cli": patch
"create-objectstack": patch
---

fix(cli): declare the four `@better-auth/utils` peer skews a freshly scaffolded project reports (#10931)

Both scaffold paths emit a `peerDependencyRules.allowedVersions` block whose
stated purpose is that a brand-new project's first `pnpm install` does not open
with a peer-skew report. It declared two skews and left four showing:

```
├─┬ @better-auth/core 1.7.1
│ └── ✕ unmet peer @better-auth/utils@0.4.2: found 0.5.0
        ├─┬ @better-auth/scim 1.7.0-rc.1
        │ └── ✕ unmet peer @better-auth/utils@0.4.2: found 0.5.0
        ├─┬ @better-auth/oauth-provider 1.7.1
        │ └── ✕ unmet peer @better-auth/utils@0.4.2: found 0.5.0
        └─┬ @better-auth/sso 1.7.1
          └── ✕ unmet peer @better-auth/utils@0.4.2: found 0.5.0
```

`@better-auth/core`, `/oauth-provider`, `/scim` and `/sso` each peer an **exact**
`@better-auth/utils@0.4.2`. The 0.5.0 they are handed comes from
`better-call@1.4.0` — better-auth's own HTTP layer — which *depends* on
`^0.5.0`; `@objectstack/plugin-auth` names the four as direct dependencies
without naming utils, so pnpm satisfies their peer from better-call's copy
instead of better-auth's own exact 0.4.2 dependency.

**Measured compatible before widening, not assumed.** Those four import three
symbols in total: `base64`/`base64Url` (`@better-auth/utils/base64`),
`createHash` (`/hash`) and, in core only, `createRandomStringGenerator`
(`/random`). 0.5.0 declares all three with identical signatures; `/random` is
unchanged apart from formatting, `/base64` swaps `new Uint8Array(data)` for a
helper that *is* `new Uint8Array(data)` on non-strings, and `/hash` only widens
its input coercion for views not backed by a plain `ArrayBuffer`. Run against
the input shapes those call sites actually pass, the two versions agree on every
value; run end to end — better-auth with the `sso`, `oauth-provider` and `scim`
plugins — a tree where the four resolve 0.5.0 and one where they resolve 0.4.2
produce the same transcript: sign-up, sign-in, session, both OAuth metadata
documents, the RFC 7636 PKCE challenge, and the SCIM and SSO endpoint outcomes.

A resolution change was measured too, and rejected: pinning utils back to 0.4.2
clears the four lines only by dragging `better-call@1.4.0` off its own declared
`^0.5.0` — manufacturing one real range violation to silence four benign ones.

Four scoped entries, one per declaring package, matching the block's convention
that each rule widens exactly one declaration. `allowedVersions` suppresses the
report only: the lockfile a scaffold resolves is byte-identical with and without
the block. The version is spelled `0.5.0` exactly rather than `0.5`, so a future
`0.6.0` reports again instead of inheriting this finding.

Both scaffold paths — `objectstack init` (rendered by the CLI) and
`npx create-objectstack` (a copied template file) — are changed together, and
`packages/cli/test/scaffold-workspace-consistency.test.ts` gains a limb that
compares the peer maps the two produce, so they cannot drift apart again.
