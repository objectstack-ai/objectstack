---
"@object-ui/plugin-chatbot": patch
"@object-ui/auth": patch
---

Clause-②: no
Metadata-protocol: none

Dependency pins the merged objectstack tree resolves to one copy: `@object-ui/plugin-chatbot` pins `@ai-sdk/react` to `4.0.121` and `ai` to `7.0.118` (the `ai` that `@ai-sdk/react` 4.0.121 itself pins, so the chat transport's types come from one `ai`), and `@object-ui/auth` pins `better-auth` to `1.7.12`.
