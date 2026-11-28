---
'@objectstack/core': minor
'@objectstack/service-i18n': minor
---

fix(i18n): server t() fills {{ name }} holes written with spaces, as the Console does

Clause-②: yes (widening)
Metadata-protocol: semantic

Server-side translations now fill a placeholder written with spaces inside the braces, `{{ name }}`, the same way the Console does. Before, `FileI18nAdapter.t()` and the kernel's in-memory `createMemoryI18n().t()` filled only `{{name}}` and printed `{{ name }}` as written, so one translation showed a value in the Console and raw braces in a server message (a notification, an error). Whitespace (spaces or tabs) between the braces and the name is now allowed on the server too. A placeholder with no value is still left exactly as written, spaces included, and single braces (`{name}`) are still not a placeholder. No change is needed in your bundles: `{{name}}` works as before.
