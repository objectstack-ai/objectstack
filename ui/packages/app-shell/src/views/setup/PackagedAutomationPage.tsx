// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PackagedAutomationPage — Setup › "Packaged automation" (ADR-0126 §7.4).
 *
 * ## What this page is, and what it deliberately is not
 *
 * Automation AUTHORING lives in Studio and stays there. This page is the
 * OPERATIONAL surface for the automation a code package shipped, in two
 * sections: the packaged FLOWS below, and the packaged ACTIONS in
 * `PackagedActionsSection.tsx` (ADR-0126 §8 item 2, amendment ruling 3 — its
 * own header carries that charter and the reasons its section has no clone).
 *
 * Per packaged flow this half does exactly two things, and claims nothing
 * beyond them —
 *
 *   1. **on/off for this scope** — reads the activation state the engine
 *      reports (`GET /api/v1/automation/_status`, backed by the ADR-0126 §7.2
 *      `sys_metadata_activation` ledger) and flips it through
 *      `POST /api/v1/automation/<name>/toggle`;
 *   2. **clone** — `POST /api/v1/automation/<name>/clone` with a mandatory NEW
 *      machine name and label (ADR-0126 §7.1). The dialog opens on
 *      `<name>_copy` and "<label> (copy)", both editable (objectui#13344).
 *
 * Everything else a "packaged flow" page could plausibly show is withdrawn by
 * ADR-0126 §9, and its absence is load-bearing rather than unfinished:
 *
 *   ⛔ no diff-vs-base, ⛔ no "customized" badge, ⛔ no "based on v3" /
 *   base-moved notice, ⛔ no ancestry link from a clone back to its source.
 *
 * The platform does not track that lineage, so a surface that displayed it
 * would be displaying something it had to invent. Cloned-without-disabled and
 * disabled-without-clone are ordinary states, shown plainly, not halves of an
 * unfinished ceremony. `PackagedAutomationPage.test.tsx` pins the absence of
 * the withdrawn shapes so a future "helpful" addition fails loudly.
 *
 * ## The clone result offers the next steps (objectui#13270)
 *
 * A clone is created `draft`, which is NOT an off-switch: a cloned
 * record-change or schedule flow runs beside the flow it was copied from, and
 * the server's notice says so. So the result keeps that notice verbatim and
 * offers the two doors an admin otherwise has to find alone, as the declared
 * sharing rule's clone does (`SharingRuleCloneDialog`):
 *
 *   - **Switch "SOURCE" off** — the SAME packaged-flow toggle the row's switch
 *     calls, for the row the admin cloned from. It is the page's own knowledge
 *     of which row was clicked, not a lineage the platform tracks, and it is
 *     an offer, not a step: clone and disable stay independent primitives
 *     (ADR-0126). Offered only while that row reads on; a refusal is the
 *     server's sentence, shown beside the button, which stays offered.
 *   - **Open the clone in Studio** — the package-less scope where a clone is
 *     listed and edited (`studioOrgScopePath`, objectui#11553).
 *
 * For the same reason this page shows no `bound` / `status` column even though
 * `_status` carries both: §7.4 scopes it to what the activation ledger knows.
 * The Studio rail is where a flow's binding is diagnosed.
 * The one exception is an unbound row's `reason`: the platform's own sentence
 * for why the flow is not armed (objectui#9217), shown verbatim and muted in a
 * disclosure behind a neutral chip after the flow's name (objectui#12609), so
 * a row that carries one keeps the table's row height — never parsed, never
 * styled as an error. `ReasonDetails` below carries the chip's rules.
 *
 * And the switch is not the whole of the Activation cell (objectui#13159). The
 * switch shows and writes the activation FLAG; the badge beside it says
 * whether the flow RUNS. On a row the engine reports enabled but not armed —
 * the row carries an `unboundCause`, e.g. every packaged schedule flow while a
 * deployment keeps package-authored scheduled work off — the switch stays on
 * (the author may want the flag set for a deployment that does arm it) and the
 * badge reads "Not running here", the words Studio's rail uses for the same
 * state, instead of an "On" an admin takes for "running". `activationReading`
 * in `packagedFlows.ts` is that rule. After a toggle the runtime states are
 * read again, because the toggle's answer carries the flag alone and the flip
 * can move what the engine armed — this row's trigger, or a caller of it.
 *
 * ## Server refusals reach the operator VERBATIM
 *
 * Three refusals are expected here and all three are the server's words,
 * rendered as sent — no client-side softening, shortening or re-wording:
 *
 *   - **403 `PERMISSION_DENIED`** — the ADR-0126 §5 posture gate. In a
 *     `group` / `isolated` deployment the install-wide activation row requires
 *     the platform operator; the server's message names the posture AND the
 *     sanctioned path (clone under a new name). Rewording it here would drop
 *     the half that tells the admin what to do instead.
 *   - **409 `DELETE_RESTRICTED`** — the §7.3 subflow guard, on disable only.
 *     The message NAMES the packaged callers that would break mid-run. That
 *     list is the entire value of the refusal and only the server can build it.
 *   - **409** on clone — the name is taken. The message explains why same-name
 *     clones are refused (the engine keys flows by bare name) and suggests a
 *     free name.
 *
 * `actionErrorDetail` is the one place this repo reads an ADR-0112 error
 * envelope's message; a fallback string is used ONLY when the response carried
 * no message at all, never in place of one.
 *
 * ## How this page is reached
 *
 * Through the component-registry nav contribution — the same mechanism every
 * other framework-contributed Setup surface uses (`metadata:directory`,
 * `metadata:resource`, `developer:packages` in `services/builtinComponents`).
 * The Setup app's navigation names the ref `automation:packaged`, and
 * `ComponentNavView` resolves it at
 * `/apps/<app>/component/automation/packaged`. No bespoke route is added:
 * a route would be a second way in that the app metadata does not know about.
 */

import * as React from 'react';
import { Link } from 'react-router-dom';
import { Info, Loader2, Workflow } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyDescription,
  EmptyTitle,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
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

// The LEAF module, not `previews/useFlowNodePalette.js` which re-exports it:
// this page is imported eagerly by `services/builtinComponents`, so anything
// in its graph joins the console's eager closure — and that module's scope
// reaches the whole flow-designer canvas.
import { apiBase } from '../../utils/apiBase.js';
import {
  activationReading,
  envelopeData,
  envelopeRefused,
  joinPackagedFlows,
  readMetadataItems,
  readRuntimeStates,
  type FlowRuntimeStateRow,
  type PackagedFlowRow,
} from './packagedFlows.js';
import { PackagedActionsSection } from './PackagedActionsSection.js';
import { studioOrgScopePath } from '../studio-design/studioScope.js';
import { PageHeader } from '../../layout/PageHeader.js';

/* -------------------------------------------------------------------------- */
/* Fetch helpers                                                               */
/* -------------------------------------------------------------------------- */

const JSON_HEADERS = { Accept: 'application/json' } as const;

async function readJson(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

/**
 * The engine's runtime states. `payload.data.flows ?? payload.flows` is how
 * this repo already reads this exact endpoint (`StudioDesignSurface`); the two
 * shapes are the wrapped and bare forms of one response, not two dialects.
 */
async function fetchRuntimeStates(signal: AbortSignal): Promise<FlowRuntimeStateRow[]> {
  const res = await fetch(`${apiBase()}/automation/_status`, {
    credentials: 'include',
    headers: JSON_HEADERS,
    cache: 'no-store',
    signal,
  });
  if (!res.ok) throw new Error(`automation status HTTP ${res.status}`);
  return readRuntimeStates(await readJson(res));
}

/** The `flow` metadata list — bare array or `{ items }`, as this route answers. */
async function fetchFlowMetadata(signal: AbortSignal): Promise<unknown[]> {
  const res = await fetch(`${apiBase()}/meta/flow`, {
    credentials: 'include',
    headers: JSON_HEADERS,
    cache: 'no-store',
    signal,
  });
  if (!res.ok) throw new Error(`flow metadata HTTP ${res.status}`);
  return readMetadataItems(await readJson(res));
}

/* -------------------------------------------------------------------------- */
/* Clone dialog state                                                          */
/* -------------------------------------------------------------------------- */

interface CloneDraft {
  /** Machine name of the flow being copied. */
  source: string;
  /** New machine name — mandatory (ADR-0126 §7.1). */
  name: string;
  /** New display name — mandatory. */
  label: string;
  /** The server's refusal, verbatim. */
  refusal: string | null;
  busy: boolean;
}

/** What a successful clone left on the page (objectui#13270). */
interface CloneResult {
  /** Machine name the clone was created under. */
  name: string;
  /** The server's post-clone notice, verbatim. */
  notice: string;
  /** Machine name of the packaged flow the admin cloned from. */
  source: string;
  /** That flow's display label, as its row shows it. */
  sourceLabel: string;
  /** The switch-off offer's request is in flight. */
  switchBusy: boolean;
  /** The toggle's refusal of the switch-off, verbatim. */
  switchRefusal: string | null;
}

/** The toggle's answer: the flag the server reports, or its refusal verbatim. */
type ToggleOutcome = { ok: true; enabled: boolean } | { ok: false; message: string };

/* -------------------------------------------------------------------------- */
/* The reason disclosure                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The chip an unarmed flow row's `reason` opens from (objectui#12609).
 *
 * The sentence used to render as a paragraph under the flow's name, which grew
 * every row that carried one to several lines and stopped the table scanning
 * as a table. It now sits behind this chip, inline on the name's line, so a
 * row with a reason is as tall as a row without one.
 *
 * ⛔ The chip does NOT classify. Its label is the same generic word on every
 * row that carries a reason, and whether it renders follows only "the runtime
 * row sent a non-empty string `reason`" — never what the sentence says. The
 * contract's own words on the field are "Consumers RENDER it; ⛔ do not parse
 * it", and a deployment-policy row and a real binding failure arrive in the
 * same `enabled: true, bound: false` shape. The structured field beside
 * `reason` that could name which of the two a row is now rides the wire
 * (`unboundCause`, objectstack#23842); this page reads it for PRESENCE only —
 * the Activation badge's "not running" — and still names no cause.
 *
 * The disclosure shows the sentence verbatim and whole — not truncated, not
 * reworded, not restyled by what it says — muted, and not as an alert. A
 * popover rather than a tooltip: the sentence runs to several lines and can
 * name an operator switch the admin needs to copy, so it opens on click, tap
 * or keyboard and stays open to be read and selected.
 */
function ReasonDetails({ reason }: { reason: string }) {
  const { t } = useObjectTranslation();
  const label = t('packagedAutomation.reasonDetails', { defaultValue: 'Details' });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="packaged-flow-reason-chip"
          className="ml-2 inline-flex items-center gap-1 rounded-md border border-border px-1.5 align-middle text-xs font-normal leading-4 text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Info className="h-3 w-3 shrink-0" aria-hidden="true" />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" aria-label={label} className="w-96 max-w-[90vw]">
        <p
          data-testid="packaged-flow-reason"
          className="whitespace-normal break-words text-sm text-muted-foreground"
        >
          {reason}
        </p>
      </PopoverContent>
    </Popover>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export function PackagedAutomationPage() {
  const { t } = useObjectTranslation();

  const [rows, setRows] = React.useState<PackagedFlowRow[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);
  /**
   * Re-reads the flows half alone (objectui#13159): bumped after a toggle, so
   * the Activation badges show what the engine armed after the flip. Kept
   * apart from `nonce` so a flow toggle does not reload the actions section.
   */
  const [flowsNonce, setFlowsNonce] = React.useState(0);
  /** Machine name of the flow whose toggle is in flight. */
  const [busyFlow, setBusyFlow] = React.useState<string | null>(null);
  /** Per-flow server refusal, keyed by machine name. Verbatim. */
  const [refusals, setRefusals] = React.useState<Record<string, string>>({});
  const [clone, setClone] = React.useState<CloneDraft | null>(null);
  /** The server's post-clone notice, verbatim, the name it created and the source. */
  const [cloneResult, setCloneResult] = React.useState<CloneResult | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setLoadError(null);
    (async () => {
      try {
        const [runtime, meta] = await Promise.all([
          fetchRuntimeStates(controller.signal),
          fetchFlowMetadata(controller.signal),
        ]);
        if (cancelled) return;
        setRows(joinPackagedFlows(runtime, meta));
      } catch (e) {
        if (cancelled || controller.signal.aborted) return;
        setRows([]);
        setLoadError(
          e instanceof Error && e.message
            ? e.message
            : t('packagedAutomation.loadFailed', { defaultValue: 'Could not load packaged automation.' }),
        );
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [nonce, flowsNonce, t]);

  const clearRefusal = React.useCallback((name: string) => {
    setRefusals((prev) => {
      if (!(name in prev)) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }, []);

  /**
   * `POST …/toggle` — the ONE packaged-flow toggle, shared by the row's switch
   * and the clone result's switch-off offer (objectui#13270). Never throws: a
   * refusal comes back as the server's sentence, verbatim.
   */
  async function requestToggle(name: string, enabled: boolean): Promise<ToggleOutcome> {
    try {
      const res = await fetch(`${apiBase()}/automation/${encodeURIComponent(name)}/toggle`, {
        method: 'POST',
        credentials: 'include',
        headers: { ...JSON_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const json = await readJson(res);
      if (!res.ok || envelopeRefused(json)) {
        // VERBATIM. The posture gate (403) and the subflow guard (409) both
        // carry the whole of what the admin needs in this string — the second
        // one names the callers, which nothing on the client could reconstruct.
        return {
          ok: false,
          message: actionErrorDetail(
            json,
            // A SEPARATE key from the catch arm's below: this one has a status
            // to name and that one does not, and one key cannot carry a hole
            // only half its call sites can fill.
            t('packagedAutomation.toggleFailedHttp', {
              defaultValue: 'Could not change activation (HTTP {{status}}).',
              status: res.status,
            }),
          ),
        };
      }
      const reported = envelopeData(json).enabled;
      return { ok: true, enabled: typeof reported === 'boolean' ? reported : enabled };
    } catch (e) {
      return {
        ok: false,
        message:
          e instanceof Error && e.message
            ? e.message
            : t('packagedAutomation.toggleFailed', { defaultValue: 'Could not change activation.' }),
      };
    }
  }

  /** A toggle the server accepted: the row shows its answer, and the runtime is re-read. */
  function applyToggled(name: string, enabled: boolean) {
    setRows((prev) => prev?.map((r) => (r.name === name ? { ...r, enabled } : r)) ?? prev);
    // The answer carries the flag, not whether the engine armed the flow:
    // switching a schedule flow on under a deployment policy that keeps
    // scheduled work off leaves it unarmed, and enabling a subflow can arm
    // its callers. Read the runtime states again so no badge keeps a stale
    // "On" (objectui#13159).
    setFlowsNonce((n) => n + 1);
  }

  async function onToggle(row: PackagedFlowRow, enabled: boolean) {
    setBusyFlow(row.name);
    clearRefusal(row.name);
    setCloneResult(null);
    try {
      const outcome = await requestToggle(row.name, enabled);
      if (!outcome.ok) {
        setRefusals((prev) => ({ ...prev, [row.name]: outcome.message }));
        return;
      }
      applyToggled(row.name, outcome.enabled);
    } finally {
      setBusyFlow(null);
    }
  }

  /**
   * The clone result's offer (objectui#13270): switch the flow the admin
   * cloned from off, through the same toggle as its row. The result stays on
   * the page either way — on success it reads the source as off, on a refusal
   * it shows the server's sentence and keeps the offer.
   */
  async function onSwitchSourceOff(result: CloneResult) {
    const source = result.source;
    setBusyFlow(source);
    clearRefusal(source);
    setCloneResult((prev) => (prev ? { ...prev, switchBusy: true, switchRefusal: null } : prev));
    try {
      const outcome = await requestToggle(source, false);
      setCloneResult((prev) =>
        prev && prev.source === source
          ? { ...prev, switchBusy: false, switchRefusal: outcome.ok ? null : outcome.message }
          : prev,
      );
      if (outcome.ok) applyToggled(source, outcome.enabled);
    } finally {
      setBusyFlow(null);
    }
  }

  async function onCloneSubmit(draft: CloneDraft) {
    setClone({ ...draft, busy: true, refusal: null });
    try {
      const res = await fetch(`${apiBase()}/automation/${encodeURIComponent(draft.source)}/clone`, {
        method: 'POST',
        credentials: 'include',
        headers: { ...JSON_HEADERS, 'Content-Type': 'application/json' },
        // ⛔ EXACTLY the two keys the clone body declares. The carried-over
        // definition (nodes, triggers, connectors) is NOT offered as editable
        // form fields: a clone copies the whole definition and the copy is
        // edited in Studio afterwards, like any other flow.
        body: JSON.stringify({ name: draft.name.trim(), label: draft.label.trim() }),
      });
      const json = await readJson(res);
      if (!res.ok || envelopeRefused(json)) {
        setClone({
          ...draft,
          busy: false,
          refusal: actionErrorDetail(
            json,
            // Separate key from the catch arm's below, for the same reason as
            // the toggle pair: a status hole only one of the two can fill.
            t('packagedAutomation.cloneFailedHttp', {
              defaultValue: 'Could not clone this flow (HTTP {{status}}).',
              status: res.status,
            }),
          ),
        });
        return;
      }
      const data = envelopeData(json);
      const created = (data.flow as { name?: unknown } | undefined)?.name;
      const notice = data.notice;
      setClone(null);
      setCloneResult({
        name: typeof created === 'string' && created ? created : draft.name.trim(),
        notice: typeof notice === 'string' ? notice : '',
        source: draft.source,
        sourceLabel: rows?.find((r) => r.name === draft.source)?.label ?? draft.source,
        switchBusy: false,
        switchRefusal: null,
      });
      // The clone is a tenant artifact, so it does NOT join this packaged
      // list. Refetch anyway: the source flow's own state is re-read, and a
      // stale list is the one thing an operational page must not show.
      setNonce((n) => n + 1);
    } catch (e) {
      setClone({
        ...draft,
        busy: false,
        refusal:
          e instanceof Error && e.message
            ? e.message
            : t('packagedAutomation.cloneFailed', { defaultValue: 'Could not clone this flow.' }),
      });
    }
  }

  const title = t('packagedAutomation.title', { defaultValue: 'Packaged automation' });
  const cloneNameValid = !!clone && clone.name.trim() !== '' && clone.label.trim() !== '';
  /** The cloned-from row as the list shows it NOW, so the offer follows its switch. */
  const cloneSourceRow = cloneResult ? rows?.find((r) => r.name === cloneResult.source) : undefined;

  return (
    <div>
      {/* The console's one page header (objectui#12606), its Refresh as the
          header's icon button. */}
      <PageHeader
        title={title}
        subtitle={t('packagedAutomation.subtitle', {
          defaultValue:
            'Flows and actions shipped by installed packages. Turn one off for this deployment, or clone a flow under a new name to customize it. Editing happens in Studio.',
        })}
        icon={<Workflow className="h-4 w-4" />}
        refresh={{
          onRefresh: () => setNonce((n) => n + 1),
          label: t('packagedAutomation.refresh', { defaultValue: 'Refresh' }),
        }}
      />
    <div className="p-6 space-y-4">

      {/* Two sections, each named: the page carries flows AND actions since
          ADR-0126 §8 item 2, and an unlabelled first table beside a labelled
          second one reads as though the second were an afterthought. */}
      <h2 className="text-base font-semibold">
        {t('packagedAutomation.flowsHeading', { defaultValue: 'Packaged flows' })}
      </h2>

      {cloneResult && (
        <div role="status" className="rounded-md border border-border bg-muted/40 p-3 text-sm space-y-1">
          <p className="font-medium">
            {t('packagedAutomation.cloneCreated', {
              // `{{name}}`, not a JS template literal: the inline default must
              // be the SAME string the pack carries, so a provider-less render
              // and a translated one cannot drift apart.
              defaultValue: 'Created flow "{{name}}".',
              name: cloneResult.name,
            })}
          </p>
          {/* The server's own post-clone notice, verbatim. */}
          {cloneResult.notice && <p className="text-muted-foreground">{cloneResult.notice}</p>}
        </div>
      )}

      {/* The result's next steps (objectui#13270), outside the status region
          so the announcement stays the server's notice. The switch-off is
          offered only while the source row reads on; an off source reads as
          done, as the sharing-rule clone's does. */}
      {cloneResult && (
        <div className="flex flex-wrap items-center gap-2" data-testid="packaged-clone-next-steps">
          {cloneSourceRow?.enabled === false ? (
            <p className="text-sm text-muted-foreground" data-testid="packaged-clone-source-off">
              {t('packagedAutomation.cloneSourceOff', {
                defaultValue: 'The packaged flow "{{label}}" is switched off.',
                label: cloneResult.sourceLabel,
              })}
            </p>
          ) : cloneSourceRow ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={cloneResult.switchBusy}
              onClick={() => void onSwitchSourceOff(cloneResult)}
              data-testid="packaged-clone-switch-source-off"
            >
              {cloneResult.switchBusy && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />}
              {t('packagedAutomation.cloneSwitchSourceOff', {
                defaultValue: 'Switch "{{label}}" off',
                label: cloneResult.sourceLabel,
              })}
            </Button>
          ) : null}
          <Button asChild variant="ghost" size="sm">
            <Link
              to={studioOrgScopePath({ type: 'flow', name: cloneResult.name })}
              data-testid="packaged-clone-open"
            >
              {t('packagedAutomation.cloneOpen', { defaultValue: 'Open the clone in Studio' })}
            </Link>
          </Button>
          {cloneResult.switchRefusal && (
            // VERBATIM, beside the offer that caused it; the offer stays.
            <p role="alert" className="basis-full text-sm text-destructive">
              {cloneResult.switchRefusal}
            </p>
          )}
        </div>
      )}

      {loadError && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {loadError}
        </div>
      )}

      {rows === null && (
        <div className="space-y-2" data-testid="packaged-automation-loading">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}

      {rows !== null && rows.length === 0 && !loadError && (
        <Empty>
          <EmptyTitle>
            {t('packagedAutomation.emptyTitle', { defaultValue: 'No packaged flows' })}
          </EmptyTitle>
          <EmptyDescription>
            {t('packagedAutomation.emptyBody', {
              defaultValue:
                'No installed package ships an automation flow on this deployment. Flows you author yourself live in Studio.',
            })}
          </EmptyDescription>
        </Empty>
      )}

      {rows !== null && rows.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('packagedAutomation.colFlow', { defaultValue: 'Flow' })}</TableHead>
              <TableHead className="w-[220px]">
                {t('packagedAutomation.colActivation', { defaultValue: 'Activation' })}
              </TableHead>
              <TableHead className="w-[140px] text-right">
                {t('packagedAutomation.colActions', { defaultValue: 'Actions' })}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const refusal = refusals[row.name];
              const reading = activationReading(row);
              return (
                <TableRow key={row.name} data-testid={`packaged-flow-${row.name}`}>
                  <TableCell className="align-top">
                    <div className="font-medium">
                      {row.label}
                      {/* The PLATFORM's sentence for why the engine has not
                          armed this flow (objectui#9217), behind a chip on the
                          name's own line so the row keeps its height
                          (objectui#12609). Present only when a reason was
                          sent; the chip reads the same whatever it says. */}
                      {row.reason && <ReasonDetails reason={row.reason} />}
                    </div>
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
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={row.enabled}
                        disabled={busyFlow === row.name}
                        onCheckedChange={(next: boolean) => void onToggle(row, next)}
                        aria-label={t('packagedAutomation.toggleLabel', {
                          defaultValue: 'Activation for {{label}}',
                          label: row.label,
                        })}
                      />
                      {/* Whether the flow RUNS, beside the switch that holds
                          its flag (objectui#13159). "Not running here" is
                          outlined, not destructive: a deployment policy is not
                          a defect, and the Details chip carries the platform's
                          sentence for why. */}
                      <Badge
                        data-testid="packaged-flow-activation"
                        data-reading={reading}
                        variant={reading === 'on' ? 'default' : reading === 'not-running' ? 'outline' : 'secondary'}
                      >
                        {reading === 'on'
                          ? t('packagedAutomation.on', { defaultValue: 'On' })
                          : reading === 'not-running'
                            ? t('packagedAutomation.notRunning', { defaultValue: 'Not running here' })
                            : t('packagedAutomation.off', { defaultValue: 'Off' })}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="align-top text-right">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        // Opens on a submittable default, both fields editable
                        // (objectui#13344). `<source>_copy` stays inside the
                        // `^[a-z_][a-z0-9_]*$` shape `FlowSchema.name` requires,
                        // since the source name already is, and it is the name
                        // the server's own taken-name refusal suggests. The
                        // server stays the judge: a taken name still answers
                        // `onCloneSubmit`'s 409, verbatim. `row.label` is the
                        // machine name when the flow declares no label.
                        setClone({
                          source: row.name,
                          name: `${row.name}_copy`,
                          label: t('packagedAutomation.cloneCopyLabel', {
                            defaultValue: '{{label}} (copy)',
                            label: row.label,
                          }),
                          refusal: null,
                          busy: false,
                        })
                      }
                    >
                      {t('packagedAutomation.clone', { defaultValue: 'Clone' })}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {/* The packaged-ACTIONS half (ADR-0126 §8 item 2). It reads and writes
          through its own doors and keeps its own state, so the flows half above
          is untouched by it; the page's one Refresh control drives both, which
          is why the nonce is handed down rather than duplicated. */}
      <PackagedActionsSection nonce={nonce} />

      <Dialog open={!!clone} onOpenChange={(open: boolean) => !open && setClone(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('packagedAutomation.cloneTitle', { defaultValue: 'Clone packaged flow' })}
            </DialogTitle>
            <DialogDescription>
              {t('packagedAutomation.cloneBody', {
                defaultValue:
                  'The copy carries the whole definition and takes a new machine name and label. Edit the copy in Studio.',
              })}
            </DialogDescription>
          </DialogHeader>

          {clone && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="packaged-clone-name">
                  {t('packagedAutomation.cloneName', { defaultValue: 'New machine name' })}
                </Label>
                <Input
                  id="packaged-clone-name"
                  value={clone.name}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setClone({ ...clone, name: e.target.value, refusal: null })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="packaged-clone-label">
                  {t('packagedAutomation.cloneLabel', { defaultValue: 'New label' })}
                </Label>
                <Input
                  id="packaged-clone-label"
                  value={clone.label}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setClone({ ...clone, label: e.target.value, refusal: null })
                  }
                />
              </div>
              {clone.refusal && (
                <p role="alert" className="text-sm text-destructive">
                  {clone.refusal}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setClone(null)}>
              {t('packagedAutomation.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              type="button"
              disabled={!cloneNameValid || !!clone?.busy}
              onClick={() => clone && void onCloneSubmit(clone)}
            >
              {t('packagedAutomation.cloneConfirm', { defaultValue: 'Create clone' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </div>
  );
}

export default PackagedAutomationPage;
