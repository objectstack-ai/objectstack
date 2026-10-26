/**
 * MetadataInspector
 *
 * Shared debug panel that shows raw JSON metadata for any view.
 * Used across ObjectView, DashboardView, PageView, ReportView, and RecordDetailView.
 */

import { useState, useMemo } from 'react';
import { Button } from '@object-ui/components';
import { Code2, Copy, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { parseDebugFlags } from '@object-ui/core';
import { useObjectTranslation } from '@object-ui/i18n';

interface MetadataSection {
  title: string;
  data: any;
}

interface MetadataInspectorProps {
  /** Sections of metadata to display */
  sections: MetadataSection[];
  /** Whether the panel is open */
  open: boolean;
  /** Toggle callback */
  onToggle: () => void;
}

/**
 * Toggle button for the metadata inspector.
 * Place this in your header/toolbar area.
 */
export function MetadataToggle({ open, onToggle, className }: { open: boolean; onToggle: () => void; className?: string }) {
  const { t } = useObjectTranslation();
  return (
    <Button
      size="sm"
      variant={open ? 'secondary' : 'outline'}
      onClick={onToggle}
      className={`shadow-none gap-2 ${className || ''}`}
      title={t('layout.metadata.toggleTitle')}
    >
      <Code2 className="h-4 w-4" />
      <span className="hidden lg:inline">{t('layout.metadata.label')}</span>
    </Button>
  );
}

/**
 * The side panel that renders JSON metadata sections.
 */
export function MetadataPanel({ sections, open }: Omit<MetadataInspectorProps, 'onToggle'>) {
  const { t } = useObjectTranslation();
  const [expandedSections, setExpandedSections] = useState<string[]>(['0']);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // Checked after the hooks above so hook order stays stable across renders.
  if (!open) return null;

  const handleCopy = async (data: any, index: number) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const toggleSection = (index: string) => {
    setExpandedSections(prev =>
      prev.includes(index)
        ? prev.filter(i => i !== index)
        : [...prev, index]
    );
  };

  return (
    <div className="w-80 border-l bg-background p-0 overflow-hidden flex flex-col shrink-0 z-20 transition-all">
      <div className="px-4 py-3 border-b bg-muted/5 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('layout.metadata.panelTitle')}</span>
        <span className="text-[10px] text-muted-foreground/60">{t('layout.metadata.jsonBadge')}</span>
      </div>
      <div className="flex-1 overflow-auto">
        {sections.map((section, index) => {
          const sectionId = String(index);
          const isExpanded = expandedSections.includes(sectionId);
          const isCopied = copiedIndex === index;

          return (
            <div key={index} className="border-b last:border-b-0">
              <div className="flex items-center justify-between px-4 py-3 hover:bg-muted/5 transition-colors">
                <button type="button"
                  onClick={() => toggleSection(sectionId)}
                  className="flex-1 flex items-center justify-between text-left"
                >
                  <h4 className="text-xs font-semibold text-foreground">
                    {section.title}
                  </h4>
                  {isExpanded ? (
                    <ChevronDown className="h-3 w-3 text-muted-foreground ml-2" />
                  ) : (
                    <ChevronRight className="h-3 w-3 text-muted-foreground ml-2" />
                  )}
                </button>
                <button type="button"
                  onClick={() => handleCopy(section.data, index)}
                  className="p-1 hover:bg-muted rounded transition-colors ml-2"
                  title={t('layout.metadata.copyJson')}
                >
                  {isCopied ? (
                    <Check className="h-3 w-3 text-green-600" />
                  ) : (
                    <Copy className="h-3 w-3 text-muted-foreground" />
                  )}
                </button>
              </div>
              {isExpanded && (
                <div className="px-4 pb-4">
                  <div className="relative rounded-md border border-border/50 bg-muted/5 overflow-hidden">
                    <pre className="text-[11px] leading-relaxed p-3 overflow-auto max-h-96 font-mono text-foreground/90">
                      {JSON.stringify(section.data, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Hook to manage MetadataInspector open/close state.
 * Automatically opens when `?__debug` URL parameter is present.
 */
export function useMetadataInspector() {
  const autoOpen = useMemo(() => {
    try {
      return typeof window !== 'undefined'
        ? parseDebugFlags(window.location.search).enabled
        : false;
    } catch {
      return false;
    }
  }, []);
  const [showDebug, setShowDebug] = useState(autoOpen);
  return {
    showDebug,
    toggleDebug: () => setShowDebug((prev: any) => !prev),
  };
}
