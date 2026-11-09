---
'@object-ui/i18n': patch
'@object-ui/core': patch
'@object-ui/app-shell': patch
'@object-ui/plugin-dashboard': patch
---

fix(console): four copy and display details from a real-user walkthrough: Latin object names spaced in zh form titles, a title on the lookup's create dialog, a success toast that names the action, and money metrics at the currency's decimals

Clause-②: yes (widening)
Metadata-protocol: none

- **zh form titles space a Latin object name.** `新建{{object}}`, `编辑{{object}}` and `查看{{object}}` (and the AI chat's record-write card titles) read `新建 Repair Ticket` when the object has no Chinese label, and still `新建联系人` when it has one. `createI18n` applies the spacing to those keys only, through an i18next post-processor; the packs keep the plain `{{object}}` spelling.
- **The lookup's "create the referenced record" dialog has a title.** A `{ objectName, mode: 'create' }` modal descriptor with no `title` now reads `form.createTitle` with the object's label, the title of the console's own New dialog. An authored title still wins.
- **The default success toast names the action.** An action with a `label` and no `successMessage` (and no matching `outcomeMessages` entry) toasts the new pack key `actions.completedNamed` (`Resolve completed`, zh `“解决”已完成`) instead of the generic `Action completed successfully`. An action with no label keeps the generic text.
- **Money metrics keep the currency's decimals.** A dataset metric over a currency measure with no `format`, and a static metric card with a `currency` and no `format`, show the currency's own minor-unit width (CNY `¥1,293.00`, JPY `¥1,293`), the width the list cell shows. Before, the dataset metric printed the shortest form (`¥1,293`, `¥1,280.5`) and the static card rounded to whole units. An authored `format` pattern still states its width.
