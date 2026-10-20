---
'@objectstack/service-settings': patch
---

fix(service-settings): Setup's AI "Test embedder" and Knowledge "Test connection" buttons are answered, and their answers say they checked the form only

Clause-②: no

- **Before.** Both buttons answered `400 SETTINGS_ACTION_FAILED` with "No handler registered for action 'test_embedder' in 'ai'." and "No handler registered for action 'test' in 'knowledge'." The manifests declared both buttons and the package exported both handlers (`aiTestEmbedderActionHandler`, `knowledgeTestActionHandler`), but `SettingsServicePlugin`'s default `actionHandlers` map did not register them.
- **Now.** The default map registers both, beside `mail.test`, `sms.test`, `storage.test` and `ai.test`. A host that passes its own `actionHandlers` still replaces the whole default map, and a plugin can still replace any one handler with `SettingsService.registerAction`.
- **What each button checks.** Both are form checks and send nothing over the network. "Test embedder" checks that a provider is chosen, that an API key is set (Ollama excepted) and that `custom` / `azure` have a Base URL. "Test connection" checks that a managed `libsql://` Turso URL has an auth token and that RAGFlow has a Base URL and an API key. The in-memory adapter answers with a warning that there is no external service to probe.
- **Answer text.** A passing "Test embedder" now ends "This checks the form only — no embedding request was sent." Every passing "Test connection" on Turso or RAGFlow now says "This checks the form only — no connection was attempted." The old "Mount @objectstack/embedder-openai + a knowledge adapter to exercise live calls" and "Mount @objectstack/knowledge-ragflow to exercise live calls" are gone: neither package registers these actions, so mounting it never made either check live.
