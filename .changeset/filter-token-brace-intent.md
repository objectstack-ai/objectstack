---
"@objectstack/spec": patch
"@objectstack/core": patch
"@objectstack/lint": patch
---

fix(spec,core): a filter placeholder is recognised by INTENT — `{TODAY()}` refuses loudly instead of comparing as a literal (#5586)

`UnknownFilterTokenError` had a hole exactly where authors fall in. Recognition
used the token-NAME grammar `/^\$?\{([a-zA-Z0-9_]+)\}$/`, so any placeholder
carrying a **non-word character** classified as "not a placeholder at all" and
was handed to the driver verbatim, to be compared as a literal string — the
silent-wrong-result failure the diagnostic exists to abolish.

The failure was inverted against the author. Measured on 17.0.0-rc.2 against a
four-row fixture:

| filter value | before | |
|---|---|---|
| `due_date < '{today}'` | 2 rows | correct — the two overdue rows |
| `due_date < '{TODAY}'` | throws `UnknownFilterTokenError` | diagnostic working |
| `due_date < '{TODAY()}'` | **4 rows** | diagnostic bypassed — literal string compare, and `'2026-…' < '{'` in lexicographic order swallowed a row due a week later |

So misspelling `{today}` as `{TODAY}` was reported by name, while misspelling it
as `{TODAY()}` returned the wrong rows in silence — and the parenthesised,
kebab-case, natural-language and dotted spellings (`{TODAY()}`,
`{current-user-id}`, `{30 days ago}`, `{user.id}`) are precisely what an author
migrating from another system's macro syntax writes first.

**Both directions of the behaviour change:**

- **Previously silent, now refuses loudly** — a filter value that is entirely
  brace-wrapped and outside the vocabulary now throws `UnknownFilterTokenError`
  (`code: FILTER_TOKEN_UNKNOWN`, `status: 400`) on the ObjectQL read and write
  paths and the analytics dataset executor, and is reported as
  `filter-token-unknown` by `objectstack build` / `validate` / `lint`. Before,
  it reached the data engine and compared as text.
- **Unchanged** — `{today}` / `{current_user_id}` still resolve; `{TODAY}` still
  refuses with the same identity; a value that merely *contains* braces
  (`'acme {x} deal'`), or is not ONE pair around the whole value (`{a}{b}`,
  `{{x}}`, `{}`), is still an ordinary literal and still reaches the driver
  untouched.

Recognition and vocabulary are now two named grammars rather than one:
`FILTER_TOKEN_WRAPPED_RE` (`/^\$?\{([^{}]+)\}$/`) answers "did the author mean a
placeholder", and `isContextToken` / `isDateMacroToken` answer "is it in the
vocabulary". Wide in, strict out. No escape hatch for a literal `{…}` comparand
ships with this: a repo-wide measurement across structured metadata, examples,
seed data and fixtures found zero legitimate consumers comparing a
brace-wrapped literal, and an escape syntax is a public micro-contract that can
be added the day one shows up.

Flow templates are unaffected. `interpolateFilter` in
`@objectstack/service-automation` already recognised the same wide shape and
resolves `{record.id}` / `{TODAY() + 30}` from flow variables **before** the
filter reaches ObjectQL; its hand-off to the engine is keyed on the token
vocabulary (`isKnownFilterToken`), which this change does not touch.
