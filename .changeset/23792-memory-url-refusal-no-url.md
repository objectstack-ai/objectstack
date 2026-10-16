---
'@objectstack/cli': patch
---

fix(cli): `os serve`'s refusal of a `memory://` or `mingo://` `OS_DATABASE_URL` names the URL's scheme and never prints the URL, so a password or token in it no longer reaches the console

Clause-②: no

This is the `os serve` path a host config takes (one whose `plugins` hold plugin instances), and the one `OS_MODE=off|none|legacy` takes. `os dev` and `os start` reach it through their `serve` child. Both schemes name the retired in-memory (mingo) engine, and both accept anything after the `//`, a `user:password@` and a query string included. The refusal interpolated the whole URL, and the CLI prints it as it exits 1.

With `OS_DATABASE_URL=memory://PLACEHOLDER-USER:PLACEHOLDER-SECRET@127.0.0.1:6399/0?authToken=PLACEHOLDER-TOKEN`:

- FROM: `✗ OS_DATABASE_URL "memory://PLACEHOLDER-USER:PLACEHOLDER-SECRET@127.0.0.1:6399/0?authToken=PLACEHOLDER-TOKEN" selects the in-memory (mingo) engine, …`
- TO: `✗ An OS_DATABASE_URL with the "memory://" scheme selects the in-memory (mingo) engine, …`

`mingo://` reads the same way, with `"mingo://"`. These are the runtime host's words for the same URL (`os dev` / `os start` over a plain config, and `os migrate`), so the two hosts print one sentence. The rest of the sentence, which names the SQLite replacements (`os dev --fresh`, and the URL `:memory:`), is unchanged.

What does not change: both schemes are still refused, with the same error class and exit code, in dev and production; every other URL resolves as before, to the same driver.
