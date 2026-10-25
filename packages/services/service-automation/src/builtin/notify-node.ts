// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { PluginContext } from '@objectstack/core';
import type { AutomationContext, IDataEngine } from '@objectstack/spec/contracts';
import { createRecordWallOrganizationResolver, type RecordOrganizationResolver } from '@objectstack/metadata-core';
import {
    createLazyCounterStore,
    incrementFixedWindow,
    type CounterStore,
} from '@objectstack/plugin-auth/rate-limit-storage';
import { defineActionDescriptor, isExpressionEnvelopeShaped, NotifyConfigSchema } from '@objectstack/spec/automation';
import type { NotifyConfigParsed, NotifyEmailFieldRecipientParsed } from '@objectstack/spec/automation';
import type { AutomationEngine } from '../engine.js';
import { renderTextSlot, type VariableMap } from './template.js';
import { parseNodeConfig } from './parse-config.js';
import { resolveValueSlot, resolveValueSlotMap } from './value-slot-map.js';

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
        /**
         * [#11303] The organization the notification belongs to — the field the
         * whole downstream chain stamps from. `MessagingService.writeEvent`
         * puts it on `sys_notification`, the inbox channel puts it on
         * `sys_inbox_message` and on the `delivered` receipt, and the outbox
         * carries it onto the `sys_notification_delivery` row. It was missing
         * from this structural mirror, so the node could not have passed it
         * even if it had tried: four tables landed 100% org-less on every
         * flow-produced notification.
         */
        organizationId?: string;
        channels?: string[];
    }): Promise<{
        notificationId: string;
        /** Deliveries a channel ACCEPTED — a terminal, observed outcome. */
        delivered: number;
        failed: number;
        /**
         * Deliveries durably accepted into the messaging outbox but NOT yet
         * attempted; their real outcome lands on `sys_notification_delivery`
         * afterwards (#7747).
         *
         * Optional because this is a STRUCTURAL mirror of a service resolved at
         * runtime: an older or third-party messaging implementation may not
         * report it, and absent reads as "nothing is in flight" — which is the
         * only answer such a stack could honestly give.
         */
        enqueued?: number;
    }>;
}

/**
 * Coerce `channels` (string | string[], read RAW — static routing, never
 * evaluated) into a clean string[]: blank entries are dropped.
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

/** A non-empty trimmed string, else undefined. */
function toStr(value: unknown): string | undefined {
    if (value == null) return undefined;
    const s = String(value).trim();
    return s.length > 0 ? s : undefined;
}

/** A record a notification can be about — an object name and a row id. */
interface RecordRef {
    readonly object: string;
    readonly id: string;
}

/**
 * [#23284] The elevated context of the one read below. The organization is read
 * off the STORED row by id, never off a snapshot the run carries: a trigger
 * door may hand a run a `record` its caller wrote, and a caller-written
 * `organization_id` must not decide whose notification this is.
 */
const SUBJECT_ORGANIZATION_READ = { context: { isSystem: true } } as const;

/**
 * [#23284] The organization of the record a notification is ABOUT, for a run
 * whose context carries none (a schedule tick, a record change written by a
 * system context).
 *
 * The candidates are tried in order and the first one that answers wins:
 *
 *  1. the click-through record the node declares (`sourceObject` + `sourceId`)
 *     — what `sys_notification.source_object` / `source_id` store, and the
 *     anchor ADR-0131's ownership inventory attributes a stored notification
 *     by, so the producer and the inventory answer the same question the same
 *     way;
 *  2. the run's trigger record (`AutomationContext.object` + `record.id`) — the
 *     record the run itself is about, the anchor the run's own history row is
 *     stamped from.
 *
 * The column is the object's WALL column (`createRecordWallOrganizationResolver`:
 * an ADR-0066 opt-out has none, then a declared `tenancy.tenantField`, then the
 * kernel's `organization_id`) — "which organization does this record belong
 * to", never the stamp-only divergence the three sanctioned platform-row
 * writers read. An object with no such column, an object the engine does not
 * know, a row that no longer exists and a row whose column is empty each
 * answer nothing, and the next candidate is asked.
 *
 * ⛔ No candidate is a guess: not the install's first organization, not the
 * recipient's membership. When none answers, the emit carries no organization
 * and the engine's system-write rule decides the owner (ADR-0131 D9) — the sole
 * organization under `single`, a refusal where none is derivable. A read that
 * fails propagates: it fails the step rather than quietly dropping to that rule.
 */
async function organizationOfRecordAbout(
    data: IDataEngine,
    resolver: RecordOrganizationResolver,
    candidates: ReadonlyArray<RecordRef | undefined>,
): Promise<string | undefined> {
    for (const candidate of candidates) {
        if (!candidate) continue;
        const column = resolver.organizationFieldFor(candidate.object);
        if (!column) continue;
        const row = await data.findOne(
            candidate.object,
            { where: { id: candidate.id }, fields: ['id', column] },
            SUBJECT_ORGANIZATION_READ,
        );
        const organization = resolver.organizationOf(candidate.object, row);
        if (organization) return organization;
    }
    return undefined;
}

/** The run's trigger record as a {@link RecordRef}, when the run has one. */
function triggerRecordOf(context: AutomationContext): RecordRef | undefined {
    const object = toStr(context.object);
    const id = toStr((context.record as { id?: unknown } | undefined)?.id);
    return object && id ? { object, id } : undefined;
}

/**
 * The code a thrown failure carries (`err.code`, the ADR-0112 envelope's
 * machine-readable half), so a step that fails on the engine's refusal names
 * it — `ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED` and the rest — beside the
 * message. Read for the step's TEXT only: `NodeExecutionResult.code` stays
 * reserved for the codes an executor classifies itself.
 */
