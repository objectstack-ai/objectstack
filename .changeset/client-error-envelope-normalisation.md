---
"@objectstack/client": patch
---

fix(client): normalize both server error envelopes so `err.code` / `err.fields` mean one thing (#3918 follow-up)

Two envelopes are in play and they disagree about where the semantic code and
the per-field list live:

```
@objectstack/rest, flat:
  { error, code: 'VALIDATION_FAILED', fields: [...] }

runtime dispatcher, wrapped:
  { success: false, error: { message, code: 400,
      details: { code: 'VALIDATION_FAILED', fields: [...] } } }
```

`error.code` in the **wrapped** form is the HTTP status, not a semantic code.
The client read it straight through, so `err.code` was the **number 400** where
the flat envelope gave `'VALIDATION_FAILED'` — meaning the branch our own docs
teach,

```js
if (err.code === 'VALIDATION_FAILED') err.fields.forEach(…)
```

never matched on a dispatcher-served surface, and the field list (put on the
wire for those routes by #3918) was unreachable at `err.details.error.details.fields`.

Now normalized at the throw site:

- **`err.code` is always the semantic string.** It is read from the flat
  `code`, else the wrapped `error.details.code`, else a *string* `error.code` —
  a numeric value is never reported as a code. The HTTP status is on
  `err.httpStatus`, where it always was.
- **`err.fields` is the per-field list** whenever the server sent one, from
  either envelope. It is left **unset** (not `[]`) when there is none, so
  `if (err.fields)` is a safe test for "this failure is field-anchored".
- **`err.details`** prefers a top-level `details` (unchanged), then the wrapped
  envelope's own `details`, then the whole body. The flat envelope has no
  top-level `details` and so keeps falling through to the whole body exactly as
  before — only the wrapped shape changes, and only from "the entire response"
  to the structured object it actually carries.

**Behaviour change worth noting:** code that read `err.code` from a
dispatcher-served route previously got a number and now gets a string (or
`undefined` where the server sent no semantic code). Nothing in this repo did —
`err.httpStatus` was always the correct source for the status, and remains
untouched — but a consumer that branched on `err.code === 400` should move to
`err.httpStatus === 400`.
