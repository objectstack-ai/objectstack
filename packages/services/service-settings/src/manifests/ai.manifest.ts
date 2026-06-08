// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { SettingsManifest } from '@objectstack/spec/system';
import type { SettingsActionHandler } from '../settings-service.types.js';

// Visibility expressions are written as inline strings here for
// readability. The spec's ExpressionInputSchema accepts a bare string
// and normalises it at parse time, but the inferred TypeScript output
// type expects `{ dialect, source }` objects. Build the manifest as
// `unknown` first, then cast — keeps the manifest source compact.
//
// The actual LLM adapter selection still happens in
// `@objectstack/service-ai`'s plugin (env-var driven by default).
// This manifest gives operators a UI to inspect and override those
// env-derived defaults without redeploying. AIServicePlugin binds to this
// namespace once the kernel is ready; env-locked settings values use the
// OS_AI_* convention and win over UI-stored values.
const manifest = {
  namespace: 'ai',
  version: 1,
  label: 'AI',
  icon: 'Sparkles',
  description:
    'LLM provider, model, credentials, and embedder configuration used by ' +
    'the platform AI and knowledge services. Provider SDK packages (e.g. ' +
    '@ai-sdk/openai for chat, @objectstack/embedder-openai for embeddings) ' +
    'must be installed on the host for the chosen provider to be loadable at runtime.',
  scope: 'global',
  readPermission: 'manage_platform_settings',
  writePermission: 'manage_platform_settings',
  category: 'Infrastructure',
  order: 30,
  specifiers: [
    // ── Provider selection ────────────────────────────────────────
    { type: 'group', id: 'provider', label: 'Provider', required: false,
      description: 'Choose the LLM backend. Memory mode echoes input — useful for tests but never for production.' },
    { type: 'select', key: 'provider', label: 'Provider', required: true, default: 'memory',
      options: [
        { value: 'memory', label: 'Memory (echo — testing only)' },
        { value: 'gateway', label: 'Vercel AI Gateway' },
        { value: 'openai', label: 'OpenAI' },
        { value: 'anthropic', label: 'Anthropic' },
        { value: 'google', label: 'Google Generative AI' },
        // Below: providers expose an OpenAI-compatible Chat Completions API,
        // so they reuse the @ai-sdk/openai SDK with a preset base_url. The
        // plugin's buildAdapterFromValues maps these onto provider="openai"
        // + an auto-filled openai_base_url at runtime.
        { value: 'deepseek', label: 'DeepSeek (OpenAI-compatible)' },
        { value: 'dashscope', label: '阿里通义 DashScope (OpenAI-compatible)' },
        { value: 'cloudflare', label: 'Cloudflare AI Gateway (OpenAI-compatible)' },
        { value: 'siliconflow', label: '硅基流动 SiliconFlow (OpenAI-compatible)' },
        { value: 'openrouter', label: 'OpenRouter (OpenAI-compatible)' },
      ],
    },

    // ── Vercel AI Gateway ─────────────────────────────────────────
    { type: 'group', id: 'gateway', label: 'Vercel AI Gateway', required: false,
      visible: "${data.provider === 'gateway'}",
      description: 'Multi-provider router. The model spec follows `provider/model`, e.g. `openai/gpt-4o`.' },
    { type: 'text', key: 'gateway_model', label: 'Gateway model', required: true,
      description: 'Forwarded as AI_GATEWAY_MODEL. Example: openai/gpt-4o',
      visible: "${data.provider === 'gateway'}" },
    { type: 'password', key: 'gateway_api_key', label: 'Gateway API key',
      required: false, encrypted: true,
      description: 'Optional — required only if the gateway enforces auth.',
      visible: "${data.provider === 'gateway'}" },

    // ── OpenAI ───────────────────────────────────────────────────
    { type: 'group', id: 'openai', label: 'OpenAI', required: false,
      visible: "${data.provider === 'openai'}" },
    { type: 'password', key: 'openai_api_key', label: 'OpenAI API key',
      required: true, encrypted: true,
      description: 'Forwarded as OPENAI_API_KEY. Stored encrypted at rest.',
      visible: "${data.provider === 'openai'}" },
    { type: 'text', key: 'openai_model', label: 'Model', required: false, default: 'gpt-4o',
      description: 'Default model id. Per-agent overrides take precedence.',
      visible: "${data.provider === 'openai'}" },
    { type: 'text', key: 'openai_base_url', label: 'Base URL', required: false,
      description: 'Override for Azure OpenAI or self-hosted gateways. Leave blank for api.openai.com.',
      visible: "${data.provider === 'openai'}" },

    // ── Anthropic ────────────────────────────────────────────────
    { type: 'group', id: 'anthropic', label: 'Anthropic', required: false,
      visible: "${data.provider === 'anthropic'}" },
    { type: 'password', key: 'anthropic_api_key', label: 'Anthropic API key',
      required: true, encrypted: true,
      description: 'Forwarded as ANTHROPIC_API_KEY. Stored encrypted at rest.',
      visible: "${data.provider === 'anthropic'}" },
    { type: 'text', key: 'anthropic_model', label: 'Model', required: false,
      default: 'claude-sonnet-4-20250514',
      visible: "${data.provider === 'anthropic'}" },

    // ── Google Generative AI ─────────────────────────────────────
    { type: 'group', id: 'google', label: 'Google', required: false,
      visible: "${data.provider === 'google'}" },
    { type: 'password', key: 'google_api_key', label: 'Google API key',
      required: true, encrypted: true,
      description: 'Forwarded as GOOGLE_GENERATIVE_AI_API_KEY. Stored encrypted at rest.',
      visible: "${data.provider === 'google'}" },
    { type: 'text', key: 'google_model', label: 'Model', required: false,
      default: 'gemini-2.0-flash',
      visible: "${data.provider === 'google'}" },

    // ── OpenAI-compatible presets (DeepSeek / DashScope / Cloudflare / …) ──
    //
    // These providers all expose `/v1/chat/completions` in OpenAI shape, so
    // we reuse the `@ai-sdk/openai` SDK with a preset base URL. The plugin
    // normalises `provider=deepseek` (etc.) to `provider=openai` at adapter
    // construction time, injecting the right base URL and a sensible default
    // model id. Users only fill in API key + (optionally) model — the URL
    // is preset, eliminating the #1 onboarding mistake.
    { type: 'group', id: 'deepseek', label: 'DeepSeek', required: false,
      visible: "${data.provider === 'deepseek'}",
      description: 'OpenAI-compatible API at https://api.deepseek.com. Base URL is auto-filled.' },
    { type: 'password', key: 'deepseek_api_key', label: 'DeepSeek API key',
      required: true, encrypted: true,
      description: 'sk-... — issued at platform.deepseek.com.',
      visible: "${data.provider === 'deepseek'}" },
    { type: 'text', key: 'deepseek_model', label: 'Model', required: false,
      default: 'deepseek-chat',
      description: 'Examples: deepseek-chat (V3), deepseek-reasoner (R1 thinking).',
      visible: "${data.provider === 'deepseek'}" },

    { type: 'group', id: 'dashscope', label: '阿里通义 DashScope', required: false,
      visible: "${data.provider === 'dashscope'}",
      description: 'OpenAI-compatible endpoint at dashscope.aliyuncs.com/compatible-mode/v1. Base URL is auto-filled.' },
    { type: 'password', key: 'dashscope_api_key', label: 'DashScope API key',
      required: true, encrypted: true,
      description: 'sk-... — issued at dashscope.console.aliyun.com.',
      visible: "${data.provider === 'dashscope'}" },
    { type: 'text', key: 'dashscope_model', label: 'Model', required: false,
      default: 'qwen-plus',
      description: 'Examples: qwen-plus, qwen-max, qwen3-max, qwen-turbo.',
      visible: "${data.provider === 'dashscope'}" },

    { type: 'group', id: 'cloudflare', label: 'Cloudflare AI Gateway', required: false,
      visible: "${data.provider === 'cloudflare'}",
      description:
        'Uses the /compat endpoint so the model id is `provider/model` (e.g. ' +
        '`openai/gpt-4o-mini`, `anthropic/claude-3-5-sonnet`, `deepseek/deepseek-chat`). ' +
        'Note: alibaba/qwen* is NOT supported by Cloudflare /compat — use the DashScope provider for Qwen.' },
    { type: 'text', key: 'cloudflare_account_id', label: 'Cloudflare account id', required: true,
      description: 'The 32-char hex id from your Cloudflare dashboard URL.',
      visible: "${data.provider === 'cloudflare'}" },
    { type: 'text', key: 'cloudflare_gateway_id', label: 'Gateway id', required: false, default: 'default',
      description: 'Gateway name configured in Cloudflare → AI Gateway. Defaults to `default`.',
      visible: "${data.provider === 'cloudflare'}" },
    { type: 'password', key: 'cloudflare_api_key', label: 'Cloudflare AI Gateway token',
      required: true, encrypted: true,
      description: 'Issued in AI Gateway → "API tokens" tab (cfut_… or sk_…).',
      visible: "${data.provider === 'cloudflare'}" },
    { type: 'text', key: 'cloudflare_model', label: 'Model', required: false,
      default: 'openai/gpt-4o-mini',
      description:
        'Format: provider/model. Allowed providers (per Cloudflare /compat): anthropic, openai, groq, ' +
        'mistral, cohere, perplexity, workers-ai, google-ai-studio, vertex, grok, deepseek, cerebras, baseten, parallel.',
      visible: "${data.provider === 'cloudflare'}" },

    { type: 'group', id: 'siliconflow', label: '硅基流动 SiliconFlow', required: false,
      visible: "${data.provider === 'siliconflow'}",
      description: 'OpenAI-compatible endpoint at api.siliconflow.cn/v1. Base URL is auto-filled.' },
    { type: 'password', key: 'siliconflow_api_key', label: 'SiliconFlow API key',
      required: true, encrypted: true,
      visible: "${data.provider === 'siliconflow'}" },
    { type: 'text', key: 'siliconflow_model', label: 'Model', required: false,
      default: 'Qwen/Qwen2.5-7B-Instruct',
      description: 'Examples: Qwen/Qwen2.5-72B-Instruct, deepseek-ai/DeepSeek-V3, meta-llama/Meta-Llama-3.1-8B-Instruct.',
      visible: "${data.provider === 'siliconflow'}" },

    { type: 'group', id: 'openrouter', label: 'OpenRouter', required: false,
      visible: "${data.provider === 'openrouter'}",
      description: 'Multi-provider router at openrouter.ai/api/v1. Base URL is auto-filled.' },
    { type: 'password', key: 'openrouter_api_key', label: 'OpenRouter API key',
      required: true, encrypted: true,
      description: 'sk-or-...',
      visible: "${data.provider === 'openrouter'}" },
    { type: 'text', key: 'openrouter_model', label: 'Model', required: false,
      default: 'openai/gpt-4o-mini',
      description: 'Format: provider/model (e.g. anthropic/claude-3.5-sonnet, deepseek/deepseek-chat).',
      visible: "${data.provider === 'openrouter'}" },

    // ── Generation defaults ──────────────────────────────────────
    { type: 'group', id: 'defaults', label: 'Generation defaults', required: false,
      description: 'Applied when an agent or chat request does not specify its own value.',
      visible: "${data.provider !== 'memory'}" },
    { type: 'slider', key: 'temperature', label: 'Temperature',
      required: false, default: 0.7, min: 0, max: 2, step: 0.1,
      description: '0 = deterministic, 2 = highly creative.',
      visible: "${data.provider !== 'memory'}" },
    { type: 'number', key: 'max_tokens', label: 'Max output tokens',
      required: false, default: 4096, min: 1, max: 1048576,
      description: 'Hard cap on tokens generated per response.',
      visible: "${data.provider !== 'memory'}" },
    { type: 'number', key: 'request_timeout_ms', label: 'Request timeout (ms)',
      required: false, default: 60000, min: 1000, max: 600000,
      visible: "${data.provider !== 'memory'}" },

    // ── Conversation titles ──────────────────────────────────────
    // After the first assistant turn lands, service-ai fires a one-shot
    // LLM call that asks the model to produce a ≤16-char title and
    // PATCHes it onto the conversation. Without this every row in the
    // sidebar shows "New conversation" + a truncated preview.
    { type: 'group', id: 'titles', label: 'Conversation titles', required: false,
      description: 'Auto-generate a short summary title for new conversations.',
      visible: "${data.provider !== 'memory'}" },
    { type: 'toggle', key: 'title_generation_enabled', label: 'Auto-summarize conversation titles',
      required: false, default: true,
      description:
        'When on, the LLM is asked to produce a short title after the first assistant ' +
        'reply. Disable to save tokens, or leave the title blank to let users name ' +
        'conversations manually.',
      visible: "${data.provider !== 'memory'}" },
    { type: 'number', key: 'title_max_length', label: 'Title max length (chars)',
      required: false, default: 16, min: 8, max: 80,
      description: 'Hard cap on the generated title. Anything longer is truncated server-side.',
      visible: "${data.provider !== 'memory' && data.title_generation_enabled !== false}" },

    // ── Observability ────────────────────────────────────────────
    { type: 'group', id: 'observability', label: 'Observability', required: false },
    { type: 'toggle', key: 'trace_enabled', label: 'Record traces',
      required: false, default: true,
      description: 'Persist prompt/response traces to sys_ai_trace for debugging and replay.' },
    { type: 'toggle', key: 'log_prompts', label: 'Log full prompts',
      required: false, default: false,
      description: 'Include rendered prompts (not just metadata) in trace rows. ⚠ May leak PII — disable in regulated environments.' },

    // ── Probe ────────────────────────────────────────────────────
    { type: 'action_button', id: 'test', label: 'Test connection',
      required: false, icon: 'Plug',
      handler: { kind: 'http', method: 'POST', url: '/api/settings/ai/test' } },

    // ════════════════════════════════════════════════════════════════
    // Embedder — text → vector provider used by knowledge / RAG.
    // Decoupled from the chat provider above so an organisation can
    // mix-and-match (e.g. OpenAI for chat + 阿里通义 for embeddings).
    //
    // The preset list mirrors @objectstack/embedder-openai's
    // OPENAI_COMPATIBLE_PRESETS so a UI dropdown maps 1:1 to a
    // runtime baseUrl. The "none" choice is the explicit opt-out
    // for instances that disable knowledge / RAG entirely.
    // ════════════════════════════════════════════════════════════════
    { type: 'group', id: 'embedder', label: 'Embedder', required: false,
      description:
        'Text → vector provider used by knowledge sources and RAG. ' +
        'Independent from the chat provider above — mix providers freely ' +
        '(e.g. OpenAI for chat + 阿里通义 for embeddings).' },
    { type: 'select', key: 'embedder_provider', label: 'Provider',
      required: false, default: 'none',
      options: [
        { value: 'none', label: 'Disabled (no embeddings)' },
        { value: 'openai', label: 'OpenAI' },
        { value: 'azure', label: 'Azure OpenAI' },
        { value: 'dashscope', label: '阿里通义 DashScope' },
        { value: 'zhipu', label: '智谱 BigModel' },
        { value: 'siliconflow', label: '硅基流动 SiliconFlow' },
        { value: 'doubao', label: '火山引擎 Doubao' },
        { value: 'minimax', label: 'MiniMax' },
        { value: 'ollama', label: 'Ollama (local)' },
        { value: 'custom', label: 'Custom (OpenAI-compatible)' },
      ],
    },
    { type: 'password', key: 'embedder_api_key', label: 'Embedder API key',
      required: false, encrypted: true,
      description: 'Bearer token sent as Authorization header. For Ollama any non-empty value works.',
      visible: "${data.embedder_provider && data.embedder_provider !== 'none'}" },
    { type: 'text', key: 'embedder_model', label: 'Model',
      required: false,
      description:
        'Examples — OpenAI: text-embedding-3-small · 阿里通义: text-embedding-v3 · ' +
        '智谱: embedding-3 · 硅基流动: BAAI/bge-m3 · Ollama: bge-m3',
      visible: "${data.embedder_provider && data.embedder_provider !== 'none'}" },
    { type: 'text', key: 'embedder_base_url', label: 'Base URL',
      required: false,
      description:
        'Endpoint root (without /embeddings). Auto-filled from preset; ' +
        'override for proxies or self-hosted gateways.',
      visible: "${data.embedder_provider === 'custom' || data.embedder_provider === 'azure'}" },
    { type: 'number', key: 'embedder_dimensions', label: 'Dimensions',
      required: false, min: 1, max: 8192,
      description:
        'Override output dimensionality (Matryoshka models only — OpenAI v3, 智谱 embedding-3, BGE-m3 dense). ' +
        'Leave blank to use the model default.',
      visible: "${data.embedder_provider && data.embedder_provider !== 'none'}" },
    { type: 'number', key: 'embedder_batch_size', label: 'Batch size',
      required: false, default: 64, min: 1, max: 2048,
      description: 'Chunks per embed() call. Reduce if hitting provider rate / size limits.',
      visible: "${data.embedder_provider && data.embedder_provider !== 'none'}" },
    { type: 'action_button', id: 'test_embedder', label: 'Test embedder',
      required: false, icon: 'Plug',
      handler: { kind: 'http', method: 'POST', url: '/api/settings/ai/test_embedder' } },
  ],
};

