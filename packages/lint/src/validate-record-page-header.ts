// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { objectTitleCompleteness } from '@objectstack/spec/data';
import type { DisplayNameObjectMeta } from '@objectstack/spec/data';
import { recordsOf } from './object-graph.js';
import { walkPageComponents } from './page-walk.js';

/**
 * A hand-written record page header that says something the object does not
 * (the maintainer ruling on the card that asked for it, record 7072788648:
 * the app aligns, the platform warns at publish and changes nothing else).
 *
 * An object's authored full record page (`type: 'record'`, `kind: 'full'`)
 * is drawn on the DESKTOP FULL PAGE only. On a phone and in every embedded
 * record view (the drawer a list opens, the split pane, an interface page's
 * preview) the record draws the platform's standard page, built from the
 * object's own metadata. So the same record has two headers, and they agree
 * only when the hand-written one says what the object says:
 *
 * - the TITLE. The standard page titles the record by the object's name field
 *   (`nameField`, else the field `objectTitleCompleteness` derives), the name
 *   every list, search result and lookup shows too. A `page:header` `title`
 *   other than exactly that one field's `{token}` titles the full page
 *   differently: `record-page-header-title-differs`.
 * - the ACTIONS. Both headers sort their actions with one rule (the header
 *   renderer's `headerActionPlan`): `order` ascending (unset = 0), then
 *   `variant: 'primary'`, then their incoming order, and the primary button is
 *   the first `variant: 'primary'` action, else the first of the sorted
 *   buttons. The incoming order is where the two differ: the full page's is
 *   the header's `actions` list, the standard page's is the object's own
 *   action declaration order, and the standard page draws every action the
 *   object places at `record_header` / `record_more`, listed or not. When that
 *   gives a different primary button, or the listed actions in a different
 *   order, the header lists them in an order the actions do not declare:
 *   `record-page-header-actions-differ`.
 *
 * Both are `warning`s: nothing is broken, the page renders as written, and a
 * static check sees less than the runtime does. What it cannot see:
 *
 * - an action's `visible` / `enabled` predicates and the user's permissions,
 *   which can hide the first action on one record and not on another;
 * - actions another installed package attaches to the object, which the
 *   standard page draws and this stack does not declare;
 * - the served declaration order itself: the object's own `actions` first,
 *   then the stack's `actions` bound to it by `objectName`, in source order,
 *   is the registry's order for one package and an ESTIMATE across several.
 *
 * So it can miss a disagreement and can name one the runtime would hide.
 * An action list naming an action this stack does not declare on the object
 * is not judged at all (the reference-integrity rules name the dangling id).
 *
 * What the author does about either finding is where the ruling puts the one
 * declaration: the title on the object (`nameField`), the order and primary on
 * the actions (`order`, `variant: 'primary'`), and a header that really should
 * differ in a `kind: 'slotted'` page's `header` slot, which the standard page
 * draws on every surface.
 *
 * Not judged: print pages (named routes, never the object's record page),
 * slotted pages (one header on every surface already), html and react pages
 * (their `source` is the page; `walkPageComponents` skips them), and record
 * pages bound to no object, or to an object this stack does not declare.
 */

export const RECORD_PAGE_HEADER_TITLE_DIFFERS = 'record-page-header-title-differs';
export const RECORD_PAGE_HEADER_ACTIONS_DIFFER = 'record-page-header-actions-differ';

export interface RecordPageHeaderFinding {
  /** Always `warning` (see module note). */
  severity: 'warning';
  /** Diagnostic rule id. */
  rule: string;
  /** Human-readable location, e.g. `page "lead_detail"`. */
  where: string;
  /** Config path, e.g. `pages[0].regions[0].components[0].properties.title`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
  /** The names the user-facing sentence interpolates (`validate-record-page-header.user-text.ts`). */
  userTextParams: Readonly<Record<string, string>>;
}

type AnyRec = Record<string, unknown>;

