// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * StudioShell — wires the cross-cutting layout pieces:
 *
 *   • TopBar
 *   • Inspector right-drawer (toggle with `]`)
 *   • Problems bottom panel + status-bar pill (toggle with `[`)
 *   • Global keyboard shortcuts + Help dialog (toggle with `?`)
 *
 * The page outlet (children) renders inside the main canvas. Detail pages
 * call `useSetInspectorTarget()` to populate the inspector.
 */

import { useState } from 'react';
import { TopBar } from '@/components/top-bar';
import { InspectorDrawer } from '@/components/InspectorDrawer';
import { ProblemsPanel, ProblemsStatusBar } from '@/components/ProblemsPanel';
import { HotkeysHelpDialog } from '@/components/HotkeysHelpDialog';
import { InspectorProvider, useInspector } from '@/hooks/useInspector';
import { ProblemsProvider, useProblems } from '@/hooks/useProblems';
import { useStudioHotkeys } from '@/hooks/useStudioHotkeys';
import { useAiChatPanel } from '@/hooks/use-ai-chat-panel';
import { Button } from '@/components/ui/button';
import { PanelRight, HelpCircle, Sparkles } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

function ShellBody({ children }: { children: React.ReactNode }) {
  const { toggle: toggleInspector } = useInspector();
  const { toggle: toggleProblems } = useProblems();
  const { toggle: toggleAiChat, isOpen: aiChatOpen } = useAiChatPanel();
  const [helpOpen, setHelpOpen] = useState(false);
  useStudioHotkeys({
    toggleInspector,
    toggleProblems,
    openHelp: () => setHelpOpen(true),
  });

  return (
    <TooltipProvider delayDuration={500}>
      <div className="flex min-h-screen w-full flex-col">
        <TopBar
          rightSlot={
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={`h-8 w-8 p-0 ${aiChatOpen ? 'text-primary' : ''}`}
                    onClick={toggleAiChat}
                    aria-label="Toggle AI Chat"
                  >
                    <Sparkles className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  AI Chat <kbd className="ml-1 px-1 rounded bg-muted text-[10px]">⌘⇧I</kbd>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    onClick={toggleInspector}
                    aria-label="Toggle Inspector"
                  >
                    <PanelRight className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Inspector <kbd className="ml-1 px-1 rounded bg-muted text-[10px]">]</kbd>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    onClick={() => setHelpOpen(true)}
                    aria-label="Keyboard shortcuts"
                  >
                    <HelpCircle className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Shortcuts <kbd className="ml-1 px-1 rounded bg-muted text-[10px]">?</kbd>
                </TooltipContent>
              </Tooltip>
            </>
          }
        />
        <div className="flex flex-1 w-full overflow-hidden">
          <main className="flex flex-1 min-w-0 overflow-hidden">{children}</main>
        </div>
        <ProblemsPanel />
        <StatusBar />
        <InspectorDrawer />
        <HotkeysHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
      </div>
    </TooltipProvider>
  );
}

function StatusBar() {
  return (
    <div className="h-6 border-t flex items-center justify-between px-2 text-xs bg-muted/30">
      <ProblemsStatusBar />
      <div className="text-muted-foreground">
        <kbd className="px-1 rounded bg-muted text-[10px]">?</kbd> shortcuts ·{' '}
        <kbd className="px-1 rounded bg-muted text-[10px]">⌘K</kbd> palette
      </div>
    </div>
  );
}

export function StudioShell({ children }: { children: React.ReactNode }) {
  return (
    <InspectorProvider>
      <ProblemsProvider>
        <ShellBody>{children}</ShellBody>
      </ProblemsProvider>
    </InspectorProvider>
  );
}
