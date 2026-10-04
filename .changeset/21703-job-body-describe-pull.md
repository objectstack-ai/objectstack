---
'@objectstack/spec': patch
---

`JobSchema.body`'s description now says an enabled `pull` job installs through `os package install` when its `pull` binds and is refused when it does not

Clause-②: no

The description said `os package install` refuses an enabled job with no `body`, "a `pull` job excepted: it is data too". Read plainly, that says the install never refuses a `pull` job. That stopped being true when the install-local door (`os package install`, `POST /api/v1/marketplace/install-local`) began refusing an enabled job whose `pull` does not bind, with the same `422 VALIDATION_ERROR` it gives a job whose `body` the declaration refuses.

The sentence now reads: a `pull` is data too, so an enabled `pull` job is judged by its `pull` instead. It installs when the `pull` binds (it names a mapping the package declares, with a `connectorSource`) and is refused when it does not, as is a job whose `body` the declaration refuses. The generated reference page for `job` carries the same text.

Text only: no key, schema shape, condition, error code or status moves. A tool or test that matches the old sentence needs the new one.
