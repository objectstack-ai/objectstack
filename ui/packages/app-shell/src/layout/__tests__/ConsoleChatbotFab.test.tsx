import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConsoleChatbotFab } from '../ConsoleChatbotFab';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'topbar.openAssistant') return `Open ${String(options?.name)} assistant`;
      return String(options?.defaultValue ?? key);
    },
  }),
}));

describe('ConsoleChatbotFab', () => {
  it('keeps the lightweight FAB above the mobile bottom navigation', () => {
    render(<ConsoleChatbotFab appLabel="Workspace" onOpenDock={() => {}} />);

    const fab = screen.getByTestId('console-chatbot-fab');
    expect(fab).toHaveAccessibleName('Open Workspace assistant');
    expect(fab).toHaveClass('bottom-20');
    expect(fab).toHaveClass('sm:bottom-6');
  });

  it('ADR-0057 — the FAB is the ChatDock launcher (no overlay ever mounts)', () => {
    const onOpenDock = vi.fn();
    render(<ConsoleChatbotFab appLabel="Workspace" onOpenDock={onOpenDock} />);

    const fab = screen.getByTestId('console-chatbot-fab');
    fireEvent.click(fab);
    expect(onOpenDock).toHaveBeenCalledTimes(1);
    // The FAB stays the lightweight launcher button after the click.
    expect(screen.getByTestId('console-chatbot-fab')).toBeInTheDocument();
  });
});
