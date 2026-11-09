// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The values an administrator can pick for a notification preference's
 * `topic` and `channel` (and a notification template's `topic`), as the
 * preference options door serves them (`preference-options-routes.ts`).
 *
 * [#30208 row 6, ruling E on #30527] The two fields stay free text, exactly as
 * ruled on #25346 (route A): `'*'` is stored as written, nothing new is
 * refused, and the channel seam stays open. What this adds is a LIST the
 * console offers beside the text box (the fields declare `widget:
 * 'notification-topic'` / `'notification-channel'`), so the common path picks
 * a value instead of typing a machine name from memory. A value that is not
 * in the list is still a legal value; the list is a suggestion, never a
 * closed set.
 *
 * ## Topics — three sources, `*` first
 *
 *  - **platform**: {@link PLATFORM_NOTIFICATION_TOPICS}, the fixed topics the
 *    platform's own features send or template under. No package registers its
 *    topics (ADR-0030's `defineTopic()` catalog was never built), so the list is
 *    measured from the send sites and held here.
 *  - **flow**: the topic each `notify` step of this environment's flows names.
 *    A step that names none sends under `notify` (the step's own default), so
 *    `notify` is listed for it. Flows are the environment's metadata, not an
 *    organization's (ADR-0131 D6): every organization of the environment runs
 *    the same flows, so every organization is offered the same flow topics.
 *  - **stored**: the distinct `sys_notification.topic` values the CALLER'S
 *    organization holds, read with an explicit `organization_id` term — the
 *    term is the organization boundary, as it is on the template store's read.
 *    A caller with no organization is offered no stored topic: no event row is
 *    stored without one (ADR-0131 D1).
 *
 * A topic named by several sources is listed once, with each source.
 *
 * ## Channels — `*` first, then every known channel
 *
 * The channels {@link MessagingService.getKnownChannels} knows, in its order:
 * a mounted one answers `configured: true`, a known one whose transport is
 * absent (email with no email service, …) `configured: false`, which the
 * console draws as "not configured". A plugin's own channel id appears once
 * the plugin registers it.
 */

/**
 * The platform's fixed notification topics, measured from their send and
 * template sites: `plugin-approvals` (`approval.*`), `plugin-audit`
 * (`collab.mention`), `plugin-security` (`security.access_upgrade`,
 * `system.upgrade_impact`) and `plugin-auth` (the two phone SMS template
 * topics). Kept sorted; a feature that starts sending a new fixed topic adds
 * it here.
 */
export const PLATFORM_NOTIFICATION_TOPICS: readonly string[] = [
    'approval.comment',
    'approval.escalated',
    'approval.ooo_skipped',
    'approval.ooo_substituted',
    'approval.reassigned',
    'approval.reminder',
    'approval.request_info',
    'approval.requested',
    'approval.returned',
    'approval.sla_breached',
    'auth.phone_invite',
    'auth.phone_otp',
    'collab.mention',
    'security.access_upgrade',
    'system.upgrade_impact',
];

/** The topic a `notify` step sends under when it names none (`notify-node.ts`). */
export const NOTIFY_STEP_DEFAULT_TOPIC = 'notify';

/** The wildcard both fields store for "all" (`preference-resolver.ts`). */
export const PREFERENCE_WILDCARD = '*';

/** Where a listed topic comes from. */
export type PreferenceTopicSource = 'platform' | 'flow' | 'stored';

export interface PreferenceTopicOption {
    /** The value the field stores. */
    value: string;
    /** `true` on the `'*'` entry alone. */
    wildcard: boolean;
    /** Every source that names this topic; empty on the wildcard. */
    sources: PreferenceTopicSource[];
}

export interface PreferenceChannelOption {
    /** The value the field stores. */
    value: string;
    /** `true` on the `'*'` entry alone. */
    wildcard: boolean;
    /** Whether the deployment can send on this channel right now; `true` on the wildcard. */
    configured: boolean;
}

/** The door's success payload. */
export interface PreferenceOptions {
    topics: PreferenceTopicOption[];
    channels: PreferenceChannelOption[];
}

/** The engine read the stored-topic source makes: one grouped `aggregate`. */
export interface PreferenceOptionsEngine {
    aggregate(objectName: string, query: Record<string, unknown>, options?: { context?: unknown }): Promise<unknown[]>;
}

/** What the read is composed over — each asked when a request arrives. */
export interface PreferenceOptionsSources {
    /** Every known channel and whether it is mounted (`MessagingService.getKnownChannels`). */
    knownChannels(): Array<{ id: string; configured: boolean }>;
    /** The data engine; `undefined` when none is registered (then no stored topic is read). */
    getData(): PreferenceOptionsEngine | undefined;
    /**
     * This environment's flow definitions, or `undefined` when the kernel
     * carries no metadata protocol to read them from. A read that fails
     * rejects, and the door answers that failure.
     */
    readFlows(): Promise<readonly unknown[] | undefined>;
}

/** The event object whose stored topics are listed. */
export const NOTIFICATION_EVENT_OBJECT_NAME = 'sys_notification';

/**
 * [#30208 row 6] The context the stored-topic read runs under: the explicit
 * system opt-in. The caller of the door is any signed-in member, who holds no
 * read on the platform's event table; what leaves the read is the set of
 * distinct topic names of the caller's OWN organization (the `organization_id`
 * term is the boundary, never the context), no row, no count and no content.
 */
export const PREFERENCE_OPTIONS_SYSTEM_CONTEXT = { isSystem: true } as const;

/** Read the options for a caller acting in `organizationId`. */
export async function readPreferenceOptions(
    sources: PreferenceOptionsSources,
    organizationId: string | undefined,
): Promise<PreferenceOptions> {
    const bySource = new Map<string, Set<PreferenceTopicSource>>();
    const add = (topic: string, source: PreferenceTopicSource): void => {
        if (topic === PREFERENCE_WILDCARD) return;
        let set = bySource.get(topic);
        if (!set) bySource.set(topic, (set = new Set()));
        set.add(source);
    };

    for (const topic of PLATFORM_NOTIFICATION_TOPICS) add(topic, 'platform');
    for (const topic of notifyStepTopics(await sources.readFlows())) add(topic, 'flow');
    for (const topic of await storedTopics(sources.getData(), organizationId)) add(topic, 'stored');

    const order: PreferenceTopicSource[] = ['platform', 'flow', 'stored'];
    const topics: PreferenceTopicOption[] = [
        { value: PREFERENCE_WILDCARD, wildcard: true, sources: [] },
        ...[...bySource.keys()].sort().map((value) => ({
            value,
            wildcard: false,
            sources: order.filter((s) => bySource.get(value)!.has(s)),
        })),
    ];

    const channels: PreferenceChannelOption[] = [
        { value: PREFERENCE_WILDCARD, wildcard: true, configured: true },
        ...sources.knownChannels()
            .filter((c) => c.id !== PREFERENCE_WILDCARD)
            .map((c) => ({ value: c.id, wildcard: false, configured: c.configured })),
    ];

    return { topics, channels };
}

/**
 * The topics the `notify` steps of `flows` send under: a step's own string
 * `topic`, or {@link NOTIFY_STEP_DEFAULT_TOPIC} for a step that names none.
 * Each flow is read as the protocol hands it: the document, or an `{ item }`
 * wrapper around it.
 */
export function notifyStepTopics(flows: readonly unknown[] | undefined): string[] {
    const topics = new Set<string>();
    for (const entry of flows ?? []) {
        const flow = entry && typeof entry === 'object' && 'item' in entry ? (entry as { item: unknown }).item : entry;
        const nodes = (flow as { nodes?: unknown } | null | undefined)?.nodes;
        if (!Array.isArray(nodes)) continue;
        for (const node of nodes) {
            if (!node || typeof node !== 'object' || (node as { type?: unknown }).type !== 'notify') continue;
            const topic = ((node as { config?: { topic?: unknown } }).config ?? {}).topic;
            if (typeof topic === 'string' && topic !== '') topics.add(topic);
            else if (topic === undefined || topic === null || topic === '') topics.add(NOTIFY_STEP_DEFAULT_TOPIC);
        }
    }
    return [...topics];
}

/** The distinct stored topics of one organization; none without an organization or an engine. */
async function storedTopics(data: PreferenceOptionsEngine | undefined, organizationId: string | undefined): Promise<string[]> {
    if (!data || !organizationId) return [];
    // ⛔ Never drop the `organization_id` term: the read runs under the system
    // opt-in, so the term IS the organization boundary.
    const rows = await data.aggregate(
        NOTIFICATION_EVENT_OBJECT_NAME,
        {
            where: { organization_id: organizationId },
            groupBy: ['topic'],
            aggregations: [{ function: 'count', field: 'id', alias: 'events' }],
        },
        { context: PREFERENCE_OPTIONS_SYSTEM_CONTEXT },
    );
    const topics: string[] = [];
    for (const row of rows ?? []) {
        const topic = (row as { topic?: unknown } | null)?.topic;
        if (typeof topic === 'string' && topic !== '') topics.push(topic);
    }
    return topics;
}
