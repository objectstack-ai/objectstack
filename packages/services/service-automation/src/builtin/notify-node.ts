// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { PluginContext } from '@objectstack/core';
import type { AutomationContext } from '@objectstack/spec/contracts';
import { defineActionDescriptor, NotifyConfigSchema } from '@objectstack/spec/automation';
import type { NotifyConfigParsed } from '@objectstack/spec/automation';
import type { AutomationEngine } from '../engine.js';
import { interpolate, stringifyForTemplate, type VariableMap } from './template.js';
import { parseNodeConfig } from './parse-config.js';

/**
 * Structural view of `@objectstack/service-messaging`'s service (ADR-0012),
 * declared locally so service-automation does not take a runtime dependency on
 * it — mirrors the `ConnectorRegistrySurface` pattern. The `notify` node
 * resolves whatever object is registered under the `messaging` service and
 * dispatches through this shape; if no such service is present the node
 * degrades to a no-op success.
 */
export interface MessagingServiceSurface {
    emit(input: {
        topic: string;
        audience: string[];
        payload?: Record<string, unknown>;
        severity?: string;
        dedupKey?: string;
        source?: { object: string; id: string };
        actorId?: string;
        channels?: string[];
    }): Promise<{ notificationId: string; delivered: number; failed: number }>;
}

/**
 * Coerce a config value (string | string[]) into a clean string[].
 *
 * Entries that resolved to nothing are DROPPED, not stringified (framework#3582).
 * `String(undefined)` is the six-character string `"undefined"`, which survives
 * `.filter(Boolean)` and was handed to the messaging service as an audience
 * member — so `to: ['{record.owner.manager}']` addressed a user id literally
 * named "undefined": no delivery, no error, and a `sys_notification` row
 * pointing at nobody. Dropping the entry instead lets the empty-recipients
 * guard below report the real problem.
 */
function toStringList(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value
            .filter((v) => v != null)
            .map((v) => String(v).trim())
            .filter(Boolean);
    }
    if (typeof value === 'string' && value.trim()) return [value.trim()];
    return [];
}

/**
 * The `{…}` templates an author wrote in the recipient config, for the
 * diagnostic when none of them resolved. Reading them off the RAW config (not
 * the interpolated result) is the whole point: after interpolation an
 * unresolved token is indistinguishable from an author who configured nothing.
 */
function recipientTemplates(raw: unknown): string[] {
    const out: string[] = [];
    const walk = (v: unknown): void => {
        if (typeof v === 'string') {
            for (const m of v.matchAll(/\{[^{}]+\}/g)) out.push(m[0]);
            return;
        }
        if (Array.isArray(v)) v.forEach(walk);
    };
    walk(raw);
    return [...new Set(out)];
}

/** Coerce an interpolated config value to a non-empty trimmed string, else undefined. */
function toStr(value: unknown): string | undefined {
    if (value == null) return undefined;
    const s = String(value).trim();
    return s.length > 0 ? s : undefined;
}

/**
 * Resolve the click-through target record from the node config, if any.
 *
 * Reads the canonical flat `sourceObject`/`sourceId` keys only — they mirror the
 * `sys_notification.source_object`/`source_id` columns. A target is produced
 * only when BOTH object and id resolve; a half-specified link is dropped so the
 * inbox never renders a dead deep-link.
 *
 * The nested `source: { object, id }` form (the messaging `emit()` surface) used
 * to be tolerated here by a bare `cfg.sourceObject ?? src?.object`. It has
 * graduated into the ADR-0087 D2 conversion layer
 * (`flow-node-notify-config-aliases`, #4045), which lifts it onto the flat pair
 * at load — including the `registerFlow` rehydration seam — so no consumer-side
 * fallback survives and the alias is declared, tested and retirable on schedule
 * (Prime Directive #12). Same graduation path as `object` → `objectName` (#3796).
 */
function resolveSource(
    cfg: Pick<NotifyConfigParsed, 'sourceObject' | 'sourceId'>,
    variables: VariableMap,
    context: AutomationContext,
): { object: string; id: string } | undefined {
    const object = toStr(interpolate(cfg.sourceObject, variables, context));
    const id = toStr(interpolate(cfg.sourceId, variables, context));
    return object && id ? { object, id } : undefined;
}

