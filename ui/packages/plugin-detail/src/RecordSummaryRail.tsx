/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn, RelatedCountStore, useRelatedCountVersion } from '@object-ui/components';
import { composeParentScopeFilter, mergeFilterNodes, type FieldContainerLike } from '@object-ui/core';
import { formatCurrency } from '@object-ui/fields';
import { resolveFieldCurrency, useDisplayLocale, useLocalization, withFollowedParent } from '@object-ui/i18n';
import { SchemaRenderer, toRenderableSchema, useRecordContext } from '@object-ui/react';
import { RecordTimelinePanelContext, type RecordTimelinePanel } from './recordTimelineStream';
import { resolveTitleField } from './synth/buildDefaultPageSchema';
import type { RelatedCardId } from './synth/relatedArrangement';
import { useDetailTranslation } from './useDetailTranslation';

/**
 * The 概览 tab's right rail (objectstack#35596): one small summary card per
 * other tab that has something to show, in a fixed order — 审批, 附件, 最近动态,
 * then 「其他相关」 with one card per related list that HAS records. Each card
 * is a title, a grey count (or a status), and at most three rows; the whole
 * title opens its tab. A card with nothing in it is not drawn, and nothing
 * stands in for the empty lists (no 「还有 N 个空关联」 line). Nothing in the
 * rail is editable: no composer, no upload.
 *
 * The rail is a summary of the tabs, never a second copy of them: each card
 * reads what the tab's own block reads (the approvals the host hands the
 * `record:approvals` node, the record's `sys_attachment` rows, the 动态
 * stream, a related list's first rows) and the tab draws the whole.
 */

/** The ids of the rail's own cards; a related card's id is its relationship id. */
export const RECORD_SUMMARY_APPROVALS = 'approvals';
export const RECORD_SUMMARY_ATTACHMENTS = 'attachments';

/** The most rows a summary card shows. */
export const RECORD_SUMMARY_ROWS = 3;

const rowsOf = (res: any): any[] => (Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : []);

/**
 * The rows a summary card draws, for one question (`null`: nothing to ask).
 * The record page's one read (objectstack#27627) holds each list's first rows
 * in the related-count store: `take` hands them over, once; without them the
 * card reads for itself (`read`). The answer is kept per question, so an
 * effect React runs twice (StrictMode) draws the rows it took instead of
 * finding the hand-off spent and reading again. A refused read draws no rows.
 */
