---
'@objectstack/core': minor
'@objectstack/cli': minor
'@objectstack/plugin-dev': minor
'@objectstack/objectql': patch
---

feat(cli,plugin-dev): an app under `os serve` or `DevPlugin` that declares its own `sys_organization` default record page boots, and its page is the only default

Clause-②: yes (widening)

A deployment holds at most one `isDefault: true` record page per object, and a second one is refused at registration with `DEFAULT_RECORD_PAGE_CONFLICT`. `plugin-auth` registers `sys_organization_detail` as the default record page of `sys_organization` unless it is constructed with `registerOrganizationRecordPage: false`. `os serve` and `DevPlugin` construct `AuthPlugin` themselves and never passed that option, so an app served by either one that shipped its own default page for `sys_organization` was refused at boot, with no switch to set.

- **What changes.** Both roots now read the app's own pages before they construct `AuthPlugin`. When the app declares an `isDefault: true` record page for `sys_organization`, they pass `registerOrganizationRecordPage: false`, and the app's page is the only default. When it does not, `plugin-auth`'s page registers as before. There is no new configuration key: the page the author already wrote is the switch. Plugin order and precedence rules play no part.
- **One rule for both roots.** The reading is `stackDeclaresOrganizationRecordPage(stack, plugins?)`, a new export of `@objectstack/core`. It reads the stack's `pages` (or each package body's, for a multi-package stack) and the bundle of each app plugin already in `plugins`, and judges each page with `defaultRecordPageObject` from `@objectstack/spec/ui`, the reading the registration refusal uses.
- **The refusal's remedy (`@objectstack/objectql`).** `DEFAULT_RECORD_PAGE_CONFLICT`'s message now says to set `isDefault: false` on one of the two pages, "or compose the deployment without the other package's page". It said to compose the deployment without the other package, which a host cannot do when that package is the platform's auth plugin. The code, the `422` status and the named pages are unchanged.
- **Nothing to adopt.** An app that ships its own `sys_organization` default record page boots under `os serve` and `DevPlugin` with no further change. A deployment that composes its own kernel still sets `registerOrganizationRecordPage: false` on `AuthPlugin` itself.
