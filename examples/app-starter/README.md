# @objectstack/example-starter — Starter app

A small, complete app an organization installs and then makes its own:
companies, the people at them, and the platform's tasks and notes in one menu.

- `src/objects/` — `starter_company` (name, type, industry, website, phone,
  address) and `starter_contact` (name, company, job title, influence, email,
  phone). A contact is a person outside the organization, never a user.
- `src/views/` — a grid and a board for each object. The create and edit form
  is each object's `fieldGroups`; the company's record page lists its contacts.
- `src/apps/` — the menu: companies, contacts, tasks (`sys_task`), notes
  (`sys_note`), and the overview dashboard. Tasks and notes are platform
  objects every environment carries; this package declares no copy of them.
- `src/datasets/`, `src/dashboards/` — one overview dashboard.
- `src/data/` — five sample companies and six sample contacts.
- `src/translations/` — English and Simplified Chinese.

The API names carry the `starter_` namespace, so a tenant can install this
starter beside a CRM package without a name clash. Uninstalling the package
removes companies and contacts; tasks and notes stay.

## How to run

```bash
# From the monorepo root
pnpm --filter @objectstack/example-starter dev
pnpm --filter @objectstack/example-starter validate
pnpm --filter @objectstack/example-starter test   # boots it, checks the menu, uninstalls it
```
