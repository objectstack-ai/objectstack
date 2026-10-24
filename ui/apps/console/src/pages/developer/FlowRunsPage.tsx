/**
 * Flow Runs — pick a flow, trigger a test run with sample inputs, and
 * inspect recent run history.
 *
 * Console is not project-scoped: there is no useScopedClient and no projectId
 * param. The client comes from `useAdapter().getClient()` (which exposes
 * `.automation` and `.meta`). Run output renders as a plain `<pre>` block.
 *
 * A *screen* flow pauses instead of completing: the trigger returns
 * `{ status: 'paused', runId, screen }`. This page used to dump that envelope
 * as JSON and stop — the run stayed suspended forever with no way to finish it
 * from the UI, and every test run of a screen flow orphaned a `paused` row in
 * the history (framework#3528). It now hands the pause to the SAME
 * {@link FlowRunner} the record/list surfaces use, so a screen flow can be
 * driven to completion (multi-step wizards and `object-form` steps included)
 * from here too.
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useDisplayLocale } from '@object-ui/i18n';
import { ConsolePageHeader, useAdapter, useMetadata, FlowRunner, type ScreenFlowState } from '@object-ui/app-shell';
import { createAuthenticatedFetch } from '@object-ui/auth';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Badge,
  Input,
  Label,
  Textarea,
  Switch,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@object-ui/components';
import {
  Play, Loader2, CheckCircle2, XCircle, Clock, AlertCircle, RefreshCw, Workflow,
} from 'lucide-react';

interface FlowVariable {
  name: string;
  type: string;
  isInput?: boolean;
  isOutput?: boolean;
}

interface FlowItem {
  name: string;
  label?: string;
  spec?: any;
}

interface RunSummary {
  id: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  flowVersion?: number;
  trigger?: { type?: string };
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { icon: any; cls: string }> = {
    success:   { icon: CheckCircle2, cls: 'text-emerald-600 border-emerald-300' },
    completed: { icon: CheckCircle2, cls: 'text-emerald-600 border-emerald-300' },
    failed:    { icon: XCircle,      cls: 'text-red-600 border-red-300' },
    error:     { icon: XCircle,      cls: 'text-red-600 border-red-300' },
    running:   { icon: Loader2,      cls: 'text-blue-600 border-blue-300 animate-pulse' },
    pending:   { icon: Clock,        cls: 'text-amber-600 border-amber-300' },
    // A screen/approval node suspended the run — it is waiting for input, not
    // stalled (ADR-0019 durable pause).
    paused:    { icon: Clock,        cls: 'text-amber-600 border-amber-300' },
    skipped:   { icon: AlertCircle,  cls: 'text-muted-foreground' },
  };
  const cfg = map[status] ?? { icon: AlertCircle, cls: 'text-muted-foreground' };
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={`text-[10px] font-mono inline-flex items-center gap-1 ${cfg.cls}`}>
      <Icon className="h-3 w-3" />
      {status}
    </Badge>
  );
}

/** In the session's display locale — it used no tag, the MACHINE's locale (objectui#9909). */
function fmtDate(s: string | undefined, locale: string) {
  if (!s) return '—';
  try { return new Date(s).toLocaleString(locale); } catch { return s; }
}

function coerce(value: string, type: string): unknown {
  switch (type) {
    case 'number': {
      if (value === '') return undefined;
      const n = Number(value);
      return Number.isNaN(n) ? value : n;
    }
    case 'boolean':
      return value === 'true';
    case 'object':
    case 'list':
    case 'array':
      if (value.trim() === '') return undefined;
      try { return JSON.parse(value); } catch { return value; }
    default:
      return value;
  }
}

