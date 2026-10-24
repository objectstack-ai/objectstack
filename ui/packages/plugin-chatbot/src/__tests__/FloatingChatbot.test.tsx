/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Focused checks for the floating chat chrome. Message rendering is covered
 * by ChatbotEnhanced tests.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FloatingChatbotProvider } from '../FloatingChatbotProvider';
import { FloatingChatbotPanel } from '../FloatingChatbotPanel';
import { FloatingChatbotTrigger } from '../FloatingChatbotTrigger';

describe('FloatingChatbot chrome', () => {
  it('uses responsive panel bounds and hides the trigger while open', () => {
    render(
      <FloatingChatbotProvider defaultOpen>
        <FloatingChatbotTrigger />
        <FloatingChatbotPanel title="Workspace assistant" width={420} height={560}>
          <div>Chat body</div>
        </FloatingChatbotPanel>
      </FloatingChatbotProvider>
    );

    expect(screen.getByTestId('floating-chatbot-trigger')).toHaveClass('hidden');

    const panel = screen.getByTestId('floating-chatbot-panel');
    expect(panel).toHaveClass('left-3');
    expect(panel).toHaveClass('right-3');
    expect(panel).toHaveClass('sm:w-[420px]');
    expect(panel).toHaveClass('sm:h-[560px]');
  });
});
