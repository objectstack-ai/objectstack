// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { definePage } from '@objectstack/spec/ui';

/**
 * Renewals Pipeline — a `kind:'react'` business scenario (ADR-0081).
 *
 * A renewals manager works a list of accounts by lifecycle stage; selecting one
 * drives a 360° panel (account summary + invoices + a value-by-status chart) and
 * a pre-styled `<ObjectForm formType="drawer">` to update the account in place.
 * Every block prop is taken straight from the react-tier contract
 * (skills/objectstack-ui/references/react-blocks.md).
 *
 * The 360 panel deliberately shows BOTH rollup styles side by side:
 *   • hand-rolled — a `useAdapter()` effect counts related projects/invoices
 *     into a KPI strip (full control, you own loading/refresh, and you own the
 *     adapter's `$`-prefixed option contract and its `QueryResult` shape — see
 *     the numbered note on the effect), vs
 *   • framework blocks — `<ObjectChart>`/`<ListView>` do the same cross-object
 *     reads declaratively (zero data code).
 * (This comparison absorbed the former Account Cockpit page.)
 *
 * The chart is written in the spec `ChartConfig` shape (#3729) and its axes are
 * bound explicitly (#3701) to show the object-bound result-column rule: an
 * inline `aggregate` returns rows keyed by the RAW FIELD NAMES — `status` (its
 * `groupBy`) and `total` (its `field`) — not by a dataset-style measure name.
 * `os validate` checks both halves.
 *
 * The selected account is bound BY REACT STATE, not by a record context: `sel`
 * is the parent id, so the invoice list is an ordinary `<ListView>` filtered on
 * the child's lookup (`['account', '=', sel]`) and the summary is an
 * `<ObjectForm mode="view">`. Both read their binding from their own props,
 * which is what makes them work on this tier.
 *
 * This panel used to be `<RecordHighlights>` + `<RecordRelatedList>`, and both
 * rendered EMPTY here (#4413): every `record:*` block takes its record from the
 * context a record page mounts, and a react page mounts none — the
 * `objectName`/`recordId` the contract published for them were read by no
 * renderer. They are out of the react tier now, and `os validate` rejects them
 * on this surface rather than letting the next author rediscover it at runtime.
 * (#4340's finding still holds where it applies: on a RECORD page
 * `<RecordRelatedList objectName>` is the CHILD object, never the parent.)
 *
 * Styling (ADR-0065): no Tailwind — inline `style={{}}` with `hsl(var(--token))`;
 * data blocks and the drawer bring their own compiled styling. The drawer sets
 * NO pixel width: per #2578 pixel widths are deprecated (the author can't know
 * the client viewport) — omit and let the renderer derive the size.
 */
