# @objectstack/route-envelope-conformance

One shared guard for the response envelope every REST route is declared to emit.
Private — a validation instrument, not a product package.

## Why

`BaseResponseSchema` (`packages/spec/src/api/contract.zod.ts`) declares one shape
for every REST body the platform returns:

```ts
{ success: true,  data }
{ success: false, error: { code, message } }
```

The route **ledgers** (#3563 → #3656) audit which routes exist and whether the
SDK can address them. They say nothing about what comes back, which is how six
route modules carried green `sdk` rows while emitting something else — including,
in two of them, an `error` that was a bare string, so `body.error.message` read
`undefined` (#3675 → #3689 → #3843).

Each of those fixes shipped its own hand-rolled source scan. Three copies of the
same regex block was the signal the guard wanted sharing rather than copying, so
it lives here (#3843 option 3).

## Using it

```ts
import { readFileSync } from 'node:fs';
import { checkRouteEnvelope } from '@objectstack/route-envelope-conformance';

it('routes every body through the two helpers', () => {
  const source = readFileSync(new URL('./storage-routes.ts', import.meta.url), 'utf8');
  expect(checkRouteEnvelope({ source, module: 'storage-routes.ts' })).toEqual([]);
});
```

Source text in, findings out — no test-runner and no filesystem dependency, the
same contract the ADR-0060 helpers in `@objectstack/verify` use. Callers read
their own module and assert `toEqual([])`.

## What it checks

The load-bearing check is structural, not per-route: **it counts `.json(` call
sites.** When every body is built by the `sendOk` / `sendError` pair, that count
is fixed at the number of builders and does not grow with the route list. A new
route that hand-rolls its own body moves the count and fails — which is the one
thing a driven-body test can never cover, since it can only drive the routes that
existed the day it was written.

The rest are tripwires for specific retired dialects, so a revert fails loudly:

| rule | what it catches |
|---|---|
| `unenveloped-json-call` | a `.json(` site that is not a declared builder |
| `success-builder-count` / `error-builder-count` | an envelope half built in more (or fewer) places than declared |
| `string-error-body` | `{ error: '<string>' }` — the pre-#3675 shape |
| `bare-error-body` | a route building `res.status(…).json({ error … })` inline |
| `private-success-word` | a literal `ok: true` beside the envelope's own flag |

A **computed** `ok` is deliberately left alone: `POST /datasources/:name/external/validate`
reports `ok: results.every(r => r.ok)`, a domain verdict that happens to share the
name with the flag #3689 retired. Only literals are flagged.

Counts are options, so a module that legitimately has one half (or emits through
builders imported from elsewhere) declares that instead of being excused:

```ts
checkRouteEnvelope({ source, module: 'errors-only.ts', jsonCallSites: 1, successBuilders: 0 });
```

Used as a **ratchet**, those numbers pin a module's current structure while the
consolidation is still outstanding — see `service-i18n`'s error-envelope suite,
which declares `jsonCallSites: 5, successBuilders: 4` and says why.

## What it does not check

This is the **static** half. It proves no route can bypass the builders; it
cannot prove the builders are right. Each module pairs it with driven bodies
parsed against the real spec schemas — the half that has to live next to the
routes it drives.

It also does not check the error **code** vocabulary. Two dialects are live
(lowercase snake in the spec enum, SCREAMING_SNAKE on the wire); picking one is
#3841. Once `ApiErrorSchema.code` references a real enum, the driven halves get
the value check for free.

## Note on comment stripping

`stripNonCode` tokenizes: comments removed, string / template / regex literals
emptied but delimited. The copies this replaces used two `String.replace` calls,
and the line-comment regex also ate `//` inside strings — truncating the rest of
that line, `.json(` calls included. Literal *contents* are dropped rather than the
literals themselves, so `{ error: 'not_found' }` reduces to `{ error: '' }` and
stays recognisable as the bare-string dialect.
