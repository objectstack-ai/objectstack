// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { ObjectSchema } from '@objectstack/spec/data';
import { ApprovalsServicePlugin } from './approvals-plugin.js';
import { SysApprovalRequest } from './sys-approval-request.object.js';

/**
 * `sys_approval_request` declares the ActivityPointer pair — #11386 (ADR-0052
 * §5, carrier landed by #11339).
 *
 * Re-verified for THIS object rather than inherited from the shape it shares
 * with the audit ledger: here the pair is not a display key, it is the key the
 * approval machinery QUERIES ON. `approval-service.ts` finds a record's open
 * request with `where: { object_name, record_id, status: 'pending' }`, and
 * `lifecycle-hooks.ts` holds the record LOCK on the same pair (single and
 * `$in` batch forms). `submit()` writes both halves from `input.object` /
 * `input.recordId`, so a stored id is always a record id of the object the
 * sibling names.
 *
 * Consequence, and why the declaration earns its place on this object: a
 * seeded request whose `record_id` stayed a verbatim natural key locked
 * nothing and surfaced under no record — a row that LOOKED pending while being
 * invisible to both queries that give it meaning.
 */
describe('sys_approval_request — declared pointer pair (#11386)', () => {
  const fields = SysApprovalRequest.fields as Record<string, Record<string, unknown>>;

  it('declares record_id as the id half, resolved through object_name', () => {
    expect(fields.record_id.referenceVia).toBe('object_name');
  });

  it('keeps the id half a plain text column with no contradicting static reference', () => {
    expect(fields.record_id.type).toBe('text');
    expect(fields.record_id.reference).toBeUndefined();
  });

  it('declares the sibling the pointer names', () => {
    expect(fields.object_name).toBeDefined();
    expect(fields.object_name.type).toBe('text');
  });

  it('keeps BOTH halves required — so an un-addressable pointer cannot be authored here at all', () => {
    // The loader's "id half authored, object half empty" refusal is reachable
    // on objects whose halves are optional (`sys_audit_log`). On this object
    // the schema forecloses it one layer earlier. Recorded because it is the
    // measured difference between two objects carrying the same pair — and
    // because `required: true` is also why a deferred pointer here cannot be
    // back-filled by pass 2 the way an optional one is.
    expect(fields.record_id.required).toBe(true);
    expect(fields.object_name.required).toBe(true);
  });
});

/**
 * The pointer's tombstone predicate — objectui#12489 ruling, letter A.
 *
 * When the platform voids a `pending` request because its record was deleted
 * (`cancelled` + `cancel_reason: 'record_deleted'`), `record_id` names a record
 * that no longer exists. `referenceDeletedWhen` is the object's own assertion of
 * that, so a renderer draws the sibling option's label instead of a link to
 * nothing. The spec refuses the declaration at parse unless the sibling is a
 * single-value `select` holding the option, so the parse is half of the pin.
 */
describe('sys_approval_request — record_id tombstone predicate', () => {
  const fields = SysApprovalRequest.fields as Record<string, Record<string, unknown>>;

  it('declares record_id as deleted when cancel_reason holds record_deleted', () => {
    expect(fields.record_id.referenceDeletedWhen).toEqual({ field: 'cancel_reason', value: 'record_deleted' });
  });

  it('names a sibling select that declares that option, and the object parses through ObjectSchema', () => {
    expect(fields.cancel_reason.type).toBe('select');
    expect(fields.cancel_reason.options).toEqual(
      expect.arrayContaining([expect.objectContaining({ value: 'record_deleted' })]),
    );
    const parsed = ObjectSchema.safeParse(SysApprovalRequest);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
  });
});

/**
 * [#24501] A list names a pointer's target with the id half alone. The console
 * draws a `referenceVia` column as the target record (its object's icon and
 * name) and fetches the type half for that cell without a column
 * (objectui#13036); a type-half column draws the stored API name as text.
 * Enumerated over every object the plugin registers, so a view added later is
 * judged without anyone listing it here.
 */
describe('approvals list views — a pointer shows as its id half, never its type half (#24501)', () => {
  type PointerObject = {
    name: string;
    fields: Record<string, { referenceVia?: unknown } | undefined>;
    listViews?: Record<string, { columns?: ReadonlyArray<string | { field: string }> }>;
  };

  async function registeredObjects(): Promise<PointerObject[]> {
    const registered: Array<{ objects: PointerObject[] }> = [];
    const ctx: any = {
      getService: (name: string) =>
        name === 'manifest' ? { register: (m: { objects: PointerObject[] }) => registered.push(m) } : undefined,
      logger: { info: () => {}, warn: () => {} },
    };
    await new ApprovalsServicePlugin({ disableService: true }).init(ctx);
    expect(registered).toHaveLength(1);
    return registered[0].objects;
  }

  /** `object.view: column` for each shown id half, and for each type half shown beside one. */
  function pointerColumns(objects: readonly PointerObject[]): { idHalves: string[]; typeHalves: string[] } {
    const idHalves: string[] = [];
    const typeHalves: string[] = [];
    for (const object of objects) {
      for (const [view, def] of Object.entries(object.listViews ?? {})) {
        const shown = new Set((def.columns ?? []).map((c) => (typeof c === 'string' ? c : c.field)));
        for (const column of shown) {
          const via = object.fields[column]?.referenceVia;
          if (typeof via !== 'string') continue;
          idHalves.push(`${object.name}.${view}: ${column}`);
          if (shown.has(via)) typeHalves.push(`${object.name}.${view}: ${via}`);
        }
      }
    }
    return { idHalves, typeHalves };
  }

  it('no list view shows a referenceVia sibling beside its id half', async () => {
    expect(pointerColumns(await registeredObjects()).typeHalves).toEqual([]);
  });

  it('the request and action lists still show the id half, so the Record column names the target', async () => {
    expect(pointerColumns(await registeredObjects()).idHalves).toEqual(expect.arrayContaining([
      'sys_approval_request.all_requests: record_id',
      'sys_approval_request.my_pending: record_id',
      'sys_approval_request.submitted_by_me: record_id',
      'sys_approval_request.completed: record_id',
      'sys_approval_action.recent: record_id',
      'sys_approval_action.all_actions: record_id',
    ]));
  });
});
