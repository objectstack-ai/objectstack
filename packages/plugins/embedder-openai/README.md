# @objectstack/embedder-openai

OpenAI-compatible embedder for ObjectStack. Works against any endpoint that speaks the `POST /v1/embeddings` shape:

| Provider | `baseUrl` | Typical model |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | `text-embedding-3-small` |
| Azure OpenAI | `https://{resource}.openai.azure.com/openai/deployments/{deployment}` | (deployment name) |
| 阿里通义 DashScope | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `text-embedding-v3` |
| 智谱 BigModel | `https://open.bigmodel.cn/api/paas/v4` | `embedding-3` |
| 硅基流动 SiliconFlow | `https://api.siliconflow.cn/v1` | `BAAI/bge-m3` |
| 火山引擎 Doubao | `https://ark.cn-beijing.volces.com/api/v3` | `doubao-embedding-large-text-240915` |
| MiniMax | `https://api.minimax.chat/v1` | `embo-01` |
| Ollama (local) | `http://localhost:11434/v1` | `bge-m3`, `nomic-embed-text` |
| LiteLLM / vLLM / 自建网关 | (your endpoint) | (your model) |

Implements `IEmbedder` from `@objectstack/spec/contracts`, so it drops into any knowledge adapter that computes vectors. ⚠️ No adapter in this repository does yet — see [Using the embedder](#using-the-embedder).

## Install

```bash
pnpm add @objectstack/embedder-openai
```

## Usage

### OpenAI

```ts
import { OpenAIEmbedder } from '@objectstack/embedder-openai';

const embedder = new OpenAIEmbedder({
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'text-embedding-3-small', // default
});
```

### 阿里通义 DashScope

```ts
import { createOpenAIEmbedder } from '@objectstack/embedder-openai';

const embedder = createOpenAIEmbedder({
  preset: 'dashscope',
  apiKey: process.env.DASHSCOPE_API_KEY!,
  model: 'text-embedding-v3',
});
```

### 硅基流动 SiliconFlow（推荐桌面端）

```ts
const embedder = createOpenAIEmbedder({
  preset: 'siliconflow',
  apiKey: process.env.SILICONFLOW_API_KEY!,
  model: 'BAAI/bge-m3',
});
```

### Ollama（完全离线）

```ts
const embedder = createOpenAIEmbedder({
  preset: 'ollama',
  apiKey: 'ollama', // ignored by ollama but required by interface
  model: 'bge-m3',
});
```

### 智谱 BigModel

```ts
const embedder = createOpenAIEmbedder({
  preset: 'zhipu',
  apiKey: process.env.ZHIPU_API_KEY!,
  model: 'embedding-3',
});
```

## Using the embedder

`OpenAIEmbedder` is a plain `IEmbedder`: construct it and hand it to whatever needs
vectors.

```ts
import { OpenAIEmbedder } from '@objectstack/embedder-openai';

const embedder = new OpenAIEmbedder({ apiKey: process.env.OPENAI_API_KEY! });

const [vector] = await embedder.embed(['ObjectStack turns an app into typed metadata']);
console.log(embedder.id, embedder.dimensions, vector.length);
```

⚠️ **No knowledge adapter in this repository consumes an `IEmbedder` yet.** The two this
repo builds — `@objectstack/knowledge-memory` and `@objectstack/knowledge-ragflow` — take
no embedder option. The vector-computing adapters the contract is written for
(`@objectstack/knowledge-turso`, `@objectstack/knowledge-sqlite-vec`, named in
[`embedder.ts`](../../spec/src/contracts/embedder.ts)) are in no directory of this repo,
so an earlier revision of this page showed a `new KnowledgeTursoPlugin({ embedding })`
example that no reader could install or run.

## Options

| Option | Default | Description |
|---|---|---|
| `apiKey` | — (required) | Bearer token. |
| `model` | `'text-embedding-3-small'` | Upstream model id. |
| `dimensions` | (model default) | Override output dim (Matryoshka models only). |
| `baseUrl` | `'https://api.openai.com/v1'` | Endpoint root (no `/embeddings`). |
| `id` | `'openai'` | Stable id surfaced as `IEmbedder.id`. |
| `headers` | `{}` | Extra request headers. |
| `fetch` | `globalThis.fetch` | Inject for tests / custom transport. |

## Contract

Implements [`IEmbedder`](../../spec/src/contracts/embedder.ts):

```ts
interface IEmbedder {
  readonly id: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}
```

## License

Apache-2.0. See [LICENSING.md](../../../LICENSING.md).