/**
 * `notify` built-in node (ADR-0012) — outbound notification.
 *
 * Baseline node and the human-notification counterpart to `http`
 * ("raw call") and `connector_action` ("call a registered integration"):
 * `notify` hands a topic + recipients + message to the platform's messaging
 * service, which fans it out across the user's channels (inbox by default).
 *
 * Like the CRUD nodes degrade without a data engine, `notify` degrades to a
 * warning + success when no `messaging` service is registered — the capability
 * simply isn't installed in that stack. Install `MessagingServicePlugin`
 * (`@objectstack/service-messaging`) and the same flow starts delivering, with
 * no flow edit. This is the seam that fixes the "notify drops on the floor"
 * gap (#1292) once messaging is present.
 */
export function registerNotifyNode(engine: AutomationEngine, ctx: PluginContext): void {
    const getMessaging = (): MessagingServiceSurface | undefined => {
        try {
            return ctx.getService<MessagingServiceSurface>('messaging');
        } catch {
            return undefined;
        }
    };

    engine.registerNodeExecutor({
        type: 'notify',
        descriptor: defineActionDescriptor({
            type: 'notify', version: '1.0.0', name: 'Notify',
            description: 'Send an outbound notification to users via the messaging service (inbox / email / push / …).',
            icon: 'bell', category: 'io', source: 'builtin',
            supportsRetry: true,
            // Delivery is outbox-backed inside the messaging service (ADR-0030
            // emit → sys_notification_delivery), so it inherits retry/dead-letter.
            needsOutbox: true,
            paradigms: ['flow', 'approval'],
            // Drives the Studio form + documents the accepted keys. Extra keys
            // are still tolerated (JSON Schema allows additional properties) —
            // this is discoverability, not a lockdown.
            configSchema: {
                // No `required` array: the execute-time guard ("title + ≥1
                // recipient") owns enforcement, and a strict required-check on a
                // RAW stored config would reject a pre-protocol-17 flow whose
                // aliased keys (`to`/`subject`/`body`/`url`) are only rewritten
                // at the load seam ('flow-node-notify-config-aliases', #3796).
                type: 'object',
                properties: {
                    recipients: {
                        description: 'Recipient user id(s) / audience selector(s)',
                    },
                    title: { type: 'string', description: 'Notification title' },
                    message: { type: 'string', description: 'Notification body' },
                    channels: {
                        type: 'array', items: { type: 'string' },
                        description: 'Channels to fan out to (default: inbox)',
                    },
                    topic: { type: 'string', description: 'Event topic (default: "notify")' },
                    // Closed vocabulary, declared as one so the Studio form
                    // offers a choice instead of a free-text box the Zod gate
                    // then refuses at execute time (#7086). Mirrors
                    // `NotifyConfigSchema.severity`; the `screen` node's `mode`
                    // is the in-repo precedent for enum-on-both-sides.
                    severity: {
                        type: 'string', enum: ['info', 'warning', 'critical'],
                        description: 'Severity forwarded to the messaging service',
                    },
                    // ── Click-through target (#2675) ─────────────────────────
                    sourceObject: {
                        type: 'string',
                        description: 'Object name of the record the notification links to (writes sys_notification.source_object). Requires sourceId.',
                    },
                    sourceId: {
                        type: 'string',
                        description: 'Record id the notification links to (writes sys_notification.source_id). Requires sourceObject. The inbox synthesizes a `/{object}/{id}` deep-link from these.',
                    },
                    actorId: {
                        type: 'string',
                        description: 'User id that caused the event (writes sys_notification.actor_id)',
                    },
                    // `actionUrl` (not `url`) is the deliberate canonical: it is the
                    // name the whole downstream chain uses (sys_notification.action_url,
                    // the channel contract, the REST read model), while `url` elsewhere
                    // in the platform means "HTTP endpoint to call" (#3796).
                    actionUrl: {
                        type: 'string',
                        description: 'Explicit click-through URL; overrides the link synthesized from sourceObject/sourceId.',
                    },
                    payload: { type: 'object', description: 'Extra template inputs merged into the notification payload' },
                },
            },
        }),
        async execute(node, variables, context) {
            // The historical aliases (`to`/`subject`/`body`/`url`) are canonicalized
            // at load by the ADR-0087 D2 conversion 'flow-node-notify-config-aliases'
            // (#3796), so the parse sees only canonical keys. Parsed BEFORE
            // interpolation — the contract's slots are string-typed, so `{token}`
            // templates pass; the post-interpolation guards below still own
            // "title/recipients resolved to nothing" (#3582), which no static
            // parse can see.
            const parsed = parseNodeConfig<NotifyConfigParsed>('notify', node.id, NotifyConfigSchema, node.config);
            if (!parsed.ok) return parsed.refusal;
            const cfg = parsed.config;

            const recipientCfg = cfg.recipients ?? [];
            const recipients = toStringList(interpolate(recipientCfg, variables, context));
            // stringifyForTemplate (not String()): a sole-token `{$error}` resolves
            // to the engine's error OBJECT, which String() would render as the
            // useless `[object Object]` (#3450). Serialize it readably instead.
            const title = stringifyForTemplate(interpolate(cfg.title ?? '', variables, context));
            const body = stringifyForTemplate(interpolate(cfg.message ?? '', variables, context));
            const channels = toStringList(cfg.channels);
            const topic = cfg.topic ? String(cfg.topic) : undefined;
            const severity = cfg.severity ? String(cfg.severity) : undefined;
            const urlCfg = cfg.actionUrl;
            const actionUrl = urlCfg
                ? String(interpolate(urlCfg, variables, context) ?? '')
                : undefined;
            const payload = cfg.payload
                ? (interpolate(cfg.payload, variables, context) as Record<string, unknown>)
                : undefined;

            // Click-through target: forwarding `source` lets the messaging
            // service persist sys_notification.source_object/source_id and
            // synthesize a `/{object}/{id}` deep-link for the inbox (#2675). An
            // explicit `actionUrl` still wins over the synthesized link.
            const source = resolveSource(cfg, variables, context);
            const actorId = toStr(interpolate(cfg.actorId, variables, context));

            if (!title) return { success: false, error: 'notify: title is required' };
            if (recipients.length === 0) {
                // Name the templates that came up empty (framework#3582). The
                // dominant cause is a cross-object hop — `{record.owner.manager}`
                // walks `.manager` on a scalar foreign-key id — which used to
                // deliver to a phantom "undefined" audience instead of failing.
                const templates = recipientTemplates(recipientCfg);
                return {
                    success: false,
                    error: templates.length > 0
                        ? `notify: at least one recipient is required, but every recipient template ` +
                          `resolved to nothing: ${templates.join(', ')}. A flow template reads the ` +
                          `trigger record as it was written — a relation field holds a scalar id, not ` +
                          `an expanded record, so \`{record.<lookup>.<field>}\` resolves to nothing. ` +
                          `Add the relation to the start node's \`config.expand\` so the engine ` +
                          `hydrates it, or address the id directly (\`{record.<lookup>}\`).`
                        : 'notify: at least one recipient is required',
                };
            }

            const messaging = getMessaging();
            if (!messaging) {
                ctx.logger.warn(
                    `[notify] no messaging service registered; notification "${title}" not delivered`,
                );
                return {
                    success: true,
                    output: { delivered: 0, failed: 0, skipped: true },
                    // #4354 — nothing was delivered, and the run summary must say
                    // so: a nudge sweep whose messaging service is absent is
                    // precisely the "green but inert" case this counter exists for.
                    metrics: { acted: 0 },
                };
            }

            try {
                // ADR-0030 single ingress: hand the messaging service a topic +
                // audience + payload; it writes the L2 event and materializes
                // per channel. title/body/url ride in the payload (templates in
                // a later phase fall back to these).
                const result = await messaging.emit({
                    topic: topic ?? 'notify',
                    audience: recipients,
                    payload: { ...(payload ?? {}), title, body, url: actionUrl },
                    severity,
                    source,
                    actorId,
                    channels: channels.length ? channels : undefined,
                });
                return {
                    success: true,
                    output: {
                        notificationId: result.notificationId,
                        delivered: result.delivered,
                        failed: result.failed,
                    },
                    // A notification IS the action for a nudge/alert sweep, so it
                    // counts toward `acted` (#4354) — otherwise the flow whose
                    // whole job is to notify would report acting on nothing, and
                    // the broken-sweep detector would fire on every healthy run.
                    metrics: { acted: Number(result.delivered) || 0 },
                };
            } catch (err) {
                return { success: false, error: `notify failed: ${(err as Error).message}` };
            }
        },
    });

    ctx.logger.info('[Notify] 1 built-in node executor registered (notify)');
}
