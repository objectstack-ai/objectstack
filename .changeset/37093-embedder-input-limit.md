---
'@objectstack/embedder-openai': patch
'@objectstack/spec': patch
---

feat(embedder-openai): an over-limit input is refused, not truncated — known-model input limits and one shared token estimate

Clause-②: yes
Metadata-protocol: none

`OpenAIEmbedder.embed()` now measures every input before it sends anything. When one input is over the model's per-input token limit, the call fails with an error naming the input's 0-based index, the model, the estimate and the limit; nothing is sent, so the provider never silently truncates the text and drops its tail from the index. An input at or under the limit is sent unchanged.

- The known-model table gains each model's provider-documented per-input limit: OpenAI `text-embedding-3-small` / `-3-large` / `ada-002` 8192, DashScope `text-embedding-v3` 8192 and `-v2` / `-v1` 2048, BigModel `embedding-3` 3072 and `embedding-2` 512, SiliconFlow `BAAI/bge-m3` 8192 and `BAAI/bge-large-zh-v1.5` / `-en-v1.5` 512.
- New option `OpenAIEmbedderOptions.maxInputTokens` (a positive integer) overrides the table.
- A model that is not in the table, with no `maxInputTokens`, has no limit and warns once per embedder instance. That warning is the same single warning an unknown model already gave for its batch size: one instance warns at most once, naming every option it is missing.

`@objectstack/spec/shared` exports `estimateTokens(text)`, its `TOKEN_ESTIMATE_MARGIN` (1.1) and `ASCII_RUN_CHARS_PER_TOKEN` (4): the one conservative token estimate the embedder uses, for an app that sizes its own chunks to call too. CJK characters and full-width punctuation count 1.5 each, a run of ASCII letters and digits ceil(length / 4) (`ASCII_RUN_CHARS_PER_TOKEN`, 4), any other punctuation mark or character 1, whitespace 0; the sum is multiplied by 1.1 and rounded up.

What to do: nothing for a known model. A call that used to send a text over the model's limit — which the provider truncated — now fails instead; split such texts below the limit. For a model outside the table, set `maxInputTokens` to your provider's documented limit, which also silences the warning; an app that set only `maxBatchSize` for such a model now sees the warning again until it sets `maxInputTokens` too.
