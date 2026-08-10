---
"@objectstack/spec": patch
---

fix(spec): the object-form `params` refusal prescribes per action type — `bodyExtra` for `api`, `target` interpolation + `openIn` for `url` (#6828)

`params` has always been `z.array(ActionParamSchema)`, so writing it as an object
has always been refused. What changed in #5777 is the *message*: it stopped being
the unactionable "expected array, received object" and started naming
`bodyExtra`, the key the maintainer's 2026-08-06 ruling created for a
`type:'api'` action's static request body.

That prescription is right for exactly one action type. On a `type:'url'` action
the object form meant something else entirely — objectui's `ActionRunner` read a
non-array `params` as the `${param.X}` interpolation scope for `target`, and
`params.newTab` as a legacy new-tab flag. Telling that author to use `bodyExtra`
sent them to an api request-body key that is neither an interpolation scope nor a
new-tab control. (The same asymmetry is why the
`inline-action-api-params-to-body-extra` conversion guards on `type === 'api'`:
rewriting a url action's object `params` into `bodyExtra` would be lossy, and
ADR-0087 D2 requires losslessness.)

The maintainer's 2026-08-10 ruling on #6828 **retired the url meaning** rather
than giving it a key — a key with three meanings and no authorized spelling for
the third is the de-facto-contract shape AGENTS.md #0.1 forbids, the schema
already refuses it, and nothing in the reachable corpus authors it. Both halves
already have sanctioned spellings:

| Retired reading | Sanctioned spelling |
|:---|:---|
| statically authored `${param.X}` scope | put the value in the `target` string itself (`${param.X}` interpolates what the params **dialog** collected; `${ctx.X}` the action context) |
| `params.newTab` | `openIn: 'new-tab'` (declared, and already read with priority by the runner) |

So the refusal message now carries both arms, and the authoring docs
(`ui/actions`, `protocol/objectui/actions`) state the refusal where inline and
url actions are described.

**No acceptance-face movement**: `params` is still `z.array(ActionParamSchema)`,
the object form is still refused with `invalid_type` at path `params`, and the
array form still parses on every action type. This is a message-and-docs change —
hence `patch` — pinned on both arms and on both the inline and registered
surfaces.

The two objectui reads this ruling makes dead vocabulary (`interpolateTarget`'s
non-array `params` scope, and the `params.newTab` escape hatch) are objectui's
card, filed contract-first behind this one.
