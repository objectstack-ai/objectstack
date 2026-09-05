---
"@objectstack/cli": patch
---

`os lint --eval --json` now carries the ADR-0112 error carriers on its generator-load failure, instead of a bare `{error}`.

Eval mode's `--generator` load failure was the one exit on that mode with a machine face, and it was off-envelope: the `catch` built its human message and discarded the error object, so `code` and `httpStatus` could never reach the payload. A consumer that reads `code` to branch got a real code from the same command's project-lint catch-all and `undefined` from eval mode — the case a consumer is most likely to be caught by, because the face is present and looks answerable.

The exit now spreads `errorCodeFields(error)`, the same helper the project-lint catch-all spreads, so both failure faces of `os lint` are built from one source rather than two hand-written shapes.

Nothing is minted. `errorCodeFields` passes a producer's code through and returns nothing otherwise — ADR-0112's ledger stays the authority on who may mint a code — so the exit is polymorphic in exactly the way its sibling already is. Measured on the command's own output, across the reachable load-failure classes:

- a generator whose top-level evaluation throws a coded failure (an SDK refusal as the module builds its client at import) now answers `{"error": …, "code": "FORBIDDEN", "httpStatus": 403}`; both keys were being dropped;
- a file the generator reads at import that is missing now answers `code: "ENOENT"`, the errno vocabulary already documented for this command, and no invented HTTP status;
- an unresolvable path or a syntax error — esbuild's own build failure, which carries neither key — still answers a bare `{error}`, as does the hand-thrown "module must default-export a function".

The human (non-`--json`) path, the eval report exit, and offline eval are unchanged.
