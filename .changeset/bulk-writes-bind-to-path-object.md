---
"@objectstack/rest": minor
---

fix(rest): bulk writes bind to the object in the path, not the one in the body (#3933)

`POST /data/:object/updateMany` spread the request body over the value it had
just taken from the URL:

```js
const result = await p.updateManyData!({
    object: req.params.object,   // trusted, written first
    ...req.body,                 // …and spread over it
    ...
});
```

The gate on the line above reads the PATH object — `enforceApiAccess` starts
with `const objectName = req?.params?.object` — so `enable.apiEnabled` /
`enable.apiMethods` (ADR-0049 / #1889) was enforced on the object in the URL
while the object named in the body got written. Measured on a stock CRM dev
deployment: `POST /data/crm_account/updateMany` with
`{"object":"crm_contact", "records":[…]}` returned `succeeded: 1` and changed
the `crm_contact` row. Point the URL at any exposed object, name a hidden one in
the body, and the gate clears the wrong object every time.

This is not a row-authorization bypass — the engine middleware still evaluates
RLS/FLS against the object actually written, and `assertObjectRegistered` (#3770)
still resolves it. What it defeats is the object-level exposure policy, the layer
ADR-0049 exists to make enforceable rather than advisory.

The path object is now written LAST, after the body, so the object the gate
cleared is the object that gets written — a property of the code rather than of
the caller declining to send that key. The body is parsed against
`UpdateManyDataRequestSchema` first, which (Zod strips unknown keys) also stops a
body `context` from becoming the execution context on a deployment where none
resolves — `requireAuth: false` plus an anonymous caller, the one case where the
trailing `...(context ? { context } : {})` has nothing to overwrite it with.

`deleteMany` gets the same ordering: #3897 moved it behind a schema parse, but
fed that parse `{ object: req.params.object, ...req.body }` — still body-wins.
`createMany` (`records: req.body || []`) and `batch` (`request: req.body`) never
splatted the body at the top level and are unaffected.

**Behaviour change.** A malformed `updateMany` body is now `400
VALIDATION_FAILED` naming the offending path, instead of reaching the protocol
and failing further in. A body `object` key is ignored rather than honoured.
