// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `@objectstack/embedder-openai`
 *
 * OpenAI-compatible embedder. Drop-in for any endpoint that speaks the
 * `POST /v1/embeddings` shape:
 *
 *   - OpenAI                  https://api.openai.com/v1
 *   - Azure OpenAI            https://{resource}.openai.azure.com/openai/deployments/{deployment}
 *   - 阿里通义 DashScope       https://dashscope.aliyuncs.com/compatible-mode/v1
 *   - 智谱 BigModel            https://open.bigmodel.cn/api/paas/v4
 *   - 硅基流动 SiliconFlow     https://api.siliconflow.cn/v1
 *   - 火山引擎 Doubao          https://ark.cn-beijing.volces.com/api/v3
 *   - MiniMax                 https://api.minimax.chat/v1
 *   - Ollama (openai shim)    http://localhost:11434/v1
 *   - LiteLLM / vLLM / 任何兼容服务
 *
 * Implements the `IEmbedder` contract from `@objectstack/spec/contracts`.
 */

import type { IEmbedder } from '@objectstack/spec/contracts';
import { estimateTokens, resilientFetch } from '@objectstack/spec/shared';

export interface OpenAIEmbedderOptions {
  /** Bearer token sent as `Authorization: Bearer <apiKey>`. Required. */
  apiKey: string;
  /**
   * Model id sent in the request body. Choose to match your provider:
   *  - OpenAI:        `'text-embedding-3-small'` (default), `'text-embedding-3-large'`
   *  - 阿里通义:       `'text-embedding-v3'`
   *  - 智谱:           `'embedding-3'`
   *  - 硅基流动:       `'BAAI/bge-m3'`, `'BAAI/bge-large-zh-v1.5'`
   *  - 火山 Doubao:    `'doubao-embedding-large-text-240915'`
   *  - Ollama:        `'bge-m3'`, `'nomic-embed-text'`
   *
   * @default 'text-embedding-3-small'
   */
  model?: string;
  /**
   * Override dimensions. Only Matryoshka-style models (OpenAI v3, 智谱 embedding-3,
   * BGE-m3 dense) support truncation. When set, also forwarded to the upstream
   * `dimensions` body field for providers that honour it.
   */
  dimensions?: number;
  /**
   * Endpoint base URL (without `/embeddings`). Defaults to OpenAI's. Set this
   * to point at any compatible provider.
   *
   * @default 'https://api.openai.com/v1'
   */
  baseUrl?: string;
  /** Stable id surfaced as `IEmbedder.id`. @default 'openai' */
  id?: string;
  /** Inject for tests. Defaults to `globalThis.fetch`. */
  fetch?: typeof fetch;
  /** Additional headers (e.g. provider-specific keys, tracing). */
  headers?: Record<string, string>;
  /**
   * Most inputs sent in one `/embeddings` request. `embed()` splits a longer
   * `texts` array into batches of this size, sends them one after another and
   * returns the vectors in input order. Must be a positive integer.
   *
   * Defaults to the provider's documented cap for a model in the known-model
   * table; for any other model, to 10 (the smallest documented cap in that
   * table), with one warning per embedder instance. Set it when your provider
   * or gateway documents a different cap.
   */
  maxBatchSize?: number;
  /**
   * Longest single input the model accepts, in tokens. `embed()` measures
   * every input with the shared `estimateTokens` from `@objectstack/spec/shared`
   * before sending anything, and refuses the whole call when one input's
   * estimate is over this limit — an over-limit input is never sent, so the
   * provider never silently truncates it. Must be a positive integer.
   *
   * Defaults to the provider's documented limit for a model in the
   * known-model table. For any other model there is no limit, with one
   * warning per embedder instance. Set it when your provider or gateway
   * documents a limit.
   */
  maxInputTokens?: number;
}

/**
 * Documented per-request input-count caps (the most array items one
 * `/embeddings` request accepts). A model listed here is batched at its cap
 * without a warning. Only provider-documented caps belong here — a model whose
 * provider documents no item cap is left out and takes
 * {@link DEFAULT_MAX_BATCH_SIZE}.
 *
 * Sources (read 2026-11-24):
 *  - OpenAI: API reference, embeddings `input` — array `maxItems: 2048`.
 *  - 阿里通义 DashScope: text-embedding-synchronous-api — v3 "最多支持 10 条（行）",
 *    v1 / v2 "最多支持 25 条（行）".
 *  - 智谱 BigModel: 文本嵌入 API reference — embedding-3 "数组最大不得超过 64 条".
 *  - 硅基流动 SiliconFlow: create-embeddings — array `maxItems: 32`.
 */
