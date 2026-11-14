---
'@objectstack/lint': patch
---

feat(lint): advise a template `default` argument that reads like a variable path, and a `notify` node that sends an email template without a variable the template declares `required`

Clause-②: yes (widening) — two advisory rules and their exports are added; nothing that saved, built or validated before is refused.
Metadata-protocol: none

A template default is literal text; to read another variable, compute it in the flow. No template syntax is added: the mail renderer's `default` formatter already prints a literal fallback (`{{ person_name | default:'Customer' }}`), and a variable declared `required` already refuses the send with `MISSING_VARIABLES` when it is absent. Two authoring checks now say so before a template or a flow ships:

- `email-template-default-reads-as-path` (`warning`; `os validate`, `os build`, `os lint` and the metadata publish door for an `email_template` write, where it is an advisory on the save response). An unquoted `default` argument shaped like a variable path (a dotted or `@`-marked path, a snake_case name, or a name the template itself uses as a variable) prints that text to the recipient: `{{ person_name | default:first_name }}` prints the word `first_name`, never the send's `first_name`. Quote the argument (`default:'first_name'`) when the text itself is meant.
- `notify-template-variable-missing` (`warning`; `os validate`, `os build`, `os lint`). A `notify` node names an email template the app declares, and its `templateData` provably does not supply a variable a locale member of that template declares `required`: every send to a recipient of that locale fails with `MISSING_VARIABLES` and nothing is delivered. A CEL value envelope counts as supplied, as do `appName`, `baseUrl` and the keys of the stack's `email.defaultTemplateContext`. A `templateData` key is one name, not a path: the key `'task.title'` does not supply `task.title`, which the renderer reads as `title` under `task`, and the hint says so. It warns rather than refuses because a host can supply a variable through a default template context set in code, which the stack does not state.

`@objectstack/lint` exports `validateEmailTemplateDefaultArguments`, `EMAIL_TEMPLATE_DEFAULT_READS_AS_PATH`, `validateNotifyTemplateVariables`, `NOTIFY_TEMPLATE_VARIABLE_MISSING` and the two finding types.

The email templates guide states the rule, and its `notify` example, which passed `templateData: { 'task.title': … }` to a template that requires `task.title` (a send that always failed with `MISSING_VARIABLES`), now passes `task`.
