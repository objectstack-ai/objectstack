// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0142 D5, ruling A on organization-authored routing] The save guard an
 * organization's own `sys_assignment_rule` row carries, and the boot report of
 * a row a later declaration shadows.
 *
 * Authoring a rule in Setup is a plain data write, so the guard is a hook on
 * the table, the way the queue tables' guards are (`queue-hooks.ts`), never a
 * check inside a service method nobody calls. It refuses the write — one
 * `VALIDATION_FAILED` naming every field at fault — when the rule could not
 * route a record the way it reads:
 *
 * | field                         | refused when                                                                 |
 * |-------------------------------|------------------------------------------------------------------------------|
 * | `organization_id`             | the row lands in no organization (non-null: a deployment-wide rule is a declared one) |
 * | `name`                        | not snake_case, or a declared assignment rule's name (ADR-0131 D4, one namespace) |
 * | `object_name`                 | not a registered object, or one with no ownership-queue column to route by   |
 * | the entry columns             | the shape the stack schema refuses for a declared entry (`AssignmentRuleSchema`) |
 * | `criteria`, `load`            | the engine's CEL paths cannot compile it (`assignmentExpressionRefusals`)     |
 * | `recipient_id` (user target)  | not an active member of the rule's organization (`organizationMemberStanding`) |
 *
 * The CEL compile and the membership predicate are imported from the engine's
 * assignment seam, so a row is judged on save by exactly what judges it at an
 * insert. At insert time the engine re-asks the membership — a member who
 * leaves later is a lapsed target there, logged, never a refused insert.
 *
 * An update is judged on the merged row (pre-image + patch) when the patch
 * touches a judged column; a patch of only the label, description, order or
 * active flag is not re-judged, so an administrator can always switch off or
 * rename a rule whose target lapsed.
 */

import type { FieldErrorCode } from '@objectstack/spec/api';
import { AssignmentRuleSchema } from '@objectstack/spec/automation';
import { resolveInjectedColumnProvenance } from '@objectstack/spec/data';
import {
  ASSIGNMENT_RULE_OBJECT,
  assignmentExpressionRefusals,
  organizationMemberStanding,
} from '@objectstack/objectql';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/** Package id of the `sys_assignment_rule` save guard. */
export const ASSIGNMENT_RULE_GUARD_PACKAGE = 'plugin-sharing:assignment-rule-guard';

/** The registry type of a declared assignment rule. */
const ASSIGNMENT_RULE_TYPE = 'assignment_rule';

const RULE_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

/** The columns a patch must touch for the update to be re-judged. */
const JUDGED_COLUMNS = [
  'organization_id', 'name', 'object_name', 'criteria', 'recipient_type', 'recipient_id', 'strategy', 'load',
] as const;

interface MinimalEngine {
  registerHook(
    event: string,
    handler: (ctx: any) => any | Promise<any>,
    options?: { object?: string | string[]; priority?: number; packageId?: string },
  ): void;
  unregisterHooksByPackage(packageId: string): number;
  find?(object: string, options?: any): Promise<any[]>;
  registry?: {
    listItems?: (type: string) => unknown[];
    getObject?: (name: string) => unknown;
  };
}

type FieldIssue = { field: string; code: FieldErrorCode; message: string };

/**
 * Field-level refusal for a `sys_assignment_rule` row, on the data-API path:
 * the shape `QueueValidationError` uses (`code: 'VALIDATION_FAILED'`, a
 * `fields[]` entry per column at fault), so REST answers it as a validation
 * failure naming the fields.
 */
