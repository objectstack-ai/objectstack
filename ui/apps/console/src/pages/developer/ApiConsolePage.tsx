/**
 * API Console — REST endpoint debugger with auto-discovery.
 *
 * Console is not project-scoped, so there is no projectId prop, no scope
 * toggle (Project API / System API), and no `Server`/`FolderOpen` icons. The
 * discovery hook is the console-local copy under `./hooks/useApiDiscovery`.
 * UI primitives come from `@object-ui/components`.
 *
 * ## Request preset (objectui#10591)
 *
 * The page opens with a request pre-filled when its URL carries one:
 * `?path=/api/v1/…` fills the URL field and `?method=POST` (any verb the
 * method selector offers, in any case) picks the method. The tool preview's
 * "Open in API Console" link is the producer; it builds exactly this pair.
 *
 * - Read ONCE, on mount, from the router's query string — so it works on both
 *   mounts, the standalone `developer/api-console` route and the
 *   `developer:api-console` registry key. A later change to the query does not
 *   overwrite what the user has typed since.
 * - Pre-fill only: nothing is sent until the user presses Send.
 * - `path` is honoured only when it is a same-origin API path, i.e. it starts
 *   with `/api/`. Anything else (an absolute `http://…` URL, a
 *   protocol-relative `//host`, a bare word, an empty value) is ignored, so a
 *   crafted link cannot aim the request editor at another origin.
 * - `method` rides with `path`: it is read only when `path` is honoured, and a
 *   verb the selector does not offer is ignored.
 * - With no honoured `path` the page opens exactly as it does without a query.
 */

import { useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAdapter } from '@object-ui/app-shell';
import {
  Badge,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@object-ui/components';
import {
  Globe, Play, Copy, Check, ChevronDown, ChevronRight, Clock,
  Loader2, Search, RefreshCw, Trash2, Plus, X,
} from 'lucide-react';
import { useApiDiscovery, type EndpointDef, type HttpMethod } from './hooks/useApiDiscovery';

const METHOD_COLORS: Record<string, string> = {
  GET:    'text-emerald-600 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-950/50',
  POST:   'text-blue-600 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-950/50',
  PATCH:  'text-amber-600 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-950/50',
  PUT:    'text-amber-600 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-950/50',
  DELETE: 'text-red-600 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-950/50',
};

const STATUS_COLORS: Record<string, string> = {
  '2': 'text-emerald-600 dark:text-emerald-400',
  '3': 'text-blue-600 dark:text-blue-400',
  '4': 'text-amber-600 dark:text-amber-400',
  '5': 'text-red-600 dark:text-red-400',
};

const QUERY_PARAM_PRESETS = [
  { key: '$top', placeholder: '10', hint: 'limit' },
  { key: '$skip', placeholder: '0', hint: 'offset' },
  { key: '$sort', placeholder: 'name', hint: 'sort field' },
  { key: '$select', placeholder: 'name,email', hint: 'fields' },
  { key: '$count', placeholder: 'true', hint: 'total count' },
  { key: '$filter', placeholder: "status eq 'active'", hint: 'OData filter' },
];

interface QueryParam {
  id: number;
  key: string;
  value: string;
  enabled: boolean;
}

interface RequestHistoryEntry {
  id: number;
  method: HttpMethod;
  url: string;
  body?: string;
  status: number;
  duration: number;
  response: string;
  timestamp: Date;
}

let nextParamId = 1;

/** The verbs the method selector offers, in its order — the selector renders this list. */
const REQUEST_METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'];

/** The request preset a link can carry — see "Request preset" in the header. */
function readRequestPreset(search: URLSearchParams): { path: string; method: HttpMethod | '' } | null {
  const path = search.get('path');
  if (!path || !path.startsWith('/api/')) return null;
  const method = search.get('method')?.toUpperCase();
  return { path, method: REQUEST_METHODS.find((m) => m === method) ?? '' };
}

/** The item a held method none of the selector's verbs carries is shown by. */
const OUTSIDE_OPTIONS = 'outside';

/**
 * objectui#11865 — the method selector, drawn with the shared `Select` the rest
 * of the console picks with. It used to be a browser-native `<select>`. What a
 * pick writes is unchanged: `onPick` receives the picked verb, the string the
 * native control's `change` carried, and the page sends with it as before.
 *
 * - Items carry their option's INDEX, not its value, as every picker on
 *   objectui#11865 does, and a held method none of {@link REQUEST_METHODS}
 *   carries gets an item of its own, labelled with the method, so the trigger
 *   shows what Send would use. Every source of the method is typed
 *   `HttpMethod`, so that item is the pattern's guard, not a path this page
 *   takes today.
 * - The trigger keeps the native control's verb colours ({@link METHOD_COLORS}).
 */
function MethodPicker({
  value,
  onPick,
}: {
  value: HttpMethod;
  onPick: (method: HttpMethod) => void;
}) {
  const at = REQUEST_METHODS.indexOf(value);
  return (
    <Select
      value={at !== -1 ? String(at) : OUTSIDE_OPTIONS}
      onValueChange={(token) => {
        // `undefined` for the outside item: it is the held method, so there is nothing to write.
        const picked = REQUEST_METHODS[Number(token)];
        if (picked) onPick(picked);
      }}
    >
      <SelectTrigger
        className={`h-auto w-auto gap-1.5 px-2 py-1.5 font-mono text-xs font-semibold focus:ring-1 focus:ring-offset-0 ${METHOD_COLORS[value] || ''}`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {at === -1 && <SelectItem value={OUTSIDE_OPTIONS}>{value}</SelectItem>}
        {REQUEST_METHODS.map((m, i) => (
          <SelectItem key={m} value={String(i)} className="font-mono text-xs">
            {m}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ApiConsolePage() {
  const adapter = useAdapter();
  const client: any = adapter?.getClient?.();
  const { groups, loading: discovering, refresh } = useApiDiscovery();
  const [searchParams] = useSearchParams();
  // Lazy initialiser: runs on the first render only, which is the "once, on
  // mount" the preset promises.
  const [preset] = useState(() => readRequestPreset(searchParams));

  const [searchQuery, setSearchQuery] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedEndpoint, setSelectedEndpoint] = useState<EndpointDef | null>(null);
  const [methodOverride, setMethodOverride] = useState<HttpMethod | ''>(preset?.method ?? '');
  const [urlOverride, setUrlOverride] = useState(preset?.path ?? '');
  const [requestBody, setRequestBody] = useState('');
  const [queryParams, setQueryParams] = useState<QueryParam[]>([]);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<{ status: number; body: string; duration: number } | null>(null);
  const [history, setHistory] = useState<RequestHistoryEntry[]>([]);
  const [expandedHistory, setExpandedHistory] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const filteredGroups = useMemo(() => {
    if (!searchQuery) return groups;
    const q = searchQuery.toLowerCase();
    return groups
      .map(g => ({
        ...g,
        endpoints: g.endpoints.filter(ep =>
          ep.desc.toLowerCase().includes(q) ||
          ep.path.toLowerCase().includes(q) ||
          ep.method.toLowerCase().includes(q)
        ),
      }))
      .filter(g => g.endpoints.length > 0);
  }, [groups, searchQuery]);

  const toggleGroup = useCallback((key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const selectEndpoint = useCallback((ep: EndpointDef) => {
    setSelectedEndpoint(ep);
    setMethodOverride(ep.method);
    setUrlOverride(ep.path);
    setRequestBody(ep.bodyTemplate ? JSON.stringify(ep.bodyTemplate, null, 2) : '');
    setQueryParams([]);
    setResponse(null);
  }, []);

  const effectiveMethod = (methodOverride || selectedEndpoint?.method || 'GET') as HttpMethod;
  const basePath = urlOverride || selectedEndpoint?.path || '';

  const effectiveUrl = useMemo(() => {
    const enabledParams = queryParams.filter(p => p.enabled && p.key.trim());
    if (enabledParams.length === 0) return basePath;
    const qs = enabledParams.map(p => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join('&');
    return `${basePath}?${qs}`;
  }, [basePath, queryParams]);

  const addQueryParam = useCallback((key = '', value = '') => {
    setQueryParams(prev => [...prev, { id: nextParamId++, key, value, enabled: true }]);
  }, []);

  const removeQueryParam = useCallback((id: number) => {
    setQueryParams(prev => prev.filter(p => p.id !== id));
  }, []);

  const updateQueryParam = useCallback((id: number, field: 'key' | 'value', val: string) => {
    setQueryParams(prev => prev.map(p => p.id === id ? { ...p, [field]: val } : p));
  }, []);

  const toggleQueryParam = useCallback((id: number) => {
    setQueryParams(prev => prev.map(p => p.id === id ? { ...p, enabled: !p.enabled } : p));
  }, []);

  const sendRequest = useCallback(async () => {
    if (loading || !effectiveUrl) return;

    const baseUrl = client?.baseUrl ?? '';
    const fullUrl = `${baseUrl}${effectiveUrl}`;

    setLoading(true);
    const start = performance.now();

    try {
      const fetchOptions: RequestInit = {
        method: effectiveMethod,
        headers: { 'Content-Type': 'application/json' },
      };

      if (['POST', 'PATCH', 'PUT'].includes(effectiveMethod) && requestBody.trim()) {
        fetchOptions.body = requestBody;
      }

      const res = await fetch(fullUrl, fetchOptions);
      const duration = Math.round(performance.now() - start);

      let bodyText: string;
      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('json')) {
        const json = await res.json();
        bodyText = JSON.stringify(json, null, 2);
      } else {
        bodyText = await res.text();
      }

      const result = { status: res.status, body: bodyText, duration };
      setResponse(result);

      setHistory(prev => [{
        id: Date.now(),
        method: effectiveMethod,
        url: effectiveUrl,
        body: requestBody || undefined,
        status: res.status,
        duration,
        response: bodyText,
        timestamp: new Date(),
      }, ...prev].slice(0, 50));
    } catch (err: any) {
      const duration = Math.round(performance.now() - start);
      setResponse({
        status: 0,
        body: `Network Error: ${err.message}`,
        duration,
      });
    } finally {
      setLoading(false);
    }
  }, [client, effectiveUrl, effectiveMethod, requestBody, loading]);

  const replayHistoryEntry = useCallback((entry: RequestHistoryEntry) => {
    setMethodOverride(entry.method);
    const [path, qs] = entry.url.split('?');
    setUrlOverride(path);
    setRequestBody(entry.body || '');
    if (qs) {
      const params = new URLSearchParams(qs);
      const restored: QueryParam[] = [];
      params.forEach((value, key) => {
        restored.push({ id: nextParamId++, key, value, enabled: true });
      });
      setQueryParams(restored);
    } else {
      setQueryParams([]);
    }
    setResponse(null);
    setSelectedEndpoint(null);
  }, []);

  const copyResponse = useCallback(() => {
    if (response?.body) {
      navigator.clipboard.writeText(response.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [response]);

  const statusColor = (status: number) => STATUS_COLORS[String(status)[0]] ?? 'text-muted-foreground';

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">

      <div className="w-72 shrink-0 border-r flex flex-col overflow-hidden">
        <div className="p-3 border-b space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground flex-1">API Endpoints</h3>
            <button type="button"
              onClick={refresh}
              disabled={discovering}
              className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              title="Refresh endpoints"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${discovering ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search endpoints..."
              className="w-full rounded-md border bg-background pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto p-2 space-y-1">
          {discovering ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Discovering APIs...
            </div>
          ) : filteredGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground text-sm">
              <Globe className="h-6 w-6 opacity-30 mb-2" />
              <span>{searchQuery ? 'No matching endpoints' : 'No endpoints found'}</span>
            </div>
          ) : (
            filteredGroups.map(group => {
              const isExpanded = expandedGroups.has(group.key) || !!searchQuery;
              return (
                <Collapsible key={group.key} open={isExpanded} onOpenChange={() => toggleGroup(group.key)}>
                  <CollapsibleTrigger asChild>
                    <button type="button" className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors">
                      <ChevronRight className={`h-3 w-3 shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                      <span className="flex-1 text-left truncate">{group.label}</span>
                      <span className="shrink-0 text-[10px] tabular-nums opacity-60">{group.endpoints.length}</span>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="ml-3 space-y-0.5 mt-0.5">
                      {group.endpoints.map((ep, i) => {
                        const isActive = selectedEndpoint === ep;
                        return (
                          <button type="button"
                            key={`${ep.method}-${ep.path}-${i}`}
                            onClick={() => selectEndpoint(ep)}
                            className={`w-full text-left flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
                              isActive
                                ? 'bg-accent text-accent-foreground'
                                : 'hover:bg-muted/50 text-muted-foreground hover:text-foreground'
                            }`}
                          >
                            <Badge variant="outline" className={`font-mono text-[9px] shrink-0 px-1 py-0 ${METHOD_COLORS[ep.method] || ''}`}>
                              {ep.method}
                            </Badge>
                            <span className="truncate">{ep.desc}</span>
                          </button>
                        );
                      })}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })
          )}
        </div>

        <div className="p-3 border-t space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Query Parameters</h4>
            <button type="button"
              onClick={() => addQueryParam()}
              className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <Plus className="h-3 w-3" />
              Add
            </button>
          </div>

          <div className="flex flex-wrap gap-1">
            {QUERY_PARAM_PRESETS.map(preset => (
              <button type="button"
                key={preset.key}
                onClick={() => addQueryParam(preset.key, '')}
                className="text-[10px] px-1.5 py-0.5 rounded border bg-muted/30 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors font-mono"
                title={preset.hint}
              >
                {preset.key}
              </button>
            ))}
          </div>

          {queryParams.length > 0 && (
            <div className="space-y-1">
              {queryParams.map(param => (
                <div key={param.id} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={param.enabled}
                    onChange={() => toggleQueryParam(param.id)}
                    className="h-3 w-3 shrink-0 rounded border accent-primary"
                  />
                  <input
                    type="text"
                    value={param.key}
                    onChange={e => updateQueryParam(param.id, 'key', e.target.value)}
                    placeholder="key"
                    className="flex-1 min-w-0 rounded border bg-background px-1.5 py-0.5 text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <input
                    type="text"
                    value={param.value}
                    onChange={e => updateQueryParam(param.id, 'value', e.target.value)}
                    placeholder="value"
                    className="flex-1 min-w-0 rounded border bg-background px-1.5 py-0.5 text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <button type="button"
                    onClick={() => removeQueryParam(param.id)}
                    className="shrink-0 p-0.5 rounded text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="p-3 border-b space-y-1">
          <div className="flex items-center gap-2">
            <MethodPicker value={effectiveMethod} onPick={setMethodOverride} />
            <input
              type="text"
              value={basePath}
              onChange={e => setUrlOverride(e.target.value)}
              className="flex-1 rounded-md border bg-background px-3 py-1.5 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="/api/v1/..."
              onKeyDown={e => { if (e.key === 'Enter') sendRequest(); }}
            />
            <button type="button"
              onClick={sendRequest}
              disabled={loading || !effectiveUrl}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Send
            </button>
          </div>
          {queryParams.some(p => p.enabled && p.key.trim()) && (
            <div className="text-[10px] font-mono text-muted-foreground truncate pl-1">
              → {effectiveUrl}
            </div>
          )}
        </div>

        <div className="flex-1 flex flex-col min-h-0 overflow-auto">
          {['POST', 'PATCH', 'PUT'].includes(effectiveMethod) && (
            <div className="p-3 border-b space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Request Body (JSON)</label>
              <textarea
                value={requestBody}
                onChange={e => setRequestBody(e.target.value)}
                rows={5}
                className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring resize-y"
                placeholder='{ "key": "value" }'
              />
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Sending request...
            </div>
          )}

          {response && !loading && (
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b">
                <div className="flex items-center gap-3 text-sm">
                  <span className={`font-mono font-semibold ${statusColor(response.status)}`}>
                    {response.status || 'ERR'}
                  </span>
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {response.duration}ms
                  </span>
                </div>
                <button type="button"
                  onClick={copyResponse}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre className="flex-1 overflow-auto p-3 text-xs font-mono bg-muted/10 whitespace-pre-wrap break-all">
                {response.body}
              </pre>
            </div>
          )}

          {!response && !loading && (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              <div className="text-center space-y-2">
                <Globe className="h-10 w-10 mx-auto opacity-20" />
                <p>Select an endpoint or type a URL and click <strong>Send</strong></p>
                <p className="text-xs opacity-60">All registered APIs are auto-discovered from the platform</p>
              </div>
            </div>
          )}

          {history.length > 0 && (
            <div className="border-t">
              <div className="flex items-center justify-between px-3 py-2">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  History ({history.length})
                </h4>
                <button type="button"
                  onClick={() => setHistory([])}
                  className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Trash2 className="h-3 w-3" />
                  Clear
                </button>
              </div>
              <div className="space-y-0.5 px-2 pb-2 max-h-60 overflow-auto">
                {history.map(entry => (
                  <div key={entry.id} className="rounded border">
                    <button type="button"
                      onClick={() => setExpandedHistory(expandedHistory === entry.id ? null : entry.id)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-muted/30 transition-colors"
                    >
                      {expandedHistory === entry.id
                        ? <ChevronDown className="h-3 w-3 shrink-0" />
                        : <ChevronRight className="h-3 w-3 shrink-0" />
                      }
                      <Badge variant="outline" className={`font-mono text-[9px] shrink-0 ${METHOD_COLORS[entry.method] || ''}`}>
                        {entry.method}
                      </Badge>
                      <span className="font-mono truncate text-left flex-1">{entry.url}</span>
                      <span className={`ml-auto shrink-0 font-mono ${statusColor(entry.status)}`}>
                        {entry.status}
                      </span>
                      <span className="shrink-0 text-muted-foreground">{entry.duration}ms</span>
                      <button type="button"
                        onClick={e => { e.stopPropagation(); replayHistoryEntry(entry); }}
                        className="shrink-0 p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                        title="Replay request"
                      >
                        <Play className="h-2.5 w-2.5" />
                      </button>
                    </button>
                    {expandedHistory === entry.id && (
                      <pre className="px-3 py-2 text-xs font-mono bg-muted/10 border-t overflow-auto max-h-40 whitespace-pre-wrap break-all">
                        {entry.response}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