function thrownCodeOf(err: unknown): string | undefined {
    const code = err !== null && typeof err === 'object' ? (err as { code?: unknown }).code : undefined;
    return typeof code === 'string' && code.length > 0 ? code : undefined;
}

/** How a returned failure names what a value expression evaluated to — `null`, a map, a number (`42`). */
function evaluatedKindOf(value: unknown): string {
    if (value === null) return '`null`';
    if (value === undefined) return 'nothing';
    if (Array.isArray(value)) return 'a list';
    if (typeof value === 'object') return 'a map';
    return `a ${typeof value} (\`${String(value)}\`)`;
}

/** The `source` of a value envelope, for a failure that names it. */
function sourceOf(envelope: unknown): string {
    const source = (envelope as { source?: unknown } | null)?.source;
    return typeof source === 'string' ? source : '';
}

/** One value slot's resolved value, or the returned failure that refuses it. */
type Resolved<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

/**
 * [#19939] Who the notification goes to — `recipients`, a value slot holding one
 * value or a list of them (`NotifyConfigSchema`; the expression ledger's
 * `eachElement`), resolved to the audience entries handed to the messaging
 * service:
 *
 *  - a string is one recipient as written (a user id or an audience selector);
 *  - a CEL value envelope — the whole value, or one entry of a list — is
 *    evaluated in the run's scope through the one per-slot resolver every
 *    value slot shares (`resolveValueSlot`; `recipients`, `recipients[1]`
 *    names it in a fault), and may evaluate to a recipient, to `null` or a blank string (no
 *    recipient, as a token that resolved to nothing was dropped —
 *    framework#3582), or to a LIST of them, whose every recipient is added.
 *    The 17.x interpolator handed a whole token holding a list, written as a
 *    list entry, on as ONE recipient joined with commas (`'u1,u2'`): the
 *    phantom recipient this reading retires.
 *
 * Anything else an envelope evaluates to — a map, a number, a list holding
 * one — fails the node, naming what it evaluated to and its source; it is
 * never `String(value)`. A `{…}` token never arrives: the contract parse
 * refused it. `empty` names each envelope that evaluated to no recipient, for
 * the guard that fails a node left with none. `computed` names each recipient
 * an envelope evaluated to that reads as an email address, for the check that
 * a user holds it ({@link screenComputedAddresses}).
 */
function resolveRecipients(
    engine: AutomationEngine,
    value: unknown,
    variables: VariableMap,
    context: AutomationContext,
): Resolved<{ recipients: string[]; empty: string[]; computed: ComputedAddress[] }> {
    const recipients: string[] = [];
    const empty: string[] = [];
    const computed: ComputedAddress[] = [];
    const entries: Array<[string, unknown]> = Array.isArray(value)
        ? value.map((entry, index) => [`recipients[${index}]`, entry])
        : value === undefined ? [] : [['recipients', value]];
    for (const [where, raw] of entries) {
        const evaluated = resolveValueSlot(engine, raw, variables, where, context);
        const before = recipients.length;
        const items: Array<[string, unknown]> = Array.isArray(evaluated)
            ? evaluated.map((item, index) => [`${where} evaluated to a list whose entry [${index}] is`, item])
            : [[`${where} evaluated to`, evaluated]];
        for (const [what, item] of items) {
            if (item == null) continue;
            if (typeof item !== 'string') {
                return {
                    ok: false,
                    error:
                        `notify: ${what} ${evaluatedKindOf(item)}, not a recipient — a recipient is a user id or an `
                        + 'audience selector such as `team:ID`, as a string, and a value expression may evaluate to '
                        + `one, to a list of them, or to \`null\` for none — source: \`${sourceOf(raw)}\``,
                };
            }
            const recipient = toStr(item);
            if (recipient === undefined) continue;
            const address = isExpressionEnvelopeShaped(raw) ? mailedAddressOf(recipient) : undefined;
            if (address !== undefined) {
                computed.push({ index: recipients.length, what, source: sourceOf(raw), address });
            }
            recipients.push(recipient);
        }
        if (isExpressionEnvelopeShaped(raw) && recipients.length === before) empty.push(sourceOf(raw));
    }
    return { ok: true, value: { recipients, empty, computed } };
}

/** The user identity object an address is checked against — the messaging resolver's `USER_OBJECT`. */
const USER_OBJECT = 'sys_user';

/**
 * The elevated context of the directory and record reads below — the posture
 * the messaging service's own recipient reads take (`FAN_OUT_SYSTEM_CONTEXT`):
 * each read projects only what it needs, and what it returns leaves this file
 * only as a recipient.
 */
const RECIPIENT_READ = { context: { isSystem: true } } as const;

/** A recipient a value envelope evaluated to that reads as an email address. */
interface ComputedAddress {
    /** Its position in the resolved recipient list. */
    readonly index: number;
    /** Where it came from, as a failure names it (`recipients[1] evaluated to`). */
    readonly what: string;
    /** The envelope's `source`. */
    readonly source: string;
    /** The address the email channel would send to (`a@b.c`, also for `user:a@b.c`). */
    readonly address: string;
}

/**
 * The address the email channel would send `recipient` to, or `undefined`
 * when it sends to none — mirrored from `@objectstack/service-messaging`,
 * which this package takes no runtime dependency on. The chain reads an
 * address in TWO places: the `RecipientResolver` keeps an address-shaped
 * value verbatim when no user holds it, and it hands the remainder of a
 * `user:` value on as the recipient id with no lookup at all; the email
 * channel then sends to any recipient id that is address-shaped. So both
 * `a@b.c` and `user:a@b.c` (and `user:user:a@b.c`, whose remainder is itself
 * address-shaped) reach the mail as an address. `role:` and `team:` yield
 * user ids. `owner_of:` reads a stored owner field, which record writes put
 * there, not the expression, so it is not screened.
 */
