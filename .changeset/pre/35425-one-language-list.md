---
'@object-ui/i18n': patch
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

feat(i18n): the sign-in page and the in-app language menu offer one list, every interface language

Clause-②: yes (widening) — @object-ui/i18n adds `appContentLanguages` to the i18n context and the locale key `console.localeSwitcher.appContentDefault` in all eleven packs; `offerableLanguages` is never `null` any more; nothing removed
Metadata-protocol: none

The in-app language menu used to list only the languages the app declares (four on HotCRM), while the sign-in page, which has no session to ask the app with, listed all eleven interface languages. A language picked on the sign-in page (German, Korean) was then missing from the menu after sign-in.

Both now list all eleven, as does the profile page's language card. A language the app's own content is not translated into stays selectable: the interface shows in it, and object, field and view names show in the deployment's default language. The menu row of such a language carries one muted line, "App content shows in the default language", and the profile card shows the same line under the picker when one is chosen. The sign-in page marks nothing, because nothing has been read about the app there.

`offerableLanguages` on `useObjectTranslation()` is now every platform locale table language whatever the app ships. The app's list (`loadLocales`) feeds the new `appContentLanguages`: the table languages it covers, or `null` when not known (in flight, signed out, failed, or naming no table language). `GET /api/v1/i18n/locales` is unchanged and no language pack is added. The organization's default-language setting keeps the app's declared list.
