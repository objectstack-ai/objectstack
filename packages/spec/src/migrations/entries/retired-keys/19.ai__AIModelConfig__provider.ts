// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #37712 — ADR-0049 enforce-or-remove: an agent's `model.provider` was parsed
// and never read. The cloud AI runtime, the one runtime that executes agents,
// applies the model name, `temperature` and `maxTokens` from the block and
// nothing else, and the providers a deployment turns on are its own AI
// settings, a list the agent's four-value enum neither matched nor followed.
// Tombstoned with `retiredKey()` on the strict `AIModelConfigSchema`; D2
// conversion `agent-model-provider-removed` (lossless delete, retired from the
// load path); D3 semantic entry `agent-model-provider-retired`. Registered
// under 19, the spec package's own major.
export const entry = 'ai/AIModelConfig:provider';