function mailedAddressOf(recipient: string): string | undefined {
    if (recipient.startsWith('user:')) {
        const rest = recipient.slice('user:'.length);
        return readsAsAddress(rest) ? rest : undefined;
    }
    if (/^(role|team|owner_of):/.test(recipient)) return undefined;
    return readsAsAddress(recipient) ? recipient : undefined;
}

/**
 * The resolver's and the email channel's linear "looks like an email" test:
 * no whitespace, one `@` not at either end, a dot inside the domain.
 */
function readsAsAddress(recipient: string): boolean {
    if (/\s/.test(recipient)) return false;
    const at = recipient.indexOf('@');
    if (at <= 0 || at !== recipient.lastIndexOf('@') || at === recipient.length - 1) return false;
    const domain = recipient.slice(at + 1);
    const dot = domain.indexOf('.');
    return dot > 0 && dot < domain.length - 1;
}

/**
 * [#25647, ruling 6386629237 letter B] A recipient a value envelope COMPUTED
 * must be a user. An envelope that evaluates to an address a user holds
 * resolves to that user's id here; one that evaluates to an address no user
 * holds fails the node, pointing to `{ emailField }`. An address WRITTEN OUT
 * in the metadata is the author's constant and is not looked at: it never
 * reaches `computed`.
 *
 * Why the line falls there: an expression can build an address from record
 * text a visitor typed, so letting it reach the mail channel lets whoever
 * typed that text choose who this flow mails. The one way to mail a person
 * who is not a user is the email-field recipient, which reads an `email`-typed
 * field and carries the per-address limit ({@link registerNotifyNode}).
 *
 * So the screen runs only for a node whose `channels` name `email`, the one
 * channel that sends to the address itself. Any other node (`inbox` alone,
 * the messaging default) mails nobody, and its recipients go to the messaging
 * resolver as before, which maps an address a user holds to that user.
 *
 * The lookup is the one the messaging resolver makes (`sys_user` by `email`,
 * the id projected), so "a user holds it" means here what it means there. No
 * data engine, or a lookup that fails, fails the node: an address that could
 * not be checked is not sent.
 */
async function screenComputedAddresses(
    data: IDataEngine | undefined,
    recipients: string[],
    computed: readonly ComputedAddress[],
): Promise<Resolved<string[]>> {
    if (computed.length === 0) return { ok: true, value: recipients };
    const screened = [...recipients];
    for (const entry of computed) {
        const address = entry.address;
        const located = `notify: ${entry.what} an email address — source: \`${entry.source}\``;
        if (!data) {
            return {
                ok: false,
                error: `${located}. A computed recipient must be a user, and there is no data engine to look up `
                    + 'whether a user holds that address, so nothing was sent.',
            };
        }
        let user: Record<string, unknown> | null | undefined;
        try {
            user = await data.findOne(USER_OBJECT, { where: { email: address }, fields: ['id'] }, RECIPIENT_READ);
        } catch (err) {
            return {
                ok: false,
                error: `${located}. Looking up the user who holds it failed (${(err as Error).message}), so nothing was sent.`,
            };
        }
        const id = toStr(user?.id);
        if (id === undefined) {
            return {
                ok: false,
                error: `${located}, and no user holds it. A value expression names a user, never builds an `
                    + 'address to mail: an address built from record text lets whoever typed that text choose who '
                    + 'this flow mails. To mail a person who is not a user, give that address its own `notify` node '
                    + 'with `recipients: { emailField: \'FIELD\' }`, naming an `email`-typed field of the record that '
                    + 'triggered the flow, and `channels: \'email\'`. An address written out in the flow is sent as '
                    + 'written.',
            };
        }
        screened[entry.index] = id;
    }
    return { ok: true, value: screened };
}

/**
 * True when `value` is ONE email address and nothing else — the check the
 * address an email-field recipient reads must pass before it is mailed.
 *
 * Stricter than the `email` field type's write check, on purpose: that check
 * (`^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$`) admits a local part holding `,`, `;`,
 * `:`, `<`, `>` or quotes, and a visitor types this value. Here the local part
 * is dot-separated RFC 5322 atoms and the domain is dot-separated hostname
 * labels, so no list separator, display name, header break or audience prefix
 * (`role:` reads as one to the messaging resolver) can pass. ASCII only, on
 * purpose too: an internationalised address, a quoted local part or an
 * IP-literal domain the field type stored is refused, and the refusal says
 * so. Written as plain scans and single-class tests, linear in the input.
 */
function isOneAddress(value: string): boolean {
    if (value.length === 0 || value.length > 254) return false;
    const at = value.indexOf('@');
    if (at <= 0 || at !== value.lastIndexOf('@')) return false;
    const local = value.slice(0, at);
    if (local.length > 64) return false;
    if (!local.split('.').every((atom) => /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+$/.test(atom))) return false;
    const labels = value.slice(at + 1).split('.');
    return labels.length >= 2 && labels.every((label) => label.length <= 63
        && /^[A-Za-z0-9-]+$/.test(label) && !label.startsWith('-') && !label.endsWith('-'));
}

/** True when the parsed `recipients` is an email-field recipient, `{ emailField }`. */
function isEmailFieldRecipient(value: unknown): value is NotifyEmailFieldRecipientParsed {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        && typeof (value as { emailField?: unknown }).emailField === 'string';
}