export class AssignmentRuleValidationError extends Error {
  readonly code = 'VALIDATION_FAILED';
  readonly fields: FieldIssue[];
  constructor(issues: FieldIssue[]) {
    super(issues.map((i) => i.message).join(' '));
    this.name = 'ValidationError';
    this.fields = issues;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function present(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v);
  return s.trim() === '' ? null : s;
}

/** Every declared assignment rule's name, switched on or off. */
function declaredRuleNames(engine: MinimalEngine): Set<string> {
  const names = new Set<string>();
  let items: unknown[] = [];
  try {
    items = engine.registry?.listItems?.(ASSIGNMENT_RULE_TYPE) ?? [];
  } catch {
    return names;
  }
  for (const item of Array.isArray(items) ? items : []) {
    if (isRecord(item) && typeof item.name === 'string') names.add(item.name);
  }
  return names;
}

/** The column an `AssignmentRuleSchema` issue path names, for the one-entry row. */
function columnOf(path: ReadonlyArray<PropertyKey>): string {
  const [head, , key, sub] = path;
  if (head === 'name') return 'name';
  if (head === 'object') return 'object_name';
  if (head !== 'entries') return '_record';
  if (key === 'name') return 'name'; // the one entry is named after the rule
  if (key === 'assignTo') return sub === 'type' ? 'recipient_type' : 'recipient_id';
  if (key === 'criteria' || key === 'strategy' || key === 'load') return key;
  return '_record';
}

/**
 * Judge one row as it will be stored. `organizationId` is where it lands: the
 * row's own column, else the caller's active organization.
 */
export async function assignmentRuleRowIssues(
  engine: MinimalEngine,
  row: Record<string, unknown>,
  organizationId: string | null,
): Promise<FieldIssue[]> {
  const issues: FieldIssue[] = [];
  if (!organizationId) {
    issues.push({
      field: 'organization_id',
      code: 'required',
      message:
        'An assignment rule belongs to one organization, and this one would land in none. Write it from inside ' +
        'the organization it routes records for, or name that organization.',
    });
  }

  const name = present(row.name);
  if (name !== null && !RULE_NAME_PATTERN.test(name)) {
    issues.push({
      field: 'name',
      code: 'invalid_format',
      message: `An assignment rule name is a machine name — lowercase letters, digits and underscores, starting with a letter (got ${JSON.stringify(name)}).`,
    });
  } else if (name !== null && declaredRuleNames(engine).has(name)) {
    issues.push({
      field: 'name',
      code: 'invalid_value',
      message:
        `'${name}' is the name of an assignment rule an installed app provides, and one name means one rule. ` +
        'Choose another name for your own rule.',
    });
  }

  const object = present(row.object_name);
  if (object !== null && typeof engine.registry?.getObject === 'function') {
    const schema = engine.registry.getObject(object);
    if (!schema) {
      issues.push({ field: 'object_name', code: 'reference_not_found', message: `There is no object named '${object}'.` });
    } else if (resolveInjectedColumnProvenance(schema, 'queue') !== 'injected-provisioned') {
      issues.push({
        field: 'object_name',
        code: 'invalid_value',
        message:
          `Records of '${object}' have no owner a rule could set, or are stored outside the platform, so an ` +
          'assignment rule on it would never assign anything. Choose an object whose records are owned by a person.',
      });
    }
  }

  // The shape a declared entry is held to, through the one schema that holds it.
  const entry: Record<string, unknown> = {
    name: name ?? '',
    assignTo: { type: row.recipient_type, value: present(row.recipient_id) ?? '' },
  };
  if (present(row.criteria) !== null) entry.criteria = row.criteria;
  if (present(row.strategy) !== null) entry.strategy = row.strategy;
  if (present(row.load) !== null) entry.load = row.load;
  const parsed = AssignmentRuleSchema.safeParse({ name: name ?? '', object: object ?? '', entries: [entry] });
  if (!parsed.success) {
    const judged = new Set(issues.map((i) => i.field));
    for (const issue of parsed.error.issues) {
      const field = columnOf(issue.path);
      // `name` / `object_name` are reported once, by the checks above, or by
      // the required-field check when absent.
      if (field === 'name' || field === 'object_name' || judged.has(field)) continue;
      judged.add(field);
      issues.push({ field, code: 'invalid_value', message: issue.message });
    }
  }

  for (const refusal of assignmentExpressionRefusals({ criteria: entry.criteria, load: entry.load })) {
    if (issues.some((i) => i.field === refusal.field)) continue;
    issues.push({
      field: refusal.field,
      code: 'invalid_value',
      message:
        refusal.field === 'criteria'
          ? `The condition cannot be evaluated: ${refusal.message}`
          : `The open-work expression cannot be counted by: ${refusal.message}`,
    });
  }

  const userId = row.recipient_type === 'user' ? present(row.recipient_id) : null;
  if (userId !== null && organizationId && typeof engine.find === 'function') {
    const find = engine.find.bind(engine);
    let standing: Awaited<ReturnType<typeof organizationMemberStanding>>;
    try {
      standing = await organizationMemberStanding(
        {
          hasObject: (o) => Boolean(engine.registry?.getObject?.(o)),
          find: (o, where, context, limit) => find(o, { where, context, ...(limit ? { limit } : {}) }),
        },
        userId,
        organizationId,
      );
    } catch (err) {
      // Not the author's fault, so not a field issue — but never a save the
      // guard could not judge: the write fails, saying why.
      throw Object.assign(
        new Error(
          `[assignment] the membership of user '${userId}' in organization '${organizationId}' could not be read, ` +
            `so the assignment rule cannot be judged and is not saved: ${err instanceof Error ? err.message : String(err)}`,
        ),
        { cause: err },
      );
    }
    if (standing === 'banned') {
      issues.push({ field: 'recipient_id', code: 'reference_user_banned', message: `User '${userId}' is banned, so records cannot be assigned to them.` });
    } else if (standing !== 'member') {
      issues.push({
        field: 'recipient_id',
        code: 'reference_not_found',
        message: `User '${userId}' is not an active member of this organization, so records cannot be assigned to them. Choose a member, or a queue.`,
      });
    }
  }
  return issues;
}

/** Bind the `sys_assignment_rule` save guard. */
export function bindAssignmentRuleGuards(engine: MinimalEngine): void {
  if (typeof engine.registerHook !== 'function') return;
  if (typeof engine.unregisterHooksByPackage === 'function') engine.unregisterHooksByPackage(ASSIGNMENT_RULE_GUARD_PACKAGE);

  const guard = (insert: boolean) => async (ctx: any) => {
    const data = ctx?.input?.data;
    if (!isRecord(data)) return;
    if (!insert && !JUDGED_COLUMNS.some((c) => Object.prototype.hasOwnProperty.call(data, c))) return;
    const row = insert ? { ...data } : { ...(isRecord(ctx?.previous) ? ctx.previous : {}), ...data };
    const organizationId = present(row.organization_id) ?? present(ctx?.session?.organizationId);
    const issues = await assignmentRuleRowIssues(engine, row, organizationId);
    if (issues.length > 0) throw new AssignmentRuleValidationError(issues);
  };

  const opts = { object: ASSIGNMENT_RULE_OBJECT, packageId: ASSIGNMENT_RULE_GUARD_PACKAGE, priority: 100 };
  engine.registerHook('beforeInsert', guard(true), opts);
  engine.registerHook('beforeUpdate', guard(false), opts);
}

/**
 * Report, at boot, every `sys_assignment_rule` row whose name a package now
 * declares. The declared rule answers for the name and the engine does not
 * evaluate the row, so an organization's routing stopped without a write
 * anyone made: logged at `error`, naming the row's organization, because an
 * administrator has to act — rename the row — and nothing else will say so.
 */
export async function reportShadowedAuthoredAssignmentRules(
  engine: MinimalEngine,
  logger?: {
    warn: (msg: string, meta?: Record<string, any>) => void;
    error?: (msg: string, meta?: Record<string, any>) => void;
  },
): Promise<void> {
  if (typeof engine.find !== 'function') return;
  const declared = declaredRuleNames(engine);
  if (declared.size === 0) return;
  let rows: any[] = [];
  try {
    rows = await engine.find(ASSIGNMENT_RULE_OBJECT, { fields: ['name', 'organization_id'], limit: 10000, context: SYSTEM_CTX });
  } catch {
    return; // no table yet — nothing authored to shadow
  }
  for (const row of Array.isArray(rows) ? rows : []) {
    const name = present(row?.name);
    if (!name || !declared.has(name)) continue;
    const msg =
      `[assignment] an organization's assignment rule '${name}' is shadowed by a rule an installed app declares ` +
      'under the same name — the declared rule answers for it, and the organization\'s rule assigns nothing. ' +
      'Rename the organization\'s rule to keep it.';
    const meta = { rule: name, organization: present(row?.organization_id) };
    if (logger?.error) logger.error(msg, meta);
    else logger?.warn(msg, meta);
  }
}
