---
'@object-ui/plugin-chatbot': patch
---

fix(plugin-chatbot): the chat composer's accept list reads the HTML `accept` grammar, so a picked CSV, PDF or spreadsheet attaches, and a file of a refused type is named to the user

Clause-②: no
Metadata-protocol: none

The vendored `PromptInput` compared every `accept` token with the file's MIME type, so the extension tokens of `ChatbotEnhanced`'s default list (`.pdf`, `.csv`, `.xlsx`, …) never matched: a picked CSV or PDF did not attach, and the refusal reached only `console.warn`. A token is now read the way the file picker reads it: `.ext` matches the end of the file name, `type/*` matches the MIME prefix, any other token matches the MIME type exactly, all case-insensitive.

A file that still fails is shown to the user: `ChatbotEnhanced` names it, with the accepted list, in the same notice above the composer that names an over-size file, in the user's language (the existing pack sentence `fields.file.typeNotAccepted`; no new key). When one pick refuses files for type and for size, the notice names both.

`PromptInput` now reports every type-refused file of a pick through `onError` with `code: 'accept'` and the refused files in `files`. Before, it reported only a pick where every file was refused, without `files`; a pick that mixed types attached the matching files and dropped the rest with no report. An `onError` handler that ignores `files` sees one more call, for a mixed pick, with the same `code`.
