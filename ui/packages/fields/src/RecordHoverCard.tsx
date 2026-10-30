/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * RecordHoverCard — a glance at a referenced record without leaving the page
 * (objectstack#27604).
 *
 * Wrap any element that names a record — a lookup value's link, the name in a
 * compact related row — and hovering it for {@link OPEN_DELAY_MS} shows a
 * floating card: the target object's icon and label, the record's name (a
 * link that opens it the way the reference itself does), and the object's
 * declared `highlightFields` (ADR-0085), drawn by the same cell renderers a
 * list draws them with. Keyboard: Space on the focused reference shows the
 * card, Esc hides it. Focus alone does not: tabbing through a list of
 * references must not pop a card per row.
 *
 * Invariants:
 *
 * - **Stateless and floating.** The card is portalled to `document.body`, so
 *   the host keeps its layout: nothing expands, nothing pushes the panels
 *   below. One card is open at a time.
 * - **One read per shown card, none per reference.** Nothing is read until a
 *   card is shown. The read is one `findOne` (with `$expand` naming only the
 *   reference fields the card draws), cached per record in this module and
 *   dropped when the data bus says the record changed.
 * - **Metadata only.** The fields are the DECLARED `highlightFields`, minus
 *   the name field, those the object does not define and those the viewer may
 *   not read, at most {@link HIGHLIGHTS_MAX}. Nothing is derived: an object
 *   that declares none shows its name and its object label only.
 * - **No card inside a card.** References drawn inside the card are plain
 *   links ({@link InsideRecordHoverCard}).
 * - **Inert without a source.** No data source with `findOne` in the
 *   renderer context, no object name or no record id: the child renders
 *   exactly as it would without this wrapper.
 */

import * as React from 'react';
import { createPortal } from 'react-dom';
import { HoverCard, HoverCardContent, HoverCardTrigger, LazyIcon, Skeleton, cn } from '@object-ui/components';
import {
  buildExpandFields,
  getRecordDisplayName,
  humanizeLabel,
  isEmptyValue,
  resolveNameField,
  withoutDeniedFields,
} from '@object-ui/core';
import { pickLocalized } from '@object-ui/i18n';
import type { FieldMetadata } from '@object-ui/types';
import { usePermissions } from '@object-ui/permissions';
import {
  SchemaRendererContext,
  dataChangeMatches,
  subscribeDataChanges,
  useDataInvalidation,
  useObjectLabel,
  useObjectTranslation,
  useRelatedRecordActions,
} from '@object-ui/react';
import { getCellRenderer, pickRecordDisplayName, resolveCellRendererType } from './index.js';

/** How long a pointer rests on a reference before its card shows. */
const OPEN_DELAY_MS = 400;
/** How long the card stays after the pointer leaves (time to reach it). */
const CLOSE_DELAY_MS = 200;
/** The record header's six (`RECORD_HIGHLIGHTS_MAX` in `@object-ui/plugin-detail`). */
const HIGHLIGHTS_MAX = 6;
/** Records whose read the module keeps; the oldest goes first. */
const READS_MAX = 200;

/** The target object's definition, as the host already holds it. */
export interface RecordHoverCardObjectDef {
  name?: string;
  label?: unknown;
  icon?: unknown;
  fields?: Record<string, any> | null;
  highlightFields?: unknown;
  [key: string]: unknown;
}

export interface RecordHoverCardProps {
  /** The referenced record's object. */
  objectName?: string;
  /** The referenced record's id. */
  recordId?: string | number | null;
  /**
   * The target object's definition the host holds (its `fields`,
   * `highlightFields`, `icon`, `label`). Absent: the card shows the record's
   * name and the object name, no highlights.
   */
  objectSchema?: RecordHoverCardObjectDef | null;
  /** The name the reference shows, used until the record is read. */
  label?: string;
  /**
   * Open the record the way a click on the reference does. Absent: the host's
   * `openRecord` (`RelatedRecordActionsContext`), the lookup link's own path.
   */
  onOpen?: (event: React.MouseEvent<HTMLElement>) => void;
  /** The reference: one element that takes a ref and pointer / key handlers. */
  children: React.ReactElement;
}

/** The one read the card makes; the console's adapter satisfies it as it is. */
interface HoverCardSource {
  findOne(objectName: string, id: string, params?: { $expand?: string[] }): Promise<unknown>;
}

/** `true` inside a card: references drawn there get no card of their own. */
const InsideRecordHoverCard = React.createContext(false);

/** Closes the card that is open now, so showing another hides it. */
let closeOpenCard: (() => void) | null = null;

// ── The read cache ─────────────────────────────────────────────────────────

type HoverRead =
  | { state: 'pending'; objectName: string; recordId: string; promise: Promise<void> }
  | { state: 'readable'; objectName: string; recordId: string; record: Record<string, unknown> }
  | { state: 'unreadable'; objectName: string; recordId: string };

const reads = new Map<string, HoverRead>();
let unsubscribeReads: (() => void) | null = null;

const readKey = (objectName: string, recordId: string): string => `${objectName}\u0000${recordId}`;

function storeRead(key: string, entry: HoverRead): void {
  reads.delete(key);
  reads.set(key, entry);
  while (reads.size > READS_MAX) {
    const oldest = reads.keys().next().value;
    if (oldest === undefined) break;
    reads.delete(oldest);
  }
}

/** A record the data bus says changed is read again the next time it shows. */
function watchDataChanges(): void {
  if (unsubscribeReads) return;
  unsubscribeReads = subscribeDataChanges((change) => {
    for (const [key, entry] of Array.from(reads)) {
      if (entry.state !== 'pending' && dataChangeMatches(change, entry.objectName, entry.recordId)) reads.delete(key);
    }
  });
}

function startRead(source: HoverCardSource, objectName: string, recordId: string, expand: string[]): void {
  watchDataChanges();
  const key = readKey(objectName, recordId);
  // The executor runs synchronously, so a source that throws lands where a
  // rejection does.
  const promise = new Promise<unknown>((resolve) => {
    resolve(
      expand.length > 0
        ? source.findOne(objectName, recordId, { $expand: expand })
        : source.findOne(objectName, recordId),
    );
  }).then(
    (record) => {
      storeRead(
        key,
        record && typeof record === 'object'
          ? { state: 'readable', objectName, recordId, record: record as Record<string, unknown> }
          : { state: 'unreadable', objectName, recordId },
      );
    },
    () => storeRead(key, { state: 'unreadable', objectName, recordId }),
  );
  storeRead(key, { state: 'pending', objectName, recordId, promise });
}

/**
 * The card's read of one record: from the cache when it holds the record,
 * else one `findOne` shared by every card that shows the same record while it
 * is out. A change on the data bus reads it again, keeping what the card shows
 * until the answer lands.
 */
function useHoverCardRead(
  source: HoverCardSource,
  objectName: string,
  recordId: string,
  expand: string[],
): HoverRead | undefined {
  const key = readKey(objectName, recordId);
  const changed = useDataInvalidation(objectName, recordId);
  // The last answer this card drew, shown while a re-read is out.
  const [kept, setKept] = React.useState<{ key: string; entry: HoverRead } | null>(null);
  // The data the read sends, as a string, so the effect keys on it.
  const expandKey = expand.join(',');
  React.useEffect(() => {
    let alive = true;
    if (!reads.has(key)) startRead(source, objectName, recordId, expandKey ? expandKey.split(',') : []);
    const entry = reads.get(key);
    if (entry?.state === 'pending') {
      void entry.promise.then(() => {
        const settled = reads.get(key);
        if (alive && settled && settled.state !== 'pending') setKept({ key, entry: settled });
      });
    }
    return () => {
      alive = false;
    };
  }, [key, source, objectName, recordId, expandKey, changed]);
  const entry = reads.get(key);
  if (entry && entry.state !== 'pending') return entry;
  return kept?.key === key ? kept.entry : entry;
}

// ── What the card shows ────────────────────────────────────────────────────

/**
 * The declared `highlightFields` the card draws: strings naming a field the
 * object defines, the name field and the fields the viewer may not read left
 * out before the cap, so neither wastes a slot.
 */
function declaredHighlights(
  def: RecordHoverCardObjectDef | null | undefined,
  objectName: string,
  perms: ReturnType<typeof usePermissions>,
): string[] {
  if (!def || !Array.isArray(def.highlightFields)) return [];
  const fields = def.fields ?? {};
  const nameField = resolveNameField(def);
  return (def.highlightFields as unknown[])
    .filter(
      (name): name is string =>
        typeof name === 'string' &&
        name !== '' &&
        name !== nameField &&
        fields[name] != null &&
        (!perms?.isLoaded || perms.checkField(objectName, name, 'read')),
    )
    .slice(0, HIGHLIGHTS_MAX);
}

const stopPropagation = (event: React.SyntheticEvent) => event.stopPropagation();

/**
 * The record's name as a link: the host's record URL, so a modifier click
 * opens a tab, and a plain click handed to `open` (the reference's own path).
 */
function CardTitle({
  objectName,
  recordId,
  onOpen,
  onDone,
  children,
}: {
  objectName: string;
  recordId: string;
  onOpen?: (event: React.MouseEvent<HTMLElement>) => void;
  onDone: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  const host = useRelatedRecordActions();
  const href = host?.recordHref ? host.recordHref(objectName, recordId) : null;
  const open =
    onOpen ?? (host?.openRecord ? () => host.openRecord!(objectName, recordId) : undefined);
  const className =
    'block max-w-full truncate rounded-sm text-left text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  if (href) {
    return (
      <a
        href={href}
        className={className}
        data-record-hover-card-title=""
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
          if (!open) return;
          event.preventDefault();
          onDone();
          open(event);
        }}
      >
        {children}
      </a>
    );
  }
  if (open) {
    return (
      <button
        type="button"
        className={className}
        data-record-hover-card-title=""
        onClick={(event) => {
          onDone();
          open(event);
        }}
      >
        {children}
      </button>
    );
  }
  return (
    <span className="block truncate text-sm font-semibold" data-record-hover-card-title="">
      {children}
    </span>
  );
}

