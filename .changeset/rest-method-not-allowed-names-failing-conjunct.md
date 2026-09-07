---
"@objectstack/rest": patch
---

`OBJECT_API_METHOD_NOT_ALLOWED` now names the conjunct that actually failed, instead of one its own `allowed` array lists.

An object declaring `apiMethods: ['get','list','update','bulk']` refused `deleteMany`, `createMany` and each op of a cross-object `POST /batch` with an identical body:

```json
{ "error": "API operation 'bulk' is not allowed on object 'sys_user'",
  "code": "OBJECT_API_METHOD_NOT_ALLOWED",
  "allowed": ["get","list","update","bulk","aggregate","history","search","import","export"] }
```

Every one of those refusals was correct in outcome — `deleteMany` is `bulk ∧ delete`, `createMany` is `bulk ∧ create`, and `updateMany` / `batch`, which need only `bulk`, are still admitted — but the message named the half that PASSED, and the same envelope listed it as allowed. The writeMode-refined `import` had the identical shape: `import` derives from create ∨ update, so `update` alone puts `import` in the effective set while an `insert` import still needs `create`.

The message now names a conjunct that is genuinely missing: `delete`, `create` or `update` for the cases above, and still `bulk` when the `bulk` primitive itself is what the object withholds. Three requests that previously produced one indistinguishable envelope are now told apart.

**`allowed` is unchanged, in contents and in meaning** — it is still the object's declared effective operation set, not the set the gate evaluated against. That matters because the array is read as a discriminator: a declaration re-widened to create/update can still 405 for an unrelated reason, so only the set proves which gate answered. Nothing about which requests are admitted or refused moved; the HTTP status, the `code` and the `object` field are all as before. A client matching on the `error` string for these bulk and import refusals sees the new name.
