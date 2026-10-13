---
'@objectstack/core': patch
---

An import row answers a sandboxed hook's refusal in the hook's own words, not the sandbox debug wrapper

Clause-②: no

When a hook body refused a row during `POST /api/v1/data/:object/import` (or the async `/import/jobs` job), the row's `error` read `hook 'NAME' threw: Error: SENTENCE`, while `POST /api/v1/data/:object` and `/createMany` answered the same refusal as `SENTENCE`. The import runner now reads the row's sentence the way those routes do: the hook's sentence, unchanged, with any `code` the body declared still on the row. A hook body that crashes (for example with a `TypeError`) is not a refusal, and its row reads as it did before.