function RecordHoverCardBody({
  source,
  objectName,
  recordId,
  objectSchema,
  label,
  onOpen,
  onDone,
}: {
  source: HoverCardSource;
  objectName: string;
  recordId: string;
  objectSchema?: RecordHoverCardObjectDef | null;
  label?: string;
  onOpen?: (event: React.MouseEvent<HTMLElement>) => void;
  onDone: () => void;
}): React.ReactElement {
  const perms = usePermissions();
  const { language } = useObjectTranslation();
  const { objectLabel, fieldLabel, translateOptions } = useObjectLabel();
  const highlights = declaredHighlights(objectSchema, objectName, perms);
  const expandable = objectSchema ? buildExpandFields(objectSchema.fields, highlights) : [];
  const expand = perms?.isLoaded
    ? expandable.filter((field) => perms.checkField(objectName, field, 'read'))
    : expandable;
  const read = useHoverCardRead(source, objectName, recordId, expand);
  // Not asked yet is the first render's answer: the read starts in an effect.
  const pending = !read || read.state === 'pending';
  const record = read?.state === 'readable' ? withoutDeniedFields(read.record, perms, objectName) : null;

  const name =
    (record && (objectSchema ? getRecordDisplayName(objectSchema, record) : pickRecordDisplayName(record))) ||
    label ||
    recordId;
  const typeLabel = objectLabel({
    name: objectName,
    label: pickLocalized(objectSchema?.label, language) || humanizeLabel(objectName),
  });

  const rows = record
    ? highlights
        .filter((field) => !isEmptyValue(record[field]))
        .map((field) => {
          const def = objectSchema!.fields![field] as Record<string, any>;
          const caption = fieldLabel(objectName, field, pickLocalized(def.label, language) || humanizeLabel(field));
          const meta: Record<string, any> = { ...def, name: field, label: caption };
          if (Array.isArray(def.options)) meta.options = translateOptions(objectName, field, def.options);
          const Cell = getCellRenderer(resolveCellRendererType(meta as { type?: string; format?: string }));
          return (
            <React.Fragment key={field}>
              <dt className="truncate text-muted-foreground">{caption}</dt>
              <dd className="min-w-0 truncate" data-record-hover-card-field={field}>
                <Cell value={record[field]} field={meta as unknown as FieldMetadata} />
              </dd>
            </React.Fragment>
          );
        })
    : [];

  return (
    <div
      className="flex flex-col gap-2.5"
      data-record-hover-card=""
      data-record-hover-card-object={objectName}
      aria-busy={pending || undefined}
    >
      <div className="flex min-w-0 items-start gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <LazyIcon
            name={typeof objectSchema?.icon === 'string' ? objectSchema.icon : undefined}
            className="h-4 w-4"
            aria-hidden="true"
          />
        </span>
        <div className="min-w-0 flex-1">
          <CardTitle objectName={objectName} recordId={recordId} onOpen={onOpen} onDone={onDone}>
            {name}
          </CardTitle>
          <div className="truncate text-xs text-muted-foreground" data-record-hover-card-object-label="">
            {typeLabel}
          </div>
        </div>
      </div>
      {pending && highlights.length > 0 ? (
        <div className="flex flex-col gap-1.5" data-record-hover-card-pending="">
          {highlights.map((field) => (
            <Skeleton key={field} className="h-3.5 w-full rounded" />
          ))}
        </div>
      ) : rows.length > 0 ? (
        <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-baseline gap-x-3 gap-y-1.5 text-xs">{rows}</dl>
      ) : null}
    </div>
  );
}

