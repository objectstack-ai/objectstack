// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_notification_template` refuses a save whose html or mjml body places a
 * hole the renderer cannot encode for where it lands — the notification half
 * of ruling `6335348115` on #25082 (items 2–4), under the maintainer's ruling
 * 3C on #25040: every outlet that renders a text field into HTML escapes by
 * context.
 *
 * ## What is refused
 *
 * A write that leaves a row whose `format` sends its body to the `html` face
 * (`isHtmlFormat`: `html` or `mjml`) with a hole outside the two placements the
 * renderer's encoding is right for — element text and a quoted plain-text
 * attribute value (`template-hole-placement.ts` says where those come from and
 * how a placement is read). Every writer is judged, system context included:
 * the verdict is about the row's content, not the caller's authority, the same
 * stance the object's `channel_renders_template` rule takes.
 *
 * ## Judged over the merged record (ruling item 4)
 *
 * An insert is judged on the row as written, its `format` defaulting as the
 * object declares. An update is judged on the stored row overlaid with the
 * write, on every dispatch path — by id, and per matched row of a predicate
 * update — because the engine binds `previous` on both before any
 * `beforeUpdate` hook runs. So, as with the channel rule, a row stored before
 * this rule that breaks it is refused on ANY edit that leaves it breaking it,
 * until an edit moves its holes, or its format off html / mjml: frozen, not
 * bricked. It is still read, listed and deleted (a delete is not judged), and
 * it keeps rendering and delivering as it did — nothing here runs at send, and
 * no stored row is rewritten. A payload-only judge would let an edit that
 * leaves the body alone pass, which is why the write is not judged alone.
 *
 * ## The envelope
 *
 * `400 VALIDATION_FAILED` (built by `validationFailure`, which both HTTP doors
 * map) with one `fields[]` entry at `field: 'body'`, `code: 'invalid_value'`.
 * Its message names each refused hole and its placement, and the supported
 * placements. An import commit reports it as that row's failure and a bulk
 * update as that record's; a predicate update over a set holding a refused row
 * writes no row. No new error code (ADR-0112, ADR-0114).
 *
 * ## Hooks, not a validation rule
 *
 * A declarative rule's condition is CEL, which has no HTML placement reading;
 * so the invariant is engine `beforeInsert` / `beforeUpdate` hooks, the shape
 * plugin-security's grant-name refusal uses for a check a rule cannot express.
 */

import { validationFailure } from '@objectstack/types';
import { NotificationTemplate } from './objects/notification-template.object.js';
import { isHtmlFormat, TEMPLATE_OBJECT } from './template-renderer.js';
import {
    HOLE_PLACEMENT_LABELS,
    judgeTemplateHtmlHoles,
    SUPPORTED_HOLE_PLACEMENTS,
    type TemplateHtmlHole,
} from './template-hole-placement.js';

/** The `packageId` both hooks register under, so they bind and unbind as one. */
export const TEMPLATE_PLACEMENT_HOOK_PACKAGE = 'service-messaging:template-hole-placement';

const HOOK_PRIORITY = 30;
const BODY_FIELD = 'body';
const FORMAT_FIELD = 'format';

const fields = NotificationTemplate.fields as Record<string, { label?: unknown; defaultValue?: unknown }>;
/** The body column's declared label — what the refusal names it by. */
const BODY_LABEL: string = typeof fields[BODY_FIELD]?.label === 'string' ? (fields[BODY_FIELD].label as string) : 'Body';
/** The format an insert that names none is stored with. */
const DECLARED_FORMAT_DEFAULT: unknown = fields[FORMAT_FIELD]?.defaultValue;

/** How many refused holes the message lists by name before it counts the rest. */
const LISTED_HOLES = 5;

