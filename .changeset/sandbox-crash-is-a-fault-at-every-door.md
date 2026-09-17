---
"@objectstack/rest": minor
"@objectstack/runtime": minor
---

fix(rest,runtime): a sandboxed body that crashed now answers the sanitised 500 at the bulk REST door and at `/api/v1/actions`, instead of a declared 4xx or a 400 carrying the crash text (#17273)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable moves: no `packages/spec` key, no Zod schema, no object definition, no config field and no stored representation changes its name, its type or its optionality, so `objectstack migrate meta` has nothing to visit, `spec-changes.json` has nothing to project and the upgrade guide has no row to gain. What moves is the RESPONSE two published doors give for one input shape at request time, and this changeset ships no instructions for rewriting anything a consumer authored -- there is no authored artifact to rewrite. The affected caller's remedy is not an edit but the truth: the body crashed, and the 500 says so. The other four categories are closed on facts: `@objectstack/rest` and `@objectstack/runtime` both publish to npm (not `unpublished`); no ADR-0087 id is minted in this diff (not `registered`) and none pre-dates the base that would cover it (not `already-registered`); no named `path#Symbol` is a non-metadata runtime interface whose members moved -- no exported declaration changes at all, the crash gate being file-local in `error-response.ts` and a local `const` in `domains/actions.ts`, absent from both package entries (not `runtime-interface-only`), which is also why `type-surface-only` has no subject. -->

**BREAKING** — the answer two published doors give moves for existing inputs. No
export, signature or declared type changes; what changes is the response an
existing call observes, and a client branching on `error.code` or on the status
for the affected shape now falls to its 5xx path instead of its refusal path.
Shipped as `minor` under the launch-window convention (`major` is refused while
the fixed group versions in lockstep), so this banner — not the level — is the
breaking-ness signal.

**What changes for an operator.** #15071 ruled that a crash inside a sandboxed
hook or action body is a FAULT, not the refusal a declared code names, and
converged the single-record `/api/v1/data` door on it. Two doors that door does
not decide kept the old answer, and both are closed here. Measured, driven end
to end:

The bulk / metadata / UI routes — everything reporting through
`handleRouteError` / `sendThrownError` — for a crash that declared a 4xx:

```
FROM  409 {"error":"hook 'guard' threw: TypeError: ctx.input.title.trim is not a function",
           "code":"DELETE_RESTRICTED","object":"account"}
TO    500 {"error":"Internal server error","code":"INTERNAL_ERROR"}
```

`POST /api/v1/actions/:object/:action`, for a body that really crashed inside
QuickJS (`return ctx.input.title.trim();` with a numeric `title`):

```
FROM  400 {"success":false,"error":{"code":"VALIDATION_ERROR",
           "message":"TypeError: not a function","httpStatus":400}}
TO    500 {"success":false,"error":{"code":"INTERNAL_ERROR",
           "message":"Internal server error","httpStatus":500}}
```

and, when that crash also declared a status of its own, `409 DELETE_RESTRICTED`
with the same `TypeError:` message becomes the same sanitised 500.

The full `<kind> '<name>' threw: …` wrapper still reaches the server log on both
paths, so nothing an operator diagnoses with is lost.

**The `/actions` answer was also contradicting its own published page.** The
error catalog states for this very route that "a `TypeError` / a
`ReferenceError` / a driver's own error class is a crash (500)", and this module's
header says `did it reject or crash? reject → 400; crash → 500`. The door said
400. The code now matches the page; the page is unchanged.

**What does NOT change.** An ordinary sandboxed REFUSAL — a body that throws a
business error and does not crash — is untouched at both doors: same status,
same code, same sentence, same structured fields. A refusal whose text merely
mentions a native error name ("Import failed with a TypeError in row 4") is
still a refusal, because the name list is anchored. Non-sandbox producers are
untouched. The 5xx passthrough arm's unconditional prose-drop is not narrowed:
the fault terminal withholds prose too.

**Why.** A declared code, and a declared status, are the author's statement
about a failure mode they handled; a crash is not that mode. Answering one with
a business status shipped an internal, stack-shaped sentence to an end user and
told the client the wrong thing about what happened. #15071's own residue note
said closing it meant moving a status a passthrough decided — that is what this
does, deliberately and in the shrinking direction: the wire loses the crash
text and the producer's code, and gains nothing.

**If you were relying on the old answer,** the affected shape is a sandboxed
hook or action body that FAULTS (`TypeError`, `ReferenceError`, a driver's own
class). It now surfaces as a 5xx to clients, retry policies and alerting rather
than as a 4xx — which is the point of the change.
