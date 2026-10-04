---
'@objectstack/spec': minor
---

feat(spec)!: four members of an `object-form` page block take the shape the form reads instead of any value — `contentLayout`, `submitBehavior`, `navigateOnSuccess` and `mobile` (#21464)

Clause-②: yes (narrowing)

<!-- adr-0087: registered ui-object-form-members-typed -->

**BREAKING** — an accept-set narrowing on a published authoring surface, shipped as `minor` under the repo's launch-window convention for accept-set narrowings. What reads the row: the component-props gate on `objectstack validate`, `objectstack build` and `objectstack lint`, which reports a refused value as an advisory `component-props-invalid` / `component-props-unknown-key` finding. A stored page still saves and loads, because a page component's `properties` is not parsed on the metadata save or load path.

**`@objectstack/spec`**

- **Four members are typed.** `ComponentPropsMap['object-form']` declared `contentLayout`, `submitBehavior`, `navigateOnSuccess` and `mobile` as `z.unknown()`, although the form reads each with one shape. Any value passed, and an off-shape one was answered with a silent default: a `submitBehavior` whose `kind` the form does not know showed the thank-you panel; a misspelled `contentLayout` stacked the modal's sections; a `navigateOnSuccess` that is not a string failed the submit after the record had been written; a misspelled `mobile` member was ignored.
- **`submitBehavior` is the form view's own block, by reference** — `{ kind: 'thank-you', title?, message? }`, `{ kind: 'redirect', url, delayMs? }`, `{ kind: 'continue' }` or `{ kind: 'next-record' }` — with the same rule on a `redirect` `url` a form view carries: a relative path, interpolating declared record fields as `{{record.field_name}}`.
- **The measured shape, where no form view declares the member:** `contentLayout` is `'simple'` or `'tabbed'`; `navigateOnSuccess` is a relative path string (`{id}` / `{recordId}` interpolate the saved record's id); `mobile` is `{ stickyActions?, stepper?, stepperMinFields?, stepperFieldsPerStep?, fullscreenLongText? }`, with `stepper` `true`, `false` or `'auto'` and the two counts positive integers.
- **`ObjectFormProps`** carries these types on the four members instead of `unknown`.
- **The form's `fields` and `sections`, and the master-detail form's `fields` and `sections`, are not narrowed** and still accept any value. The form draws a top-level `fields` entry written as `{ name }` by that name, and it draws an inline runtime field (`{ name, type, … }`) written inside a section's `fields` as it stands — two shapes the typed members (field-name strings; the form view's section, whose field entry is keyed by `field`) would refuse. Each is held until that read is ruled. The master-detail form hands both members to its form unchanged, so they are held with the form's.
- **`customFields` is not narrowed either.** Its entries are the console's runtime form field (keyed by `name`), which the spec has not declared; it is typed once the spec declares it.

## FROM → TO

| you wrote on an `object-form` | write instead |
|:--|:--|
| `submitBehavior: 'thank-you'` | `submitBehavior: { kind: 'thank-you' }` |
| `submitBehavior: { kind: 'toast' }` (any `kind` outside the four) | one of `thank-you`, `redirect`, `continue`, `next-record` |
| `submitBehavior: { kind: 'thank-you', heading: 'Done' }` | `{ kind: 'thank-you', title: 'Done' }` |
| `submitBehavior: { kind: 'redirect', url: 'https://app.example.com/done' }` | a relative path: `url: '/done'` |
| `contentLayout: 'tabs'` | `contentLayout: 'tabbed'` |
| `navigateOnSuccess: { url: '/orders/{id}' }` | `navigateOnSuccess: '/orders/{id}'`, or `submitBehavior: { kind: 'redirect', url: '/orders/{{record.id}}' }` |
| `mobile: { stepper: 'yes' }` | `mobile: { stepper: true }`, or `'auto'` for phone-width viewports only |
| `mobile: { stepperFieldsPerStep: 0 }` | delete the key (one field a step is the default), or a positive integer |

The one-line fix: write each member as the table above shows. No conversion is registered, because an off-shape value has no rewrite that both keeps what the form shows today and honours what the author wrote; the D3 entry `ui-object-form-members-typed` carries that judgment.

## Who is affected, measured

A writer is a page-component node: an object literal naming the type, a literal annotated with the block's type, a `schema={{…}}` on the block's React component, a call into a local helper that builds the node, or a direct parse through the row. Each member's value is read through same-file constants and local helpers. The control is `objectName` on the same nodes.

- **objectstack** at `e909aa0a23`, over `examples/`, `packages/` (with `packages/apps/`), `content/`, `skills/` and `apps/`: 16 `object-form` nodes (the control on 13). Three values among the four members: the showcase's new-project wizard `submitBehavior` (a thank-you panel) and two copies of it in the lint and spec tests. All three parse.
- **objectui** at the `.objectui-sha` pin `89cad75d55`: 539 `object-form` nodes (the control on 522). Across the four members there are 73 values: 60 are static, and 56 of them parse. The 4 that do not are test fixtures of a protocol-relative redirect (`//example.com/thanks`), each asserting that the form refuses it and navigates nowhere. Of the 13 values that are not static, 9 are relative redirects that parse by inspection, and 4 are redirect fixtures the form refuses (three same-origin absolute URLs and one protocol-relative one). No refused value is one the form draws.
- **Deployed metadata** was not measured.