/**
 * A hover card over one record reference. See the module comment for what it
 * shows and the rules it keeps.
 */
export function RecordHoverCard({
  objectName,
  recordId,
  objectSchema,
  label,
  onOpen,
  children,
}: RecordHoverCardProps): React.ReactElement {
  const nested = React.useContext(InsideRecordHoverCard);
  const source = React.useContext(SchemaRendererContext)?.dataSource as unknown as HoverCardSource | null | undefined;
  const [open, setOpen] = React.useState(false);
  // Radix opens a hover card on focus as well as on hover; only a pointer
  // resting on the reference (or Space) may open this one.
  const pointerInside = React.useRef(false);
  const [close] = React.useState(() => () => setOpen(false));
  React.useEffect(
    () => () => {
      if (closeOpenCard === close) closeOpenCard = null;
    },
    [close],
  );

  if (
    nested ||
    !objectName ||
    recordId == null ||
    recordId === '' ||
    !source ||
    typeof source.findOne !== 'function'
  ) {
    return children;
  }

  const show = () => {
    if (closeOpenCard && closeOpenCard !== close) closeOpenCard();
    closeOpenCard = close;
    setOpen(true);
  };
  const hide = () => {
    if (closeOpenCard === close) closeOpenCard = null;
    setOpen(false);
  };

  return (
    <HoverCard
      open={open}
      onOpenChange={(next) => {
        if (!next) hide();
        else if (pointerInside.current) show();
      }}
      openDelay={OPEN_DELAY_MS}
      closeDelay={CLOSE_DELAY_MS}
    >
      <HoverCardTrigger
        asChild
        onPointerEnter={(event) => {
          if (event.pointerType !== 'touch') pointerInside.current = true;
        }}
        onPointerLeave={() => {
          pointerInside.current = false;
        }}
        onKeyDown={(event) => {
          if (event.key !== ' ' || event.target !== event.currentTarget) return;
          // Space shows the card instead of scrolling the page or pressing a
          // button reference; Enter still follows the reference.
          event.preventDefault();
          event.stopPropagation();
          show();
        }}
        onKeyUp={(event) => {
          if (event.key === ' ' && event.target === event.currentTarget) event.preventDefault();
        }}
      >
        {children}
      </HoverCardTrigger>
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <HoverCardContent
            side="bottom"
            align="start"
            sideOffset={6}
            className="w-72 p-3"
            data-record-hover-card-content=""
            // Events inside a portal still bubble through the React tree; the
            // rows around a reference open or copy on click and key.
            onClick={stopPropagation}
            onDoubleClick={stopPropagation}
            onKeyDown={stopPropagation}
          >
            <InsideRecordHoverCard.Provider value={true}>
              <RecordHoverCardBody
                source={source}
                objectName={objectName}
                recordId={String(recordId)}
                objectSchema={objectSchema}
                label={label}
                onOpen={onOpen}
                onDone={hide}
              />
            </InsideRecordHoverCard.Provider>
          </HoverCardContent>,
          document.body,
        )}
    </HoverCard>
  );
}
