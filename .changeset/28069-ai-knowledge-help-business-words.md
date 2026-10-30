---
'@objectstack/service-settings': patch
---

fix(service-settings): AI & Embedder and Knowledge help is in business words

Clause-②: no
Metadata-protocol: none

On Setup → Settings → AI & Embedder and Knowledge, the help under several fields read like code comments, in every language: "Forwarded as OPENAI_API_KEY", traces saved "to sys_ai_trace", "Chunks per embed() call", "Per-source values on KnowledgeSource.adapterConfig take precedence", "topK × overFetch". The help now says what each setting does:

- A provider API key or the gateway model is "used instead of the one set in the server configuration".
- Record traces keeps a record of each AI request and its response, so a conversation can be inspected and replayed.
- Batch size is the number of chunks sent to the embedding provider in one request.
- Indexing defaults: a value set on a knowledge source itself wins over these defaults.
- Over-fetch multiplier: search fetches this many times the requested number of results, so enough are left after filtering.

The English, Chinese, Japanese and Spanish text changed together. No setting, default or accepted value changed, and model examples such as openai/gpt-4o stay as written because they are what you type.
