---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
'@object-ui/console': patch
---

feat(console): the create-workspace dialog shows the unpaid-organization limit refusal and its next step

Clause-②: yes (widening) — `@object-ui/i18n` gains `organization.errors.unpaidOrganizationLimitReached` and `workspace.viewPlans` in every locale
Metadata-protocol: none

The hosted control plane refuses a create past its cap on free organizations with 403 `UNPAID_ORGANIZATION_LIMIT_REACHED`. The body carries a sentence in the request's language (`message` and `userMessage`) and `details.next_step`, either `upgrade_to_team` or `contact_support`. The create-workspace dialog now recognizes this code:

- It shows the control plane's own `userMessage`, which names the next step. A refusal that arrives without one shows the console's sentence instead (new key `organization.errors.unpaidOrganizationLimitReached`, in all eleven console locales). That sentence names no number and no plan.
- When the next step is `upgrade_to_team` and the host serves its upgrade entry (`upgradeUrl` on `/api/v1/runtime/config`), the dialog also shows a link to it (new key `workspace.viewPlans`). The console never builds that address itself. If the host serves no entry, no link is shown and the sentence alone gives the step. A `contact_support` step shows no link, because the sentence already names the contact address.

better-auth's own organization-limit refusal (`YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_ORGANIZATIONS`) and every other code behave as before. Nothing to migrate.