/** AI — provider / model / credentials configuration. */
export const aiSettingsManifest = manifest as unknown as SettingsManifest;

/**
 * Built-in fallback action handler for `ai/test`. The real
 * implementation that issues a live `chat()` round-trip lives in
 * `@objectstack/service-ai` and overrides this stub via
 * `registerAction` on `kernel:ready` (mirrors the storage pattern).
 *
 * This fallback only validates the form so the button is still useful
 * when the AI plugin is absent (e.g. in a unit-test kernel that mounts
 * settings only).
 */
export const aiTestActionHandler: SettingsActionHandler = async ({ values, payload }) => {
  // The Settings UI may POST the current (possibly unsaved) form state
  // either as `{ values: {...} }` (nested) or as a bare `{ key: value }`
  // map (Studio default). Prefer those over the persisted snapshot so
  // operators can validate edits before hitting "Save".
  const overrides = extractOverrides(payload);
  const merged: Record<string, unknown> = { ...values, ...overrides };
  const provider = String(merged.provider ?? 'memory');
  values = merged;
  if (provider === 'memory') {
    return {
      ok: true,
      severity: 'warning',
      message: 'Memory provider is an echo stub — no external call to validate. Switch to a real provider for production.',
    };
  }
  if (provider === 'gateway') {
    if (!values.gateway_model) {
      return { ok: false, severity: 'error', message: 'Gateway model is required (e.g. openai/gpt-4o).' };
    }
    return {
      ok: true,
      severity: 'info',
      message: `Vercel AI Gateway configured (model=${values.gateway_model}). Mount @objectstack/service-ai to exercise live calls.`,
    };
  }
  // Cloudflare needs more than just an API key.
  if (provider === 'cloudflare') {
    if (!values.cloudflare_account_id) {
      return { ok: false, severity: 'error', message: 'Cloudflare account id is required.' };
    }
    if (!values.cloudflare_api_key) {
      return { ok: false, severity: 'error', message: 'Cloudflare AI Gateway token is required.' };
    }
    const model = values.cloudflare_model ?? '(default openai/gpt-4o-mini)';
    return {
      ok: true,
      severity: 'info',
      message: `Cloudflare AI Gateway configured (model=${model}). Mount @objectstack/service-ai to exercise live calls.`,
    };
  }
  const keyField = `${provider}_api_key`;
  if (!values[keyField]) {
    return { ok: false, severity: 'error', message: `${provider} API key is required.` };
  }
  const modelField = `${provider}_model`;
  const model = values[modelField] ?? '(default)';
  return {
    ok: true,
    severity: 'info',
    message: `${provider} configured (model=${model}). Mount @objectstack/service-ai to exercise live calls.`,
  };
};

