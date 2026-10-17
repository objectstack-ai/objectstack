---
'@objectstack/runtime': patch
---

fix(runtime): the standalone host's database-URL refusals name the URL's scheme and never print the URL, so a password or token in `OS_DATABASE_URL` no longer reaches the console or the boot log

Clause-②: no

The standalone host is what `os dev`, `os start` and `os serve` boot over a plain config, and what `os migrate` boots. Its URL refusals interpolated the whole database URL, and the CLI prints that message as it exits. A URL is where postgres / mysql / mongodb credentials ride, so whenever such a URL was refused, the password and any token in its query string were printed. Each refusal now names only the scheme (the letters before `://`), which cannot hold a username, a password, a host, a path or a query.

- **An unsupported scheme.** With `OS_DATABASE_URL=redis://PLACEHOLDER-USER:PLACEHOLDER-SECRET@127.0.0.1:6399/0?authToken=PLACEHOLDER-TOKEN`:
  - FROM: `[StandaloneStack] Unsupported database URL scheme: redis://PLACEHOLDER-USER:PLACEHOLDER-SECRET@127.0.0.1:6399/0?authToken=PLACEHOLDER-TOKEN. Supported schemes: …`
  - TO: `[StandaloneStack] Unsupported database URL scheme "redis://". Supported schemes: …`. The list of supported schemes is unchanged. `os migrate … --json` carries the same text in its `error` field.
- **A `memory://` or `mingo://` URL (the retired in-memory engine).**
  - FROM: `The database URL "memory://…"` (or `OS_DATABASE_URL "memory://…"`) followed by the full URL.
  - TO: `A database URL with the "memory://" scheme` (or `An OS_DATABASE_URL with the "memory://" scheme`). A declared default datasource reads `(driver: memory, URL scheme "memory://")`. The rest of the sentence, which names the SQLite replacements, is unchanged.
- **An explicit `sqlite` driver over a URL that is not a file path** (for example `OS_DATABASE_DRIVER=sqlite` beside a `postgres://…` URL).
  - FROM: `sqlite driver was selected but the URL does not look like a file path: "postgres://PLACEHOLDER-USER:PLACEHOLDER-SECRET@…"`
  - TO: `sqlite driver was selected but the URL does not look like a file path (its scheme is "postgres://")`. A bare `file:` now reads `(it names no file after "file:")`.

What does not change: which URLs resolve, and to which driver; the URL handed to the driver, which keeps its credentials; and where each refusal is raised, with the same error class. Each message keeps the phrase that identifies it: `Unsupported database URL scheme`, `selects the in-memory (mingo) engine`, `does not look like a file path`.
