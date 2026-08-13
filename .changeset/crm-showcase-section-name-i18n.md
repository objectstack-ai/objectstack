---
"@objectstack/example-crm": patch
"@objectstack/example-showcase": patch
---

fix(examples): name the form/page sections that had a label but no `name`, and translate the headings into zh-CN (#8231)

`translation-section-name-missing` fired on every build of both example apps: a
form or `record:details` section that declares a `label` but no `name` has no
key a bundle can carry (`objects.<object>._sections.<name>.label`), so its
heading renders in the source locale in EVERY locale — permanently, and
invisibly, because every neighbouring field label on the same object
translates fine. `app-crm` ships en + zh-CN; `app-showcase` ships the same.

21 of the 24 flagged sections now declare a stable snake_case `name` and
resolve a real (non-echoed) zh-CN label:

- **app-crm** (9/9): `crm_activity` (`activity_details`, `related_records`,
  `notes`), `crm_lead` (`contact_us`, `lead_information`, `qualification`,
  `conversion`, `notes`), `crm_opportunity` (`opportunity`).
- **app-showcase** (12/15): `showcase_project` form (`project`,
  `budget_schedule`) and its detail page (`overview`, `financials`,
  `timeline`); `showcase_task`'s detail page (`overview`, `schedule`,
  `details` — reusing the same names and zh-CN copy its `tabbed` form view
  already declares, so no new bundle entries were needed there);
  `showcase_inquiry` (`tell_us_about_yourself`); `showcase_business_unit`
  (`unit`); `showcase_preference`'s settings page (`appearance`,
  `notifications`).

**Not named here — a `packages/**` conflict, out of this PR's scope.** Three
`app-showcase` sections (`showcase_task`'s `formViews.edit`/`Task` and
`formViews.quick`/`Quick Edit`, `showcase_contact`'s `formViews.create`/`Who is
this?`) are pinned NAMELESS as regression fixtures by
`packages/lint/src/validate-translatable-sections.test.ts` and
`validate-translation-references.test.ts`, which import `TaskViews` /
`ContactViews` directly from this app and assert on their current unnamed
shape. Naming them requires a coordinated `packages/lint` test update; #8231
remains open for that follow-up.

Adding a `name` alone would have silenced the warning with zero translation
delivered, so both apps also gain a generalized i18n-coverage sweep test
(`examples/app-crm/test/i18n-sections.test.ts`,
`examples/app-showcase/test/seed.test.ts`) asserting every section this PR
touches BOTH has a `name` AND resolves a real, non-ASCII zh-CN
`_sections.<name>.label` — not just that the section has a name.
