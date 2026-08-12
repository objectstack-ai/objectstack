---
"@objectstack/rest": minor
---

feat(rest): closed query-parameter sets become REST ingress policy, starting with the first tier of data read routes (#7606)

**BREAKING** for tolerated traffic, and deliberately so — see the last section.

## The condition

`rest-server.ts` handlers read the query keys they know and ignore the
remainder, so a misspelled, renamed or invented parameter is **silently
dropped** and the caller gets a plausible-looking `200`. The failure is
undetectable from the response in both directions:

- it **silently widens** — a dropped `?objects=` fans a search across every
  object; a dropped `?fields=` returns the whole record. An unfiltered result
  is shaped exactly like a genuinely broad match.
- it **silently narrows** — a dropped key inside a filter answers `200` with
  zero rows, which is shaped exactly like an object that really is empty.

There is no status, header or field that distinguishes either from a real
answer, which is what makes it worth a policy rather than a bug per endpoint.
An AI caller can detect neither direction at all.

## The policy

A REST route **declares its closed query-parameter set on the day it lands**,
refusing an unrecognised name with a located `400` instead of dropping it.
Adoption is incremental and per lane — data READ routes first — never a
one-shot sweep. The rule, its three measuring constraints and the exclusions
are written up in `packages/rest/src/query-allowlist.ts` and in AGENTS.md's
"Route & surface ownership" section, so it is enforceable at review time.

## The first tier

Three routes, each set **measured from the handler's own read points**:

| route | closed set |
| :--- | :--- |
| `GET /data/:object/:id` | `select`, `expand` |
| `GET /data/:object/export` | `format`, `header`, `limit`, `page`, `filter`, `search`, `searchFields`, `orderby`, `fields`, `locale` |
| `GET /search` | `q`, `query`, `objects`, `limit`, `perObject` |

The refusal is `400` with the ADR-0112 nested body
`{ error: { code: 'VALIDATION_ERROR', message } }` — the same envelope these
routes' existing multiplicity refusals answer, so no route gains a second
dialect. The message names the parameters that were not understood **and lists
the ones that are**, so a caller can fix the request from the response alone.

## What is deliberately NOT closed

`GET /data/:object` (the record list) keeps accepting any name. Its handler
passes the whole query to the normalizer, which lowers every leftover key into
an implicit field-equality predicate — `?status=open` *is* the filter — so the
valid names are the object's own fields and vary per object. That route is
already guarded one layer down and against the right authority: an unknown
**field** is refused there with `400 INVALID_FIELD`. Closing it here would
break every implicit filter.

Its repeated-`?filter=` refusal (`400 INVALID_FILTER`) is untouched, and since
the recognition gate never runs on that route the two guards never meet on one
request.

## Breaking tolerated traffic is the point, and v17 is the window

A caller sending one of these routes a parameter we ignore today starts getting
a `400`. That is not a side effect — it is the change. This is **not a pure bug
fix**: the blast radius cannot be measured from our side, precisely because we
have been dropping the traffic silently, so it was decided rather than
measured (maintainer ruling, 2026-08-12). v17 is the intended window; the
longer it waits the more tolerated traffic there is to break.

Two callers most likely to notice, both on `GET /data/:object/:id`: `?fields=`
and `?populate=` are refused. They are the spec's canonical/alias spellings for
slots this route reads as `select` and `expand`, and it folds no aliases — so
they were being dropped, silently returning the full record. They are left
outside the closed set rather than implemented, because adding them would
advertise a capability the handler does not have; the refusal message names
`select` and `expand` as what the route does accept.

<!-- adr-0087: not-required (no-migration-prescription) HTTP query-string ingress, not stored metadata — the ADR-0087 ledger drives `objectstack migrate meta`, and no metadata migration can rewrite a caller's URL. No authorable spec key, export or config field is removed or renamed by this change. -->