export const RenewalsPipelinePage = definePage({
  name: 'showcase_renewals_pipeline',
  label: 'Renewals Pipeline (React)',
  type: 'home',
  kind: 'react',
  source: `
function Page() {
  const adapter = useAdapter();
  const [sel, setSel] = React.useState(null);
  const [editing, setEditing] = React.useState(false);
  const [reload, setReload] = React.useState(0);
  const [stage, setStage] = React.useState('active');
  const [related, setRelated] = React.useState({ projects: 0, invoices: 0, openInvoices: 0, capped: false });

  // Hand-rolled rollup: the imperative counterpart of the framework blocks
  // below. You own the queries, loading, and refresh (reload bumps re-run it) --
  // and, because you own them, you own the two adapter contracts the blocks hide:
  //
  //  1. QUERY OPTIONS ARE $-PREFIXED. QueryParams declares $select, $filter,
  //     $orderby, $skip, $top, $expand, $search, $count, and the adapter copies
  //     ONLY those. A bare 'top:' / 'limit:' reaches no branch and is dropped
  //     with no error, so the cap you wrote is never applied -- and the list
  //     route has no default page size, so the query comes back carrying EVERY
  //     matching row.
  //  2. THE RESULT IS A QueryResult, NOT THE REST ENVELOPE. Rows arrive under
  //     'data' (never 'records'), beside 'total' -- which, whenever $top was
  //     applied, is the server's real count over the same $filter rather than
  //     the page length. Counting data.length under a cap is how a KPI starts
  //     under-reporting in silence; count 'total' and the cap stays a fetch
  //     bound instead of a lie about the business.
  React.useEffect(() => {
    let alive = true;
    (async () => {
      if (!adapter || !sel) { setRelated({ projects: 0, invoices: 0, openInvoices: 0, capped: false }); return; }
      const pr = await adapter.find('showcase_project', { $filter: ['account', '=', sel], $top: 500 });
      const iv = await adapter.find('showcase_invoice', { $filter: ['account', '=', sel], $top: 500 });
      const rows = (res) => (Array.isArray(res) ? res : (res && res.data) || []);
      const count = (res, list) => (typeof (res && res.total) === 'number' ? res.total : list.length);
      const projects = rows(pr);
      const invoices = rows(iv);
      // Open AR is a per-row verdict, so it can only be read off the rows we
      // actually fetched -- the one number here the cap genuinely bounds. The
      // 'capped' flag says so on screen instead of letting it pass for a total.
      if (alive) setRelated({
        projects: count(pr, projects),
        invoices: count(iv, invoices),
        openInvoices: invoices.filter((r) => r.status !== 'paid' && r.status !== 'void').length,
        capped: invoices.length < count(iv, invoices),
      });
    })();
    return () => { alive = false; };
  }, [adapter, sel, reload]);

  const Stat = ({ label, value, accent }) => (
    <div style={{ background: 'hsl(var(--muted))', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', padding: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'hsl(var(--muted-foreground))' }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 24, fontWeight: 700, color: accent || 'hsl(var(--foreground))' }}>{value}</div>
    </div>
  );

  const STAGES = [
    { id: 'active', label: 'Active' },
    { id: 'at_risk', label: 'At risk' },
    { id: 'churned', label: 'Churned' },
  ];
  const stageBtn = (active) => ({
    borderRadius: 'var(--radius)', padding: '6px 12px', fontSize: 14, cursor: 'pointer',
    border: '1px solid ' + (active ? 'hsl(var(--primary))' : 'hsl(var(--border))'),
    background: active ? 'hsl(var(--primary) / 0.1)' : 'transparent',
    color: 'hsl(var(--foreground))', fontWeight: active ? 600 : 400,
  });

  return (
    <div style={{ display: 'flex', height: '100%', gap: 16, padding: 16 }}>
      <div style={{ display: 'flex', width: '50%', flexDirection: 'column', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: 'hsl(var(--foreground))' }}>Renewals Pipeline</h1>
          <p style={{ marginTop: 2, fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>Work the renewal book by lifecycle stage.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {STAGES.map((s) => (
            <button key={s.id} onClick={() => { setStage(s.id); setSel(null); }} style={stageBtn(stage === s.id)}>{s.label}</button>
          ))}
        </div>
        <ListView
          objectName="showcase_account"
          viewType="grid"
          filters={['status', '=', stage]}
          columns={['name', 'status']}
          searchableFields={['name']}
          navigation={{ mode: 'none' }}
          onRowClick={(record) => { setSel(record.id); setEditing(false); }}
        />
      </div>

      <div style={{ display: 'flex', width: '50%', flexDirection: 'column', gap: 16, overflow: 'auto' }}>
        {!sel ? (
          <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius)', border: '1px dashed hsl(var(--border))', fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>
            Select an account to see its renewal picture.
          </div>
        ) : (
          <React.Fragment>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'hsl(var(--foreground))' }}>Account 360</h2>
              <button onClick={() => setEditing(true)} style={{ borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))', background: 'transparent', color: 'hsl(var(--foreground))', padding: '6px 12px', fontSize: 14, cursor: 'pointer' }}>Edit account</button>
            </div>

            <ObjectForm objectName="showcase_account" mode="view" recordId={sel} fields={['name', 'status']} />

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              <Stat label="Projects" value={related.projects} />
              <Stat label="Invoices" value={related.invoices} />
              <Stat label="Open AR" value={related.capped ? related.openInvoices + '+' : related.openInvoices} accent="hsl(38 92% 50%)" />
            </div>

            <ObjectChart objectName="showcase_invoice" type="bar" aggregate={{ field: 'total', function: 'sum', groupBy: 'status' }} xAxis={{ field: 'status' }} yAxis={[{ field: 'total', format: '$0,0' }]} series={[{ name: 'total', label: 'Invoice value' }]} title="Invoice value by status" showLegend={true} />

            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'hsl(var(--foreground))' }}>Invoices</h3>
            <ListView objectName="showcase_invoice" filters={['account', '=', sel]} columns={['name', 'status', 'total']} navigation={{ mode: 'none' }} />

            {editing ? (
              <ObjectForm objectName="showcase_account" mode="edit" recordId={sel}
                formType="drawer" drawerSide="right" open title="Edit account"
                onOpenChange={(o) => { if (!o) setEditing(false); }}
                onSuccess={() => { setEditing(false); setReload((n) => n + 1); }}
                onCancel={() => setEditing(false)} />
            ) : null}
          </React.Fragment>
        )}
      </div>
    </div>
  );
}`,
});