/**
 * [#25571, ruling 6377887204 letter B] The address an email-field recipient,
 * `{ emailField }`, names: the value of that field on the run's trigger
 * record, read back from the STORED row by id — never off the `record` a run
 * carries, which a trigger door may hand over as its caller wrote it — and
 * checked to be one address ({@link isOneAddress}).
 *
 * Every way there is no address fails the node and says which: a run with no
 * trigger record, no data engine, a row that no longer exists, an empty field,
 * a value that is not one address. The value itself is never echoed into the
 * failure: a visitor typed it.
 */
async function resolveEmailFieldAddress(
    data: IDataEngine | undefined,
    context: AutomationContext,
    field: string,
): Promise<Resolved<string>> {
    const lead = `notify: \`recipients: { emailField: '${field}' }\` mails the address in that field of the record `
        + 'that triggered the flow';
    const trigger = triggerRecordOf(context);
    if (!trigger) {
        return {
            ok: false,
            error: `${lead}, and this run has no trigger record, so nothing was sent. An email-field recipient `
                + 'belongs to a record-triggered flow.',
        };
    }
    const at = `\`${field}\` on ${trigger.object} '${trigger.id}'`;
    if (!data) return { ok: false, error: `${lead}, and there is no data engine to read ${at}, so nothing was sent.` };
    let row: Record<string, unknown> | null | undefined;
    try {
        row = await data.findOne(trigger.object, { where: { id: trigger.id }, fields: ['id', field] }, RECIPIENT_READ);
    } catch (err) {
        return { ok: false, error: `${lead}; reading ${at} failed (${(err as Error).message}), so nothing was sent.` };
    }
    if (!row) {
        return {
            ok: false,
            error: `${lead}, and ${trigger.object} '${trigger.id}' is not stored (deleted, or not written yet), so `
                + 'nothing was sent. The address is read from the stored record.',
        };
    }
    const value = row[field];
    if (value == null || value === '') {
        return {
            ok: false,
            error: `${lead}, and ${at} is empty, so there is no address to mail. Route around this node with a `
                + '`decision` where the field may be blank.',
        };
    }
    if (typeof value !== 'string' || !isOneAddress(value)) {
        return {
            ok: false,
            error: `${lead}, and ${at} does not hold one plain ASCII email address, so nothing was sent. The address `
                + 'must be exactly one mailbox, `name@example.com`, in ASCII letters, digits and the usual mailbox '
                + 'punctuation: no list, display name, separator, quoted local part, IP-literal domain or '
                + 'non-ASCII character.',
        };
    }
    return { ok: true, value };
}

/**
 * [#25571] The per-address limit on email-field recipients: at most
 * {@link EMAIL_FIELD_SENDS_PER_WINDOW} sends to one address per
 * {@link EMAIL_FIELD_SEND_WINDOW_SECONDS}, across every flow and node.
 *
 * The address came from a record a visitor may have filled in, so without a
 * limit a public form becomes a way to mail any inbox as often as it can be
 * submitted. The number is a constant, not a setting: it covers the outcomes
 * one applicant is told about ("received", "returned for documents",
 * "rejected") several times over, and nothing in the tree asks for more.
 */
export const EMAIL_FIELD_SENDS_PER_WINDOW = 5;

/** The window {@link EMAIL_FIELD_SENDS_PER_WINDOW} counts over, in seconds. */
export const EMAIL_FIELD_SEND_WINDOW_SECONDS = 60 * 60;

/** Key prefix of the per-address counter; the address follows it, lowercased. */
const EMAIL_FIELD_COUNTER_PREFIX = 'notify-email-field-sends:';

/**
 * [#19939] The notify value slot holding one string — `sourceId`, the
 * click-through record's id: the string as written, or a CEL value envelope
 * evaluated in the run's scope to one, through the shared per-slot resolver
 * (`resolveValueSlot`). `null` or a blank string leaves the key unset, as a
 * token that resolved to nothing did; anything else fails the node, naming
 * what it evaluated to — never `String(value)`. (`sourceObject` and `actorId`
 * are literals, read as written.)
 */