function isRec(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function strName(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** A full record page bound to an object, the only page whose header leaves the standard page's. */
function isFullRecordPage(page: AnyRec): boolean {
  const type = page.type === undefined ? 'record' : page.type;
  const kind = page.kind === undefined ? 'full' : page.kind;
  return type === 'record' && kind === 'full' && page.print === undefined && strName(page.object) !== undefined;
}

/** Every string a `title` label renders: the string itself, or each value of an inline locale map. */
function titleTexts(title: unknown): string[] | undefined {
  if (typeof title === 'string') return title.trim() === '' ? undefined : [title];
  if (isRec(title)) {
    const texts = Object.values(title).filter((v): v is string => typeof v === 'string');
    return texts.length > 0 ? texts : undefined;
  }
  return undefined;
}

/** The object's actions in the order the registry serves them (see module note: an estimate). */
function objectActions(stack: AnyRec, object: AnyRec, objectName: string): AnyRec[] {
  const out: AnyRec[] = [];
  const seen = new Set<string>();
  const push = (action: AnyRec): void => {
    const name = strName(action.name);
    if (!name || seen.has(name)) return;
    seen.add(name);
    out.push(action);
  };
  for (const action of recordsOf(object.actions)) push(action);
  for (const action of recordsOf(stack.actions)) {
    if (action.objectName === objectName) push(action);
  }
  return out;
}

function placedIn(action: AnyRec, location: string): boolean {
  return Array.isArray(action.locations) && action.locations.includes(location);
}

/** The header renderer's sort: `order` ascending, `variant: 'primary'` first among equals, then incoming order. */
function headerSort(actions: readonly AnyRec[]): AnyRec[] {
  const rank = (a: AnyRec): number => (typeof a.order === 'number' ? a.order : 0);
  return [...actions].sort((a, b) => {
    const byOrder = rank(a) - rank(b);
    if (byOrder !== 0) return byOrder;
    return (a.variant === 'primary' ? 0 : 1) - (b.variant === 'primary' ? 0 : 1);
  });
}

/**
 * The header's primary button, as the renderer picks it: among the actions
 * that draw as buttons (not `record_more`-only, not pinned into the `⋯` by
 * `component: 'action:menu'`, not destructive), the first declaring
 * `variant: 'primary'`, else the first.
 */
function primaryOf(sorted: readonly AnyRec[]): string | undefined {
  const candidates = sorted.filter(
    (a) => placedIn(a, 'record_header') && a.component !== 'action:menu' && a.variant !== 'danger',
  );
  const primary = candidates.find((a) => a.variant === 'primary') ?? candidates[0];
  return primary ? strName(primary.name) : undefined;
}

const list = (names: readonly string[]): string => names.map((n) => `"${n}"`).join(', ');

/**
 * Warn on every full record page header whose title or action order differs
 * from what the standard page draws for the same record. Returns findings
 * (empty = clean); never an `error`.
 */
export function validateRecordPageHeader(stack: AnyRec): RecordPageHeaderFinding[] {
  const findings: RecordPageHeaderFinding[] = [];
  if (!isRec(stack)) return findings;

  const objectsByName = new Map<string, AnyRec>();
  for (const obj of recordsOf(stack.objects)) {
    const name = strName(obj.name);
    if (name && !objectsByName.has(name)) objectsByName.set(name, obj);
  }

  const pages = recordsOf(stack.pages);
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    if (!isFullRecordPage(page)) continue;
    const objectName = page.object as string;
    const object = objectsByName.get(objectName);
    if (!object) continue;
    const pageName = strName(page.name) ?? `(page ${i})`;
    const where = `page "${pageName}"`;

    for (const walked of walkPageComponents(page, `pages[${i}]`)) {
      if (walked.component.type !== 'page:header') continue;
      const props = isRec(walked.component.properties) ? walked.component.properties : {};

      // ── the title ──
      const texts = titleTexts(props.title);
      const titleField = objectTitleCompleteness(object as DisplayNameObjectMeta).field;
      if (texts && titleField) {
        const token = `{${titleField}}`;
        if (texts.some((t) => t.trim() !== token)) {
          findings.push({
            severity: 'warning',
            rule: RECORD_PAGE_HEADER_TITLE_DIFFERS,
            where,
            path: `${walked.path}.properties.title`,
            message:
              `${pageName}: the header title is not the record's name field "${titleField}", so the desktop full ` +
              `page titles a record one way while the phone, the side drawer and every list title it by ` +
              `"${titleField}"`,
            hint:
              `Delete the header's title (or set it to '${token}'); to change the record's name everywhere, ` +
              `set nameField on "${objectName}"; for a header that should differ on every surface, use a ` +
              `kind: 'slotted' page's header slot`,
            userTextParams: { page: pageName, object: objectName, field: titleField },
          });
        }
      }

      // ── the actions ──
      if (!Array.isArray(props.actions) || props.placedActions === true) continue;
      const listed = props.actions.filter((n): n is string => typeof n === 'string' && n.length > 0);
      if (listed.length === 0) continue;
      const universe = objectActions(stack, object, objectName);
      const byName = new Map(universe.map((a) => [a.name as string, a]));
      if (!listed.every((n) => byName.has(n))) continue;
      const isPlaced = (a: AnyRec): boolean => placedIn(a, 'record_header') || placedIn(a, 'record_more');

      const fullPage = headerSort([...new Set(listed)].map((n) => byName.get(n)!).filter(isPlaced));
      if (fullPage.length === 0) continue;
      const standard = headerSort(universe.filter(isPlaced));
      const listedSet = new Set(fullPage.map((a) => a.name as string));
      const fullOrder = fullPage.map((a) => a.name as string);
      const standardOrder = standard.map((a) => a.name as string).filter((n) => listedSet.has(n));
      const fullPrimary = primaryOf(fullPage);
      const standardPrimary = primaryOf(standard);

      const primaryDiffers = fullPrimary !== standardPrimary;
      const orderDiffers = fullOrder.join('\n') !== standardOrder.join('\n');
      if (!primaryDiffers && !orderDiffers) continue;

      const said = primaryDiffers
        ? `the desktop full page's primary button is ${fullPrimary ? `"${fullPrimary}"` : 'none'} while the ` +
          `phone and the side drawer draw ${standardPrimary ? `"${standardPrimary}"` : 'none'}`
        : `the desktop full page orders them ${list(fullOrder)} while the phone and the side drawer order ` +
          `them ${list(standardOrder)}`;
      findings.push({
        severity: 'warning',
        rule: RECORD_PAGE_HEADER_ACTIONS_DIFFER,
        where,
        path: `${walked.path}.properties.actions`,
        message:
          `${pageName}: the header lists "${objectName}"'s actions in an order the actions do not declare, so ` +
          `${said} (judged from declared order and variant only; visibility, permissions and actions other ` +
          `packages attach are not read)`,
        hint:
          `Declare the order on the actions themselves: an order number on each (lower first) and ` +
          `variant: 'primary' on the main one, so every surface sorts them alike; the header list then only ` +
          `chooses which actions the full page draws`,
        userTextParams: { page: pageName, object: objectName },
      });
    }
  }

  return findings;
}