function JsonBlock({ data }: { data: unknown }) {
  return (
    <pre className="rounded border bg-muted/30 p-2 text-xs font-mono overflow-auto whitespace-pre-wrap break-all max-h-96">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

/** The item a value none of the picker's options carries is shown by. */
const OUTSIDE_OPTIONS = 'outside';

/**
 * objectui#11865 — the flow picker, drawn with the shared `Select` the rest of
 * the console picks with. It used to be a browser-native `<select>`. What a
 * pick writes is unchanged: `onPick` receives the picked flow's `name`, the
 * string the native control's `change` carried. Re-picking the current flow
 * writes nothing, as it did there.
 *
 * - Items carry their option's INDEX, not the flow's name, as the card's other
 *   pickers do; an index cannot collide with a name.
 * - A value none of the options carries gets an item of its own, labelled with
 *   the value: a flow picked before a Refresh that no longer lists it. The
 *   trigger then shows the flow the page still holds (no runner is shown for
 *   it). The native control showed the first flow there. Picking that item
 *   writes nothing.
 * - Like the native control, the trigger has no label: none is associated
 *   with it today, and this swap keeps the name it had.
 * - The page has no read-only state.
 */
function FlowPicker({
  value,
  options,
  onPick,
}: {
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onPick: (value: string) => void;
}) {
  const at = options.findIndex((o) => o.value === value);
  return (
    <Select
      value={at !== -1 ? String(at) : OUTSIDE_OPTIONS}
      onValueChange={(token) => {
        // `undefined` for the outside item: it is the page's own value, so there is nothing to write.
        const picked = options[Number(token)];
        if (picked) onPick(picked.value);
      }}
    >
      <SelectTrigger className="h-9 max-w-md">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {at === -1 && <SelectItem value={OUTSIDE_OPTIONS}>{value}</SelectItem>}
        {options.map((o, i) => (
          <SelectItem key={`${i}:${o.value}`} value={String(i)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function FlowRunsPage() {
  const adapter = useAdapter();
  const client: any = adapter?.getClient?.();

  const [flows, setFlows] = useState<FlowItem[]>([]);
  const [flowsLoading, setFlowsLoading] = useState(true);
  const [flowsError, setFlowsError] = useState<string | null>(null);
  const [selectedFlowName, setSelectedFlowName] = useState<string>('');
  const [refreshRuns, setRefreshRuns] = useState(0);

  const loadFlows = useCallback(async () => {
    if (!client?.meta?.getItems) {
      setFlowsError('meta.getItems is not available on this client');
      setFlowsLoading(false);
      return;
    }
    setFlowsLoading(true);
    setFlowsError(null);
    try {
      const result: any = await client.meta.getItems('flow');
      // `meta.getItems` answers `{ type, items: [...] }`, or a bare array on
      // the ADR-0037 preview path. The trailing `value` arm is gone on a
      // measured zero at this seam (objectui#6917).
      const items: any[] = Array.isArray(result)
        ? result
        : Array.isArray(result?.items)
          ? result.items
          : [];
      // The served list is flattened: each item IS the flow definition, its
      // `name` and `label` on the item itself, so the picker names a labelled
      // flow `label (name)` (objectui#12783). No server wraps an item in a
      // `spec` member, so none is read (objectui#12829).
      const normalized: FlowItem[] = items.map(it => ({
        name: it?.name,
        label: it?.label,
        spec: it,
      })).filter(f => f.name);
      setFlows(normalized);
      if (!selectedFlowName && normalized.length > 0) {
        setSelectedFlowName(normalized[0].name);
      }
    } catch (e: any) {
      setFlowsError(e?.message ?? String(e));
    } finally {
      setFlowsLoading(false);
    }
  }, [client, selectedFlowName]);

  useEffect(() => { loadFlows(); }, [loadFlows]);

  const selectedFlow = useMemo(
    () => flows.find(f => f.name === selectedFlowName) ?? null,
    [flows, selectedFlowName],
  );

  return (
    <div>
    {/* The console's one page header (objectui#12553), the one an object list,
        a dashboard and the Approvals Inbox draw: icon chip, title, and the
        subtitle beside the title from `sm` up, in one row across the page
        above the padded body. Below `sm` the header hides the subtitle. */}
    <ConsolePageHeader
      title="Flow Runs"
      subtitle="Pick a flow, trigger a test run with sample inputs, and inspect recent run history"
      icon={<Workflow className="h-4 w-4" />}
    />
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Flow</CardTitle>
              <CardDescription>Select a flow definition to test</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={loadFlows} disabled={flowsLoading}>
              <RefreshCw className={`h-3.5 w-3.5 mr-2 ${flowsLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {flowsLoading && <Skeleton className="h-9 w-72" />}
          {flowsError && (
            <p className="text-sm text-red-500 font-mono break-all">{flowsError}</p>
          )}
          {!flowsLoading && !flowsError && flows.length === 0 && (
            <p className="text-sm text-muted-foreground">No flow definitions found.</p>
          )}
          {!flowsLoading && !flowsError && flows.length > 0 && (
            <FlowPicker
              value={selectedFlowName}
              options={flows.map(f => ({
                value: f.name,
                label: f.label ? `${f.label} (${f.name})` : f.name,
              }))}
              onPick={setSelectedFlowName}
            />
          )}
        </CardContent>
      </Card>

      {selectedFlow && (
        <div className="grid gap-4 lg:grid-cols-2">
          <FlowTestRunner
            client={client}
            flow={selectedFlow.spec}
            onExecuted={() => setRefreshRuns(v => v + 1)}
          />
          <FlowRunsPanel
            client={client}
            flowName={selectedFlow.name}
            refreshKey={refreshRuns}
          />
        </div>
      )}
    </div>
    </div>
  );
}

function FlowTestRunner({
  client,
  flow,
  onExecuted,
}: {
  client: any;
  flow: any;
  onExecuted?: () => void;
}) {
  const inputVars = useMemo<FlowVariable[]>(
    () => (flow?.variables ?? []).filter((v: FlowVariable) => v?.isInput),
    [flow],
  );

  const adapter = useAdapter();
  const { objects } = useMetadata();
  const authFetch = useMemo(() => createAuthenticatedFetch(), []);

  const [values, setValues] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  // The paused screen a test run stopped at — driven to completion by
  // <FlowRunner>, exactly as a `type: 'flow'` action would.
  const [screenFlow, setScreenFlow] = useState<ScreenFlowState | null>(null);

  useEffect(() => {
    setValues({});
    setResult(null);
    setError(null);
    setScreenFlow(null);
  }, [flow?.name]);

  const setVal = (k: string, v: string) => setValues(s => ({ ...s, [k]: v }));

  const handleRun = async () => {
    if (!client?.automation?.execute) {
      setError('automation.execute is not available on this client');
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    setScreenFlow(null);
    try {
      const params: Record<string, unknown> = {};
      for (const v of inputVars) {
        const raw = values[v.name];
        if (raw === undefined) continue;
        params[v.name] = coerce(raw, v.type);
      }
      const res = await client.automation.execute(flow.name, { params });
      setResult(res);
      // Screen flow: the run is suspended at a `screen` node. Open the runner
      // so the tester can fill it in and the run can actually finish. `res` is
      // the trigger door's `AutomationResult`, so it carries the flow's served
      // `flowLabel` the runner names the flow by (objectui#11092).
      if (res?.status === 'paused' && res?.screen && res?.runId) {
        setScreenFlow({ flowName: flow.name, flowLabel: res.flowLabel, runId: res.runId, screen: res.screen });
      }
      onExecuted?.();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Test Run</CardTitle>
        <CardDescription>Provide input values and invoke the flow</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {inputVars.length === 0 && (
          <p className="text-sm text-muted-foreground">
            This flow declares no input variables. Click Run to invoke with no parameters.
          </p>
        )}
        {inputVars.map(v => (
          <div key={v.name} className="grid gap-1.5">
            <Label htmlFor={`var-${v.name}`} className="flex items-center gap-2">
              <span className="font-mono text-xs">{v.name}</span>
              <Badge variant="outline" className="text-[10px] font-mono">{v.type}</Badge>
            </Label>
            {v.type === 'boolean' ? (
              <div className="flex items-center gap-2">
                <Switch
                  id={`var-${v.name}`}
                  checked={values[v.name] === 'true'}
                  onCheckedChange={(c: boolean) => setVal(v.name, c ? 'true' : 'false')}
                />
                <span className="text-xs text-muted-foreground">{values[v.name] === 'true' ? 'true' : 'false'}</span>
              </div>
            ) : v.type === 'object' || v.type === 'list' || v.type === 'array' ? (
              <Textarea
                id={`var-${v.name}`}
                placeholder={`JSON ${v.type}`}
                value={values[v.name] ?? ''}
                onChange={(e) => setVal(v.name, e.target.value)}
                className="font-mono text-xs min-h-[80px]"
              />
            ) : (
              <Input
                id={`var-${v.name}`}
                type={v.type === 'number' ? 'number' : 'text'}
                value={values[v.name] ?? ''}
                onChange={(e) => setVal(v.name, e.target.value)}
              />
            )}
          </div>
        ))}
        <div className="pt-1">
          <Button onClick={handleRun} disabled={running} size="sm">
            {running ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-2" />}
            {running ? 'Running…' : 'Run Flow'}
          </Button>
        </div>

        {(result || error) && (
          <div className="pt-2 border-t mt-2 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              {error || result?.success === false ? (
                <><XCircle className="h-4 w-4 text-red-500" /> Failed</>
              ) : result?.status === 'paused' ? (
                <><Clock className="h-4 w-4 text-amber-500" /> Waiting for input</>
              ) : (
                <><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Result</>
              )}
              {typeof result?.durationMs === 'number' && (
                <Badge variant="secondary" className="text-[10px] font-mono">
                  {result.durationMs} ms
                </Badge>
              )}
            </div>
            {error && <p className="text-sm text-red-500 font-mono break-all">{error}</p>}
            {/* A run left paused (the runner was dismissed) can be reopened —
                the suspension is durable, so the screen is still waiting. */}
            {result?.status === 'paused' && result?.screen && result?.runId && !screenFlow && (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm text-muted-foreground">
                  This run is paused at screen <span className="font-mono">{result.screen.nodeId}</span>.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setScreenFlow({
                      flowName: flow.name,
                      flowLabel: result.flowLabel,
                      runId: result.runId,
                      screen: result.screen,
                    })
                  }
                >
                  Continue run
                </Button>
              </div>
            )}
            {result && <JsonBlock data={result} />}
          </div>
        )}
      </CardContent>

      {/* The shared screen-flow runner — renders the paused screen and POSTs
          the collected values to the run's resume endpoint. */}
      <FlowRunner
        state={screenFlow}
        authFetch={authFetch}
        baseUrl={import.meta.env.VITE_SERVER_URL || ''}
        dataSource={adapter}
        objects={objects}
        onClose={() => { setScreenFlow(null); onExecuted?.(); }}
        onComplete={() => { setScreenFlow(null); onExecuted?.(); }}
      />
    </Card>
  );
}

function FlowRunsPanel({
  client,
  flowName,
  refreshKey,
}: {
  client: any;
  flowName: string;
  refreshKey?: number;
}) {
  const displayLocale = useDisplayLocale();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    if (!client?.automation?.listRuns) {
      setError('automation.listRuns is not available on this client');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res: any = await client.automation.listRuns(flowName, { limit: 20 });
      const items: RunSummary[] = Array.isArray(res) ? res : (res?.items ?? res?.runs ?? []);
      setRuns(items);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [client, flowName]);

  useEffect(() => { loadRuns(); }, [loadRuns, refreshKey]);

  const openRun = async (runId: string) => {
    setOpenRunId(runId);
    setRunDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const res: any = await client.automation.getRun(flowName, runId);
      setRunDetail(res?.run ?? res);
    } catch (e: any) {
      setDetailError(e?.message ?? String(e));
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Recent Runs</CardTitle>
              <CardDescription className="font-mono text-xs">{flowName}</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={loadRuns} disabled={loading}>
              {loading ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-2" />}
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading && (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          )}
          {!loading && error && (
            <p className="text-sm text-red-500 font-mono break-all">{error}</p>
          )}
          {!loading && !error && runs.length === 0 && (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No runs yet. Use the Test Run panel to invoke this flow.
            </p>
          )}
          {!loading && !error && runs.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Run</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map(r => (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer"
                    onClick={() => openRun(r.id)}
                  >
                    <TableCell className="font-mono text-xs">{r.id.slice(0, 12)}…</TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(r.startedAt, displayLocale)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {typeof r.durationMs === 'number' ? `${r.durationMs} ms` : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Sheet open={!!openRunId} onOpenChange={(o: boolean) => { if (!o) { setOpenRunId(null); setRunDetail(null); } }}>
        <SheetContent side="right" className="w-full sm:max-w-2xl p-0 flex flex-col">
          <SheetHeader className="p-4 border-b">
            <SheetTitle className="font-mono text-sm break-all">Run {openRunId}</SheetTitle>
            <SheetDescription>
              {runDetail && (
                <span className="inline-flex items-center gap-2">
                  <StatusBadge status={runDetail.status} />
                  {typeof runDetail.durationMs === 'number' && (
                    <Badge variant="secondary" className="text-[10px] font-mono">{runDetail.durationMs} ms</Badge>
                  )}
                  <span className="text-xs">{fmtDate(runDetail.startedAt, displayLocale)}</span>
                </span>
              )}
            </SheetDescription>
          </SheetHeader>
          <ScrollArea className="flex-1 p-4">
            {detailLoading && (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            )}
            {detailError && (
              <p className="text-sm text-red-500 font-mono break-all">{detailError}</p>
            )}
            {!detailLoading && runDetail && (
              <div className="space-y-3">
                {Array.isArray(runDetail.steps) && runDetail.steps.length > 0 ? (
                  runDetail.steps.map((step: any, idx: number) => (
                    <div key={`${step.nodeId}-${idx}`} className="rounded-md border p-3 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-muted-foreground font-mono text-xs">#{idx + 1}</span>
                        <span className="font-mono text-sm font-medium">{step.nodeLabel || step.nodeId}</span>
                        {step.nodeType && (
                          <Badge variant="outline" className="text-[10px] font-mono">{step.nodeType}</Badge>
                        )}
                        <StatusBadge status={step.status} />
                        {typeof step.durationMs === 'number' && (
                          <Badge variant="secondary" className="text-[10px] font-mono ml-auto">
                            {step.durationMs} ms
                          </Badge>
                        )}
                      </div>
                      {step.input !== undefined && (
                        <div>
                          <div className="text-[10px] uppercase text-muted-foreground mb-1">Input</div>
                          <JsonBlock data={step.input} />
                        </div>
                      )}
                      {step.output !== undefined && (
                        <div>
                          <div className="text-[10px] uppercase text-muted-foreground mb-1">Output</div>
                          <JsonBlock data={step.output} />
                        </div>
                      )}
                      {step.error && (
                        <div>
                          <div className="text-[10px] uppercase text-red-500 mb-1">Error</div>
                          <JsonBlock data={step.error} />
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground mb-1">Run</div>
                    <JsonBlock data={runDetail} />
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </>
  );
}
