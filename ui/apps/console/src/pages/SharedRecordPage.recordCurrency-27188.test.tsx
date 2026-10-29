/**
 * objectstack#27188 — a shared `record`-mode amount (ADR-0144 D2) shows the
 * currency its own record names: the resolve answer projects the amount's
 * `currencyField` pointer, and the page hands the shared record to the
 * currency face. A code field the link hides leaves a plain number.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SchemaRendererProvider } from '@object-ui/react';
import SharedRecordPage from './SharedRecordPage';

const TOKEN = 'tok_27188';
const RESOLVE_PATH = `/api/v1/share-links/${TOKEN}/resolve`;

const RECORD_MODE = { currencyMode: 'record', currencyField: 'currency_code' } as const;

const DEAL = { id: 'deal_1', name: 'Shared deal', amount: 1250, currency_code: 'EUR' };
const FIELDS = {
  name: { label: 'Deal Name', type: 'text' },
  amount: { label: 'Amount', type: 'currency', currencyConfig: RECORD_MODE },
  currency_code: { label: 'Currency', type: 'text' },
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Stub the resolve route; answer `fields` only when given. Returns every requested path. */
function shareServer(record: Record<string, unknown>, fields?: Record<string, unknown>): string[] {
  const requested: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const { pathname } = new URL(raw, 'http://localhost');
      requested.push(pathname);
      if (pathname === RESOLVE_PATH) {
        return json(200, {
          success: true,
          data: {
            record,
            link: {
              id: 'sl_1',
              token: TOKEN,
              object_name: 'deal',
              record_id: String(record.id),
              permission: 'view',
              audience: 'anyone',
            },
            redactFields: ['ssn'],
            ...(fields ? { fields } : {}),
          },
        });
      }
      return new Response(null, { status: 404 });
    }),
  );
  return requested;
}

function renderLink(dataSource?: Record<string, unknown>) {
  const routed = (
    <MemoryRouter initialEntries={[`/s/${TOKEN}`]}>
      <Routes>
        <Route path="/s/:token" element={<SharedRecordPage />} />
      </Routes>
    </MemoryRouter>
  );
  return render(
    dataSource ? <SchemaRendererProvider dataSource={dataSource as never}>{routed}</SchemaRendererProvider> : routed,
  );
}

/** The value cell beside the row whose label reads `label`. */
function cellOf(label: string): HTMLElement {
  const term = screen.getByText(label, { selector: 'dt' });
  const value = term.parentElement?.querySelector('dd');
  expect(value).not.toBeNull();
  return value as HTMLElement;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('shared record — a record-mode amount', () => {
  it('shows the currency the record\'s code field names', async () => {
    shareServer(DEAL, FIELDS);
    renderLink();
    await screen.findByText('Amount', { selector: 'dt' });
    expect(cellOf('Amount').textContent).toContain('€');
  });

  it('follows each record\'s own code', async () => {
    shareServer({ ...DEAL, currency_code: 'JPY', amount: 1250 }, FIELDS);
    renderLink();
    await screen.findByText('Amount', { selector: 'dt' });
    expect(cellOf('Amount').textContent).toMatch(/¥|JP¥/);
    expect(cellOf('Amount').textContent).not.toContain('€');
  });

  it('a hidden code field (no pointer, no code) leaves a plain number', async () => {
    const { currency_code: _hidden, ...record } = DEAL;
    shareServer(record, { ...FIELDS, amount: { ...FIELDS.amount, currencyConfig: { currencyMode: 'record' } } });
    renderLink();
    await screen.findByText('Amount', { selector: 'dt' });
    expect(cellOf('Amount').textContent).not.toMatch(/€|\$|¥/);
    expect(cellOf('Amount').textContent).toMatch(/1,?250/);
  });
});
