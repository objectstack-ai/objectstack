---
'@object-ui/plugin-chatbot': patch
---

Clause-②: no
Metadata-protocol: none

A model picked in the chat composer now stays picked after you send. The composer cleared its message box by resetting the whole form, and the model picker in that form answered the reset by switching back to the default model, so the next question silently ran on the default. Sending now clears only the message box.
