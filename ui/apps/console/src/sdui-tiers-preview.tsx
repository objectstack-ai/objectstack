/* Browser preview for the two AI-authoring tiers, each rendered through the
 * REAL PageRenderer (not a private harness):
 *   - kind:'html'  — constrained JSX with the full native HTML tag set (h1/p/
 *     a/ul/li/img/strong/blockquote) plus the blocks' own structured props
 *     (<flex direction gap>), parsed, never executed.
 *   - kind:'react' — real React (useState/map/onClick) + an injected data block,
 *     executed by @object-ui/react-runtime. Gated by CAP_REACT_PAGES, enabled
 *     here to exercise the trusted tier.
 *
 * STYLING — the two page sources below carry NO Tailwind classes, and must not
 * acquire any. A page's `source` is runtime metadata: the console's Tailwind is
 * compiled at build time by scanning the console's own `src` (`@source
 * '../src/**'` in index.css) with no safelist, so a utility class authored in
 * real page metadata produces no CSS and no error anywhere. (ADR-0065; ADR-0080's
 * 2026-06-30 amendment; `content/docs/guide/react-pages.md` §Styling; `os
 * validate` reports it as `page-source-className-tailwind`.) This file makes an
 * explicit authoring claim, so its sources style the way authors are told to:
 * the html tier with the blocks' structured props plus a JSON `style` object,
 * the react tier with inline `style` objects — colours from the theme as
 * `hsl(var(--token))`, so both tiers follow light/dark and whatever theme the
 * deployment installs. `__tests__/sdui-preview-page-source-styling.test.ts`
 * holds this file to zero authored classNames. */
import './index.css';
import '@object-ui/components';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { SchemaRenderer } from '@object-ui/react';
import { enableCapability, CAP_REACT_PAGES } from '@object-ui/core';

// Trusted tier on (a host would do this; never authored metadata).
enableCapability(CAP_REACT_PAGES);

// Layout comes from <flex>'s structured props (the renderer emits the classes
// from its OWN source, which the build does scan); everything else is a JSON
// `style` object — quoted keys and quoted values, because the html tier
// materializes a braced attribute with JSON.parse and keeps anything else as a
// deferred expression.
const htmlSource = `
<section style={{"maxWidth":"48rem","margin":"0 auto","padding":"var(--space-10)","color":"hsl(var(--foreground))"}}>
  <flex direction="col" align="stretch" gap={6}>
    <flex direction="col" align="stretch" gap={3}>
      <h1 style={{"fontSize":"2.25rem","fontWeight":"700","letterSpacing":"-0.02em","lineHeight":"1.15"}}>Release Notes</h1>
      <p style={{"fontSize":"1rem","lineHeight":"1.7","color":"hsl(var(--muted-foreground))"}}>A <strong style={{"fontWeight":"600","color":"hsl(var(--foreground))"}}>kind:'html'</strong> page — native HTML tags and the blocks' structured props, parsed (never executed), styled from theme tokens.</p>
    </flex>
    <hr style={{"border":"0","borderTop":"1px solid hsl(var(--border))"}} />
    <flex direction="col" align="stretch" gap={3}>
      <h2 style={{"fontSize":"1.5rem","fontWeight":"600"}}>What shipped</h2>
      <ul style={{"paddingLeft":"var(--space-6)","listStyleType":"disc","lineHeight":"1.9","color":"hsl(var(--muted-foreground))"}}>
        <li>Full HTML tag set in the <em style={{"fontStyle":"italic"}}>html</em> tier.</li>
        <li>A trusted <a href="https://objectui.org" style={{"fontWeight":"500","color":"hsl(var(--primary))","textDecoration":"underline"}}>react tier</a> behind a flag.</li>
        <li>Author writes markup; the platform renders it.</li>
      </ul>
    </flex>
    <blockquote style={{"borderLeft":"4px solid hsl(var(--primary))","background":"hsl(var(--muted))","borderRadius":"var(--radius)","padding":"var(--space-4)","margin":"0","color":"hsl(var(--foreground))"}}>
      <p style={{"margin":"0"}}>“The best custom page is one the AI can write and the platform can render safely.”</p>
    </blockquote>
    <img src="https://placehold.co/600x160/4f46e5/ffffff?text=kind:html" alt="banner" style={{"width":"100%","borderRadius":"var(--radius-xl)"}} />
  </flex>
</section>`;

