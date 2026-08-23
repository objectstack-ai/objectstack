---
'@objectstack/service-settings': patch
---

Tell the operator in Settings → AI that `@objectstack/service-ai` has no
open-edition version to install, instead of three bare "Mount it" lines

Configure any real LLM provider in **Settings → AI** and press *Test
connection*, and the built-in fallback handler answered — on all three
real-provider branches — "Mount `@objectstack/service-ai` to exercise live
calls." This platform's own capability roster says that cannot be done:
`PLATFORM_CAPABILITY_PROVIDERS.ai` in `@objectstack/spec/kernel` declares
`edition: 'cloud'`, which `CapabilityEdition` defines as "realized only by a
cloud runtime tier; there is **no installable version in the open edition**" —
the un-followable "add it to your dependencies" that framework#3366 exists to
make legible. The package is in no directory of this repo (0 path hits for
`/service-ai/` on `main`; `/service-settings/` returns 64 and
`/embedder-openai/` 8 under the identical command, so the zero is real).

The instruction is **kept** — an operator may well have a cloud tier — and
gains the boundary it was missing, so one who does not can see the path is
closed to them.

Worse than a 404, the install succeeds. Measured 2026-08-23 against the public
npm registry (unauthenticated, `@objectstack/spec` + `@objectstack/cli` as
positive controls, `@objectstack/service-ai-studio` — the sibling
`edition: 'cloud'` entry — as a negative control returning 404):
`@objectstack/service-ai` returns **200** with 57 versions, and the highest is
**10.3.0** (2026-06-23) — entirely below the 11.3.0 cut the roster note names,
i.e. the pre-cloud tail left behind on the registry. A determined operator
following the old sentence installs a seven-major-old AI runtime that
exact-pins `@objectstack/spec@10.3.0` against this repo's 17.2.0, resolving a
second spec beside this one. The new message says so, so nobody discovers it
from a dependency error.

The boundary sentence is **read from the roster**, not hand-written a fourth
time: `note` is documented as "surfaced verbatim inside the preflight / boot
error so the message carries its own context", and `packages/cli`'s capability
preflight already interpolates it the same way. The three provider prefixes
stay distinct — only the shared trailing sentence converges.

No behaviour change: `ok` and `severity` are untouched on every branch, and the
embedder hint at the fourth site is deliberately left alone (its package
**is** built here, so that instruction is followable as written) and pinned by
a contrast test.
