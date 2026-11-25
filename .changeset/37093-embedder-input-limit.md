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

`@objectstack/spec/shared` exports `estimateTokens(text)`, its `TOKEN_ESTIMATE_MARGIN` (1.1) and `ASCII_RUN_CHARS_PER_TOKEN` (`{ letters: 4, digits: 3, mixed: 2 }`): the one conservative token estimate the embedder uses, for an app that sizes its own chunks to call too. CJK characters and full-width punctuation count 1.5 each, a run of ASCII letters only ceil(length / 4), of digits only ceil(length / 3), and of letters and digits mixed ceil(length / 2), any other punctuation mark or character 1, whitespace 0; the sum is multiplied by 1.1 and rounded up.

The estimate is conservative: on Chinese text it runs about 1.4 times the real token count. It is at or above OpenAI `cl100k` counts on Chinese, mixed Chinese/English and English-heavy text (long words, numbers, URLs, code); text made mostly of random hex or base64 (UUIDs, hashes) can estimate below its real count.

What to do: nothing for a known model. A call that used to send a text over the model's limit — which the provider truncated — now fails instead. Because the estimate errs high, a text whose real count is just under the limit can now be refused too, although it was never truncated. In both cases split the text smaller, or set `maxInputTokens` yourself if you know the model's real count fits. For a model outside the table, set `maxInputTokens` to your provider's documented limit, which also silences the warning; an app that set only `maxBatchSize` for such a model now sees the warning again until it sets `maxInputTokens` too.
