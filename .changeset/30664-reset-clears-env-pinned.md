---
'@objectstack/service-settings': patch
---

fix(service-settings): a namespace reset clears the value stored beneath an env pin, so the old value does not come back when the variable is removed

Clause-②: no
Metadata-protocol: none

- **The reset clears beneath a pin.** `SettingsService.resetNamespace` and the built-in `reset` settings action skipped every key an `OS_*` override in force pins, so a value stored beneath the pin survived the reset and took over again the day the variable was removed. The reset now clears that stored value too, with the same clear a single `null` write to a pinned key makes: it changes nothing in force (the key still answers the env value, `source: 'env'`, `locked: true`), it records the same `reset` audit row and change event, and once the variable is removed the key reads its default. A pinned key with nothing stored beneath it is left alone, and a key no variable pins is reset as before.
- **The count includes those keys.** `resetNamespace` returns the number of keys it cleared, pinned ones included.
- **The reset's answer says what is still pinned.** When an environment variable still pins some of the namespace's keys, the `reset` action's message adds one sentence with their number ("2 setting(s) remain pinned by environment variables."), in all eleven languages the answer is written in. A namespace no variable pins gets the same message as before.
