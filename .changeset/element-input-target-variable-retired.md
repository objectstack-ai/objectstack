---
"@objectstack/spec": minor
---

feat(spec): retire the inert `targetVariable` key from `element:text_input` and `element:record_picker` (#9198, ADR-0049)

**BREAKING** accept-set narrowing, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`; the migration prescription is
registered under protocol major 18, where `os migrate meta` users will look).

`targetVariable` on the two SDUI input elements was a declarative hint with
zero readers in any repo — its own describe text said the live binding
"resolves via the variable whose `source` equals this component id"
(`PageVariableSchema`), and that reverse lookup
(`usePageVariableBinding(schema?.id)` in the console renderer) is the only
binding mechanism that exists. Measured (objectstack-ai/objectui#3834,
re-verified at retirement): no renderer, hook or runtime in objectui,
framework or cloud reads the key. An author — human or AI — who read the
manifest, wrote `targetVariable`, and skipped the variable's `source` got an
input that wrote nothing, with a success receipt and no diagnostic anywhere.
Same disposition as the sibling inert hint settled by retirement in objectui
PR #4794.

**What is refused:** an authored `targetVariable` on `element:text_input` or
`element:record_picker` properties. Both keys are `retiredKey()` tombstones —
refused at `tsc` (typed `never`) and at the parse, message carrying the
prescription.

**What stays accepted:** every text input / record picker without the key,
byte-identically — including the working binding (`variables[].source`), which
is untouched. `targetVariable` on `element:filter` is a different surface and
is not part of this disposition. Runtime behaviour is unchanged: nothing ever
read the key, so removing it removes no behaviour.

The retirement kit:

- tombstones at the schema (`packages/spec/src/ui/component.zod.ts`)
- ADR-0087 registration: retired-key entries
  `ui/ElementTextInputProps:targetVariable` +
  `ui/ElementRecordPickerProps:targetVariable` and the D2 conversion
  `element-input-target-variable-removed` (protocol 18), wired into the step-18
  chain — `os migrate meta --from 17` strips the key from old sources (pure
  lossless delete; it never had an effect to lose)
- pin tests (`component.test.ts` — refusal carries the prescription; clean
  parses materialize nothing)
- generated baselines/docs follow the schema (`authorable-surface/`,
  `json-schema.manifest/`, spec-changes, upgrade guide, reference docs)

## FROM → TO

```ts
// before — parsed green; the hint bound nothing
{
  id: 'email_input',
  type: 'element:text_input',
  properties: { inputType: 'email', targetVariable: 'contact_email' },
}

// after — delete the key; declare the binding on the page variable instead
{
  id: 'email_input',
  type: 'element:text_input',
  properties: { inputType: 'email' },
}
// page.variables: [{ name: 'contact_email', type: 'string', source: 'email_input' }]
```

<!-- adr-0087: registered element-input-target-variable-removed -->
