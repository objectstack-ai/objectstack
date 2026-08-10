---
"@objectstack/spec": major
---

fix(spec)!: `ImportRequest.runAutomations` declares the default the import route actually applies (#6704, ADR-0049)

`POST /api/v1/data/:object/import` — and its async twin `POST /api/v1/data/:object/import/jobs` —
has fired triggers and hooks for an omitted `runAutomations` since #2922. The server
decides with `body?.runAutomations !== false`: automations always ran on import
historically, so opting **out** was made the explicit act, matching platform
convention (Salesforce fires triggers on import by default).

The schema declared the opposite, and said so twice. `.default(false)` shipped in
`@objectstack/spec`'s JSON Schema, and the `describe` prose — "off by default for
bulk" — rendered into the published reference tables for **both** defs
(`ImportRequest` and `CreateImportJobRequest`). Both are now corrected to the
runtime: `.default(true)`, with prose that states automations run by default and
that opt-out must be explicit.

**Runtime behaviour is deliberately UNCHANGED.** `packages/rest/src/import-prepare.ts`
is untouched by this change. Nothing starts being refused, and no request that
worked before behaves differently on the wire.

### Why a wrong declaration was reachable at all

Nothing in the repo reconciled the two halves, which is why no gate could see the
divergence: no request path parses an import body through this schema. The route
reads the raw body, and the single reference to `CreateImportJobRequestSchema` is
the declarative `ImportJobApiContracts` catalog entry — a declaration, not a parse.
Each half was internally consistent; only their disagreement was wrong.

### Migration: FROM → TO

| FROM | TO |
| :--- | :--- |
| omitting `runAutomations` and expecting no triggers, because the schema said so | send `runAutomations: false` — the only spelling the server has ever read |
| omitting it and expecting triggers | change nothing; that is what you already got, and now what is declared |
| reading `ImportRequestParsed.runAutomations` after parsing a body without the key | it now yields `true` instead of `false` — the value the server would have applied anyway |

**Who is actually affected:** a client or SDK that validates its request through the
published schema and sends the **parsed** object. It materialised
`runAutomations: false` from the declared default and sent it explicitly, and the
server honoured that — so identical request bodies produced opposite behaviour
depending on whether the caller validated before sending, with the validating
caller silently losing its triggers. Those bulk loads ran with automations off and
will now run with them on, which is what an unvalidated caller always got. A caller
that never parsed its own request body is unaffected in every direction.

`dryRun` is untouched and still runs **no** automations whatever this flag says
(#6037).

Maintainer ruling 2026-08-09 (#6704), disposition A — the spec follows the runtime:

> **Maintainer ruling (2026-08-09): disposition A — the spec follows the runtime.** `ImportRequest.runAutomations` becomes `.default(true)` with corrected describe prose (state that automations run by default and opt-out must be explicit, per the #2922 rationale); the generated reference tables follow. Runtime behaviour unchanged. [...] Changeset notes the declared-default flip of a published schema (a correction toward the actual shipped behaviour, not a behaviour change).

The declared move itself is recorded per key in `DEFAULT_CHANGES_BY_MAJOR[17]`, whose
`from`/`to` fingerprints are re-derived on every build, so the declaration cannot
outlive the fact it describes.

<!-- adr-0087: registered import-run-automations-declared-default-corrected -->
