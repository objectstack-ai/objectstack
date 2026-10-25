import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SidebarProvider, useSidebar } from '@object-ui/components';
import { describe, expect, it } from 'vitest';
import { useResponsiveSidebar } from '../useResponsiveSidebar';

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
}

function Harness() {
  useResponsiveSidebar();
  const { open, setOpen } = useSidebar();

  return (
    <>
      <div data-testid="sidebar-open">{String(open)}</div>
      <button type="button" onClick={() => setOpen(true)}>
        Expand sidebar
      </button>
    </>
  );
}

describe('useResponsiveSidebar', () => {
  it('auto-collapses at tablet width without overriding a manual expand', async () => {
    setViewportWidth(970);

    render(
      <SidebarProvider defaultOpen>
        <Harness />
      </SidebarProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('sidebar-open')).toHaveTextContent('false');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));

    await waitFor(() => {
      expect(screen.getByTestId('sidebar-open')).toHaveTextContent('true');
    });
  });
});
