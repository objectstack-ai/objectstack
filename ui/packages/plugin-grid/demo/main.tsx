/**
 * Manual-verification demo for the @object-ui/plugin-grid Import Wizard.
 *
 *   pnpm --dir packages/plugin-grid exec vite demo --port 5198
 *
 * Exercises the three new capabilities:
 *   - Excel parsing  — drag in demo/sample.xlsx (lazy-loads exceljs)
 *   - Type inference — the Mapping step shows an inferred-type badge per column
 *   - Paste import   — copy a block from Excel/Sheets and Ctrl/⌘+V anywhere
 *
 * Add ?lang=zh to see the Simplified-Chinese chrome.
 */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import '@object-ui/components/style.css';
import { I18nProvider } from '@object-ui/react';

// The prebuilt components CSS ships its own :root theme and (being injected at
// runtime) wins over index.html. Re-apply console's blue brand tokens last so
// this demo renders with the SAME theme as the real console app — proving the
// wizard's look comes from the host theme, not the component.
const themeStyle = document.createElement('style');
themeStyle.textContent = `:root {
  --primary: 243 75% 59%;
  --primary-foreground: 0 0% 100%;
  --ring: 243 75% 59%;
  --secondary: 210 40% 96.1%;
  --secondary-foreground: 222.2 47.4% 11.2%;
  --muted: 210 40% 96.1%;
  --muted-foreground: 215.4 16.3% 46.9%;
  --accent: 210 40% 96.1%;
  --accent-foreground: 222.2 47.4% 11.2%;
  --border: 214.3 31.8% 91.4%;
  --input: 214.3 31.8% 91.4%;
}`;
document.head.appendChild(themeStyle);
import { en, zh, ja, ko, de, fr, es, pt, ru, ar } from '@object-ui/i18n/locales';
import { ImportWizard, type ImportResult } from '../src/ImportWizard';

const lang = new URLSearchParams(window.location.search).get('lang') ?? 'en';

/** A "Contacts" object whose field types let inference + mismatch warnings show:
 *  name(text), age(number), active(boolean), birthday(date), score(percent). */
const FIELDS = [
  { name: 'name', label: 'Name', type: 'text', required: true },
  { name: 'age', label: 'Age', type: 'number' },
  { name: 'active', label: 'Active', type: 'boolean' },
  { name: 'birthday', label: 'Birthday', type: 'date' },
  { name: 'score', label: 'Score', type: 'percent' },
];

/** Mock data source — logs every created record instead of hitting a backend. */
const created: unknown[] = [];
const dataSource = {
  async create(resource: string, record: Record<string, unknown>) {
    created.push(record);
    // eslint-disable-next-line no-console
    console.log(`[demo] create ${resource}`, record);
    return record;
  },
};

const SAMPLE_TSV = `Name\tAge\tActive\tBirthday\tScore
Ada Lovelace\t36\ttrue\t1815-12-10\t0.99
Alan Turing\t41\tyes\t1912-06-23\t0.97
Grace Hopper\t85\tno\t1906-12-09\t0.95`;

function Demo() {
  const [open, setOpen] = React.useState(false);
  const [result, setResult] = React.useState<ImportResult | null>(null);

  const onComplete = (r: ImportResult) => {
    setResult(r);
    setOpen(false);
  };

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 32 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Import Wizard — demo</h1>
      <p style={{ color: 'hsl(var(--muted-foreground))', marginTop: 0 }}>
        Excel parsing · column type inference · paste-to-import
      </p>

      <ol style={{ lineHeight: 1.7, color: 'hsl(var(--muted-foreground))' }}>
        <li>Click <b>Open import</b> below.</li>
        <li>Drag in <code>sample.csv</code> or <code>sample.xlsx</code> (in this demo folder), or…</li>
        <li>…copy the block below and press <b>Ctrl/⌘+V</b> in the wizard — no file needed.</li>
        <li>On the <b>Mapping</b> step, note the inferred-type badge under each column
            (e.g. <i>number</i>, <i>boolean</i>, <i>date</i>) and the mismatch warning if a
            text column is mapped to a numeric field.</li>
      </ol>

      <pre
        style={{
          background: 'hsl(var(--muted))',
          padding: 12,
          borderRadius: 8,
          fontSize: 12,
          overflowX: 'auto',
          userSelect: 'all',
        }}
      >{SAMPLE_TSV}</pre>

      <button type="button"
        onClick={() => { setResult(null); setOpen(true); }}
        style={{
          background: 'hsl(var(--primary))',
          color: 'hsl(var(--primary-foreground))',
          border: 'none',
          borderRadius: 8,
          padding: '10px 18px',
          fontSize: 14,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Open import
      </button>

      {result && (
        <div
          style={{
            marginTop: 20,
            padding: 16,
            border: '1px solid hsl(var(--border))',
            borderRadius: 8,
          }}
        >
          <b>Done.</b> Imported {result.importedRows}/{result.totalRows} rows
          {result.skippedRows ? `, skipped ${result.skippedRows}` : ''}.
          <pre style={{ fontSize: 12, marginBottom: 0 }}>
            {JSON.stringify(created, null, 2)}
          </pre>
        </div>
      )}

      {/* Mount on demand (like ObjectView) so each open starts on the Upload step. */}
      {open && (
        <ImportWizard
          objectName="contact"
          objectLabel="Contact"
          fields={FIELDS}
          dataSource={dataSource}
          open={open}
          onOpenChange={setOpen}
          onComplete={onComplete}
          onCancel={() => setOpen(false)}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false, resources: { en, zh, ja, ko, de, fr, es, pt, ru, ar } }}>
    <Demo />
  </I18nProvider>,
);
