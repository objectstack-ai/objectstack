---
'@object-ui/react': patch
'@object-ui/plugin-form': patch
'@object-ui/app-shell': patch
---

fix(plugin-form): a drawer or modal `object-form` save that answers warnings shows one toast, the record-named message carrying them

Clause-②: yes (widening)
Metadata-protocol: none

A save from an `object-form` block with `formType: 'drawer'` or `'modal'` that succeeded with advisory warnings (a warning-severity validation rule, for example) showed two toasts: the record-named success one and the write-warning channel's own "Saved — with warnings". The record page and the Console's record dialogs already showed one. The container now does the same: while it is open it claims the answer warnings of the write it makes (its record's update, or a create of its object), and its save toast carries them on the warning variant, one per line, whether the message is the record-named one or a declared `successMessage`. A write the container did not make keeps the channel's toast, and so does a container with a `submitHandler`, which writes nothing itself.

- **`@object-ui/react`**: new exports `claimAnswerWarnings`, `parkAnswerWarnings`, `answerWarningLines`, `toastRecordSave` and the types `AnswerWarningsEvent`, `AnswerWarningScope`, `AnswerWarningClaim` and `RecordSaveSink`. They are the one claim registry every record save surface and the write-warning channel share, moved here from `@object-ui/app-shell`, where they were internal, so `@object-ui/plugin-form` can reach them.
- **`@object-ui/app-shell`**: the write-warning channel, the record page and the record dialogs read the claim from `@object-ui/react`. Their behaviour is unchanged.