const KNOWN_MAX_BATCH_SIZE: Record<string, number> = {
  // OpenAI
  'text-embedding-3-small': 2048,
  'text-embedding-3-large': 2048,
  'text-embedding-ada-002': 2048,
  // 阿里通义
  'text-embedding-v3': 10,
  'text-embedding-v2': 25,
  'text-embedding-v1': 25,
  // 智谱
  'embedding-3': 64,
  // 硅基流动 / BGE 家族
  'BAAI/bge-m3': 32,
  'BAAI/bge-large-zh-v1.5': 32,
  'BAAI/bge-large-en-v1.5': 32,
};

/**
 * Batch size for a model with no documented cap and no `maxBatchSize`
 * override. Equal to the smallest cap in {@link KNOWN_MAX_BATCH_SIZE}, so an
 * unknown model on any provider listed there is never rejected for its count.
 */
const DEFAULT_MAX_BATCH_SIZE = 10;

/**
 * Documented per-input token limits (the longest single text one
 * `/embeddings` input may be). A model listed here refuses an over-limit
 * input; any other model has no limit unless `maxInputTokens` sets one. Only
 * provider-documented limits belong here.
 *
 * Sources (read 2026-11-24):
 *  - OpenAI: API reference, embeddings create — "The input must not exceed the
 *    max input tokens for the model (8192 tokens for all embedding models)".
 *  - 阿里通义 DashScope: text-embedding-synchronous-api — v3 "最长支持 8,192 Token",
 *    v1 / v2 "最长支持 2,048 Token".
 *  - 智谱 BigModel: 文本嵌入 API reference — "embedding-3 的单条请求最多支持
 *    3072 个Tokens", "embedding-2 的单条请求最多支持 512 个Tokens".
 *  - 硅基流动 SiliconFlow: create-embeddings — "BAAI/bge-m3: 8192",
 *    "BAAI/bge-large-zh-v1.5, BAAI/bge-large-en-v1.5 …: 512".
 */
const KNOWN_MAX_INPUT_TOKENS: Record<string, number> = {
  // OpenAI
  'text-embedding-3-small': 8192,
  'text-embedding-3-large': 8192,
  'text-embedding-ada-002': 8192,
  // 阿里通义
  'text-embedding-v3': 8192,
  'text-embedding-v2': 2048,
  'text-embedding-v1': 2048,
  // 智谱
  'embedding-3': 3072,
  'embedding-2': 512,
  // 硅基流动 / BGE 家族
  'BAAI/bge-m3': 8192,
  'BAAI/bge-large-zh-v1.5': 512,
  'BAAI/bge-large-en-v1.5': 512,
};

/**
 * Known dimensions for popular models. Used as the default when the
 * caller doesn't pass `dimensions` explicitly.
 */
const KNOWN_DIMENSIONS: Record<string, number> = {
  // OpenAI
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
  // 阿里通义
  'text-embedding-v3': 1024,
  'text-embedding-v2': 1536,
  'text-embedding-v1': 1536,
  // 智谱
  'embedding-3': 2048,
  'embedding-2': 1024,
  // 硅基流动 / BGE 家族
  'BAAI/bge-m3': 1024,
  'BAAI/bge-large-zh-v1.5': 1024,
  'BAAI/bge-large-en-v1.5': 1024,
  'BAAI/bge-base-zh-v1.5': 768,
  'BAAI/bge-small-zh-v1.5': 512,
  'bge-m3': 1024,
  // 火山 Doubao
  'doubao-embedding-large-text-240915': 4096,
  'doubao-embedding-text-240715': 2048,
  // Nomic / Ollama defaults
  'nomic-embed-text': 768,
  // MiniMax
  'embo-01': 1536,
};