const htmlPage = { type: 'home', kind: 'html', name: 'release_notes', label: 'Release Notes', source: htmlSource };

// The react tier's styling primitive: inline `style` objects, colours as
// `hsl(var(--token))`. Real JS, so shared style objects are just consts.
const reactSource = `
function Page() {
  const [sortKey, setSortKey] = React.useState('amount');
  const [count, setCount] = React.useState(0);
  const rows = [...data].sort((a, b) => (sortKey === 'amount' ? b.amount - a.amount : a.name.localeCompare(b.name)));
  const total = data.reduce((s, r) => s + r.amount, 0);
  const cell = { padding: 'var(--space-2) 0', borderBottom: '1px solid hsl(var(--border))' };
  const head = { padding: 'var(--space-2) 0', fontWeight: 500, color: 'hsl(var(--muted-foreground))' };
  return (
    <div style={{ maxWidth: '48rem', margin: '0 auto', padding: 'var(--space-10)', color: 'hsl(var(--foreground))' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
        <h1 style={{ fontSize: '1.875rem', fontWeight: 700, letterSpacing: '-0.02em' }}>Pipeline (real React)</h1>
        <button
          onClick={() => setCount((c) => c + 1)}
          style={{
            borderRadius: 'var(--radius)',
            background: 'hsl(var(--primary))',
            color: 'hsl(var(--primary-foreground))',
            padding: 'var(--space-2) var(--space-4)',
            fontSize: '0.875rem',
            fontWeight: 600,
            border: 'none',
            cursor: 'pointer',
          }}
        >Clicked {count} times</button>
      </div>
      <p style={{ marginTop: 'var(--space-2)', fontSize: '0.875rem', color: 'hsl(var(--muted-foreground))' }}>useState · map · reduce · sort · onClick — executed by the runtime.</p>
      <div style={{ marginTop: 'var(--space-4)', display: 'flex', gap: 'var(--space-2)', fontSize: '0.75rem' }}>
        {['amount', 'name'].map((k) => (
          <button key={k} onClick={() => setSortKey(k)}
            style={{
              borderRadius: '9999px',
              padding: 'var(--space-1) var(--space-3)',
              fontWeight: 600,
              border: '1px solid hsl(var(--border))',
              cursor: 'pointer',
              background: sortKey === k ? 'hsl(var(--foreground))' : 'hsl(var(--muted))',
              color: sortKey === k ? 'hsl(var(--background))' : 'hsl(var(--muted-foreground))',
            }}
          >sort by {k}</button>
        ))}
      </div>
      <table style={{ marginTop: 'var(--space-4)', width: '100%', textAlign: 'left', fontSize: '0.875rem', borderCollapse: 'collapse' }}>
        <thead><tr style={{ borderBottom: '1px solid hsl(var(--border))' }}><th style={head}>Account</th><th style={{ ...head, textAlign: 'right' }}>Amount</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td style={{ ...cell, fontWeight: 500 }}>{r.name}</td>
              <td style={{ ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'hsl(var(--muted-foreground))' }}>{'$' + r.amount.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 'var(--space-3)', textAlign: 'right', fontSize: '0.875rem', fontWeight: 600 }}>Total: {'$' + total.toLocaleString()}</div>
    </div>
  );
}`;

const reactPage = {
  type: 'home',
  kind: 'react',
  name: 'pipeline_react',
  label: 'Pipeline',
  source: reactSource,
  data: [
    { name: 'Acme', amount: 120000 },
    { name: 'Globex', amount: 88000 },
    { name: 'Initech', amount: 64000 },
    { name: 'Umbrella', amount: 152000 },
    { name: 'Soylent', amount: 41000 },
  ],
};

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <div className="space-y-10 bg-background text-foreground">
      <div data-tier="html"><SchemaRenderer schema={htmlPage as any} /></div>
      <div className="border-t-4 border-dashed border-border" />
      <div data-tier="react"><SchemaRenderer schema={reactPage as any} /></div>
    </div>
  </React.StrictMode>,
);
