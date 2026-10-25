/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * PositionHoldersSection — who holds a position, on the Setup catalog's
 * position page (objectui#7611, ADR-0131 D3/D4).
 *
 * The position's DEFINITION is the registry's and is edited above this section
 * by whoever may author it. Holding a position is something else: an
 * assignment, a `sys_user_position` row of the caller's own organization,
 * which names the position BY NAME (`position` stores the machine name). So
 * this section is an ordinary data page over that object — the same reads and
 * writes the generic assignment page makes — and the server decides who may
 * add or remove a holder, under every posture: its object CRUD step asks the
 * caller's grant on `sys_user_position`, and its delegated-administration gate
 * may refuse a holder of that grant as well. The section reads the first half
 * (objectui#12082): ADD and REMOVE are offered only where that grant is held,
 * so a caller who may read the holders but not write them sees the list
 * alone. Reaching Setup is not that grant — see the gate in the component.
 *
 * The shape follows `AssignedUsersSection` (a permission set's holders):
 * people first, add through `RecordPickerDialog`, remove per row. The server
 * judges the name against the security catalog (objectstack's
 * `position-catalog-refusal`, ADR-0131 stage 2a): any position the registry
 * serves is assignable, a registry-only one included, and a name the catalog
 * does not resolve is refused. A refusal is shown in the server's own words,
 * which this page must not paper over.
 *
 * objectui#13337 — Remove asks first and names the person; nothing is sent
 * until the admin confirms. The picker offers the members of the active
 * organization only: the users its `sys_member` rows name, read from the
 * server when the picker opens and handed to the picker as its hard filter.
 * The server already refuses an assignment whose user holds no `sys_member`
 * row in the row's organization (objectstack's
 * `grant-holder-membership-refusal`), so a non-member offered here could only
 * be refused. Where that refusal judges nothing — no active organization (the
 * row is stored with none) or a composition that registers no `sys_member` —
 * the picker keeps its whole list, as the server does.
 */

import * as React from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  buttonVariants,
} from '@object-ui/components';
import { useAuth } from '@object-ui/auth';
import { resolveAffordance, type SchemaLike } from '@object-ui/core';
import { RecordPickerDialog } from '@object-ui/fields';
import { usePermissions } from '@object-ui/permissions';
import { extractWriteErrorMessage, useAdapter, useMetadata } from '@object-ui/react';
import { AlertCircle, Loader2, Plus, UserCheck, X } from 'lucide-react';
import { useMetadataLocale } from './i18n.js';
import { membershipOrganization, readOrganizationMemberIds, type MemberFilter } from './organization-members.js';

export interface PositionHoldersSectionProps {
  /** The position's machine name. */
  name: string;
}

interface HolderRow {
  /** The `sys_user_position` row — the assignment this page removes. */
  assignmentId: string;
  userId: string;
  label: string;
  email: string;
}

/** The assignment object, and the column that names the position. */
const USER_POSITION_OBJECT = 'sys_user_position';
const USER_POSITION_NAME_FIELD = 'position';

/** Rows of a `find()` answer, read as `QueryResult` declares them (`data`). */
const asArray = (res: any): any[] => (Array.isArray(res) ? res : res?.data ?? []);

const personLabel = (u: any): string =>
  u?.full_name || u?.name || u?.display_name || u?.email || String(u?.id ?? '');

/**
 * The server's own sentence out of a refused call, or `''` when it gave none.
 * Read through `@object-ui/react`'s shared reader, the one place the adapters'
 * error shapes are told apart (AGENTS #1), as `AssignedUsersSection` reads it:
 * the ObjectStack client puts the sentence on `message` and the parsed body on
 * `details`, and sets neither `body` nor `error` on the error.
 */
const refusalSentence = (err: unknown): string => extractWriteErrorMessage(err) ?? '';

function useCopy() {
  const zh = useMetadataLocale() === 'zh-CN';
  return React.useMemo(
    () =>
      zh
        ? {
            title: '岗位持有人',
            add: '添加持有人',
            remove: '移除',
            empty: '还没有人持有此岗位。',
            loading: '加载中…',
            pickTitle: '选择要分配此岗位的组织成员',
            noMembers: '本组织还没有可分配的成员。',
            membersFailed: '无法读取本组织的成员。',
            removeTitle: (who: string) => `将 ${who} 从此岗位移除？`,
            removeBody: (who: string) =>
              `${who} 将不再持有此岗位，也不再获得它分配的权限集。之后可以重新添加。`,
            cancel: '取消',
            addFailed: '分配失败，请重试。',
            removeFailed: '移除失败，请重试。',
            loadFailed: '无法读取岗位持有人。',
          }
        : {
            title: 'Position holders',
            add: 'Add holder',
            remove: 'Remove',
            empty: 'Nobody holds this position yet.',
            loading: 'Loading…',
            pickTitle: 'Select organization members to assign this position to',
            noMembers: 'This organization has no members to assign yet.',
            membersFailed: 'Could not read the members of this organization.',
            removeTitle: (who: string) => `Remove ${who} from this position?`,
            removeBody: (who: string) =>
              `${who} will no longer hold this position or the permission sets it distributes. You can add them again later.`,
            cancel: 'Cancel',
            addFailed: 'Failed to assign. Please try again.',
            removeFailed: 'Failed to remove. Please try again.',
            loadFailed: 'Could not read the holders of this position.',
          },
    [zh],
  );
}

export function PositionHoldersSection({ name }: PositionHoldersSectionProps): React.ReactElement {
  const adapter = useAdapter() as any;
  const c = useCopy();
  const [rows, setRows] = React.useState<HolderRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  /**
   * The holders read failed (objectui#12706). A refused read is not an empty
   * list: while this is set, the section says the read failed, in the server's
   * words, and draws neither a count nor "Nobody holds this position yet." —
   * the empty copy follows only a read that succeeded. `said` is the server's
   * sentence, `''` when it gave none.
   */
  const [readFailure, setReadFailure] = React.useState<{ said: string } | null>(null);
  /** The holder whose Remove is being confirmed, or `null` while no confirm is open. */
  const [pendingRemove, setPendingRemove] = React.useState<HolderRow | null>(null);
  /**
   * The picker's hard filter: the active organization's members, by user id,
   * or `undefined` where the server judges no membership (see the module note).
   * Read when the picker opens, so a member added or removed since is counted.
   */
  const [memberFilter, setMemberFilter] = React.useState<MemberFilter | undefined>(undefined);
  const [openingPicker, setOpeningPicker] = React.useState(false);
  const activeOrganizationId = useAuth().activeOrganization?.id ?? null;

  /**
   * May the caller add or remove a holder? Each is a write of a
   * {@link USER_POSITION_OBJECT} row, so each reads its row of the
   * affordance-to-grant map (`resolveAffordance` in `@object-ui/core`), asked
   * of that object with its schema as the registry serves it: ADD creates a
   * junction row under the position, the `relatedNew` row a related list's Add
   * existing reads; REMOVE deletes one, the `relatedRowDelete` row a related
   * list row's Delete reads.
   *
   * Setup's own gate is not this one. The Setup app asks `setup.access`, and
   * a caller can hold it while the server refuses their write of an assignment
   * row at its object CRUD step. So a closed row withholds its affordance: the
   * Add button and the picker it feeds, each row's Remove. With no permission
   * provider every grant reads open, as before. objectstack's shipped
   * organization administrator set (and its `_no_bypass` variant) holds both
   * rows open — it creates and removes assignment rows, never edits them (that
   * repo's pin `organization_admin creates and removes assignment rows, never
   * edits them — both variants`) — so it is offered Add and Remove; what it may
   * create or remove is bounded on the server by the delegated-administration
   * gate.
   */
  const { objects } = useMetadata();
  const perms = usePermissions();
  const holdingSource = {
    objectSchema: ((objects ?? []).find((o) => (o as { name?: unknown } | null)?.name === USER_POSITION_OBJECT) ??
      null) as SchemaLike | null,
    objectName: USER_POSITION_OBJECT,
    perms,
  };
  const canAdd = resolveAffordance('relatedNew', holdingSource).allowed;
  const canRemove = resolveAffordance('relatedRowDelete', holdingSource).allowed;
  const memberOrganization = membershipOrganization(activeOrganizationId, objects);

  const load = React.useCallback(async () => {
    if (!adapter) return;
    setLoading(true);
    try {
      const assignments = asArray(
        await adapter.find(USER_POSITION_OBJECT, {
          $filter: { [USER_POSITION_NAME_FIELD]: name },
          $top: 1000,
        }),
      );
      const userIds = [...new Set(assignments.map((a: any) => a?.user_id).filter(Boolean).map(String))];
      const users = userIds.length
        ? asArray(await adapter.find('sys_user', { $filter: { id: { $in: userIds } }, $top: 1000 }))
        : [];
      const byId = new Map(users.map((u: any) => [String(u.id), u]));
      setRows(
        assignments
          .filter((a: any) => a?.id != null && a?.user_id != null)
          .map((a: any) => {
            const u = byId.get(String(a.user_id));
            return {
              assignmentId: String(a.id),
              userId: String(a.user_id),
              label: u ? personLabel(u) : String(a.user_id),
              email: u?.email ?? '',
            };
          }),
      );
      setReadFailure(null);
    } catch (err) {
      setRows([]);
      setReadFailure({ said: refusalSentence(err) });
    } finally {
      setLoading(false);
    }
  }, [adapter, name]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const held = React.useMemo(() => new Set(rows.map((r) => r.userId)), [rows]);

  const addHolders = React.useCallback(
    async (records: any[]) => {
      setBusy(true);
      setError(null);
      try {
        for (const u of records || []) {
          const uid = u?.id != null ? String(u.id) : null;
          if (!uid || held.has(uid)) continue;
          // By NAME: the assignment names the catalog item (ADR-0131 D4).
          await adapter.create(USER_POSITION_OBJECT, { user_id: uid, [USER_POSITION_NAME_FIELD]: name });
        }
        await load();
      } catch (err) {
        setError(refusalSentence(err) || c.addFailed);
      } finally {
        setBusy(false);
        setPickerOpen(false);
      }
    },
    [adapter, name, held, load, c],
  );

  /**
   * Open the picker over the active organization's members. The user ids are
   * the server's `sys_member` rows of that organization, every page of them
   * (`readOrganizationMemberIds`, shared with `AssignedUsersSection`); a
   * refused read is said in the server's words and the picker stays shut,
   * since its list would otherwise offer people the server will refuse.
   */
  const openPicker = React.useCallback(async () => {
    setError(null);
    if (!memberOrganization) {
      setMemberFilter(undefined);
      setPickerOpen(true);
      return;
    }
    setOpeningPicker(true);
    try {
      const ids = await readOrganizationMemberIds(adapter, memberOrganization);
      if (ids.length === 0) {
        setError(c.noMembers);
        return;
      }
      setMemberFilter({ id: { $in: ids } });
      setPickerOpen(true);
    } catch (err) {
      setError(refusalSentence(err) || c.membersFailed);
    } finally {
      setOpeningPicker(false);
    }
  }, [adapter, memberOrganization, c]);

  const removeHolder = React.useCallback(
    async (assignmentId: string) => {
      setError(null);
      try {
        await adapter.delete(USER_POSITION_OBJECT, assignmentId);
        await load();
      } catch (err) {
        setError(refusalSentence(err) || c.removeFailed);
      }
    },
    [adapter, load, c],
  );

  return (
    <div className="mt-6 rounded-md border" data-testid="position-holders">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2 text-sm font-medium">
          <UserCheck className="h-4 w-4 text-muted-foreground" />
          <span>{c.title}</span>
          {!loading && !readFailure && (
            <span className="text-xs text-muted-foreground font-normal">{rows.length}</span>
          )}
        </div>
        {canAdd && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy || openingPicker || !adapter}
            onClick={() => void openPicker()}
            className="gap-1 h-8 text-xs"
          >
            {busy || openingPicker ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {c.add}
          </Button>
        )}
      </div>
      <div className="px-4 py-3">
        {error && (
          <div
            className="mb-3 flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
            role="alert"
          >
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {c.loading}
          </div>
        ) : readFailure ? (
          <div
            className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
            role="alert"
            data-testid="position-holders-read-failed"
          >
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{readFailure.said || c.loadFailed}</span>
          </div>
        ) : rows.length === 0 ? (
          <div className="text-xs text-muted-foreground italic py-2">{c.empty}</div>
        ) : (
          <ul className="divide-y rounded-md border">
            {rows.map((r) => (
              <li key={r.assignmentId} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm truncate">{r.label}</div>
                  {r.email && r.email !== r.label && (
                    <div className="text-xs text-muted-foreground truncate">{r.email}</div>
                  )}
                </div>
                {canRemove && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setError(null);
                      setPendingRemove(r);
                    }}
                    aria-label={c.remove}
                    title={c.remove}
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {adapter && canAdd && (
        <RecordPickerDialog
          open={pickerOpen}
          onOpenChange={(o: boolean) => setPickerOpen(o)}
          multiple
          dataSource={adapter}
          objectName="sys_user"
          title={c.pickTitle}
          baseFilter={memberFilter}
          onSelect={() => {}}
          onSelectRecords={(records: any[]) => void addHolders(records)}
        />
      )}
      <AlertDialog
        open={pendingRemove !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemove(null);
        }}
      >
        <AlertDialogContent data-testid="position-holder-remove-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{c.removeTitle(pendingRemove?.label ?? '')}</AlertDialogTitle>
            <AlertDialogDescription>{c.removeBody(pendingRemove?.label ?? '')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="position-holder-remove-cancel">{c.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              data-testid="position-holder-remove-confirm"
              onClick={() => {
                const target = pendingRemove;
                setPendingRemove(null);
                if (target) void removeHolder(target.assignmentId);
              }}
            >
              {c.remove}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default PositionHoldersSection;
