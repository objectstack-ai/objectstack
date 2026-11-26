---
'@objectstack/spec': patch
'@objectstack/metadata-protocol': patch
'@objectstack/plugin-security': patch
'@objectstack/cli': patch
---

fix: four refusals say what the author can act on — the clone control by its console label, an empty or short unknown key, and an unknown CLI command

Clause-②: no
Metadata-protocol: none

Nothing new is accepted or refused; only the words change.

- **Packaged permission sets.** The `ITEM_LOCKED` save refusal and the `NOT_OVERRIDABLE` lock refusals sent the admin to a "Clone" action. Studio's Access pillar and Setup label that control "New similar" ("新建类似" in a Chinese session), so the diagnostic and both end-user messages, in every language they ship, now name it that way.
- **Unknown keys.** A refusal naming an empty key printed it as empty backticks; it now says "an empty key (`""`)" and offers no rename. On a key of five characters or fewer, a "Did you mean" rename is offered only when the declared key is one edit away, counting a swap of two adjacent letters as one: `lable` → `label` is still offered, while a removed `aria` is no longer answered with `areas`.
- **CLI.** `os <topic> <unknown>` and `os <unknown>` still exit 2 without running anything, and now name the command as typed (`command environments frobnicate not found`) and end with the help that lists the real ones (`See more help with \`os environments --help\``).