function useSummaryRows(
  question: string | null,
  take: () => Promise<{ rows: any[] }> | undefined,
  read: () => Promise<any[]>,
): any[] | null {
  const [rows, setRows] = React.useState<any[] | null>(null);
  const asked = React.useRef<{ question: string; answer: Promise<any[]> } | null>(null);
  React.useEffect(() => {
    if (question === null) return undefined;
    let answer = asked.current?.question === question ? asked.current.answer : undefined;
    if (!answer) {
      const seeded = take();
      answer = (seeded ? seeded.then((res) => res.rows) : read()).catch(() => []);
      asked.current = { question, answer };
    }
    let cancelled = false;
    void answer.then((next) => {
      if (!cancelled) setRows(next);
    });
    return () => {
      cancelled = true;
    };
    // `take` and `read` answer the question; it names everything they read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question]);
  return rows;
}

export interface RecordSummaryRelated {
  id: RelatedCardId;
  /** The tab's `record:related_list` node. */
  node: any;
  /** Its count; `null` while unknown. Only a count above 0 draws a card. */
  count: number | null;
}

export interface RecordSummaryRailProps {
  /** The related lists, in the tab row's order. */
  related: readonly RecordSummaryRelated[];
  /** The 审批 tab's `record:approvals` node, when the page has one. */
  approvals?: any;
  /** Whether the page has an 附件 tab, and the count it shows. */
  attachments?: { count: number | null } | null;
  /** The 动态 tab's blocks, and the count the tab shows. */
  timeline: any[];
  timelineCount: number | null;
  onTimelineCount: (count: number | null) => void;
  /** Open a tab: the card's title. Absent: the titles open nothing. */
  onOpen?: (id: string) => void;
  /** The child objects' field definitions the host holds. */
  fieldsOf?: (objectName: string) => FieldContainerLike;
  /** Drawn after the cards (the related panels' hidden-line). */
  footer?: React.ReactNode;
}

/**
 * One summary card: radius 8, a 13 px title with its grey count, rows 26 px
 * high (objectstack#35596 item 5). The title is one button, the card's whole
 * header, ending in 「›」.
 */
export const RecordSummaryCard: React.FC<{
  id: string;
  title: string;
  count?: number | null;
  status?: React.ReactNode;
  onOpen?: (id: string) => void;
  hidden?: boolean;
  children?: React.ReactNode;
}> = ({ id, title, count, status, onOpen, hidden, children }) => (
  <section
    className="rounded-[8px] border border-border bg-card"
    aria-label={title}
    data-record-summary-card={id}
    hidden={hidden}
  >
    <button
      type="button"
      className="flex h-9 w-full min-w-0 items-center gap-1.5 rounded-[8px] px-3 text-left text-[13px] font-semibold hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => onOpen?.(id)}
      data-record-summary-card-title=""
    >
      <span className="min-w-0 truncate">{title}</span>
      {typeof count === 'number' && count > 0 && (
        <span className="shrink-0 font-normal tabular-nums text-muted-foreground" data-record-summary-card-count="">
          {count}
        </span>
      )}
      {status}
      <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
    </button>
    {children}
  </section>
);

/** A card's row: 26 px, the text on the left and its value on the right. */
const SummaryRow: React.FC<{ left: React.ReactNode; right?: React.ReactNode; title?: string }> = ({ left, right, title }) => (
  <li className="flex h-[26px] min-w-0 items-center justify-between gap-3 px-3 text-xs" title={title} data-record-summary-row="">
    <span className="min-w-0 truncate">{left}</span>
    {right !== undefined && right !== null && right !== '' && (
      <span className="shrink-0 tabular-nums text-muted-foreground">{right}</span>
    )}
  </li>
);

const SummaryRows: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ul className="pb-1.5">{children}</ul>
);

type PageNode = Record<string, any>;

const propsOf = (node: unknown): PageNode => {
  const raw = (node && typeof node === 'object' ? node : {}) as PageNode;
  return raw.properties && typeof raw.properties === 'object' ? { ...raw, ...raw.properties } : raw;
};

// ── 审批 ───────────────────────────────────────────────────────────────────

interface ApprovalStepRow {
  key: string;
  label: string;
  state: 'done' | 'mine' | 'waiting';
  waitingOn?: string;
}

/**
 * The pending approval's steps, at most three, ending at the step it waits
 * on: the request's own route (`flow_route`, the server's) when it carries
 * one, else the pending step alone. `null` when nothing is pending — the card
 * is drawn only while an approval runs (objectstack#35596 item 4).
 */
export function approvalSummaryRows(approvals: any, currentUserId: string | undefined): ApprovalStepRow[] | null {
  const pending = approvals?.pendingRequest;
  if (!pending || typeof pending !== 'object') return null;
  const approvers: string[] = Array.isArray(pending.pending_approvers) ? pending.pending_approvers : [];
  const mine = pending.viewer?.can_act === true || (!!currentUserId && approvers.includes(currentUserId));
  const names: Record<string, string> = pending.pending_approver_names ?? {};
  const waitingOn = approvers.map((id) => names[id]).filter((n): n is string => typeof n === 'string' && n !== '');
  const currentLabel: string = pending.step_label || pending.current_step || pending.process_label || pending.process_name || '';
  const current: ApprovalStepRow = {
    key: 'current',
    label: currentLabel,
    state: mine ? 'mine' : 'waiting',
    ...(waitingOn.length > 0 ? { waitingOn: waitingOn.join(', ') } : {}),
  };
  const steps: any[] = Array.isArray(pending.flow_route?.steps) ? pending.flow_route.steps : [];
  const at = steps.findIndex((s) => s?.state === 'current');
  if (at < 0) return [current];
  const rows: ApprovalStepRow[] = steps
    .slice(0, at)
    .filter((s) => s?.state === 'done')
    .map((s, i) => ({ key: `done-${s.id ?? i}`, label: String(s.label ?? s.id ?? ''), state: 'done' as const }));
  rows.push({ ...current, label: String(steps[at].label ?? currentLabel) });
  return rows.slice(-RECORD_SUMMARY_ROWS);
}

const ApprovalsSummary: React.FC<{ node: any; onOpen?: (id: string) => void }> = ({ node, onOpen }) => {
  const { t } = useDetailTranslation();
  const p = propsOf(node);
  const rows = approvalSummaryRows(p.approvals, p.currentUserId);
  if (!rows) return null;
  const stateText = (row: ApprovalStepRow) =>
    row.state === 'done'
      ? t('detail.summaryApprovalDone', { defaultValue: 'Approved' })
      : row.state === 'mine'
        ? t('detail.summaryApprovalMine', { defaultValue: 'Awaiting you' })
        : row.waitingOn
          ? t('detail.summaryApprovalWaitingOn', { name: row.waitingOn, defaultValue: 'Waiting on {{name}}' })
          : t('detail.summaryApprovalWaiting', { defaultValue: 'Waiting' });
  return (
    <RecordSummaryCard
      id={RECORD_SUMMARY_APPROVALS}
      title={t('detail.approvalsPanelTitle', { defaultValue: 'Approvals' })}
      onOpen={onOpen}
    >
      <SummaryRows>
        {rows.map((row) => (
          <SummaryRow
            key={row.key}
            left={row.label}
            right={<span className={cn(row.state === 'mine' && 'font-medium text-primary')}>{stateText(row)}</span>}
          />
        ))}
      </SummaryRows>
    </RecordSummaryCard>
  );
};

// ── 附件 ───────────────────────────────────────────────────────────────────

/**
 * The related-count store key the record's attachments are counted under: the
 * synthetic relationship the 附件 tab badge probes (`page:tabs`), which the
 * record page payload seeds and the panel takes its rows from.
 */
export const attachmentsCountField = (objectName: string): string => `attachments:${objectName}`;

/**
 * How many attachments the record holds, through the store the tab badge and
 * the panel share: the probe is the badge's own (the `(parent_object,
 * parent_id)` scope), so a page payload that seeded it answers at once.
 * `null` while unknown, or with nothing to ask.
 */
export function useRecordAttachmentCount(enabled: boolean): number | null {
  const ctx = useRecordContext();
  useRelatedCountVersion();
  const objectName = ctx?.objectName;
  const parentId = ctx?.recordId === undefined || ctx?.recordId === null ? undefined : String(ctx.recordId);
  const ds: any = ctx?.dataSource;
  const field = objectName ? attachmentsCountField(objectName) : undefined;
  const cached = enabled && field && parentId ? RelatedCountStore.get('sys_attachment', field, parentId) : undefined;
  React.useEffect(() => {
    if (!enabled || !field || !parentId || !ds || typeof ds.find !== 'function') return;
    if (RelatedCountStore.get('sys_attachment', field, parentId) !== undefined) return;
    const finder = (object: string, query: any) =>
      ds.find(object, { ...query, $filter: { parent_object: objectName, parent_id: parentId } });
    void RelatedCountStore.fetch(finder, 'sys_attachment', field, parentId).catch(() => 0);
  }, [enabled, field, parentId, ds, objectName, cached]);
  return typeof cached === 'number' ? cached : null;
}

const formatSize = (bytes: unknown): string => {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const AttachmentsSummary: React.FC<{ count: number | null; onOpen?: (id: string) => void }> = ({ count, onOpen }) => {
  const { t } = useDetailTranslation();
  const ctx = useRecordContext();
  const ds: any = ctx?.dataSource;
  const objectName = ctx?.objectName;
  const parentId = ctx?.recordId === undefined || ctx?.recordId === null ? undefined : String(ctx.recordId);
  const has = typeof count === 'number' && count > 0;
  const rows = useSummaryRows(
    has && ds && typeof ds.find === 'function' && objectName && parentId
      ? JSON.stringify([objectName, parentId, count])
      : null,
    // The payload's newest attachments, under the key the 附件 tab counts.
    () => RelatedCountStore.takeRows('sys_attachment', attachmentsCountField(objectName!), parentId!, undefined, RECORD_SUMMARY_ROWS),
    async () =>
      rowsOf(
        await ds.find('sys_attachment', {
          $filter: { parent_object: objectName, parent_id: parentId },
          $orderby: { created_at: 'desc' },
          $top: RECORD_SUMMARY_ROWS,
        }),
      ),
  );
  if (!has) return null;
  return (
    <RecordSummaryCard
      id={RECORD_SUMMARY_ATTACHMENTS}
      title={t('detail.attachments', { defaultValue: 'Attachments' })}
      count={count}
      onOpen={onOpen}
    >
      {rows && rows.length > 0 && (
        <SummaryRows>
          {rows.slice(0, RECORD_SUMMARY_ROWS).map((row, i) => (
            <SummaryRow
              key={String(row?.id ?? i)}
              left={row?.file_name || row?.file_id || ''}
              right={formatSize(row?.size)}
            />
          ))}
        </SummaryRows>
      )}
    </RecordSummaryCard>
  );
};

// ── 最近动态 ────────────────────────────────────────────────────────────────

/**
 * The 动态 card: the stream's own blocks in their peek face, the newest three,
 * with no composer (`showCommentInput: false` — nothing in the rail is
 * editable) and no 「查看全部」 of their own (the title opens the tab). It stays
 * mounted, `hidden`, until the stream reports entries, because the count it
 * shows is the one the stream reports. A slotted page's `record:chatter` /
 * `record:discussion` stream reports no count, so its card is drawn as it
 * comes — its first page of three, read-only (`feed.showCommentInput: false`,
 * `feed.limit: 3`).
 */
const TimelineSummary: React.FC<{
  nodes: any[];
  count: number | null;
  onCount: (count: number | null) => void;
  onOpen?: (id: string) => void;
  timelineId: string;
}> = ({ nodes, count, onCount, onOpen, timelineId }) => {
  const { t } = useDetailTranslation();
  const panel = React.useMemo<RecordTimelinePanel>(
    () => ({ entries: RECORD_SUMMARY_ROWS, onCount }),
    [onCount],
  );
  const peekNodes = React.useMemo(() => nodes.map(readOnlyStreamNode), [nodes]);
  const counted = nodes.some((node) => node && typeof node === 'object' && node.type === 'record:activity');
  return (
    <RecordSummaryCard
      id={timelineId}
      title={t('detail.summaryRecentActivity', { defaultValue: 'Recent activity' })}
      count={count}
      onOpen={onOpen}
      hidden={counted && !(typeof count === 'number' && count > 0)}
    >
      {/* Edge to edge: the peek rows pad themselves, and a chatter stream
          insets itself in a timeline card (objectstack#34676). */}
      <div data-record-summary-timeline="">
        <RecordTimelinePanelContext.Provider value={panel}>
          {peekNodes.map((node, index) => (
            <SchemaRenderer key={(node && typeof node === 'object' && node.id) || index} schema={toRenderableSchema(node)} />
          ))}
        </RecordTimelinePanelContext.Provider>
      </div>
    </RecordSummaryCard>
  );
};

/** A stream block as the rail draws it: read-only, the newest few. */
function readOnlyStreamNode(node: any): any {
  if (!node || typeof node !== 'object') return node;
  const props = node.properties ?? {};
  if (node.type === 'record:activity') return { ...node, properties: { ...props, showCommentInput: false } };
  if (node.type === 'record:chatter' || node.type === 'record:discussion') {
    const feed = { ...(node.feed ?? {}), ...(props.feed ?? {}), showCommentInput: false, limit: RECORD_SUMMARY_ROWS };
    return { ...node, ...(node.feed ? { feed } : {}), properties: { ...props, feed } };
  }
  return node;
}

// ── 其他相关 ────────────────────────────────────────────────────────────────

const columnKey = (col: unknown): string | undefined => {
  if (typeof col === 'string') return col;
  if (col && typeof col === 'object') {
    const c = col as PageNode;
    const key = c.field ?? c.accessorKey ?? c.name;
    return typeof key === 'string' ? key : undefined;
  }
  return undefined;
};

const fieldMap = (fields: FieldContainerLike | undefined): Record<string, any> => {
  if (!fields) return {};
  if (Array.isArray(fields)) {
    const out: Record<string, any> = {};
    for (const f of fields as any[]) if (f && typeof f.name === 'string') out[f.name] = f;
    return out;
  }
  return fields as Record<string, any>;
};

const KEY_VALUE_TYPES = ['currency', 'select', 'status'] as const;

/**
 * The key value a related row shows beside its name (objectstack#35596 item
 * 2): the list's first amount column, else its first status column — read off
 * the list's declared columns, then the child's fields in order.
 */
export function relatedKeyValueField(columns: unknown, fields: FieldContainerLike | undefined): string | null {
  const defs = fieldMap(fields);
  const declared = Array.isArray(columns) ? columns.map(columnKey).filter((k): k is string => !!k) : [];
  const keys = declared.length > 0 ? declared : Object.keys(defs);
  for (const type of KEY_VALUE_TYPES) {
    const hit = keys.find((k) => defs[k]?.type === type);
    if (hit) return hit;
  }
  return null;
}

const RelatedSummary: React.FC<{
  entry: RecordSummaryRelated;
  onOpen?: (id: string) => void;
  fieldsOf?: (objectName: string) => FieldContainerLike;
}> = ({ entry, onOpen, fieldsOf }) => {
  const ctx = useRecordContext();
  const ds: any = ctx?.dataSource;
  const parentId = ctx?.recordId;
  const locale = useDisplayLocale();
  const { currency: tenantCurrency } = useLocalization();
  const p = propsOf(entry.node);
  const objectName: string = p.objectName;
  const relationshipField: string = p.relationshipField;
  const title: string = typeof p.title === 'string' && p.title ? p.title : objectName;
  const [fields, setFields] = React.useState<FieldContainerLike | undefined>(() => fieldsOf?.(objectName));
  const filterKey = JSON.stringify(p.filter ?? null);
  // The child's field definitions: the host's, else the data source's. Read
  // once per object; the scope filter and the row's name and value need them.
  const defsRead = React.useRef<{ objectName: string; read: Promise<FieldContainerLike | undefined> } | null>(null);
  const defsOf = (): Promise<FieldContainerLike | undefined> => {
    if (defsRead.current?.objectName !== objectName) {
      const held = fieldsOf?.(objectName);
      const read: Promise<FieldContainerLike | undefined> =
        held || !ds || typeof ds.getObjectSchema !== 'function'
          ? Promise.resolve(held)
          : Promise.resolve(ds.getObjectSchema(objectName)).then((schema: any) => schema?.fields, () => undefined);
      defsRead.current = { objectName, read };
    }
    return defsRead.current.read;
  };
  React.useEffect(() => {
    let cancelled = false;
    void defsOf().then((defs) => {
      if (!cancelled) setFields(defs);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ds, objectName]);
  const rows = useSummaryRows(
    ds && typeof ds.find === 'function' && parentId !== undefined && parentId !== null
      ? JSON.stringify([objectName, relationshipField, String(parentId), filterKey, entry.count])
      : null,
    // The record page's one read (objectstack#27627) holds each list's first
    // rows: take them rather than read again.
    () => RelatedCountStore.takeRows(objectName, relationshipField, String(parentId), p.filter ?? undefined, RECORD_SUMMARY_ROWS),
    async () => {
      const scope = composeParentScopeFilter(relationshipField, parentId as string | number, await defsOf());
      return rowsOf(await ds.find(objectName, { $filter: mergeFilterNodes(scope, p.filter), $top: RECORD_SUMMARY_ROWS }));
    },
  );

  const defs = fieldMap(fields);
  const nameField = resolveTitleField({ name: objectName, fields: defs } as any) ?? 'name';
  const valueField = relatedKeyValueField(p.columns, fields);
  const valueOf = (row: any): string => {
    if (!valueField) return '';
    const def = defs[valueField];
    const raw = row?.[valueField];
    if (raw === null || raw === undefined || raw === '') return '';
    if (def?.type === 'currency') {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n)) return '';
      const code = resolveFieldCurrency(def, tenantCurrency, withFollowedParent(row, def, ctx?.data as any));
      return formatCurrency(n, code, locale);
    }
    const options: any[] = Array.isArray(def?.options) ? def.options : [];
    const option = options.find((o) => (o && typeof o === 'object' ? o.value : o) === raw);
    return option && typeof option === 'object' && typeof option.label === 'string' ? option.label : String(raw);
  };
  return (
    <RecordSummaryCard id={entry.id} title={title} count={entry.count} onOpen={onOpen}>
      {rows && rows.length > 0 && (
        <SummaryRows>
          {rows.slice(0, RECORD_SUMMARY_ROWS).map((row, i) => {
            const name = row?.[nameField] ?? row?.name ?? row?.id ?? '';
            return <SummaryRow key={String(row?.id ?? i)} left={String(name)} right={valueOf(row)} />;
          })}
        </SummaryRows>
      )}
    </RecordSummaryCard>
  );
};

/** The 动态 tab's id (`RECORD_PAGE_TIMELINE_PANEL`), passed in to keep this file free of the page module. */
const TIMELINE_ID = 'timeline';

export const RecordSummaryRail: React.FC<RecordSummaryRailProps> = ({
  related,
  approvals,
  attachments,
  timeline,
  timelineCount,
  onTimelineCount,
  onOpen,
  fieldsOf,
  footer,
}) => {
  const { t } = useDetailTranslation();
  const withRecords = related.filter((entry) => typeof entry.count === 'number' && entry.count > 0);
  return (
    <>
      {approvals && <ApprovalsSummary node={approvals} onOpen={onOpen} />}
      {attachments && <AttachmentsSummary count={attachments.count} onOpen={onOpen} />}
      {timeline.length > 0 && (
        <TimelineSummary
          nodes={timeline}
          count={timelineCount}
          onCount={onTimelineCount}
          onOpen={onOpen}
          timelineId={TIMELINE_ID}
        />
      )}
      {withRecords.length > 0 && (
        <>
          <h3 className="px-1 pt-1 text-xs font-medium text-muted-foreground" data-record-summary-other="">
            {t('detail.summaryOtherRelated', { defaultValue: 'Other related' })}
          </h3>
          {withRecords.map((entry) => (
            <RelatedSummary key={entry.id} entry={entry} onOpen={onOpen} fieldsOf={fieldsOf} />
          ))}
        </>
      )}
      {footer}
    </>
  );
};
