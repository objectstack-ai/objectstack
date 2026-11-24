/**
 * objectstack-ai/objectstack#36256 item 6 — a drilled record's name opens its
 * page with the history-state `from` a list hands the page it opens: the
 * record page's 「N of M」 stepper walks the drill list's rows, and its way
 * back is the dashboard the drill was opened on. Read here through the record
 * page's own reader (`useRecordPageReturn`), so the page needs no change.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { FilterScopeProvider } from '@object-ui/react';
import { useRecordListDrillNavigation } from './useOpenRecordList';
import { useRecordPageReturn } from './recordDrawerStack';

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter initialEntries={['/apps/crm/dashboard/executive?tab=1']}>
      <FilterScopeProvider currentUserId="u1">
        <Routes>
          <Route path="/apps/:appName/*" element={<>{children}</>} />
        </Routes>
      </FilterScopeProvider>
    </MemoryRouter>
  );
}

function useHarness() {
  const nav = useRecordListDrillNavigation('Executive Overview');
  const location = useLocation();
  const recordId = location.pathname.match(/\/record\/([^/]+)$/)?.[1];
  const pageReturn = useRecordPageReturn(recordId);
  return { nav, location, pageReturn };
}

describe('a drilled record opens its page with the drill list as its set (#36256)', () => {
  it('pages through the drill rows and returns to the dashboard', () => {
    const { result } = renderHook(useHarness, { wrapper: Wrapper });
    act(() => result.current.nav.openRecord('crm_opportunity', 'o2', { siblings: ['o1', 'o2', 'o3'], total: 3 }));

    expect(result.current.location.pathname).toBe('/apps/crm/crm_opportunity/record/o2');
    expect((result.current.location.state as any).from).toEqual({
      pathname: '/apps/crm/dashboard/executive?tab=1',
      label: 'Executive Overview',
      siblings: ['o1', 'o2', 'o3'],
      total: 3,
    });
    expect(result.current.pageReturn.stepper?.position).toEqual({ index: 1, total: 3 });

    act(() => result.current.pageReturn.stepper!.onNext!());
    expect(result.current.location.pathname).toBe('/apps/crm/crm_opportunity/record/o3');
    expect(result.current.pageReturn.stepper?.position).toEqual({ index: 2, total: 3 });

    act(() => result.current.pageReturn.toList!());
    expect(result.current.location.pathname + result.current.location.search).toBe('/apps/crm/dashboard/executive?tab=1');
  });
});
