// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Integration Protocol Exports
 *
 * External System Connection Protocols (ADR-0097)
 * - The connector protocol: one `ConnectorSchema`, provider-bound declarative
 *   instances, and the registry descriptor `GET /automation/connectors` serves
 * - Authentication methods (OAuth2, API Key, JWT, SAML)
 * - Data synchronization and field mapping
 * - Webhooks, rate limiting, and retry strategies
 *
 * The per-provider "Connector Templates" (`connector/saas.zod.ts`,
 * `connector/database.zod.ts`, file-storage, message-queue, github, vercel)
 * were removed in #4480. They were the losing side of an architecture decision
 * this module's live half already records: ADR-0023 rejected hand-modelling
 * each external system's shape inside the spec, and ADR-0097's answer is the
 * opposite direction — provider shapes come from the provider itself
 * (connector-openapi materializes from an OpenAPI document, connector-mcp from
 * an MCP server), while the platform defines only the unified protocol. The
 * six files had zero consumers: nothing in this module referenced them, no
 * runtime read them, and `engine.registerConnector()` validates against
 * `ConnectorSchema` from `./connector.zod` alone.
 */

// Core Connector Protocol
export * from './connector.zod';

// Connector provider contract (ADR-0097) — declarative instances → live connectors
export * from './connector-provider';
export * from './connector-provider-errors';

// Connector registry vocabulary — origin/state and the descriptor
// `GET /automation/connectors` serves (ADR-0022, ADR-0097 §4, #3017)
export * from './connector-descriptor';
