---
'@object-ui/app-shell': patch
---

feat(app-shell): the first organization's create dialog opens with a default name, so one click continues

Clause-②: no
Metadata-protocol: none

For a user with no organization yet — the dialog that opens right after sign-up — the organization name is prefilled from the user's e-mail. A work domain names the company from the domain's registrable label, capitalised (`jane@acme.com` → `Acme`, `jane@acme.co.uk` → `Acme`). A public mailbox domain (a closed list in code: gmail.com, outlook.com, qq.com, 163.com, proton.me and similar, subdomains included) names no company, so it takes the existing default organization name, "My Organization" / 「我的组织」 (`workspace.default`, already in every built-in pack; no translation key is added). An unlisted domain is treated as a work domain. The field stays editable, nothing is created until the user clicks, and creating a further organization still opens with an empty name. The e-mail domain rules live in a product-neutral app-shell util (`utils/emailDomain`), outside the organization pages.