/** The sentence an author reads: the refused holes and their placements, the supported ones, the fix. */
export function holePlacementMessage(refused: readonly TemplateHtmlHole[]): string {
    const listed = refused
        .slice(0, LISTED_HOLES)
        .map((hole) => `${hole.text} in ${HOLE_PLACEMENT_LABELS[hole.placement]}`)
        .join('; ');
    const rest = refused.length > LISTED_HOLES ? `; and ${refused.length - LISTED_HOLES} more` : '';
    const supported = SUPPORTED_HOLE_PLACEMENTS.map((p) => HOLE_PLACEMENT_LABELS[p]).join(' and ');
    // The refused holes and the way out come first: an import row reports the
    // message's head only (`sanitizeRowError` keeps 300 characters).
    return (
        `${BODY_LABEL}: an html or mjml body encodes a hole's value only for ${supported}, so a hole may sit only ` +
        `there. Refused: ${listed}${rest}. Move each refused hole there, or set the format to text or markdown. ` +
        `A link whose address comes from a value belongs in an email template (email_template), which declares ` +
        `that variable as a URL; name it in the notify step's template.`
    );
}

/** The refusal: `VALIDATION_FAILED` (400 at both HTTP doors), `invalid_value` at `body`. */
export function holePlacementError(refused: readonly TemplateHtmlHole[]): Error {
    const message = holePlacementMessage(refused);
    return validationFailure(message, [{ field: BODY_FIELD, code: 'invalid_value', message, label: BODY_LABEL }]);
}

/**
 * The holes a template row's body places where the renderer cannot encode
 * them — empty for a row that renders no html face, and for one whose every
 * hole is placed where its encoding is right.
 */
export function refusedTemplateHoles(row: Record<string, unknown>): TemplateHtmlHole[] {
    if (!isHtmlFormat(row[FORMAT_FIELD])) return [];
    const body = row[BODY_FIELD];
    if (body === null || body === undefined) return [];
    return judgeTemplateHtmlHoles(String(body)).filter((hole) => !hole.supported);
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function assertPlacements(row: Record<string, unknown>): void {
    const refused = refusedTemplateHoles(row);
    if (refused.length > 0) throw holePlacementError(refused);
}

/** `beforeInsert`: one dispatch per row; a row that names no format takes the declared default. */
function onInsert(ctx: any): void {
    if (ctx?.object !== undefined && ctx.object !== TEMPLATE_OBJECT) return;
    const data = ctx?.input?.data;
    if (!isRecord(data)) return;
    const row = data[FORMAT_FIELD] === undefined ? { ...data, [FORMAT_FIELD]: DECLARED_FORMAT_DEFAULT } : data;
    assertPlacements(row);
}

/**
 * `beforeUpdate`: one dispatch per matched row, `previous` bound on both
 * dispatch paths; judged over the stored row overlaid with the write (a key the
 * write carries as `undefined` leaves the stored value standing).
 */
function onUpdate(ctx: any): void {
    if (ctx?.object !== undefined && ctx.object !== TEMPLATE_OBJECT) return;
    const data = ctx?.input?.data;
    if (!isRecord(data)) return;
    const merged: Record<string, unknown> = isRecord(ctx?.previous) ? { ...ctx.previous } : {};
    for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) merged[key] = value;
    }
    assertPlacements(merged);
}

/** The engine surface the hooks bind through — `ObjectQL`'s hook registry. */
export interface PlacementHookEngine {
    registerHook?: (
        event: string,
        handler: (ctx: any) => void | Promise<void>,
        options?: { object?: string | string[]; priority?: number; packageId?: string },
    ) => void;
    unregisterHooksByPackage?: (packageId: string) => number;
}

/**
 * Bind both hooks on the engine. Re-binding replaces the previous binding
 * rather than stacking a second one. Returns `false` when the engine exposes
 * no hook registry (a test double), so the caller can say so.
 */
export function bindTemplateHolePlacement(engine: PlacementHookEngine | null | undefined): boolean {
    if (!engine || typeof engine.registerHook !== 'function') return false;
    unbindTemplateHolePlacement(engine);
    const options = { object: TEMPLATE_OBJECT, priority: HOOK_PRIORITY, packageId: TEMPLATE_PLACEMENT_HOOK_PACKAGE };
    engine.registerHook('beforeInsert', onInsert, options);
    engine.registerHook('beforeUpdate', onUpdate, options);
    return true;
}

/** Unbind both hooks (plugin teardown). */
export function unbindTemplateHolePlacement(engine: PlacementHookEngine | null | undefined): void {
    if (engine && typeof engine.unregisterHooksByPackage === 'function') {
        engine.unregisterHooksByPackage(TEMPLATE_PLACEMENT_HOOK_PACKAGE);
    }
}
