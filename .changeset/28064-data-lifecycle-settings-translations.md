---
'@objectstack/service-settings': patch
---

fix(i18n): the Data Lifecycle settings page reads in the admin's language

Clause-②: no
Metadata-protocol: none

Setup → All Settings → Data Lifecycle read English under Chinese (zh-CN), Japanese (ja-JP) and Spanish (es-ES): the hub card's title and description and every field on the page, while every other settings page and the Setup sidebar entry for this page were translated. The page now reads in those languages too: its title, description, and each field's label and help (Enforce lifecycle policies, Retention overrides, Row quotas, Per-class quota defaults, Growth alert threshold). The hub card and the sidebar entry now carry the same name in every shipped locale.

Nothing to do: the translations ship in the built-in settings bundle and load with the settings service, as the other pages' do. The JSON examples inside the help text stay as written, since they are the values you type.
