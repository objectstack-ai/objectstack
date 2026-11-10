---
'@object-ui/core': patch
'@object-ui/i18n': patch
'@object-ui/console': patch
---

fix(console): the audit log reads the grid's clock, and the zh-CN settings page uses full-width punctuation

Clause-②: no
Metadata-protocol: none

The Console's audit log formatted its timestamp column with the bare `Intl` default. A zh-CN reader saw a 24-hour clock (`2026/11/10 07:24:26`) beside the grid's 12-hour cells (`2026/11/10 上午7:03`), and the column ignored the workspace's declared display zone. It now draws through `formatDateTimeStamp`, a new export of `@object-ui/core`: the grid's numeric date and 12-hour clock, to the second, in the display zone. English is unchanged (`3/4/2020, 3:30:00 PM`); a de-DE reader now reads the 12-hour clock its grid cells already show.

Six zh-CN strings on the settings page (the environment-lock message and chip title, the three encryption-refusal messages, and the unsupported-setting row) put half-width `:` and `,` inside Chinese sentences; they now use `：` and `，`. No key was added, removed or moved.
