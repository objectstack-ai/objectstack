// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PackagedActionsSection — the packaged-ACTIONS half of Setup › Packaged
 * automation (ADR-0126 §7.4 page, §8 item 2 charter, amendment ruling 3).
 *
 * The maintainer's pull, verbatim and untranslated:
 *
 * > 「动作 可能是需要开关的，因为有的 action 我不想启用。」
 *
 * ## What this section is, and what it deliberately is not
 *
 * Per packaged action it does exactly ONE thing: **on/off for this scope**.
 * That is all the `sys_metadata_activation` ledger knows about an action, and
 * the section claims nothing more.
 *
 *   ⛔ **No clone.** The flows section beside it clones (ADR-0126 §7.1);
 *      ruling 3 charters the SWITCH for actions and nothing else, and §8 item 2
 *      keeps the clone half pre-chartered until real pull appears. A clone
 *      button here would advertise machinery that does not exist — which is
 *      also why the server's own §5 refusal for actions recommends the operator
 *      and an ordinary sibling action, where the flow refusal recommends a
 *      clone.
 *   ⛔ **No drift or ancestry surface** (§9): no "customized" badge, no
 *      diff-vs-base, no base-moved notice, no link from anything to a base.
 *      The platform does not track that lineage, so a surface showing it would
 *      be showing something it had to invent. `PackagedActionsSection.test.tsx`
 *      pins the absence, including against a response that smuggles such a
 *      field in, so a future "helpful" addition fails loudly.
 *
 * ## Where the two facts on a row come from
 *
 * `packagedActions.ts` holds the reading rules and the citation for each; the
 * short version is that the artifacts come from the two declaration sources the
 * runtime itself reads (`GET /meta/object` embedded `actions[]`, plus standalone
 * `GET /meta/action` items) and the state comes from the `sys_metadata_activation`
 * ledger, whose rows this page may list by the object's own declaration
 * (`apiMethods: ['get', 'list']` — "Reads stay open so operability surfaces can
 * answer 'what is disabled here?'"). Absence of a row means active.
 *
 * ## Server refusals reach the operator VERBATIM
 *
 * Three refusals are expected here and all three are the server's words,
 * rendered as sent — ⛔ no client-side softening, shortening or re-wording, and
 * ⛔ no retry loop (every one of the three is a verdict, not a hiccup):
 *
 *   - **403 `PERMISSION_DENIED`** — the ADR-0126 §5 posture gate. In a
 *     `group` / `isolated` deployment the install-wide activation row requires
 *     the platform operator; the message names the posture AND the sanctioned
 *     path. Rewording it would drop the half that says what to do instead.
 *   - **409 `RESOURCE_CONFLICT`** — two objects declare this action name, and
 *     the ledger addresses an action by NAME (§4), so one row would switch
 *     every one of them. The message NAMES the objects, and that list is the
 *     entire value of the refusal — only the server can build it.
 *   - **503 `SERVICE_UNAVAILABLE`** — no activation ledger is attached to this
 *     deployment's engine, so nothing can be made durable. An outage is not a
 *     verdict about the action, and the message is the server's to phrase.
 *
 * `actionErrorDetail` reads the ADR-0112 envelope's message; the local fallback
 * string is used ONLY when the response carried no message at all, never in
 * place of one.
 */

import * as React from 'react';
import {
  Badge,
  Empty,
  EmptyDescription,
  EmptyTitle,
  Skeleton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { actionErrorDetail } from '@object-ui/core';

// The LEAF module, for the reason its own header gives: this section joins the
// page's graph, and the page is imported eagerly by `services/builtinComponents`.
import { apiBase } from '../../utils/apiBase.js';
import { envelopeData, envelopeRefused } from './packagedFlows.js';
import {
  collectPackagedActions,
  ledgerPageTruncated,
  readActionActivation,
  readDataRecords,
  readMetadataItems,
  type PackagedActionRow,
} from './packagedActions.js';

/* -------------------------------------------------------------------------- */
/* Fetch helpers                                                               */
/* -------------------------------------------------------------------------- */

const JSON_HEADERS = { Accept: 'application/json' } as const;

/**
 * How many ledger rows one page asks for.
 *
 * The ledger holds a row only for an artifact whose state was CHANGED from the
 * packaged default, so this is orders of magnitude above any real installation
 * — and the section does not rely on that being true: a response that reports
 * `hasMore` is treated as a load failure rather than rendered, because a
 * dropped row reads as "active" and would show a switched-off action as armed.
 */
const LEDGER_PAGE_SIZE = 1000;

async function readJson(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

async function getJson(path: string, signal: AbortSignal): Promise<Response> {
  return fetch(`${apiBase()}${path}`, {
    credentials: 'include',
    headers: JSON_HEADERS,
    cache: 'no-store',
    signal,
  });
}

/** The `object` metadata list — every object, for its embedded `actions[]`. */
async function fetchObjectMetadata(signal: AbortSignal): Promise<unknown[]> {
  const res = await getJson('/meta/object', signal);
  if (!res.ok) throw new Error(`object metadata HTTP ${res.status}`);
  return readMetadataItems(await readJson(res));
}

/**
 * The standalone `action` metadata items.
 *
 * Tolerated as EMPTY when the read fails, and that is a transcription rather
 * than a softening: the runtime's own `collectActionDeclarations` wraps this
 * exact source in `try { … } catch { standalone = []; }` with the reason spelled
 * out — *"no standalone-item source on this metadata service"*. A deployment
 * whose metadata service cannot list standalone actions still has embedded ones
 * to switch off, and failing the whole section there would take the off-switch
 * away from every action to report the absence of an optional source. ⛔ The
 * other two reads are NOT tolerated this way: an unreadable object list or an
 * unreadable ledger means this section cannot say what it exists to say.
 */
async function fetchStandaloneActionMetadata(signal: AbortSignal): Promise<unknown[]> {
  try {
    const res = await getJson('/meta/action', signal);
    if (!res.ok) return [];
    return readMetadataItems(await readJson(res));
  } catch (e) {
    if ((e as { name?: string } | null)?.name === 'AbortError') throw e;
    return [];
  }
}

/** The `sys_metadata_activation` rows — the activation EXCEPTIONS. */
async function fetchActivationLedger(signal: AbortSignal): Promise<Map<string, boolean>> {
  const res = await getJson(`/data/sys_metadata_activation?top=${LEDGER_PAGE_SIZE}`, signal);
  if (!res.ok) throw new Error(`activation ledger HTTP ${res.status}`);
  const json = await readJson(res);
  if (ledgerPageTruncated(json)) {
    // Refusing to render beats rendering the wrong direction: see
    // `ledgerPageTruncated`. Untranslated on purpose — the same posture the
    // flows half's `HTTP <status>` load errors take, which are the server's
    // diagnostics and not operator copy.
    throw new Error(
      `activation ledger returned more than ${LEDGER_PAGE_SIZE} rows; refusing to show a partial ledger ` +
        'because a missing row reads as "active"',
    );
  }
  return readActionActivation(readDataRecords(json));
}

/* -------------------------------------------------------------------------- */
/* Section                                                                     */
/* -------------------------------------------------------------------------- */

export interface PackagedActionsSectionProps {
  /**
   * Bumped by the page's Refresh control. One button refreshes both halves of
   * the page — the alternative, a second Refresh beside this table, would let
   * the two halves show states read at different moments with nothing saying so.
   */
  nonce?: number;
}

/** Row identity for busy/refusal bookkeeping: the pair the flip addresses. */
function rowKey(row: Pick<PackagedActionRow, 'name' | 'objectName'>): string {
  return `${row.objectName}:${row.name}`;
}

export function PackagedActionsSection({ nonce = 0 }: PackagedActionsSectionProps) {
  const { t } = useObjectTranslation();

  const [rows, setRows] = React.useState<PackagedActionRow[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  /** Key of the action whose flip is in flight. */
  const [busyKey, setBusyKey] = React.useState<string | null>(null);
  /** Per-action server refusal, keyed by `<object>:<action>`. Verbatim. */
  const [refusals, setRefusals] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setLoadError(null);
    (async () => {
      try {
        const [objects, standalone, activation] = await Promise.all([
          fetchObjectMetadata(controller.signal),
          fetchStandaloneActionMetadata(controller.signal),
          fetchActivationLedger(controller.signal),
        ]);
        if (cancelled) return;
        setRows(collectPackagedActions(objects, standalone, activation));
      } catch (e) {
        if (cancelled || controller.signal.aborted) return;
        setRows([]);
        setLoadError(
          e instanceof Error && e.message
            ? e.message
            : t('packagedAutomation.actionsLoadFailed', {
                defaultValue: 'Could not load packaged actions.',
              }),
        );
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [nonce, t]);

  const clearRefusal = React.useCallback((key: string) => {
    setRefusals((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  async function onToggle(row: PackagedActionRow, enabled: boolean) {
    const key = rowKey(row);
    setBusyKey(key);
    clearRefusal(key);
    try {
      const res = await fetch(
        `${apiBase()}/actions/_activation/${encodeURIComponent(row.objectName)}/${encodeURIComponent(row.name)}`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { ...JSON_HEADERS, 'Content-Type': 'application/json' },
          // ⛔ EXACTLY the one key the activation body declares. The door
          // refuses unknown keys by name, and it is right to: the flow toggle's
          // #3899 lesson is that an unchecked `{"enable": false}` — one letter
          // off — ENABLED the artifact and answered 200.
          body: JSON.stringify({ enabled }),
        },
      );
      const json = await readJson(res);
      if (!res.ok || envelopeRefused(json)) {
        // VERBATIM. All three expected refusals carry the whole of what the
        // administrator needs in this string, and two of them carry something
        // no client could reconstruct: the objects a name collides across, and
        // the reason this deployment cannot make the switch durable.
        setRefusals((prev) => ({
          ...prev,
          [key]: actionErrorDetail(
            json,
            // A SEPARATE key from the catch arm's below: this one has a status
            // to name and that one does not, and one key cannot carry a hole
            // only half its call sites can fill.
            t('packagedAutomation.toggleFailedHttp', {
              defaultValue: 'Could not change activation (HTTP {{status}}).',
              status: res.status,
            }),
          ),
        }));
        return;
      }
      const reported = envelopeData(json).enabled;
      const next = typeof reported === 'boolean' ? reported : enabled;
      setRows(
        (prev) => prev?.map((r) => (rowKey(r) === key ? { ...r, enabled: next } : r)) ?? prev,
      );
    } catch (e) {
      setRefusals((prev) => ({
        ...prev,
        [key]:
          e instanceof Error && e.message
            ? e.message
            : t('packagedAutomation.toggleFailed', { defaultValue: 'Could not change activation.' }),
      }));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className="space-y-3" data-testid="packaged-actions-section">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">
          {t('packagedAutomation.actionsHeading', { defaultValue: 'Packaged actions' })}
        </h2>
        <p className="text-sm text-muted-foreground max-w-2xl">
          {t('packagedAutomation.actionsSubtitle', {
            defaultValue:
              'Actions shipped by installed packages. Turn one off for this deployment and it stops running everywhere it is offered. Authoring your own action alongside it stays open in Studio.',
          })}
        </p>
      </div>

      {loadError && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {loadError}
        </div>
      )}

      {rows === null && (
        <div className="space-y-2" data-testid="packaged-actions-loading">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}

      {rows !== null && rows.length === 0 && !loadError && (
        <Empty>
          <EmptyTitle>
            {t('packagedAutomation.actionsEmptyTitle', { defaultValue: 'No packaged actions' })}
          </EmptyTitle>
          <EmptyDescription>
            {t('packagedAutomation.actionsEmptyBody', {
              defaultValue:
                'No installed package declares an action on this deployment. Actions you author yourself live in Studio.',
            })}
          </EmptyDescription>
        </Empty>
      )}

      {rows !== null && rows.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('packagedAutomation.colAction', { defaultValue: 'Action' })}</TableHead>
              <TableHead className="w-[200px]">
                {t('packagedAutomation.colObject', { defaultValue: 'Object' })}
              </TableHead>
              <TableHead className="w-[220px]">
                {t('packagedAutomation.colActivation', { defaultValue: 'Activation' })}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const key = rowKey(row);
              const refusal = refusals[key];
              return (
                <TableRow key={key} data-testid={`packaged-action-${row.objectName}-${row.name}`}>
                  <TableCell className="align-top">
                    <div className="font-medium">{row.label}</div>
                    <code className="font-mono text-xs text-muted-foreground">{row.name}</code>
                    {refusal && (
                      // VERBATIM server refusal, next to the control that
                      // caused it. `role="alert"` so it is announced.
                      <p role="alert" className="mt-2 text-sm text-destructive">
                        {refusal}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="align-top">
                    {/* The machine name, which is also the `:object` segment
                        the flip addresses — `global` for an object-less
                        action, the platform's own spelling. */}
                    <code className="font-mono text-xs text-muted-foreground">{row.objectName}</code>
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={row.enabled}
                        disabled={busyKey === key}
                        onCheckedChange={(next: boolean) => void onToggle(row, next)}
                        // The object is part of the accessible name because it
                        // is part of the identity: two objects may declare the
                        // same action name, and a label without the object
                        // would name two switches identically.
                        aria-label={t('packagedAutomation.actionToggleLabel', {
                          defaultValue: 'Activation for {{label}} on {{object}}',
                          label: row.label,
                          object: row.objectName,
                        })}
                      />
                      <Badge variant={row.enabled ? 'default' : 'secondary'}>
                        {row.enabled
                          ? t('packagedAutomation.on', { defaultValue: 'On' })
                          : t('packagedAutomation.off', { defaultValue: 'Off' })}
                      </Badge>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

export default PackagedActionsSection;
