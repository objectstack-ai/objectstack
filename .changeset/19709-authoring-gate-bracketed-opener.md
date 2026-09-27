---
'@objectstack/metadata-protocol': patch
---

The runtime authoring gate's `422 INVALID_METADATA` refusal no longer opens its message with a bracketed `[invalid_metadata]` tag restating the `code` the same throw declares. `error` carries the human sentence, `code` carries the machine token, and the token is no longer duplicated onto the prose axis.

Clause-②: no

This is the third producer of the family the protocol and the metadata repository already retired. The gate refuses an `active` publish whose body fails an author-time rule, and its message opened with `[invalid_metadata]` in front of its own `code = 'INVALID_METADATA'` / `status = 422`. `withoutDeclaredCodePrefix` strips a leading restatement only when the message opens with the declared code followed by a colon, and a lowercase bracketed tag matches neither the casing nor the separator. So it was never stripped, and it reached every caller in `error.message`.

## FROM → TO

| before | now |
| --- | --- |
| `error: "[invalid_metadata] flow/leave_approval failed author-time validation: 1 issue — flows[0].nodes[1].config.approvers[0].value [approval-expression-invalid]"` | `error: "flow/leave_approval failed author-time validation: 1 issue — flows[0].nodes[1].config.approvers[0].value [approval-expression-invalid]"` |

**Every accept/reject verdict is unchanged.** The same bodies are refused under the same conditions, with the same `code`, `status`, `issues` and `rulesRun`. A reader matching `error.message` for `invalid_metadata` should read `error.code` (`INVALID_METADATA`) instead. A reader already using `code` needs no change.

- **The `[rule]` locators stay.** Each one names the rule behind a finding, for example `[approval-expression-invalid]`, and no other field on the message carries that fact. Only the opener that restated `code` is gone.
- **The batch publish response is unaffected on its machine axis.** `publishPackageDrafts` already puts `code: 'INVALID_METADATA'` and the structured `issues` on the causal `failed[]` row beside this message.
- **Pinned as an absence.** The package's bracketed-opener pin now scans this producer too. A re-introduced tag, or a new refusal copied from a neighbour, fails it.
