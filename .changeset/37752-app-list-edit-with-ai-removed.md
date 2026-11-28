---
'@object-ui/console': patch
'@object-ui/i18n': patch
---

fix(console): the app management page no longer offers "Edit with AI", which opened the retired build agent

Clause-②: no
Metadata-protocol: none

Each packaged app on the console's app management page carried an "Edit with AI" row action that opened the AI chat on the build agent, scoped to that app's package. The build agent is retired, so the button led to a closed feature. The button is removed; the row keeps its open, edit, enable or disable, set-default and delete actions. Its two labels, `appManagement.editWithAi` and `appManagement.editWithAiNamed`, are removed from every locale pack.