function resolveStringSlot(
    engine: AutomationEngine,
    key: 'sourceId',
    raw: unknown,
    variables: VariableMap,
    context: AutomationContext,
): Resolved<string | undefined> {
    const evaluated = resolveValueSlot(engine, raw, variables, key, context);
    if (evaluated == null || typeof evaluated === 'string') return { ok: true, value: toStr(evaluated) };
    return {
        ok: false,
        error:
            `notify: ${key} evaluated to ${evaluatedKindOf(evaluated)}, not a string — write a value expression that `
            + 'evaluates to the record id, or to `null` to leave it unset — source: '
            + `\`${sourceOf(raw)}\``,
    };
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
    // [#23284] The data engine the record-anchor read goes through — resolved
    // the way the CRUD nodes resolve theirs — and one wall-column resolver per
    // engine (object schemas are static after registration, so its per-object
    // memo stays true for the engine's life).
    const getData = (): IDataEngine | undefined => {
        try {
            return ctx.getService<IDataEngine>('data') ?? ctx.getService<IDataEngine>('objectql');
        } catch {
            return undefined;
        }
    };
    // [#25571] The store the per-address email-field counter counts in: the
    // kernel `cache` service, resolved when a send is COUNTED (it registers
    // async, possibly after this plugin), else a per-process fallback that
    // announces itself — the one resolution every fleet-wide counter shares.
    const resolveCounterStore = createLazyCounterStore({
        resolveCache: async (): Promise<CounterStore | undefined> => {
            let cache: any;
            try {
                cache = await (ctx as { getServiceAsync?: (name: string) => Promise<unknown> }).getServiceAsync?.('cache');
            } catch {
                return undefined;
            }
            return cache && typeof cache.get === 'function' && typeof cache.set === 'function' ? cache : undefined;
        },
        logger: ctx.logger,
        logPrefix: '[notify]',
        subject: 'per-address email-field send limit',
        degradedImpact:
            'The limit is still enforced, but PER NODE: an N-node deployment admits up to N× the limit to one address',
    });
    let counterFaultWarned = false;
    /**
     * Admit one email-field send to `address`, or refuse it. A counter that
     * cannot be read or written admits, said once at `warn`: a cache outage
     * must not stop every form notification, and the loss is the limit, not
     * a message.
     */
    const admitEmailFieldSend = async (address: string): Promise<boolean> => {
        try {
            const store = await resolveCounterStore();
            const { count } = await incrementFixedWindow(
                store,
                EMAIL_FIELD_COUNTER_PREFIX + address.toLowerCase(),
                EMAIL_FIELD_SEND_WINDOW_SECONDS,
            );
            return count <= EMAIL_FIELD_SENDS_PER_WINDOW;
        } catch (err) {
            if (!counterFaultWarned) {
                counterFaultWarned = true;
                ctx.logger.warn(
                    `[notify] the per-address email-field send counter failed (${(err as Error).message}); `
                    + 'email-field sends are admitted without the limit until it answers again',
                );
            }
            return true;
        }
    };
    let wallResolver: { readonly data: IDataEngine; readonly resolver: RecordOrganizationResolver } | undefined;
    const wallResolverFor = (data: IDataEngine): RecordOrganizationResolver => {
        if (wallResolver?.data !== data) {
            wallResolver = { data, resolver: createRecordWallOrganizationResolver(data) };
        }
        return wallResolver.resolver;
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
                    // [#19939] A VALUE slot holding one value or a list, offered
                    // with no `type` (the contract takes a string, a list of
                    // strings and envelopes, or one envelope) and no marker: the
                    // Studio form keeps its recipients picker, and the marker
                    // rides `NotifyConfigSchema` (`LEDGER_DECLARED_NODE_CONFIG_SCHEMAS`).
                    recipients: {
                        description: 'Who the notification goes to: a user id or an audience selector (such as team:ID) as a string, or a list of them — each entry a string or a CEL value envelope { dialect: \'cel\', source } evaluated per run; an entry that evaluates to a list adds each of its recipients, and with channels: email an address it evaluates to must be a user\'s. A single-brace {token} is refused. To mail a person who is not a user, use { emailField: \'FIELD\' } as the whole value, naming an email field of the record that triggered the flow, with channels: email; at most 5 such emails go to one address per hour.',
                    },
                    // The form edits the bare-string spelling of these two
                    // template slots; the contract (`NotifyConfigSchema`) also
                    // takes the `{ dialect: 'template', source }` envelope that
                    // code-authored flows write with `tmpl`, carrying the same
                    // text. `type` stays `string` because the form's control is
                    // a text box: it is the authoring surface, not the contract.
                    title: {
                        type: 'string',
                        description: 'Notification title, rendered per run with {{ }} placeholders: a variable path with an optional formatter (e.g. {{ record.name }}, {{ record.amount | currency }}). A single-brace {token} is refused. Not localizable — use template for per-locale content. Either this or template is required; mutually exclusive with template.',
                    },
                    message: {
                        type: 'string',
                        description: 'Notification body, rendered per run with {{ }} placeholders like title. Not localizable. Only valid with inline title, never with template.',
                    },
                    // ── Localizable content path (#9205) ─────────────────────
                    // Mirrors `NotifyConfigSchema.template`/`templateData`; the
                    // mutual exclusion with title/message lives in the Zod
                    // contract's superRefine (executed at parse time), matching
                    // how requiredness is owned there rather than by the form.
                    //
                    // This description is the Studio notify inspector's Template
                    // help (served at `GET /api/v1/automation/actions`), so it
                    // reads as product guidance (#22093): the deployment-default
                    // rung is `II18nService.getDefaultLocale()`, and per-recipient
                    // resolution is the maintainer ruling of 2026-09-01 (#13881) —
                    // both recorded here, neither in the help text.
                    template: {
                        type: 'string',
                        description: 'Email template name (the email template\'s name) — the localizable content path: resolved by (name, locale) at delivery time among the email templates (built-in, declared by an app, or authored in Studio), rendering subject/body from that member. The locale is resolved per recipient, after fan-out: the recipient\'s own sys_user.locale when set, else the deployment default locale — so recipients whose personal languages differ receive different members of the same bundle. The node\'s payload.locale is not consulted. Mutually exclusive with inline title/message.',
                    },
                    templateData: {
                        type: 'object',
                        description: 'Render context for the referenced template\'s {{var}} placeholders — each value a CEL value envelope { dialect: \'cel\', source } evaluated per run, or a literal; a single-brace {token} is refused. Only valid together with template.',
                    },
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
                    // [#19939] `sourceId` is a VALUE slot: a string, or a CEL
                    // value envelope evaluated per run. `type` stays `string`
                    // because the form's control is a text box (the authoring
                    // surface, as for a screen's `recordId`); the contract is
                    // `NotifyConfigSchema`. `sourceObject` and `actorId` are
                    // literals, read as written.
                    sourceObject: {
                        type: 'string',
                        description: 'Object name of the record the notification links to (writes sys_notification.source_object) — read as written: a single-brace {token} is not resolved here and is refused, as is a CEL value envelope; write the value. Only takes effect together with sourceId — a half-specified click-through target is dropped at execute time, so the inbox never renders a dead link.',
                    },
                    sourceId: {
                        type: 'string',
                        description: 'Record id the notification links to (writes sys_notification.source_id) — a string, or a CEL value envelope evaluated per run to one, such as { dialect: \'cel\', source: \'record.id\' }; a single-brace {token} is refused. Only takes effect together with sourceObject — a half-specified click-through target is dropped at execute time, so the inbox never renders a dead link. The inbox synthesizes a `/{object}/{id}` deep-link from these.',
                    },
                    actorId: {
                        type: 'string',
                        description: 'User id that caused the event (writes sys_notification.actor_id) — read as written: a single-brace {token} is not resolved here and is refused, as is a CEL value envelope; write the value.',
                    },
                    // `actionUrl` (not `url`) is the deliberate canonical: it is the
                    // name the whole downstream chain uses (sys_notification.action_url,
                    // the channel contract, the REST read model), while `url` elsewhere
                    // in the platform means "HTTP endpoint to call" (#3796).
                    // [#19939] A TEXT slot, rendered with {{ }} holes like `title`.
                    actionUrl: {
                        type: 'string',
                        description: 'Explicit click-through URL, rendered per run with {{ }} placeholders like title (e.g. /crm_case/{{ record.id }}); a single-brace {token} is refused. Overrides the link synthesized from sourceObject/sourceId.',
                    },
                    payload: {
                        type: 'object',
                        description: 'Extra values merged into the notification payload — read as written: a single-brace {token} in any of its strings is not resolved here and is refused, as is a CEL value envelope written as a value; write the value.',
                    },
                },
            },
        }),
        async execute(node, variables, context) {
            // The historical aliases (`to`/`subject`/`body`/`url`) are canonicalized
            // at load by the ADR-0087 D2 conversion 'flow-node-notify-config-aliases'
            // (#3796), so the parse sees only canonical keys. Parsed BEFORE
            // rendering and evaluating — the text slots take `{{ }}` holes and
            // the value slots a CEL value envelope or a literal, and a
            // single-brace token in either is refused (#22110, #19939); the
            // guards below still own "title/recipients resolved to nothing"
            // (#3582), which no static parse can see.
            const parsed = parseNodeConfig<NotifyConfigParsed>('notify', node.id, NotifyConfigSchema, node.config);
            if (!parsed.ok) return parsed.refusal;
            const cfg = parsed.config;

            // [#19939] `recipients` is a VALUE slot holding one value or a list:
            // each envelope is evaluated in the run's scope, a list it
            // evaluates to adds each of its recipients (see `resolveRecipients`).
            //
            // [#25571] An email-field recipient, `{ emailField }`, is the whole
            // value: the address in that field of the trigger record. [#25647]
            // Any other recipient an envelope computed that reads as an address
            // must be a user's when the node mails (`screenComputedAddresses`).
            const emailField = isEmailFieldRecipient(cfg.recipients) ? cfg.recipients.emailField : undefined;
            let recipients: string[];
            let emptyRecipients: string[] = [];
            if (emailField !== undefined) {
                const address = await resolveEmailFieldAddress(getData(), context, emailField);
                if (!address.ok) return { success: false, error: address.error };
                recipients = [address.value];
            } else {
                const audience = resolveRecipients(engine, cfg.recipients, variables, context);
                if (!audience.ok) return { success: false, error: audience.error };
                const mails = toStringList(cfg.channels).includes('email');
                const screened = mails
                    ? await screenComputedAddresses(getData(), audience.value.recipients, audience.value.computed)
                    : { ok: true as const, value: audience.value.recipients };
                if (!screened.ok) return { success: false, error: screened.error };
                recipients = screened.value;
                emptyRecipients = audience.value.empty;
            }
            // `title`/`message` are template slots (`templateExpressionInput`,
            // the input `TemplateExpressionInputSchema` is built from): the parse
            // above normalizes a bare string to the
            // `{ dialect: 'template', source }` envelope an author may also write
            // directly (`tmpl`), so the parsed config holds the envelope in BOTH
            // cases and the text is its `source` — never the envelope itself.
            // The contract also refuses an envelope whose `source` is absent or
            // blank, so a present slot always has text.
            //
            // [#22110] Rendered through the ONE text renderer the screen and
            // `end` text share — the formula template engine's `{{ }}` holes
            // (ADR-0032 D3). An object a hole reaches (`{{ $error }}`) renders as
            // JSON, never `[object Object]` (#3450).
            const title = renderTextSlot(cfg.title?.source, variables) ?? '';
            const body = renderTextSlot(cfg.message?.source, variables) ?? '';
            // #9205 — the localizable content path. `template` is read RAW (a
            // static metadata cross-reference, like `topic`/`channels`);
            // `templateData` is a VALUE slot per key (#19939), so flow state
            // feeds the template's `{{var}}` holes at delivery time: an envelope
            // is evaluated in the run's scope, a literal handed on as written —
            // the resolver every value-slot map shares.
            const template = toStr(cfg.template);
            const templateData = cfg.templateData
                ? resolveValueSlotMap(engine, cfg.templateData, variables, 'templateData', context)
                : undefined;
            const channels = toStringList(cfg.channels);
            const topic = cfg.topic ? String(cfg.topic) : undefined;
            const severity = cfg.severity ? String(cfg.severity) : undefined;
            // [#19939] `actionUrl` is a TEXT slot: rendered through the one text
            // renderer, like `title`, with `{{ }}` holes. A link that renders no
            // text is no link (`undefined`), so the synthesized one below still
            // applies — as an empty one did.
            const actionUrl = renderTextSlot(cfg.actionUrl, variables);
            // [#19939] `payload` is a literal, read as written: no flow
            // computed one, and the contract refused a `{…}` token or an
            // envelope in it.
            const payload = cfg.payload;

            // Click-through target: forwarding `source` lets the messaging
            // service persist sys_notification.source_object/source_id and
            // synthesize a `/{object}/{id}` deep-link for the inbox (#2675). An
            // explicit `actionUrl` still wins over the synthesized link. Read off
            // the canonical flat pair only — the nested `source: { object, id }`
            // form is lifted onto it at load by the ADR-0087 D2 conversion
            // `flow-node-notify-config-aliases` (#4045), so no consumer-side
            // fallback survives — and produced only when BOTH halves resolve: a
            // half-specified link is dropped so the inbox never renders a dead
            // deep-link. [#19939] `sourceId` is a VALUE slot; `sourceObject`
            // and `actorId` are literals, read as written (the contract
            // refused a `{…}` token in either).
            const sourceObject = toStr(cfg.sourceObject);
            const sourceId = resolveStringSlot(engine, 'sourceId', cfg.sourceId, variables, context);
            if (!sourceId.ok) return { success: false, error: sourceId.error };
            const source = sourceObject && sourceId.value
                ? { object: sourceObject, id: sourceId.value }
                : undefined;
            const actorId = toStr(cfg.actorId);

            // With a `template` reference the content lives in the template
            // bundle, resolved by `(name, locale)` at delivery — per recipient,
            // after fan-out (#13881: the recipient's own `sys_user.locale`,
            // else the deployment default) — so there is no inline title to
            // demand (the Zod contract already refused a node carrying NEITHER,
            // and one carrying BOTH).
            if (!title && !template) return { success: false, error: 'notify: title is required' };
            if (recipients.length === 0) {
                // Name the value expressions that came up empty (framework#3582):
                // a recipient that evaluates to nothing is dropped rather than
                // handed on as a phantom audience member, so a node left with
                // none must say which ones did — an empty field, a guard's
                // `null`, an empty list.
                return {
                    success: false,
                    error: emptyRecipients.length > 0
                        ? `notify: at least one recipient is required, but every recipient value expression ` +
                          `evaluated to nothing: ${emptyRecipients.map((source) => `\`${source}\``).join(', ')}. ` +
                          `\`null\`, a blank string and an empty list add no recipient — an empty field on the ` +
                          `record, or a guard's answer for an absent value. Check those values in this run, or ` +
                          `route around this node with a \`decision\` where no recipient is expected.`
                        : 'notify: at least one recipient is required',
                };
            }

            const messaging = getMessaging();
            if (!messaging) {
                ctx.logger.warn(
                    `[notify] no messaging service registered; notification "${title || `template ${template}`}" not delivered`,
                );
                return {
                    success: true,
                    output: { delivered: 0, failed: 0, skipped: true },
                    // #4354 — nothing was delivered, and the run summary must say
                    // so: a nudge sweep whose messaging service is absent is
                    // precisely the "green but inert" case this counter exists for.
                    //
                    // `selected` is what makes that `acted: 0` READABLE — see the
                    // block above `metrics` on the emit path below. Without it a
                    // run whose notify reached nobody folds to
                    // `selected: 0, acted: 0, unmeasured: 0`, which is the same
                    // triple a run with no notify node at all reports.
                    metrics: { selected: recipients.length, acted: 0 },
                };
            }

            // [#11303] The organization this notification belongs to, THREADED
            // from the run's own acting context — never fabricated.
            //
            // Maintainer ruling, 2026-08-24, verbatim: 「11303
            // sys_inbox_message/sys_notification/sys_email 应该写
            // organization_id。」 — a gap, not a design choice, and the
            // PRODUCERS are the fix site.
            //
            // `AutomationContext.tenantId` is the acting run's organization —
            // the same source `audit-writers.ts` hands its own `collab.mention`
            // emit, so the two notification producers agree about whose
            // organization a notification carries. A run that carries one keeps
            // it exactly as before: nothing below is read for it.
            //
            // [#23284] A run that carries NONE — a schedule tick, a record change
            // written by a system context — takes the organization of the record
            // the notification is about (`organizationOfRecordAbout`): the
            // declared click-through record, else the run's trigger record. That
            // read happens inside the `try` below, so a failed read fails the
            // step instead of being dropped.
            //
            // ⛔ There is deliberately NO guessed limb — not "the current
            // organization", not the first organization on the install, not the
            // recipient's first membership. A wrong `organization_id` is worse
            // than a null: a null is visibly missing, while a wrong value is
            // silently authoritative to every report, export and cleanup script
            // that filters by organization. A notification about no record, from
            // a run with no organization, reaches `emit()` with no organization,
            // and its owner is the engine's to decide by ADR-0131 D9 — the sole
            // organization under `single`, a loud refusal
            // (`ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED`) wherever none is
            // derivable, which fails this step below. The WARN that used to
            // predict a NULL row here is gone with the NULL row.
            let organizationId = toStr(context.tenantId);

            // [#25571] Counted when the send is admitted, before anything is
            // written — so a refused send writes no notification at all, and a
            // send the messaging service then fails still spent its unit (the
            // conservative direction for a limit on mail a visitor can cause).
            if (emailField !== undefined && !(await admitEmailFieldSend(recipients[0]))) {
                return {
                    success: false,
                    error: `notify: \`recipients: { emailField: '${emailField}' }\` — the address in that field has `
                        + `reached the per-address limit of ${EMAIL_FIELD_SENDS_PER_WINDOW} emails through email-field `
                        + `recipients per ${EMAIL_FIELD_SEND_WINDOW_SECONDS / 60} minutes, so this one was refused and `
                        + 'nothing was sent. The limit stops a form a visitor fills in from mailing one inbox without end.',
                };
            }

            try {
                if (!organizationId) {
                    const data = getData();
                    if (data) {
                        organizationId = await organizationOfRecordAbout(data, wallResolverFor(data), [
                            source,
                            triggerRecordOf(context),
                        ]);
                    }
                }
                // ADR-0030 single ingress: hand the messaging service a topic +
                // audience + payload; it writes the L2 event and materializes
                // per channel. title/body/url ride in the payload (templates in
                // a later phase fall back to these).
                const result = await messaging.emit({
                    topic: topic ?? 'notify',
                    audience: recipients,
                    // Content rides in the payload per path (#9205): the inline
                    // strings, or the template reference + its render context —
                    // which the outbox snapshots onto each delivery row, so the
                    // template resolution happens at delivery time in the channel
                    // (email-channel.ts reads payload.template). The locale it
                    // resolves with is each recipient's own — `sys_user.locale`,
                    // read AFTER fan-out by the channel, else the deployment
                    // default (#13881). Nothing about the locale is decided
                    // here; a `payload.locale` set by a producer is not read.
                    // On the template path no inline title/body keys are set:
                    // channels without template support fall back to the topic,
                    // which is the honest degraded rendering, not ''.
                    payload: {
                        ...(payload ?? {}),
                        ...(template
                            ? { template, ...(templateData !== undefined ? { templateData } : {}) }
                            : { title, body }),
                        url: actionUrl,
                    },
                    severity,
                    source,
                    actorId,
                    // [#11303] Absent (not null) when neither the run nor the
                    // record the notification is about names an organization:
                    // `EmitInput.organizationId` is optional, and the engine
                    // decides the owner of an emit that carries none (above).
                    ...(organizationId ? { organizationId } : {}),
                    channels: channels.length ? channels : undefined,
                });
                const delivered = Number(result.delivered) || 0;
                const enqueued = Number(result.enqueued) || 0;
                return {
                    success: true,
                    output: {
                        notificationId: result.notificationId,
                        delivered,
                        // Surfaced so a flow author templating the outcome can
                        // tell "sent" from "handed to the outbox", and so the
                        // notification id above has a stated reason to be
                        // followed into `sys_notification_delivery`.
                        enqueued,
                        failed: result.failed,
                    },
                    // A notification IS the action for a nudge/alert sweep, so it
                    // counts toward `acted` (#4354) — otherwise the flow whose
                    // whole job is to notify would report acting on nothing, and
                    // the broken-sweep detector would fire on every healthy run.
                    //
                    // But only a delivery a channel ACCEPTED is countable. With
                    // the outbox in play (ADR-0030 P1) `emit()` returns once the
                    // rows are durable and the dispatcher decides the outcome
                    // afterwards — including dead-lettering an unregistered
                    // channel — so counting the enqueue as `acted` made the run
                    // summary assert a delivery that `sys_notification_delivery`
                    // recorded as `dead` (#7747). The honest answer at the moment
                    // the run settles is "an effect I cannot count yet", which is
                    // exactly `unmeasuredEffect` — the same qualifier a
                    // `connector_action` uses, and pointedly NOT a bare
                    // `acted: 0`, which would claim the run did nothing and trip
                    // the broken-sweep alert on every healthy notify. The alert
                    // is `selected > 0 AND acted = 0 AND unmeasured = 0`, so a
                    // pending delivery correctly suppresses it while refusing to
                    // claim success.
                    //
                    // Waiting for the real outcome is not on the table: a notify
                    // node must not block a flow on a downstream channel.
                    //
                    // ── `selected`: what makes a ZERO dispatch readable (commit ae6dcf6a4) ──
                    //
                    // `acted` and `unmeasuredEffect` above answer "what did this
                    // node cause". Neither can answer "this node tried to notify
                    // somebody and reached NOBODY", and that answer is the one an
                    // operator needs: `emit()` has several paths that return
                    // `delivered: 0, enqueued: 0` after logging a line and nothing
                    // else — an audience that resolved to no recipient, a
                    // preference filter that suppressed every (recipient x
                    // channel) pair, a dedup hit, every enqueue failing. Each of
                    // them lands here as `{ acted: 0 }`, and a run whose only
                    // effect-bearing node is this one then folds to
                    // `selected: 0, acted: 0, unmeasured: 0` — byte for byte the
                    // summary of a run that had nothing to notify about, and of a
                    // run whose notify node never executed at all.
                    //
                    // ⛔ The fix is NOT to report the zero as `unmeasuredEffect`.
                    // That flag means "the count is unknown", and this count is
                    // known and it is zero; claiming otherwise would take the run
                    // OUT of the broken-sweep filter
                    // (`selected > 0 AND acted = 0 AND unmeasured = 0`) — the
                    // platform's own alarm for a green-but-inert sweep — on
                    // precisely the run that should be inside it.
                    //
                    // So the node declares the other half of the pair instead, in
                    // the key that already means it: `selected` is "records this
                    // node READ or matched", and the recipients it addressed are
                    // exactly that. Reporting it costs a delivering run nothing
                    // (`acted`/`unmeasuredEffect` keep it out of the filter) and
                    // buys the zero-delivery run its place inside it, which is
                    // what makes the two runs read differently at all.
                    //
                    // It counts audience ENTRIES the node addressed, not resolved
                    // users: the entry (`role:manager`, a bare id) is what this
                    // node has: expansion happens inside the messaging service and
                    // is not reported back. `selected` and `acted` are not
                    // required to be commensurate anywhere else either — a
                    // `get_record` selects ten and an update acts on three.
                    metrics: enqueued > 0
                        ? { selected: recipients.length, ...(delivered > 0 ? { acted: delivered } : {}), unmeasuredEffect: true }
                        : { selected: recipients.length, acted: delivered },
                };
            } catch (err) {
                // [#23284] A refusal fails the step and names the engine's code —
                // the ADR-0131 D9 refusal of a notification no organization owns
                // reads `notify failed: ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED: …`.
                const code = thrownCodeOf(err);
                return {
                    success: false,
                    error: `notify failed: ${code ? `${code}: ` : ''}${(err as Error).message}`,
                };
            }
        },
    });

    ctx.logger.info('[Notify] 1 built-in node executor registered (notify)');
}
