---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(console-ai): the attachment notes added to a user's turn follow the conversation's language

Clause-②: no
Metadata-protocol: none

In the console's AI chat, the lines the page adds to a user's turn about its attachments were always Chinese: the spreadsheet brief (headers and sample rows), the line naming the images and PDFs sent as files, and each "not read" line (over the 10 MB cap, type not supported, upload failed). A user chatting in English saw Chinese in their own message, and the agent received it too.

They now follow the conversation's language, the same rule every other piece of text the console sends the agent follows: a turn written in Chinese gets Chinese notes, any other gets English ones, and a turn with files but no words takes the language the conversation is held in. A turn with no attachment is sent exactly as typed, as before. No locale-pack key is added.
