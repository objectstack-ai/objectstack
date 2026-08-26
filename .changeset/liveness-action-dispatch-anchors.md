---
'@objectstack/spec': patch
---

liveness ledger: repoint the `action` `type` / `body` / `method` anchors at their real consumers

All three cited `packages/runtime/src/http-dispatcher.ts`, and none of them is read
there. The actions domain was extracted out of that file — it now only delegates
(`handleActions` → `handleActionsRequest` at :1969-1970) — and the reads live in
`action-execution.ts`, `domains/actions.ts`, `sandbox/body-runner.ts` and, for the
client-dispatched `method`, in the renderer repo.

This is the residue of the same extraction that rotted `action.target` and
`action.requiredPermissions`, but it survived the sweep that repaired those, and the
reason is the interesting part. The key-mention check added with that sweep asks
whether the cited file names the key at all — which caught `target` and
`requiredPermissions` because `http-dispatcher.ts` contains **0** occurrences of
either. It cannot catch these three, because they are common English and HTTP words
that the file is full of for unrelated reasons:

- `type` — 9 occurrences, four of them the TypeScript `import type` keyword, the rest
  other domains' data (`error.type`, `details.type`, a field-type→JSON-Schema mapper).
- `body` — 68 occurrences: the inbound HTTP request body threaded through every
  domain delegate, plus the file's own "body extracted to ./domains/…" comments,
  where `body` means a *function* body.
- `method` — 41 occurrences: the inbound HTTP verb (15 `method: string` parameter
  declarations, route matching such as `method === 'GET'`) and the ordinary
  object-oriented sense in prose.

So the word-bounded check anchors on the coincidence and passes. That is the designed,
honest limit of the signal rather than a defect in it — the census that shipped it said
so — and it means this class is invisible to tooling and only a hand call-graph read
can settle it. Each repointed entry now records which spelling misled the gate, so the
next reader does not have to re-derive it.

`method` additionally CHANGES REALM, joining its siblings `bodyShape` and `bodyExtra`:
`type: 'api'` actions are client-dispatched by design, so the server never read the
verb. Its one in-repo appearance is a diagnostic that interpolates the verb into the
refusal explaining the server does *not* dispatch it — evidence of non-consumption,
and deliberately not cited as a consumer.

No verdict was re-graded: all three were `live` and remain `live`, with the consumer
proven rather than asserted. Citation repair only.
