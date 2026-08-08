---
"@objectstack/spec": minor
"@objectstack/objectql": minor
"@objectstack/metadata-protocol": minor
---

feat(spec,objectql,metadata-protocol): validate-only data operation — ask for the write's verdict instead of predicting it (#6037, #4633 ruling D)

`import`'s dry run predicted the write path's verdict with a hand-copied mirror
of the engine's rules (`rest/src/import-coerce.ts`). A copy cannot structurally
keep up with the family it mirrors — ADR-0104 value shapes, `format` checks,
object-level `validations`, the state machine — so ruling D replaces prediction
with the verdict itself.

**New:** `DataProtocol.validateData(request)` returns the write path's verdict
for candidate rows and persists nothing.

```ts
const verdict = await protocol.validateData({
  object: 'lead',
  mode: 'insert',                 // or 'update', which judges only supplied keys
  data: [{ first_name: 'John', email: 'not-an-email' }],
});
// → { valid: false,
//     results: [{ valid: false, errors: [{ field: 'email', code: 'invalid_email', … }], warnings: [] }],
//     posture: { valueShapeStrict: true, mediaValueShapeStrict: false } }
```

**Declaration and execution land together, deliberately.** `engine.validate()`
(objectql) calls the same `validateRecord` / `evaluateValidationRules` that
`insert()` calls, and `metadata-protocol` implements `validateData` on top of
it. Agreement between preview and write is therefore guaranteed by
construction, and a test asserts it directly by running both against one engine
in both postures. This is the ruling's own clause, not a style choice:
`BatchOptions.validateOnly` was retired in #4052 as a flag that promised a dry
run while the batch surfaces persisted regardless, so a caller previewing a
mutation had it EXECUTED. The new operation avoids that spelling too — the
tombstone still stands and still rejects `validateOnly`.

**The verdict is the target deployment's, not an absolute.** The response
carries the ADR-0104 `posture` it was reached under. On a self-certified
deployment a bad value shape is an error; on a warn-first one the same row is
valid and the finding appears in `warnings` with the same `code` — one finding
that changed buckets, not two vocabularies. An unconditionally-strict preview
was considered and rejected (#4633 option B): it would fail rows on every
un-migrated deployment that the write would have accepted, which teaches
authors to distrust the one gate in front of a bulk import.

Two boundaries worth knowing, both deliberate and both documented at the
implementation:

- **No hooks run.** `beforeInsert` fires before validation on the real path, so
  a hook deriving a *business* field could change a verdict this does not
  simulate. Firing arbitrary user hooks in a preview — mail, outbound calls,
  writes to other objects — is the #4052 defect in a new spelling, so the gap is
  documented rather than closed. Audit/ownership stamps are `system`/`readonly`
  and validation skips them regardless.
- **Warn-first admissions are not recorded as certification evidence.** The
  `#4769` sink exists so a boot cannot certify a contract it has just written
  against; a preview writes nothing, so recording there would let a *preview*
  block a later migration.

Additive: `validateData` is optional on `DataProtocol`, and nothing existing
changes shape. `valueShapeStrictEffective` / `mediaStrictEffective` are now
exported from objectql's record validator so the response reports the posture
that actually decided the verdict rather than the raw deployment flag.

Unblocks #4633's consumption half (rest/import adopting the operation and
retiring the `import-coerce.ts` mirror).
