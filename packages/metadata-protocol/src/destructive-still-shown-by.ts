// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What still shows a field a refused `object` save would remove or retype: the
 * `stillShownBy` of the `409 DESTRUCTIVE_CHANGE` findings
 * (`DestructiveChangeIssueSchema` in `@objectstack/spec/api`, whose describe is
 * the contract this module computes).
 *
 * "This change loses data" is half of what the person confirming needs; the
 * other half is what breaks on screen: the list that shows the column, the form
 * that edits it, the card that sums it. Each `field_removed` finding names those
 * items, and each `field_type_change` finding names the list-view filters whose
 * operator the new type no longer fits. The findings ride `err.issues`, which
 * every door relays verbatim, so no door computes or reshapes anything.
 *
 * ## Ported from the hosted build door
 *
 * The semantics of the removal half are the hosted build door's
 * (`field-shown-by.ts` in the hosted tree), adapted to this write face: the
 * judge is the platform's own, asked twice. The stack is judged with the field
 * and again without it, and every finding the second run adds is a place that
 * still shows the field; a finding both runs share is a fact about the stack,
 * not about this field, and is left out. No position table lives here, so a
 * position the judges learn to read reaches this answer with no change here.
 * One step is added on top, because no rule makes it: a dashboard widget shows a
 * field THROUGH its dataset, so a widget bound to a dimension or measure the
 * removal leaves dangling is named too, `via` that dataset.
 *
 * ## What it reads
 *
 * One served listing per metadata type (`getMetaItems`: the code packages'
 * registered items with the environment's stored active rows folded over them),
 * read together, and only when a finding needs it. No record is read, and no
 * item is read on its own. A listing that cannot be read leaves `stillShownBy`
 * absent — "not computed" — rather than an empty list that would read as
 * "shown nowhere".
 */

import { validateFormLayout, validateReferenceIntegrity, validateWidgetBindings } from '@objectstack/lint';
import type { FieldStillShownBy } from '@objectstack/spec/api';
import { filterOperatorFieldTypeFit } from '@objectstack/spec/data';
import { isViewFilterOrGroup } from '@objectstack/spec/ui';

/** One destructive-change finding as `detectDestructiveObjectChanges` produces it. */
export interface DestructiveFinding {
    code: string;
    field?: string;
    message: string;
    stillShownBy?: FieldStillShownBy[];
}

/** Lists the served items of one metadata type (singular). */
export type ServedItemsLister = (type: string) => Promise<readonly unknown[]>;

type AnyRec = Record<string, unknown>;

const isRecord = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** The stack collections the judges read, with the metadata type each one lists. */
const COLLECTIONS = [
    ['objects', 'object'],
    ['views', 'view'],
    ['datasets', 'dataset'],
    ['dashboards', 'dashboard'],
    ['pages', 'page'],
    ['flows', 'flow'],
    ['reports', 'report'],
] as const;

type Collection = (typeof COLLECTIONS)[number][0];
type Stack = Record<Collection, readonly unknown[]>;

const TYPE_OF: Readonly<Record<string, string>> = Object.fromEntries(COLLECTIONS);
const PATH = new RegExp(`^(${COLLECTIONS.map(([c]) => c).join('|')})\\[(\\d+)\\]\\.?(.*)$`);

/** How many items a finding's prose names before it says how many more. */
const PROSE_CAP = 5;

/**
 * The findings, each `field_removed` and `field_type_change` one carrying the
 * items that still show its field. Every other finding passes through as it
 * came. `prev` is the stored body, `next` the body the save would write.
 */
export async function withStillShownBy(
    objectName: string,
    prev: unknown,
    next: unknown,
    issues: readonly DestructiveFinding[],
    listServed: ServedItemsLister,
): Promise<DestructiveFinding[]> {
    const removed = issues.filter((i) => i.code === 'field_removed' && i.field).map((i) => i.field as string); // adr0112-ok: D6 a field-addressed finding code of the refusal's issues[], not an error.code
    const retyped = issues.filter((i) => i.code === 'field_type_change' && i.field).map((i) => i.field as string); // adr0112-ok: D6 a field-addressed finding code of the refusal's issues[], not an error.code
    if (removed.length === 0 && retyped.length === 0) return [...issues];

    // A type change needs the views alone; a removal needs every collection.
    const wanted = removed.length > 0 ? COLLECTIONS : COLLECTIONS.filter(([c]) => c === 'views');
    let stack: Stack;
    try {
        const lists = await Promise.all(wanted.map(([, type]) => listServed(type)));
        stack = { objects: [], views: [], datasets: [], dashboards: [], pages: [], flows: [], reports: [] };
        wanted.forEach(([collection], i) => { stack[collection] = lists[i] ?? []; });
    } catch (error) {
        // Not computed, said once: the refusal itself stands unchanged.
        console.warn(
            `[Protocol] the destructive-change refusal of object '${objectName}' could not read the served `
            + `metadata it names still-shown items from: ${(error as { message?: string } | null)?.message ?? String(error)}. `
            + 'Its findings carry no `stillShownBy`.',
        );
        return [...issues];
    }

    const shownByRemoval = removed.length > 0 ? removalSurfaces(stack, objectName, prev, next, removed) : undefined;
    const nextFields = isRecord(next) && isRecord(next.fields) ? next.fields : {};
    return issues.map((issue) => {
        if (!issue.field) return { ...issue };
        if (issue.code === 'field_removed') { // adr0112-ok: D6 a field-addressed finding code of the refusal's issues[], not an error.code
            const shown = shownByRemoval?.get(issue.field);
            if (!shown) return { ...issue };
            return withProse({ ...issue, stillShownBy: shown }, 'Still shown by');
        }
        if (issue.code === 'field_type_change') {
            const definition = nextFields[issue.field];
            if (!isRecord(definition) || typeof definition.type !== 'string') return { ...issue };
            const shown = unfitViewFilters(stack.views, objectName, issue.field, definition);
            return withProse({ ...issue, stillShownBy: shown }, 'Still filtered by an operator its new type does not fit in');
        }
        return { ...issue };
    });
}

/** The finding's prose, ending with the items it names when there are any. */
function withProse(issue: DestructiveFinding, lead: string): DestructiveFinding {
    const shown = issue.stillShownBy ?? [];
    if (shown.length === 0) return issue;
    const named = shown.slice(0, PROSE_CAP).map(phrase).join('; ');
    const more = shown.length > PROSE_CAP ? ` (+${shown.length - PROSE_CAP} more)` : '';
    return { ...issue, message: `${issue.message} ${lead}: ${named}${more}; the save does not edit them.` };
}

function phrase(s: FieldStillShownBy): string {
    const at = s.where.join(', ');
    const via = s.via ? `, through dataset "${s.via}"` : '';
    const operator = s.operator ? `, operator '${s.operator}'` : '';
    return `${s.type} "${s.name}" (${at}${via}${operator})`;
}

// ── field_removed: the platform's judges, asked with and without the field ──

interface Finding {
    rule: string;
    path: string;
}

/** Every finding the three judges `os validate` runs answer for `stack`, or `undefined` when one threw. */
function judge(stack: AnyRec): Finding[] | undefined {
    try {
        return [
            ...validateReferenceIntegrity(stack),
            ...validateFormLayout(stack),
            ...validateWidgetBindings(stack),
        ];
    } catch {
        return undefined;
    }
}

const findingKey = (f: Finding): string => `${f.rule}@${f.path}`;

/**
 * For each removed field, the items whose references resolve with it and dangle
 * without it. The saved object is judged as the save would write it (`next`),
 * with every removed field's stored definition put back; each run then takes one
 * field out again. `undefined` for a field when a judge could not run.
 */
function removalSurfaces(
    stack: Stack,
    objectName: string,
    prev: unknown,
    next: unknown,
    removed: readonly string[],
): Map<string, FieldStillShownBy[]> {
    const answers = new Map<string, FieldStillShownBy[]>();
    const prevFields = isRecord(prev) && isRecord(prev.fields) ? prev.fields : {};
    const nextBody = isRecord(next) ? next : {};
    const nextFields = isRecord(nextBody.fields) ? nextBody.fields : {};
    const restored: AnyRec = { ...nextFields };
    for (const field of removed) if (prevFields[field] !== undefined) restored[field] = prevFields[field];
    const withAll: AnyRec = { ...nextBody, name: str(nextBody.name) ?? objectName, fields: restored };

    const others = stack.objects.filter((o) => !(isRecord(o) && o.name === objectName));
    const at = (objectBody: AnyRec): Stack => ({ ...stack, objects: [...others, objectBody] });
    const baselineStack = at(withAll);
    const baseline = judge(baselineStack);
    if (!baseline) return answers;
    const seen = new Set(baseline.map(findingKey));

    for (const field of removed) {
        const { [field]: _gone, ...rest } = restored;
        const findings = judge(at({ ...withAll, fields: rest }));
        if (!findings) continue;
        answers.set(field, surfacesOf(baselineStack, findings.filter((f) => !seen.has(findingKey(f)))));
    }
    return answers;
}

/** The added findings, grouped by the item they sit in, plus the widgets that show the field through a dataset. */
function surfacesOf(stack: Stack, added: readonly Finding[]): FieldStillShownBy[] {
    const byItem = new Map<string, FieldStillShownBy>();
    const add = (type: string, name: string, where: string, via?: string): void => {
        const id = `${type}:${name}:${via ?? ''}`;
        const entry = byItem.get(id) ?? { type, name, where: [], ...(via ? { via } : {}) };
        if (!entry.where.includes(where)) entry.where.push(where);
        byItem.set(id, entry);
    };
    // dataset name → the dimension and measure names the removal leaves dangling.
    const datasetLosses = new Map<string, Set<string>>();
    for (const finding of added) {
        const match = PATH.exec(finding.path);
        if (!match) continue;
        const [, collection, index, rest] = match;
        const item = stack[collection as Collection][Number(index)];
        const name = isRecord(item) ? str(item.name) : undefined;
        if (!isRecord(item) || !name) continue;
        add(TYPE_OF[collection], name, rest.replace(/\.field$/, '') || '(root)');
        if (collection !== 'datasets') continue;
        const member = /^(dimensions|measures)\[(\d+)\]/.exec(rest);
        const declared = member ? (item[member[1]] as unknown[] | undefined)?.[Number(member[2])] : undefined;
        const memberName = isRecord(declared) ? str(declared.name) : undefined;
        if (!memberName) continue;
        const lost = datasetLosses.get(name) ?? new Set<string>();
        lost.add(memberName);
        datasetLosses.set(name, lost);
    }
    for (const raw of stack.dashboards) {
        if (!isRecord(raw) || !Array.isArray(raw.widgets)) continue;
        const dashboard = str(raw.name);
        if (!dashboard) continue;
        raw.widgets.forEach((widget, i) => {
            if (!isRecord(widget)) return;
            const dataset = str(widget.dataset);
            const lost = dataset ? datasetLosses.get(dataset) : undefined;
            if (!dataset || !lost) return;
            const selected = (['dimensions', 'values'] as const)
                .flatMap((key) => (Array.isArray(widget[key]) ? (widget[key] as unknown[]) : []))
                .filter((n): n is string => typeof n === 'string');
            if (selected.some((n) => lost.has(n))) add('dashboard', dashboard, `widgets[${i}]`, dataset);
        });
    }
    return [...byItem.values()];
}

// ── field_type_change: the list-view filters whose operator stops fitting ──

/** The object one view record binds: `objectName`, `object`, then `data.object`. */
function boundObject(view: AnyRec): string | undefined {
    return str(view.objectName) ?? str(view.object) ?? (isRecord(view.data) ? str(view.data.object) : undefined);
}

/** True when the record is a view container (it carries a sub-view of its own). */
function isContainer(view: AnyRec): boolean {
    return ['list', 'form', 'listViews', 'formViews'].some((k) => isRecord(view[k]));
}

/**
 * Each list-view filter rule bound to `objectName` that names `field` by its
 * bare name and whose operator does not fit `definition`'s type. A rule's view
 * binds the object it names, else its container's binding, else — for a
 * container — the object its name is (an object-scoped container is filed
 * under its object's name).
 */
function unfitViewFilters(
    views: readonly unknown[],
    objectName: string,
    field: string,
    definition: AnyRec,
): FieldStillShownBy[] {
    const meta = {
        type: definition.type as string,
        ...(typeof definition.returnType === 'string' ? { returnType: definition.returnType } : {}),
    };
    const shown: FieldStillShownBy[] = [];
    for (const raw of views) {
        if (!isRecord(raw)) continue;
        const name = str(raw.name);
        if (!name) continue;
        const containerBinding = boundObject(raw) ?? (isContainer(raw) ? name : undefined);
        // The record itself (a flattened list overlay), a ViewItem record's
        // `config`, the container's `list` and each `listViews` entry.
        const sites: Array<[string, AnyRec]> = [['', raw]];
        if (isRecord(raw.config)) sites.push(['config.', raw.config]);
        if (isRecord(raw.list)) sites.push(['list.', raw.list]);
        if (isRecord(raw.listViews)) {
            for (const [key, sub] of Object.entries(raw.listViews)) if (isRecord(sub)) sites.push([`listViews.${key}.`, sub]);
        }
        const entries: Array<{ where: string; operator: string }> = [];
        for (const [prefix, site] of sites) {
            if ((boundObject(site) ?? containerBinding) !== objectName || !Array.isArray(site.filter)) continue;
            site.filter.forEach((element, i) => {
                const rules: Array<[string, unknown]> = isViewFilterOrGroup(element) && Array.isArray(element.or)
                    ? element.or.map((rule, j) => [`${prefix}filter[${i}].or[${j}]`, rule])
                    : [[`${prefix}filter[${i}]`, element]];
                for (const [where, rule] of rules) {
                    if (!isRecord(rule) || rule.field !== field || typeof rule.operator !== 'string') continue;
                    if (filterOperatorFieldTypeFit(rule.operator, meta) === 'unfit') entries.push({ where, operator: rule.operator });
                }
            });
        }
        // One entry per operator, so each entry names the one operator its positions share.
        const byOperator = new Map<string, string[]>();
        for (const { where, operator } of entries) byOperator.set(operator, [...(byOperator.get(operator) ?? []), where]);
        for (const [operator, where] of byOperator) shown.push({ type: 'view', name, where, operator });
    }
    return shown;
}
