---
'@objectstack/embedder-openai': patch
---

fix(embedder-openai): `embed()` splits its input into batches of the provider's per-request cap, so a reindex larger than the cap is no longer rejected

Clause-②: yes
Metadata-protocol: none

`OpenAIEmbedder.embed()` sent every input in one `/embeddings` request, so a provider that caps the number of inputs per request rejected any call above its cap (阿里通义 DashScope `text-embedding-v3` takes 10, `text-embedding-v1`/`v2` 25, 智谱 `embedding-3` 64, 硅基流动 SiliconFlow 32, OpenAI 2048). It now sends at most the model's documented cap per request, one batch after another, and returns the vectors in input order.

- A model in the embedder's known-model table is batched at its provider's documented cap.
- Any other model is batched at 10 inputs per request, and the embedder logs one warning per instance naming the model.
- The new `maxBatchSize` option (a positive integer; anything else throws at construction) sets the batch size explicitly and silences that warning. Use it when your provider or gateway documents a different cap.
- A failing batch fails the whole call, and no later batch is sent. The error keeps the provider's status and response text and appends the 0-based batch index and the input range, for example `[batch index 1 of 3 (0-based), inputs 10..19]`.

What to do: nothing for the providers listed above. On another provider, set `maxBatchSize` to its documented cap to drop the warning, or to raise the default of 10.
