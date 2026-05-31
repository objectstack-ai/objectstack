// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * platform-objects/integration — External Integration Platform Objects
 *
 * Outbound HTTP webhooks (and, in the future, inbound receivers) live
 * here because they apply to every kernel — standalone, single-tenant,
 * and multi-tenant cloud projects alike. Any project can configure a
 * webhook to notify an external system on record events; the runtime
 * is provided by @objectstack/service-automation's built-in `http_request`
 * node (seeded by AutomationServicePlugin).
 */

export { SysWebhook } from './sys-webhook.object.js';
