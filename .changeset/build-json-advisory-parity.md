---
'@objectstack/cli': patch
---

Carry the capability-provider (#3366) and package-docs (ADR-0046) warnings in
the `os build --json` payload, so its `warnings` list matches
`os validate --json` on the same tree

`os build --json` reported a strictly smaller `warnings` list than
`os validate --json` did for the same stack. #11643 closed the gap for the
undeclared-authoring-key findings; two lists were still behind it — the #3366
installable-provider hints (an unknown capability token, or a provider that is
absent but addable with `pnpm add`) and the ADR-0046 package-docs advisories.
A CI job gating on `os build --json` therefore read an empty advisory list for
a stack that names a typo'd capability and ships a doc whose frontmatter tags
were silently dropped, while the identical job gating on `os validate --json`
read both.

Measured over one temp project at `origin/main` `589758d22`, both commands
exiting 0:

```
os build            ⚠ requires: "zzz_unknown_capability_token" is not a known platform capability — check for a typo.
                    ⚠ src/docs/advparity_guide.md: Frontmatter `tags:` … is not a list this reader understands …
os validate --json  warnings: [ {doc record}, {token,message}, "No apps or plugins defined …" ]
os build   --json   warnings: []                                    ← both lists dropped
```

`compile.ts` computed both and then rendered them **inside** the
`if (… && !flags.json)` print blocks, which put them structurally out of reach
of the payload: computed, then discarded, for the one audience `--json` exists
to serve. This is the fourth measured instance of that shape in these two files
(#10953, #11174, #11643), and it takes the established fix — hoist the
formatting to the computation site so one list feeds both faces and they cannot
report different sets.

**Order and shape are mirrored from `os validate --json`, not chosen here.**
That payload reads `[...ruleAdvisories, ...docWarnings, ...unknownKeyWarnings,
...capProviderWarnings, ...structuralWarnings]`; `os build --json` now emits
that list minus its last member. Doc advisories ride as the issue records
`collectAndLintDocs` returns and capability hints as `{ token, message }`,
which is what validate ships for each, so a consumer reads one shape per class
from either command rather than learning two.

**No new key.** Both lists land in the `warnings` key the payload already
declared — "the whole registry's advisory set, in the shape `os validate --json`
reports", as its own comment has always said. The payload's top-level key set is
unchanged and pinned as unchanged.

**`structuralWarnings` is deliberately not included.** `os validate` derives
four structural advisories ("No objects defined", "No apps or plugins
defined", and two manifest ones) from `collectMetadataStats`; `os compile`
calls that same helper but computes none of them, in any face. That makes it a
missing computation rather than a dropped list, and whether a command that
writes an artifact should raise them is a judgment rather than a mechanical
port. It is split out as #11896 and pinned as the only remaining residue between
the two payloads, so the question stays visible and a fifth genuinely dropped
list cannot hide in the gap.

Text output is unchanged.
