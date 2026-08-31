---
"@objectstack/docs": patch
---

fix(docs): the Backward Compatibility page said MINOR may break "during 0.x" — restate it as the launch-window rule it actually is (#13779)

`content/docs/protocol/backward-compatibility.mdx` closed with a `Pre-1.0
Disclaimer` reading:

> During the **0.x** development phase, MINOR versions may contain breaking
> changes. The full backward compatibility policy takes effect starting with
> version **1.0.0**.

The published stack is at **17.2.0**, so a reader dismisses that paragraph as
obviously stale and is left with the page's opening SemVer table, which says a
MINOR keeps existing code working. **That is the wrong way round.** The
disclaimer's *substance* is the part that survived; only its `0.x` / `1.0.0`
framing died.

Deleting the paragraph would therefore have silently **strengthened** a
customer-facing compatibility promise into one the repo contradicts on every
release. Four independent sources say breaking changes ship as MINOR today:

- **`.changeset/config.json`** — all **69** published packages sit in one
  Changesets `fixed` group (`check:changeset-fixed`: *"fixed group is in sync
  with 69 public workspace packages"*), so no published surface is exempt and a
  single `major` would promote the whole stack.
- **`scripts/check-changeset-no-major.mjs`** — a wired, currently-enforcing CI
  guard (`.changeset/pre.json` is absent, so the RC exemption is not in play)
  whose header states the convention outright: *"During the launch window we ship
  breaking changes as `minor`."* `--list` reports **559 pending changesets, 0
  declaring a major**.
- **`packages/spec/CHANGELOG.md`** — the `17.2.0` **Minor Changes** section
  carries an entry marked `**BREAKING**` (the `http_request_errors_total`
  retirement under ADR-0049).
- **`content/docs/releases/`** — v13, v14, v15 and v17 already tell customers
  this. v15.1.0: *"Strict-semver breaking, shipped in a minor under the
  launch-window policy."* v17: *"17.1.0 and 17.2.0 are minors by version number,
  not by blast radius."*

The section is retitled `Launch Window: MINOR Releases Can Contain Breaking
Changes` and now states the rule definitely rather than hedging it: which
surfaces it covers (all 69), that it is gate-enforced, what an upgrader should do
instead of trusting the version number, that MAJORs still happen when breaking
density demands one, and that it overrides the tables above wherever they
disagree.

Nothing links to the old `#pre-10-disclaimer` anchor (grepped repo-wide), so the
retitle breaks no inbound reference.

<!-- adr-0087: not-required (unpublished) The only bumped package is @objectstack/docs, which is `private: true` and absent from the Changesets `fixed` group, so nothing here reaches a published surface. This changeset removes, renames and narrows nothing; the BREAKING wording in the body quotes changelog entries that already shipped, and is not a breaking change declared by this diff. -->
