---
'@objectstack/spec': minor
---

feat(spec)!: an `object-gantt` page block's `markers`, an `object-timeline` page block's `mapping`, and the top-level `fields` of the `object-form` and `object-master-detail-form` page blocks take the shape each block reads instead of any value (#21464)

Clause-②: yes (narrowing)

<!-- adr-0087: registered ui-object-gantt-markers-typed, ui-object-timeline-mapping-typed, ui-object-form-fields-names-typed -->

**BREAKING** — an accept-set narrowing on a published authoring surface, shipped as `minor` under the repo's launch-window convention for accept-set narrowings. What reads the rows: the component-props gate on `objectstack validate`, `objectstack build` and `objectstack lint`, which reports a refused value as an advisory `component-props-invalid` / `component-props-unknown-key` finding. A stored page still saves and loads, because a page component's `properties` is not parsed on the metadata save or load path.

**`@objectstack/spec`**

- **`object-gantt` `markers` takes `{ date, label?, color? }` entries.** Its entries were `z.unknown()`, because the marker contract lived only in objectui: a marker with no `date`, a numeric `date` or a misspelled member passed, and the chart drew no line, or drew it with no label and in the default colour. The spec now declares objectui's own authoring declaration of a marker — `date` an ISO date or date-time string, `label` the text drawn against the line, `color` any CSS colour — closed, and the row takes it. A marker `title`, `text` or `name` is pointed at `label`, and a `colour` at `color`.
- **`object-timeline` `mapping` takes `{ title?, date?, description?, variant? }`**, each a field name. It was `z.unknown()`, for the same reason: a bare field name, a non-string binding or a misspelled member (`titleField` inside `mapping`) passed, and the rail drew the default field. The spec now declares objectui's own declaration of the binding record, closed. `titleField`, `dateField` / `startDateField`, `descriptionField` and `variantField` written inside `mapping` are pointed at the member they meant.
- **`object-form` and `object-master-detail-form` `fields` take field names.** The top-level list was an array of `z.unknown()`, held while the form drew a `{ name }` entry its page-builder guide taught, with a `label`, `type` and `required` it silently dropped. objectui has since retired that entry from every authoring face (the form still draws a stored one by its name), so both rows take field-name strings, objectui's own declaration of the member. A `{ name: 'email' }` entry is refused with `write 'email'` and where a per-form override goes; a `{ field: 'email' }` entry — the `sections[].fields` vocabulary, which the form skips at the top level — is refused with the same name and that pointer.
- **Not narrowed, and still accepting any value:** the `object-metric` drill-down's `report`, `object-form` `customFields`, both forms' `sections`, `object-timeline` `items` and the members of `action:group` / `action:menu`. Each contract still lives in objectui and has more than one viable spec shape that no ruling decides yet; each is typed once one is chosen.
- **`ObjectGanttProps`, `ObjectTimelineProps`, `ObjectFormProps` and `ObjectMasterDetailFormProps`** carry these types on the four members instead of `unknown`. No new member carries a default, so each parsed value is the authored one.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `object-gantt` `markers: [{ date: 5 }]` | `markers: [{ date: '2026-07-01' }]` — an ISO date or date-time string |
| `object-gantt` `markers: [{ label: 'Freeze' }]` | give it a `date`: `[{ date: '2026-07-01', label: 'Freeze' }]` |
| `object-gantt` `markers: [{ date: '2026-07-01', title: 'Freeze', colour: 'red' }]` | `[{ date: '2026-07-01', label: 'Freeze', color: 'red' }]` |
| `object-timeline` `mapping: 'subject'` | `mapping: { title: 'subject' }` — name the member the field binds |
| `object-timeline` `mapping: { titleField: 'subject', variantField: 'status' }` | `mapping: { title: 'subject', variant: 'status' }` |
| `object-form` `fields: [{ name: 'email', label: 'Email', required: true }]` | `fields: ['email']`, with the label and `required` on the object field or on a `sections[].fields` entry |
| `object-form` `fields: [{ field: 'email' }]` | `fields: ['email']`, or move the entry into a section's `fields` |
| `object-master-detail-form` `fields: [{ name: 'note' }, 'status']` | `fields: ['note', 'status']` |

The one-line fix: write each member as the table above shows. No conversion is registered: a misspelled marker or mapping member has no rewrite that says which member the author meant, and a form already draws a stored `{ name }` entry by its name, while an override written beside it has nowhere to go but a section — the D3 entries `ui-object-gantt-markers-typed`, `ui-object-timeline-mapping-typed` and `ui-object-form-fields-names-typed` carry that judgment.

## Who is affected, measured

A writer is a value written on the block: a page-component node (an object literal naming the type, flat or in its `properties` bag, a literal annotated with the block's type, a direct parse through the row), the block's React component with the member as a prop or inside `schema={{…}}`, or the argument of a local test helper that mounts one (positional helper parameters resolved at every call site). Values resolve through same-file constants. Each static value was parsed through the row; a text search for each member key beside the block's name found the writers the walk does not reach, and each was read by hand.

- **objectstack** at `7d0781482d`, over `examples/`, `packages/`, `content/`, `skills/`, `apps/` and `docs/`: no `markers` and no `object-form` `fields`; one `mapping` (this package's own navigation test, `{ title, variant }`) and four `object-master-detail-form` `fields` (the showcase's project workspace, the objectui layout DSL page, and two test copies), all field names. All parse.
- **objectui** at the `.objectui-sha` pin `ab1879721595` and at `main` `94985a92ba` (every read point identical between the two), every value a test fixture, a document or a run-time hand-off:
  - `markers`: 9 values, 8 parse. The refused one is objectui's own compile-time probe that a numeric `date` is refused (`gantt-declared-keys.test.ts`). Five more mount `GanttView`, the runtime chart, directly rather than the block, and are not writers of this member.
  - `mapping`: 9 values (the timeline inputs test and the absent-date-axis refusal test), all parse.
  - `fields`, both forms: 73 values at `main` — 56 parse, 11 are run-time hand-offs that are not static, and the 6 refused are fixtures probing the read: three `{ field }` entries asserting the form skips them with a warning, a `{ name }` entry asserting objectui's own mirror refuses it, and two `{ name }` entries asserting a stored one still draws. At the pin a seventh is refused: the page-builder guide's `{ name, label, type, required }` example, respelled to names on objectui `main`. (Fourteen more matches are object definitions or permission maps whose own `fields` key the walk read as the block's, and are not writers.)
- **hotcrm** at `4054ec2680` and **cloud** at `b2d7a7f6f8`: no writer of any of the four members.
- **Deployed metadata** was not measured.
