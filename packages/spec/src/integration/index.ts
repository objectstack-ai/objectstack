// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Integration Protocol Exports
 * 
 * External System Connection Protocols
 * - Connector configurations for SaaS, databases, file storage, message queues
 * - GitHub integration (version control, CI/CD)
 * - Vercel integration (deployment, hosting)
 * - Authentication methods (OAuth2, API Key, JWT, SAML)
 * - Data synchronization and field mapping
 * - Webhooks, rate limiting, and retry strategies
 */

// Core Connector Protocol
export * from './connector.zod';

// Connector provider contract (ADR-0097) — declarative instances → live connectors
export * from './connector-provider';
export * from './connector-provider-errors';

// Connector registry vocabulary — origin/state and the descriptor
// `GET /automation/connectors` serves (ADR-0022, ADR-0097 §4, #3017)
export * from './connector-descriptor';

// Connector Templates
export * from './connector/saas.zod';
export * from './connector/database.zod';
export * from './connector/file-storage.zod';
export * from './connector/message-queue.zod';
export * from './connector/github.zod';
export * from './connector/vercel.zod';
