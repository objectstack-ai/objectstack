---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): the tool preview says beside "Open in API Console" that a call needing the server model runs in a chat

Clause-②: no
Metadata-protocol: none

The tool preview's "Open in API Console" link presets the tool's direct run route. That run happens outside a chat turn, and on the hosted cloud it gets no server-side model, so a call that needs one is refused there with nothing on the preview saying why. The link now stays for every tool with a short note beside it (also the link's accessible description): it runs the tool directly, outside a chat, and on the hosted cloud a call that needs the server-side model is refused, so try it in a chat. The note names no tool: tool metadata carries no field saying which calls need the model, and for some tools that depends on the call's arguments. New studio string `engine.toolPreview.openApiConsoleNote` in `en` and `zh`; other languages fall back to `en`.
