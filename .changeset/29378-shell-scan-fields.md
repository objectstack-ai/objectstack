---
'@object-ui/mobile': patch
'@object-ui/fields': patch
'@object-ui/i18n': patch
---

feat(fields): offer the mobile shell's code scanner on text and lookup fields

Clause-②: yes
Metadata-protocol: none

- `@object-ui/mobile` types the shell bridge's `scan(opts?)` method: `'scan'` joins `NativeHostMethod`, `ObjectStackNative` gains an optional `scan?(opts)` (a shell older than the scanner does not carry it), `NativeScanOptions` (`formats?: string[]`) is exported, and `nativeScan(opts?)` resolves `unavailable`, `ok` with the decoded text or `null` (the user closed the scanner), or `failed` with the shell's message.
- `@object-ui/fields`: inside the shell, when the bridge announces `scan`, an editable single-line text field and a lookup field show a scan button. A text field takes the decoded text through `onChange`, as a keystroke would; a lookup opens its search with it. A closed scanner changes nothing, and a failure shows the error toast with the shell's message. A plain browser, an older shell, and a read-only or disabled field show no button. `PeoplePicker` gains an optional `initialSearch` prop that the search-first lookup uses to open seeded.
- `@object-ui/i18n`: two keys, `fields.scan.button` and `fields.scan.failed`, in every locale.