/**
 * Built-in fallback handler for `ai/test_embedder`. Real implementation
 * with a live `embed()` round-trip lives in `@objectstack/service-ai` or
 * `@objectstack/service-knowledge` and overrides this stub at runtime.
 *
 * This fallback validates form completeness only — no network call —
 * so the button is useful even when no embedder plugin is mounted.
 */
export const aiTestEmbedderActionHandler: SettingsActionHandler = async ({ values, payload }) => {
  const overrides = extractOverrides(payload);
  const merged: Record<string, unknown> = { ...values, ...overrides };
  const provider = String(merged.embedder_provider ?? 'none');

  if (provider === 'none') {
    return {
      ok: false,
      severity: 'warning',
      message: 'Embedder is disabled. Pick a provider to enable knowledge / RAG.',
    };
  }

  // For Ollama, an API key is conventionally `ollama` but not enforced.
  if (provider !== 'ollama' && !merged.embedder_api_key) {
    return {
      ok: false,
      severity: 'error',
      message: `${provider} embedder requires an API key.`,
    };
  }

  if ((provider === 'custom' || provider === 'azure') && !merged.embedder_base_url) {
    return {
      ok: false,
      severity: 'error',
      message: `${provider} embedder requires a Base URL.`,
    };
  }

  const model = merged.embedder_model ?? '(provider default)';
  return {
    ok: true,
    severity: 'info',
    message:
      `${provider} embedder configured (model=${model}). ` +
      'Mount @objectstack/embedder-openai + a knowledge adapter to exercise live calls.',
  };
};

function extractOverrides(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return {};
  const p = payload as Record<string, unknown>;
  if (p.values && typeof p.values === 'object' && p.values !== null) {
    return p.values as Record<string, unknown>;
  }
  return p;
}
