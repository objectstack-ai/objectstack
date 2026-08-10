---
"@objectstack/spec": minor
"@objectstack/objectql": minor
"@objectstack/rest": minor
---

fix(objectql,rest,spec): the `DELETE_RESTRICTED` 409 stops handing a business user a developer instruction

Deleting a record that other records reference is correctly refused with
`409 DELETE_RESTRICTED`. The transport was never the problem — `status` is set
and the structured fields survive the mapper. What reached the end user was:
`error.message` is shipped verbatim as `body.error` by `mapDataError`, and
Console renders that as-is in a toast. So an operator deleting a 部门 in a fully
Chinese app read

```
Cannot delete sys_business_unit (): 1 dependent os_tianshun_ehr_sporadic_application
record(s) reference it via apply_dept (apply_dept is required, so it cannot be
cleared). Delete or reassign them first, or set deleteBehavior:'cascade' on
os_tianshun_ehr_sporadic_application.apply_dept.
```

— an English sentence in a zh-CN UI, naming two tables and a column they have
never seen (they know them as 「零星申请」 and 「申报部门」), ending in a
metadata-authoring instruction a business user cannot act on and will open a
support ticket about.

**The error now carries two messages, because it has two audiences.**

- `message` is the **user's** half: rendered in the caller's locale
  (`ExecutionContext.locale`) from a new built-in catalog, against resolved
  **labels** for the object, the dependent object and the referencing field —
  translation bundle → declared `label` → API name, so the API name is where the
  ladder ends rather than where it starts. The actionable half of the old advice
  ("delete or reassign them first") stays; `deleteBehavior` does not appear in
  any locale.
- `developerMessage` is the **developer's** half, and is the previous sentence
  byte for byte: English, API names, and the `deleteBehavior:'cascade'` remedy.
  The guidance is correct and useful — it is moved to a channel that reaches
  developers, not deleted. `@objectstack/rest` ships it as a sibling field of the
  409 body (it discloses nothing the envelope did not already carry: `object` and
  `dependentObject` are API names on the same body), and the engine's delete
  error log now carries it too, so a zh-CN deployment's server log does not lose
  its operator detail to the localized sentence.

`code`, `status`, `object`, `dependentObject` and `dependentCount` are
unchanged, and the wire code does **not** split — one `DELETE_RESTRICTED`
(ADR-0112), two sentences, exactly as the field catalog splits a message key
without splitting `FieldErrorCode`.

**New in `@objectstack/spec/system`** (`operation-message.ts`): the operation
message catalog — `renderOperationMessage`, `BUILTIN_OPERATION_MESSAGES`
(`en` / `zh-CN` / `ja-JP` / `es-ES`), `operationMessageTranslationKey`, plus
`objectLabelKey` in `i18n-resolver`. A deployment overrides any sentence with a
`translation` item under `errors.<messageKey>`. It is a **separate** catalog from
`validation-message.ts` deliberately: that one is addressed `validation.field.*`
because every entry names a field and the constraint it broke, and a
`DELETE_RESTRICTED` names neither — the offending field is on a different object
from the one the caller acted on, and there is no `fields[]` entry to hang it
off. Filing it there would give deployments an override key that lies about what
it overrides.

`minor`, not `major`: nothing breaks. The structured fields clients match on are
untouched, no test or doc ever pinned the message text, and both new fields are
additive. `check-changeset-no-major.mjs` is the second reason — every publishable
package is in the Changesets `fixed` group, so one `major` promotes all ~70
packages, and the launch-window convention ships even genuinely breaking changes
as `minor`.

This is #3957's fix reached from the operation side: same defect (platform copy
composed in English with API names concatenated in), same machinery, one layer
up.
