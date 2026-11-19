---
'@object-ui/plugin-chatbot': patch
'@object-ui/i18n': patch
---

fix(plugin-chatbot): a file over the chat composer's size limit is named to the user with the limit, instead of only reaching `console.warn`

Clause-②: no
Metadata-protocol: none

A file picked, pasted or dropped into the chat composer that is larger than `maxFileSize` (10 MB by default) used to vanish: it did not attach and nothing told the user why. `ChatbotEnhanced` now shows a notice above the composer naming every refused file and the limit, in the user's language (new pack key `chatbot.composer.fileTooLarge`, in all eleven locales). The notice closes with its close button or on the next send, and a later refusal replaces it.

The vendored `PromptInput` now reports every over-size file of a pick through `onError` with `code: 'max_file_size'` and the refused files in the new optional `files` field. Before, it reported only a pick where every file was over the limit; a pick that mixed sizes attached the small files and dropped the large ones with no report. An `onError` handler that ignores `files` sees one more call, for a mixed pick, with the same `code`.