/**
 * `OpenAIEmbedder` — OpenAI-compatible embedder. One instance per
 * upstream provider + model combination. Pass into any knowledge
 * adapter that expects `IEmbedder`.
 *
 * @example
 * // OpenAI
 * new OpenAIEmbedder({ apiKey: process.env.OPENAI_API_KEY! });
 *
 * @example
 * // 阿里通义 DashScope
 * new OpenAIEmbedder({
 *   apiKey: process.env.DASHSCOPE_API_KEY!,
 *   baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
 *   model: 'text-embedding-v3',
 * });
 *
 * @example
 * // 硅基流动 SiliconFlow + BGE-m3
 * new OpenAIEmbedder({
 *   apiKey: process.env.SILICONFLOW_API_KEY!,
 *   baseUrl: 'https://api.siliconflow.cn/v1',
 *   model: 'BAAI/bge-m3',
 * });
 *
 * @example
 * // Local Ollama
 * new OpenAIEmbedder({
 *   apiKey: 'ollama',
 *   baseUrl: 'http://localhost:11434/v1',
 *   model: 'bge-m3',
 * });
 */
export class OpenAIEmbedder implements IEmbedder {
  readonly id: string;
  readonly dimensions: number;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly requestedDims?: number;
  private readonly extraHeaders: Record<string, string>;
  private readonly maxBatchSize: number;
  private readonly maxInputTokens: number | undefined;

  constructor(opts: OpenAIEmbedderOptions) {
    if (!opts.apiKey) throw new Error('OpenAIEmbedder: apiKey required');
    this.apiKey = opts.apiKey;
    this.id = opts.id ?? 'openai';
    this.model = opts.model ?? 'text-embedding-3-small';
    this.baseUrl = (opts.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.fetchImpl = opts.fetch ?? (globalThis.fetch as typeof fetch);
    this.requestedDims = opts.dimensions;
    this.extraHeaders = opts.headers ?? {};
    this.dimensions =
      opts.dimensions ?? KNOWN_DIMENSIONS[this.model] ?? 1536;
    if (!this.fetchImpl) {
      throw new Error(
        'OpenAIEmbedder: no fetch available; pass options.fetch or run on Node 18+ / a fetch-capable runtime',
      );
    }
    // Once per instance, in ONE warning: the configuration is what is
    // unknown, not any one call.
    const unknown: string[] = [];
    if (opts.maxBatchSize !== undefined) {
      if (!Number.isInteger(opts.maxBatchSize) || opts.maxBatchSize < 1) {
        throw new Error(
          `OpenAIEmbedder: maxBatchSize must be a positive integer, got ${String(opts.maxBatchSize)}`,
        );
      }
      this.maxBatchSize = opts.maxBatchSize;
    } else if (KNOWN_MAX_BATCH_SIZE[this.model] !== undefined) {
      this.maxBatchSize = KNOWN_MAX_BATCH_SIZE[this.model];
    } else {
      this.maxBatchSize = DEFAULT_MAX_BATCH_SIZE;
      unknown.push(
        `not in the batch-size table: no documented per-request input cap, so sending at most ` +
          `${DEFAULT_MAX_BATCH_SIZE} inputs per request (set options.maxBatchSize to your provider's cap)`,
      );
    }
    if (opts.maxInputTokens !== undefined) {
      if (!Number.isInteger(opts.maxInputTokens) || opts.maxInputTokens < 1) {
        throw new Error(
          `OpenAIEmbedder: maxInputTokens must be a positive integer, got ${String(opts.maxInputTokens)}`,
        );
      }
      this.maxInputTokens = opts.maxInputTokens;
    } else if (KNOWN_MAX_INPUT_TOKENS[this.model] !== undefined) {
      this.maxInputTokens = KNOWN_MAX_INPUT_TOKENS[this.model];
    } else {
      this.maxInputTokens = undefined;
      unknown.push(
        'not in the input-limit table: no documented per-input token limit, so inputs are sent at any length ' +
          `and the provider may truncate them (set options.maxInputTokens to your provider's limit)`,
      );
    }
    if (unknown.length > 0) {
      console.warn(
        `OpenAIEmbedder: model '${this.model}' is ${unknown.join('; and ')}. ` +
          'Setting the named option(s) silences this warning.',
      );
    }
  }

  /**
   * Embed `texts`, in batches of at most `maxBatchSize` inputs per request,
   * sent one after another. Vectors come back in input order. A failing batch
   * fails the whole call; the error names its 0-based batch index and input
   * range, and no later batch is sent.
   *
   * Before any request, every input is measured with `estimateTokens`; when
   * one is over the model's input limit the call is refused — nothing is sent
   * and nothing is truncated. The error names the input's index, the model,
   * the estimate and the limit.
   */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (this.maxInputTokens !== undefined) {
      for (let i = 0; i < texts.length; i++) {
        const estimate = estimateTokens(texts[i]);
        if (estimate > this.maxInputTokens) {
          throw new Error(
            `OpenAIEmbedder: input ${i} (0-based) is estimated at ${estimate} tokens, over the ` +
              `${this.maxInputTokens}-token input limit of model '${this.model}'; refused rather than ` +
              'sent for the provider to truncate. Split the text below the limit, or set ' +
              'options.maxInputTokens if your provider documents a higher one. Nothing was sent.',
          );
        }
      }
    }
    const batchCount = Math.ceil(texts.length / this.maxBatchSize);
    const vectors: number[][] = [];
    for (let index = 0; index < batchCount; index++) {
      const start = index * this.maxBatchSize;
      const batch = texts.slice(start, start + this.maxBatchSize);
      const where =
        `batch index ${index} of ${batchCount} (0-based), ` +
        `inputs ${start}..${start + batch.length - 1}`;
      vectors.push(...(await this.embedBatch(batch, where)));
    }
    return vectors;
  }

