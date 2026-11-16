---
'@object-ui/app-shell': patch
'@object-ui/console': patch
'@object-ui/plugin-chatbot': patch
---

feat(console-ai): an image or PDF attached in the AI chat is uploaded as the user and sent to the agent as a file part

Clause-②: no
Metadata-protocol: none

The console's AI chat used to send only spreadsheet attachments (parsed in the page) and told the model that every other file "was not read". Now:

- The composer shows its attach button and the attachment chips, so a file can be picked, pasted or dropped and seen before it is sent.
- An image (PNG, JPEG, GIF, WebP) or a PDF of at most 10 MiB is uploaded to storage as the signed-in user through the console's upload adapter (`POST /api/v1/storage/upload/presigned`, the bytes, then `POST /api/v1/storage/upload/complete` without `attachTo`), so it belongs to no record yet. The user turn carries one AI SDK file part per uploaded file: `{ type: 'file', mediaType, filename, url, providerMetadata: { objectstack: { fileId } } }`, where `url` is the stored file's address (`/api/v1/storage/files/{fileId}`, made absolute) and never an inline data URL, so the request and the stored conversation stay small. The turn's text names the files it sent.
- A file over the cap, of another type, or whose upload failed is not sent, and the turn's text names it and says why, so the user and the agent both know its content was not read. The turn still sends.
- A spreadsheet keeps the in-page parse, unchanged.

`@object-ui/plugin-chatbot`: `useObjectChat().sendMessage` takes a third, optional argument, `fileParts` (the new exported `ChatFilePart` type), which the API mode sends as the turn's file parts. Its second argument, `files`, is still not sent: upload the files first and pass the result as `fileParts`. Existing two-argument calls are unchanged.

Reading the files is the agent's side: an agent service that does not yet convert these parts for its model sees the file names in the text and the parts it does not read.
