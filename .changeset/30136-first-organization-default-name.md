---
'@object-ui/i18n': patch
---

feat(i18n,app-shell): the first organization's create dialog opens with a default name, so one click continues

Clause-②: no
Metadata-protocol: none

- **Console (`@object-ui/app-shell`, ships inside the Console build):** for a user with no organization yet — the dialog that opens right after sign-up — the organization name is prefilled from the user's e-mail. A work domain names the company from the domain's registrable label, capitalised (`jane@acme.com` → `Acme`, `jane@acme.co.uk` → `Acme`); a public mailbox domain (a closed list in code: gmail.com, outlook.com, qq.com, 163.com, proton.me and similar, subdomains included) gives the person's own organization, "Zhang San's organization" / 「张三的组织」, from the user's name or, without one, the e-mail's local part. An unlisted domain is treated as a work domain. The field stays editable, nothing is created until the user clicks, and creating a further organization still opens with an empty name.
- **`@object-ui/i18n`: one new key, `workspace.defaultPersonalName`** (`{{name}}`), in all ten built-in packs.