  private async embedBatch(texts: string[], where: string): Promise<number[][]> {
    const body: Record<string, unknown> = { model: this.model, input: texts };
    if (this.requestedDims) body.dimensions = this.requestedDims;
    let res: Response;
    try {
      res = await resilientFetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
          ...this.extraHeaders,
        },
        body: JSON.stringify(body),
      }, { fetchImpl: this.fetchImpl });
    } catch (err) {
      throw new Error(
        `OpenAIEmbedder (${this.baseUrl}) → request failed: ${err instanceof Error ? err.message : String(err)} [${where}]`,
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `OpenAIEmbedder (${this.baseUrl}) → ${res.status} ${res.statusText}${text ? `: ${text.slice(0, 200)}` : ''} [${where}]`,
      );
    }
    const json = (await res.json()) as { data?: Array<{ embedding: number[] }> };
    const data = json.data ?? [];
    if (data.length !== texts.length) {
      throw new Error(
        `OpenAIEmbedder: expected ${texts.length} vectors, got ${data.length} [${where}]`,
      );
    }
    return data.map((d) => d.embedding);
  }
}

/**
 * Convenience presets for popular Chinese providers — saves callers
 * from memorising base URLs. Pass through `createXxxEmbedder({...})`.
 */
export const OPENAI_COMPATIBLE_PRESETS = {
  openai: 'https://api.openai.com/v1',
  azure: '', // user must provide full deployment URL via baseUrl
  dashscope: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  siliconflow: 'https://api.siliconflow.cn/v1',
  doubao: 'https://ark.cn-beijing.volces.com/api/v3',
  minimax: 'https://api.minimax.chat/v1',
  ollama: 'http://localhost:11434/v1',
} as const;

export type OpenAICompatiblePreset = keyof typeof OPENAI_COMPATIBLE_PRESETS;

export interface PresetEmbedderOptions
  extends Omit<OpenAIEmbedderOptions, 'baseUrl'> {
  /** Pick a known provider; sets `baseUrl` automatically. */
  preset?: OpenAICompatiblePreset;
  /** Explicit override; takes precedence over `preset`. */
  baseUrl?: string;
}

/**
 * Helper: pick a provider by preset name. Equivalent to constructing
 * `OpenAIEmbedder` with the matching `baseUrl`.
 *
 * @example
 * createOpenAIEmbedder({ preset: 'dashscope', apiKey, model: 'text-embedding-v3' })
 */
export function createOpenAIEmbedder(opts: PresetEmbedderOptions): OpenAIEmbedder {
  const baseUrl =
    opts.baseUrl ??
    (opts.preset ? OPENAI_COMPATIBLE_PRESETS[opts.preset] : undefined);
  return new OpenAIEmbedder({ ...opts, baseUrl, id: opts.id ?? opts.preset ?? 'openai' });
}

export default OpenAIEmbedder;
