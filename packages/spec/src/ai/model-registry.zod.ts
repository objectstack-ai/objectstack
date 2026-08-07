// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { TemplateExpressionInputSchema } from '../shared/expression.zod';

/**
 * AI Model Registry Protocol
 * 
 * Centralized registry for managing AI models, prompt templates, and model versioning.
 * Enables AI-powered ObjectStack applications to discover and use LLMs consistently.
 */

/**
 * Model Provider Type
 */
import { lazySchema } from '../shared/lazy-schema';
export const ModelProviderSchema = lazySchema(() => z.enum([
  'openai',
  'azure_openai',
  'anthropic',
  'google',
  'cohere',
  'huggingface',
  'local',
  'custom',
]));

/**
 * Model Capability
 */
export const ModelCapabilitySchema = lazySchema(() => z.object({
  textGeneration: z.boolean().optional().default(true).describe('Supports text generation'),
  textEmbedding: z.boolean().optional().default(false).describe('Supports text embedding'),
  imageGeneration: z.boolean().optional().default(false).describe('Supports image generation'),
  imageUnderstanding: z.boolean().optional().default(false).describe('Supports image understanding'),
  functionCalling: z.boolean().optional().default(false).describe('Supports function calling'),
  codeGeneration: z.boolean().optional().default(false).describe('Supports code generation'),
  reasoning: z.boolean().optional().default(false).describe('Supports advanced reasoning'),
}));

/**
 * Model Limits
 */
export const ModelLimitsSchema = lazySchema(() => z.object({
  maxTokens: z.number().int().positive().describe('Maximum tokens per request'),
  contextWindow: z.number().int().positive().describe('Context window size'),
  maxOutputTokens: z.number().int().positive().optional().describe('Maximum output tokens'),
  rateLimit: z.object({
    requestsPerMinute: z.number().int().positive().optional(),
    tokensPerMinute: z.number().int().positive().optional(),
  }).optional(),
}));

/**
 * Model Pricing
 */
export const ModelPricingSchema = lazySchema(() => z.object({
  currency: z.string().optional().default('USD'),
  inputCostPer1kTokens: z.number().optional().describe('Cost per 1K input tokens'),
  outputCostPer1kTokens: z.number().optional().describe('Cost per 1K output tokens'),
  embeddingCostPer1kTokens: z.number().optional().describe('Cost per 1K embedding tokens'),
}));

/**
 * Model Configuration
 */
export const ModelConfigSchema = lazySchema(() => z.object({
  /** Identity */
  id: z.string().describe('Unique model identifier'),
  name: z.string().describe('Model display name'),
  version: z.string().describe('Model version (e.g., "gpt-4-turbo-2024-04-09")'),
  provider: ModelProviderSchema,
  
  /** Capabilities */
  capabilities: ModelCapabilitySchema,
  limits: ModelLimitsSchema,
  
  /** Pricing */
  pricing: ModelPricingSchema.optional(),
  
  /** Configuration */
  endpoint: z.string().url().optional().describe('Custom API endpoint'),
  apiKey: z.string().optional().describe('API key (Warning: Prefer secretRef)'),
  secretRef: z.string().optional().describe('Reference to stored secret (e.g. system:openai_api_key)'),
  region: z.string().optional().describe('Deployment region (e.g., "us-east-1")'),
  
  /** Metadata */
  description: z.string().optional(),
  tags: z.array(z.string()).optional().describe('Tags for categorization'),
  deprecated: z.boolean().optional().default(false),
  recommendedFor: z.array(z.string()).optional().describe('Use case recommendations'),
}));

/**
 * Prompt Template Variable
 */
export const PromptVariableSchema = lazySchema(() => z.object({
  name: z.string().describe('Variable name (e.g., "user_name", "context")'),
  type: z.enum(['string', 'number', 'boolean', 'object', 'array']).default('string'),
  required: z.boolean().default(false),
  defaultValue: z.unknown().optional(),
  description: z.string().optional(),
  validation: z.object({
    minLength: z.number().optional(),
    maxLength: z.number().optional(),
    pattern: z.string().optional(),
    enum: z.array(z.unknown()).optional(),
  }).optional(),
}));

/**
 * Prompt Template
 */
