// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ProblemsPanel — lists every structural + server validation issue for the
 * flow draft. Each row shows the severity icon and the message; clicking a row
 * selects and reveals (pans to) the offending node/edge on the canvas. Mirrors
 * the "Problems" tab of an IDE / the error panel in Salesforce Flow Builder.
 *
 * Pure presentation: the issue list is derived upstream (see `flow-problems`)
 * from the live draft, so rows clear as the author fixes each problem.
 */

import * as React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, CircleDot, CircleSlash, GitBranch } from 'lucide-react';
import { cn } from '@object-ui/components';
import { describeFlowRunStatus, type FlowProblem, type FlowRunStatus } from './flow-problems.js';
import { flowEdgeDisplayName, flowNodeDisplayName } from './flow-canvas-parts.js';
import { t as tr } from '../i18n.js';

export interface ProblemsPanelProps {
  problems: FlowProblem[];
  /** Selected element key (`node:<id>` or an edge's `edgeKey`) to highlight matching rows. */
  selectedKey?: string | null;
  onSelectProblem: (problem: FlowProblem) => void;
  /** UI locale for the panel chrome. */
  locale?: string;
  /**
   * The flow's run status (objectui#11779), the one the header's Status pill
   * shows. A flow the deployment does not run on its trigger (`not-running`)
   * gets a note above the list: a deployment fact, not an authoring problem,
   * so it is never counted, never styled as an error, and the structural
   * verdict below it stands as it is.
   */
  runStatus?: FlowRunStatus;
  /**
   * The flow's nodes, so the target column names each node as the rest of the
   * designer does (objectui#13200): by `flowNodeDisplayName`. A target naming
   * no node here reads as its id.
   */
  nodes?: ReadonlyArray<{ id: string; type?: unknown; label?: unknown }>;
}

/**
 * The target column of a problem row (objectui#13200): the node's name, or the
 * connection's `source → target` by its nodes' names — through the designer's
 * one naming rule. `title` keeps the ids, which stay apart where two nodes
 * share a label.
 */
function targetLabel(
  p: FlowProblem,
  nodes: ReadonlyArray<{ id: string; type?: unknown; label?: unknown }>,
  locale?: string,
): { text: string; title?: string } {
  if (p.target.kind === 'node') {
    const { nodeId } = p.target;
    const node = nodes.find((n) => n.id === nodeId);
    return { text: node ? flowNodeDisplayName(node, locale) : nodeId, title: nodeId };
  }
  if (p.target.kind === 'edge') {
    return {
      text: flowEdgeDisplayName(p.target, nodes, locale),
      title: `${p.target.source} → ${p.target.target}`,
    };
  }
  return { text: 'flow' };
}

export function ProblemsPanel({ problems, selectedKey, onSelectProblem, locale, runStatus, nodes = [] }: ProblemsPanelProps) {
  const errorCount = problems.filter((p) => p.level === 'error').length;
  const warningCount = problems.length - errorCount;
  const runNote = runStatus?.kind === 'not-running' ? describeFlowRunStatus(runStatus, locale) : null;

  return (
    <div className="flex h-full flex-col text-xs">
      <div className="flex items-center gap-2 border-b px-3 py-2 font-medium text-muted-foreground">
        <span>{tr('engine.flowProblems.title', locale)}</span>
        {errorCount > 0 && (
          <span className="inline-flex items-center gap-1 text-destructive">
            <AlertCircle className="h-3 w-3" /> {errorCount}
          </span>
        )}
        {warningCount > 0 && (
          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3 w-3" /> {warningCount}
          </span>
        )}
      </div>
      {runNote && (
        <div
          role="note"
          data-testid="flow-run-status-note"
          className="mx-1.5 mt-1.5 flex items-start gap-2 rounded-md border border-dashed px-2 py-1.5 text-muted-foreground"
        >
          <CircleSlash className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block leading-snug text-foreground">{runNote.label}</span>
            {runNote.title && <span className="mt-0.5 block text-[10px] leading-snug">{runNote.title}</span>}
          </span>
        </div>
      )}
      {problems.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 p-4 text-center text-muted-foreground">
          <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          <span>{tr('engine.flowProblems.empty', locale)}</span>
        </div>
      ) : (
        <ul className="flex-1 overflow-auto p-1.5">
          {problems.map((p) => {
            const isEdge = p.target.kind === 'edge';
            const isFlow = p.target.kind === 'flow';
            const key =
              p.target.kind === 'node'
                ? `node:${p.target.nodeId}`
                : p.target.kind === 'edge'
                  ? p.target.edgeKey
                  : null;
            const active = !!key && key === selectedKey;
            const Icon = p.level === 'error' ? AlertCircle : AlertTriangle;
            const TargetIcon = isEdge ? GitBranch : CircleDot;
            const target = targetLabel(p, nodes, locale);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={isFlow}
                  onClick={() => onSelectProblem(p)}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                    isFlow ? 'cursor-default' : 'cursor-pointer hover:bg-accent',
                    active && 'bg-accent ring-1 ring-primary/40',
                  )}
                >
                  <Icon
                    className={cn(
                      'mt-0.5 h-3.5 w-3.5 shrink-0',
                      p.level === 'error' ? 'text-destructive' : 'text-amber-500',
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block leading-snug text-foreground">{p.message}</span>
                    <span className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                      <TargetIcon className="h-2.5 w-2.5 shrink-0" />
                      <span className="truncate" title={target.title} data-testid="flow-problem-target">
                        {target.text}
                      </span>
                      {p.source === 'server' && <span className="uppercase tracking-wide">· {tr('engine.flowProblems.sourceSchema', locale)}</span>}
                      {p.source === 'expression' && <span className="uppercase tracking-wide">· {tr('engine.flowProblems.sourceExpression', locale)}</span>}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
