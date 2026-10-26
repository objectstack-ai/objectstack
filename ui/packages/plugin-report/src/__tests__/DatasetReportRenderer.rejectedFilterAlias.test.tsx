/**
 * `filter` is REJECTED by the renderer, not honoured as an alias (objectui#5137).
 *
 * `DatasetReportRenderer` used to read `report.runtimeFilter ?? report.filter`
 * (and the per-block twin). `filter` is not an authorable key — `ReportSchema`
 * in `@objectstack/spec` is strict and refuses it, naming the replacement
 * itself — so honouring it made the runtime looser than the published contract.
 *
 * Three facts are pinned here, and the THIRD is the one that separates this
 * from a silent regression:
 *
 *  1. `runtimeFilter` still applies, unchanged, at the report level and per
 *     joined block — the removal narrowed nothing an author authored correctly.
 *  2. A stored document carrying ONLY `filter` gets NO filter applied. The
 *     assertion is on the SELECTION the renderer sends, not merely on the
 *     absence of the alias value: an unfiltered query is what the document now
 *     produces, and that is the behaviour change worth pinning.
 *  3. That case is LOUD. Deleting the read alone would render such a report
 *     unfiltered in silence — for a scoped report, worse than an error — so the
 *     key is reported instead of applied, in the spec's own wording.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { ReportSchema } from '@objectstack/spec/ui';
import { DatasetReportRenderer, resetReportFilterAliasWarnings } from '../DatasetReportRenderer';

type MockRows = Array<Record<string, unknown>>;

function makeSource(byDataset: Record<string, MockRows>) {
  const calls: Array<{ dataset: string; selection: Record<string, unknown> }> = [];
  return {
    calls,
    queryDataset: vi.fn(async (dataset: string, selection: unknown) => {
      calls.push({ dataset, selection: selection as Record<string, unknown> });
      return { rows: byDataset[dataset] ?? [] };
    }),
  };
}

const ROWS: MockRows = [
  { stage: 'won', revenue: 10 },
  { stage: 'lost', revenue: 4 },
];

const renderReport = (report: Record<string, unknown>, src: ReturnType<typeof makeSource>) =>
  render(
    <I18nProvider>
      <DatasetReportRenderer report={report as never} dataSource={src} />
    </I18nProvider>,
  );

// Inferred rather than annotated: the spy's own type is what `vi.spyOn`
// returns for THIS console method, and spelling it out by hand drifts.
const spyOnWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => {});
let warnSpy: ReturnType<typeof spyOnWarn>;

beforeEach(() => {
  resetReportFilterAliasWarnings();
  warnSpy = spyOnWarn();
});

afterEach(() => {
  warnSpy.mockRestore();
});

const warnings = (): string[] => warnSpy.mock.calls.map((c: unknown[]) => String(c[0]));
const aliasWarnings = (): string[] => warnings().filter((m) => m.includes('objectui#5137'));

describe('DatasetReportRenderer — `runtimeFilter` still applies (unchanged)', () => {
  it('lowers a report-level `runtimeFilter` onto the dataset selection', async () => {
    const src = makeSource({ sales: ROWS });
    renderReport(
      {
        name: 'pipeline',
        type: 'summary',
        dataset: 'sales',
        rows: ['stage'],
        values: ['revenue'],
        runtimeFilter: { won: true },
      },
      src,
    );

    await waitFor(() => expect(src.queryDataset).toHaveBeenCalled());
    expect(src.calls[0].selection.runtimeFilter).toMatchObject({ won: true });
    // The correct spelling is not the noisy one.
    expect(aliasWarnings()).toEqual([]);
  });

  it('lowers each joined block’s own `runtimeFilter`', async () => {
    const src = makeSource({ sales: ROWS });
    renderReport(
      {
        name: 'pipeline',
        type: 'joined',
        blocks: [
          { name: 'open', dataset: 'sales', rows: ['stage'], values: ['revenue'], runtimeFilter: { done: false } },
          { name: 'closed', dataset: 'sales', rows: ['stage'], values: ['revenue'], runtimeFilter: { done: true } },
        ],
      },
      src,
    );

    await waitFor(() => expect(src.queryDataset).toHaveBeenCalledTimes(2));
    expect(src.queryDataset).toHaveBeenCalledWith('sales', expect.objectContaining({ runtimeFilter: { done: false } }));
    expect(src.queryDataset).toHaveBeenCalledWith('sales', expect.objectContaining({ runtimeFilter: { done: true } }));
    expect(aliasWarnings()).toEqual([]);
  });
});

describe('DatasetReportRenderer — `filter` applies NOTHING', () => {
  it('a report carrying only `filter` queries the dataset UNFILTERED', async () => {
    const src = makeSource({ sales: ROWS });
    renderReport(
      { name: 'pipeline', type: 'summary', dataset: 'sales', rows: ['stage'], values: ['revenue'], filter: { won: true } },
      src,
    );

    await waitFor(() => expect(src.queryDataset).toHaveBeenCalled());
    const { selection } = src.calls[0];
    expect(selection.runtimeFilter).toBeUndefined();
    // Nothing anywhere in the selection carries the rejected value — the alias
    // is not re-entering under another name.
    expect(JSON.stringify(selection)).not.toContain('won');
    // The report still RENDERS; the narrowing is the filter, not the report.
    expect(await screen.findByText('won')).toBeInTheDocument();
  });

  it('a joined block carrying only `filter` queries UNFILTERED too', async () => {
    const src = makeSource({ sales: ROWS });
    renderReport(
      {
        name: 'pipeline',
        type: 'joined',
        blocks: [{ name: 'open', dataset: 'sales', rows: ['stage'], values: ['revenue'], filter: { done: false } }],
      },
      src,
    );

    await waitFor(() => expect(src.queryDataset).toHaveBeenCalled());
    expect(src.calls[0].selection.runtimeFilter).toBeUndefined();
    expect(JSON.stringify(src.calls[0].selection)).not.toContain('done');
  });

  it('a report-level `filter` does not shadow the host-supplied `runtimeFilter` prop', async () => {
    const src = makeSource({ sales: ROWS });
    render(
      <I18nProvider>
        <DatasetReportRenderer
          report={{ name: 'pipeline', type: 'summary', dataset: 'sales', rows: ['stage'], values: ['revenue'], filter: { won: true } } as never}
          runtimeFilter={{ owner: 'me' }}
          dataSource={src}
        />
      </I18nProvider>,
    );

    await waitFor(() => expect(src.queryDataset).toHaveBeenCalled());
    // The host's scope survives intact — it is merged with nothing, not with `filter`.
    expect(src.calls[0].selection.runtimeFilter).toMatchObject({ owner: 'me' });
    expect(JSON.stringify(src.calls[0].selection)).not.toContain('won');
  });
});

describe('DatasetReportRenderer — the dropped `filter` is LOUD, not silent', () => {
  it('warns once, naming the key, the rename, and that no filter was applied', async () => {
    const src = makeSource({ sales: ROWS });
    renderReport(
      { name: 'pipeline', type: 'summary', dataset: 'sales', rows: ['stage'], values: ['revenue'], filter: { won: true } },
      src,
    );

    await waitFor(() => expect(src.queryDataset).toHaveBeenCalled());
    const hits = aliasWarnings();
    expect(hits).toHaveLength(1);
    const message = hits[0];
    // Which document. Which key. What happened to it.
    expect(message).toContain('pipeline');
    expect(message).toContain('`filter`');
    expect(message).toContain('`runtimeFilter`');
    expect(message).toContain('UNFILTERED');
  });

  it('says it in the SPEC’s words — one message, not two dialects of one message', () => {
    // The producer side already answers `filter` with an explicit rename hint.
    // The renderer quotes that hint verbatim, so an author who meets both meets
    // the same sentence twice rather than two spellings of one instruction.
    const parsed = ReportSchema.safeParse({
      name: 'pipeline',
      label: 'Pipeline',
      type: 'summary',
      dataset: 'sales',
      rows: ['stage'],
      values: ['revenue'],
      filter: { won: true },
    });
    expect(parsed.success, '`filter` must still be rejected by the spec').toBe(false);
    const specMessage = parsed.success ? '' : parsed.error.issues.map((i) => i.message).join('\n');

    const RENAME_HINT = 'Did you mean `filter` → `runtimeFilter`?';
    expect(specMessage).toContain(RENAME_HINT);

    const src = makeSource({ sales: ROWS });
    renderReport(
      { name: 'pipeline', type: 'summary', dataset: 'sales', rows: ['stage'], values: ['revenue'], filter: { won: true } },
      src,
    );
    expect(aliasWarnings()[0]).toContain(RENAME_HINT);
  });

  it('warns per offending block, and only once each across re-renders', async () => {
    const src = makeSource({ sales: ROWS });
    const report = {
      name: 'pipeline',
      type: 'joined',
      blocks: [
        { name: 'open', dataset: 'sales', rows: ['stage'], values: ['revenue'], filter: { done: false } },
        { name: 'closed', dataset: 'sales', rows: ['stage'], values: ['revenue'], filter: { done: true } },
        { name: 'clean', dataset: 'sales', rows: ['stage'], values: ['revenue'], runtimeFilter: { done: true } },
      ],
    };
    const view = renderReport(report, src);
    await waitFor(() => expect(src.queryDataset).toHaveBeenCalled());

    // One per offending block; the correctly-spelled block is silent.
    let hits = aliasWarnings();
    expect(hits).toHaveLength(2);
    expect(hits.some((m) => m.includes('open'))).toBe(true);
    expect(hits.some((m) => m.includes('closed'))).toBe(true);
    expect(hits.some((m) => m.includes('clean'))).toBe(false);

    // Re-rendering the same document does not re-spam the console.
    view.rerender(
      <I18nProvider>
        <DatasetReportRenderer report={report as never} dataSource={src} />
      </I18nProvider>,
    );
    hits = aliasWarnings();
    expect(hits).toHaveLength(2);
  });

  it('stays silent under NODE_ENV=production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const src = makeSource({ sales: ROWS });
      renderReport(
        { name: 'pipeline', type: 'summary', dataset: 'sales', rows: ['stage'], values: ['revenue'], filter: { won: true } },
        src,
      );
      await waitFor(() => expect(src.queryDataset).toHaveBeenCalled());
      expect(aliasWarnings()).toEqual([]);
      // Still no filter applied — production is quieter, not more tolerant.
      expect(src.calls[0].selection.runtimeFilter).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
