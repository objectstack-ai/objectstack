---
"@objectstack/service-automation": minor
---

fix(service-automation): one renderer for the contested-flow phrase, and the two spellings it had drifted into (#12563)

`minor`, not `patch`, and not empty: this adds a new export
(`renderFlowContender`) to a published package's public API, and it changes
**shipped operator-facing log text**. Both are real changes a consumer can
observe.

## What changed

One event — a flow name claimed by more than one definition — was described to
an operator in three places, each with its own private `const describe` beside
the log call: `flow-precedence.ts`'s precedence warning, `plugin.ts`'s bootstrap
audit, and (in `@objectstack/cli`) the startup banner. Nothing held them equal,
and two axes had already drifted:

- **Quoting.** `flow-precedence.ts` rendered `package "crm"`; the other two
  rendered `package 'crm'`.
- **Absent package id.** The two engine copies interpolated a bare `undefined`
  into the sentence; the CLI copy rendered a real fallback.

The two copies in this package are now one exported renderer. The choice on
each axis was measured, not voted:

- **Single quotes**, measured against this package rather than across the three
  copies: of the interpolated identifiers in operator prose under
  `service-automation/src`, 203 are single-quoted and 3 double-quoted — one of
  those 3 being this phrase. The sentence already single-quotes the flow name
  beside it.
- **A named fallback** (`a code-shipped package (id unknown)`) instead of
  `package 'undefined'`. This package's own callers cannot reach that branch
  today, because `isCodeArtifactBody` is false on a falsy `_packageId` — but
  that is a property of today's callers, not of an exported function.

## Log text a consumer may be matching on

`[Automation] Flow name collision: …` (the precedence warning) now renders a
packaged contender as `package 'crm'` rather than `package "crm"`.
`plugin.ts`'s bootstrap `[Automation] flow '<name>' is claimed by …` warning is
byte-identical to before for every input its callers can produce; only its
unreachable absent-id branch changed.

## Why the CLI still renders its own

`@objectstack/cli` deliberately keeps its own spelling and takes no value
import of this package for the banner: its engine reads are structural and
feature-detected so a host on an older automation package still boots. The
third copy is held equal by a test-only agreement pin
(`packages/cli/src/utils/format.flow-contender-agreement.test.ts`) that asserts
the banner line through this renderer, so it goes red in both directions.