export const PromptTemplateSchema = lazySchema(() => z.object({
  /** Identity */
  id: z.string().describe('Unique template identifier'),
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Template name (snake_case)'),
  label: z.string().describe('Display name'),
  
  /** Template Content */
  system: TemplateExpressionInputSchema.optional().describe('System prompt — supports {{var}} interpolation'),
  user: TemplateExpressionInputSchema.describe('User prompt template — supports {{var}} interpolation'),
  assistant: z.string().optional().describe('Assistant message prefix'),
  
  /** Variables */
  variables: z.array(PromptVariableSchema).optional().describe('Template variables'),
  
  /** Model Configuration */
  modelId: z.string().optional().describe('Recommended model ID'),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().optional(),
  topP: z.number().optional(),
  frequencyPenalty: z.number().optional(),
  presencePenalty: z.number().optional(),
  stopSequences: z.array(z.string()).optional(),
  
  /** Metadata */
  version: z.string().optional().default('1.0.0'),
  description: z.string().optional(),
  category: z.string().optional().describe('Template category (e.g., "code_generation", "support")'),
  tags: z.array(z.string()).optional(),
  examples: z.array(z.object({
    input: z.record(z.string(), z.unknown()).describe('Example variable values'),
    output: z.string().describe('Expected output'),
  })).optional(),
}));

/**
 * Model Registry Entry
 */
export const ModelRegistryEntrySchema = lazySchema(() => z.object({
  model: ModelConfigSchema,
  status: z.enum(['active', 'deprecated', 'experimental', 'disabled']).default('active'),
  priority: z.number().int().default(0).describe('Priority for model selection'),
  fallbackModels: z.array(z.string()).optional().describe('Fallback model IDs'),
  healthCheck: z.object({
    enabled: z.boolean().default(true),
    intervalSeconds: z.number().int().default(300),
    lastChecked: z.string().optional().describe('ISO timestamp'),
    status: z.enum(['healthy', 'unhealthy', 'unknown']).default('unknown'),
  }).optional(),
}));

/**
 * Model Registry
 */
export const ModelRegistrySchema = lazySchema(() => z.object({
  name: z.string().describe('Registry name'),
  models: z.record(z.string(), ModelRegistryEntrySchema).describe('Model entries by ID'),
  promptTemplates: z.record(z.string(), PromptTemplateSchema).optional().describe('Prompt templates by name'),
  defaultModel: z.string().optional().describe('Default model ID'),
  enableAutoFallback: z.boolean().default(true).describe('Auto-fallback on errors'),
}));

/**
 * Model Selection Criteria
 */
export const ModelSelectionCriteriaSchema = lazySchema(() => z.object({
  capabilities: z.array(z.string()).optional().describe('Required capabilities'),
  maxCostPer1kTokens: z.number().optional().describe('Maximum acceptable cost'),
  minContextWindow: z.number().optional().describe('Minimum context window size'),
  provider: ModelProviderSchema.optional(),
  tags: z.array(z.string()).optional(),
  excludeDeprecated: z.boolean().default(true),
}));

// Type exports
export type ModelProvider = z.infer<typeof ModelProviderSchema>;
export type ModelCapability = z.infer<typeof ModelCapabilitySchema>;
/** Post-parse shape of {@link ModelCapability} — defaults applied, transforms run (ADR-0122). */
export type ModelCapabilityParsed = z.infer<typeof ModelCapabilitySchema>;
export type ModelLimits = z.infer<typeof ModelLimitsSchema>;
export type ModelPricing = z.infer<typeof ModelPricingSchema>;
/** Post-parse shape of {@link ModelPricing} — defaults applied, transforms run (ADR-0122). */
export type ModelPricingParsed = z.infer<typeof ModelPricingSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
/** Post-parse shape of {@link ModelConfig} — defaults applied, transforms run (ADR-0122). */
export type ModelConfigParsed = z.infer<typeof ModelConfigSchema>;
export type PromptVariable = z.infer<typeof PromptVariableSchema>;
/** Post-parse shape of {@link PromptVariable} — defaults applied, transforms run (ADR-0122). */
export type PromptVariableParsed = z.infer<typeof PromptVariableSchema>;
export type PromptTemplate = z.infer<typeof PromptTemplateSchema>;
/** Post-parse shape of {@link PromptTemplate} — defaults applied, transforms run (ADR-0122). */
export type PromptTemplateParsed = z.infer<typeof PromptTemplateSchema>;
export type ModelRegistryEntry = z.infer<typeof ModelRegistryEntrySchema>;
/** Post-parse shape of {@link ModelRegistryEntry} — defaults applied, transforms run (ADR-0122). */
export type ModelRegistryEntryParsed = z.infer<typeof ModelRegistryEntrySchema>;
export type ModelRegistry = z.infer<typeof ModelRegistrySchema>;
/** Post-parse shape of {@link ModelRegistry} — defaults applied, transforms run (ADR-0122). */
export type ModelRegistryParsed = z.infer<typeof ModelRegistrySchema>;
export type ModelSelectionCriteria = z.infer<typeof ModelSelectionCriteriaSchema>;
/** Post-parse shape of {@link ModelSelectionCriteria} — defaults applied, transforms run (ADR-0122). */
export type ModelSelectionCriteriaParsed = z.infer<typeof ModelSelectionCriteriaSchema>;
