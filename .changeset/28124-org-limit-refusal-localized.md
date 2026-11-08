---
'@object-ui/i18n': patch
'@object-ui/app-shell': patch
---

fix(console): the create-workspace dialog explains the organization limit in the session language

Clause-②: no
Metadata-protocol: none

- **The organization-limit refusal is localized.** When a deployment caps how many organizations one user may create (`OS_ORG_LIMIT`) and the user is past it, the server refuses with `403 YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_ORGANIZATIONS`. The create-workspace dialog showed the auth library's English sentence for it in every locale. It now shows `organization.errors.organizationLimitReached`, which says the cap counts only organizations the user created, never ones they were invited to, in all 11 console locales (`en`, `zh-Hans`, `zh-Hant`, `ja`, `ar`, `de`, `es`, `fr`, `ko`, `pt-BR`, `ru`). The message names no number: the refusal body and `/auth/config` do not carry the cap.
