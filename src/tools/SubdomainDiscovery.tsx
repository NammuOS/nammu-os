'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ClipboardCopy,
  Clock3,
  Download,
  ExternalLink,
  FileJson,
  FileText,
  Filter,
  Globe2,
  Layers3,
  LoaderCircle,
  Radar,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import styles from './SubdomainDiscovery.module.css';
import { getPlatformCapabilities } from '../platform';

type SubdomainEntry = {
  name: string;
  firstSeen: string | null;
  depth: number;
  wildcard: boolean;
};

type DiscoveryResponse = {
  domain: string;
  results: SubdomainEntry[];
  stats: {
    total: number;
    dated: number;
    wildcard: number;
    maxDepth: number;
    elapsedMs: number;
  };
  truncated: boolean;
  error?: string;
};

type ResultScope = 'all' | 'dated' | 'undated' | 'wildcard';
type SortMode = 'name' | 'newest' | 'oldest';
type ExportFormat = 'txt' | 'csv' | 'json';

const PAGE_SIZE = 250;
const HISTORY_KEY = 'nammu-subdomain-history';

const normalizeDomainInput = (input: string) => {
  const value = input.trim().toLowerCase();
  if (!value) throw new Error('Enter a website domain to begin.');
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    let hostname = url.hostname.replace(/^\*\./, '').replace(/\.$/, '');
    if (hostname.startsWith('www.')) hostname = hostname.slice(4);
    if (!hostname.includes('.') || hostname.length > 253) throw new Error();
    return hostname;
  } catch {
    throw new Error('Enter a valid website, such as example.com.');
  }
};

const formatDate = (value: string | null) => {
  if (!value) return 'Not recorded';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(new Date(value));
};

const escapeCsv = (value: string | number | boolean | null) =>
  `"${String(value ?? '').replaceAll('"', '""')}"`;

export default function SubdomainDiscovery() {
  const [input, setInput] = useState('');
  const [data, setData] = useState<DiscoveryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [scope, setScope] = useState<ResultScope>('all');
  const [sort, setSort] = useState<SortMode>('name');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [copied, setCopied] = useState('');
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') as unknown;
      if (Array.isArray(saved)) {
        setHistory(saved.filter((item): item is string => typeof item === 'string').slice(0, 5));
      }
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => setVisibleCount(PAGE_SIZE), [filter, scope, sort]);

  const results = useMemo(() => {
    if (!data) return [];
    const query = filter.trim().toLowerCase();
    const filtered = data.results.filter((item) => {
      if (query && !item.name.includes(query)) return false;
      if (scope === 'dated' && !item.firstSeen) return false;
      if (scope === 'undated' && item.firstSeen) return false;
      if (scope === 'wildcard' && !item.wildcard) return false;
      return true;
    });

    return filtered.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (!a.firstSeen && !b.firstSeen) return a.name.localeCompare(b.name);
      if (!a.firstSeen) return 1;
      if (!b.firstSeen) return -1;
      const aTime = Date.parse(a.firstSeen);
      const bTime = Date.parse(b.firstSeen);
      return sort === 'oldest' ? aTime - bTime : bTime - aTime;
    });
  }, [data, filter, scope, sort]);

  const saveHistory = (domain: string) => {
    const next = [domain, ...history.filter((item) => item !== domain)].slice(0, 5);
    setHistory(next);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  };

  const searchDomain = async (domainInput: string) => {
    let domain: string;
    try {
      domain = normalizeDomainInput(domainInput);
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : 'Invalid domain.');
      return;
    }

    setInput(domain);
    setLoading(true);
    setError('');
    setFilter('');
    setScope('all');
    setVisibleCount(PAGE_SIZE);
    try {
      const response = await getPlatformCapabilities().services.request(
        `/api/tools/subdomains?domain=${encodeURIComponent(domain)}`,
        { cache: 'no-store' },
      );
      const payload = (await response.json()) as DiscoveryResponse;
      if (!response.ok) throw new Error(payload.error || 'Subdomain discovery failed.');
      setData(payload);
      saveHistory(payload.domain);
    } catch (searchError) {
      setData(null);
      setError(searchError instanceof Error ? searchError.message : 'Subdomain discovery failed.');
    } finally {
      setLoading(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!loading) void searchDomain(input);
  };

  const copyText = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied(''), 1400);
    } catch {
      setError('Clipboard access is unavailable.');
    }
  };

  const exportResults = (format: ExportFormat) => {
    if (!data || results.length === 0) return;
    let content: string;
    let mime: string;
    if (format === 'json') {
      content = JSON.stringify(
        { domain: data.domain, exportedAt: new Date().toISOString(), results },
        null,
        2,
      );
      mime = 'application/json';
    } else if (format === 'csv') {
      content = [
        ['subdomain', 'first_seen', 'depth', 'wildcard'].map(escapeCsv).join(','),
        ...results.map((item) =>
          [item.name, item.firstSeen, item.depth, item.wildcard].map(escapeCsv).join(','),
        ),
      ].join('\n');
      mime = 'text/csv';
    } else {
      content = results.map((item) => item.name).join('\n');
      mime = 'text/plain';
    }

    const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${data.domain}-subdomains.${format}`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const clear = () => {
    setInput('');
    setData(null);
    setError('');
    setFilter('');
    setScope('all');
  };

  const visibleResults = results.slice(0, visibleCount);

  return (
    <div className={`${styles.tool} tool-workspace`}>
      <header className={styles.header}>
        <div className={styles.identity}>
          <span className={styles.iconBox}>
            <Radar size={19} strokeWidth={1.5} />
          </span>
          <div>
            <div className={styles.eyebrow}>Network intelligence · Passive CT</div>
            <h1>Subdomain Inspector</h1>
            <p>Map public hostnames observed in certificate transparency indexes.</p>
          </div>
        </div>
        <div className={styles.sourceBadge} title="Public certificate transparency data">
          <ShieldCheck size={12} /> crt.name
        </div>
      </header>

      <section className={styles.queryPanel} aria-label="Domain search">
        <form className={styles.queryForm} onSubmit={submit}>
          <div className={styles.domainInput}>
            <Globe2 size={15} aria-hidden="true" />
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="example.com or https://www.example.com"
              aria-label="Website domain"
              autoComplete="url"
              autoCapitalize="none"
              spellCheck={false}
              disabled={loading}
            />
            {input && !loading && (
              <button type="button" onClick={clear} aria-label="Clear domain">
                <X size={14} />
              </button>
            )}
          </div>
          <button className={styles.scanButton} type="submit" disabled={loading || !input.trim()}>
            {loading ? <LoaderCircle className={styles.spinner} size={15} /> : <Search size={15} />}
            {loading ? 'Searching index' : 'Discover'}
          </button>
        </form>

        {history.length > 0 && (
          <div className={styles.history}>
            <Clock3 size={11} />
            <span>Recent</span>
            {history.map((domain) => (
              <button key={domain} type="button" onClick={() => void searchDomain(domain)}>
                {domain}
              </button>
            ))}
          </div>
        )}
      </section>

      {error && (
        <div className={styles.error} role="alert">
          <AlertTriangle size={15} />
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} aria-label="Dismiss error">
            <X size={13} />
          </button>
        </div>
      )}

      {!data && !loading && !error && (
        <section className={styles.emptyState}>
          <div className={styles.radarGraphic} aria-hidden="true">
            <Radar size={38} strokeWidth={1} />
          </div>
          <h2>Discover the public surface</h2>
          <p>
            Enter an apex domain. Nammu OS will normalize the URL, query the certificate index,
            remove duplicates, and organize every public hostname it finds.
          </p>
          <div className={styles.capabilities}>
            <span>
              <Sparkles size={12} /> First-seen history
            </span>
            <span>
              <Filter size={12} /> Search and filters
            </span>
            <span>
              <Download size={12} /> TXT · CSV · JSON
            </span>
          </div>
        </section>
      )}

      {loading && (
        <section className={styles.loadingState} aria-live="polite">
          <div className={styles.scanLine} />
          <Radar className={styles.pulse} size={30} />
          <strong>Reading certificate transparency records</strong>
          <span>Large domains may contain thousands of historical hostnames.</span>
        </section>
      )}

      {data && !loading && (
        <div className={styles.resultsWorkspace}>
          <section className={styles.metrics} aria-label="Discovery summary">
            <div>
              <span>Total found</span>
              <strong>{data.stats.total.toLocaleString()}</strong>
            </div>
            <div>
              <span>With dates</span>
              <strong>{data.stats.dated.toLocaleString()}</strong>
            </div>
            <div>
              <span>Wildcard</span>
              <strong>{data.stats.wildcard.toLocaleString()}</strong>
            </div>
            <div>
              <span>Max depth</span>
              <strong>{data.stats.maxDepth}</strong>
            </div>
            <div>
              <span>Index time</span>
              <strong>{data.stats.elapsedMs.toLocaleString()} ms</strong>
            </div>
          </section>

          <section className={styles.controlBar} aria-label="Result controls">
            <div className={styles.filterInput}>
              <Search size={13} />
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter hostnames"
                aria-label="Filter subdomains"
              />
              {filter && (
                <button type="button" onClick={() => setFilter('')} aria-label="Clear filter">
                  <X size={12} />
                </button>
              )}
            </div>

            <div className={styles.scopeTabs} aria-label="Result scope">
              {(['all', 'dated', 'undated', 'wildcard'] as ResultScope[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={scope === item ? styles.activeTab : undefined}
                  onClick={() => setScope(item)}
                >
                  {item}
                </button>
              ))}
            </div>

            <label className={styles.sortSelect}>
              <span>Sort</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as SortMode)}>
                <option value="name">A–Z</option>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
              <ChevronDown size={12} />
            </label>
          </section>

          <section className={styles.resultPanel}>
            <div className={styles.resultHeader}>
              <div>
                <span className={styles.liveDot} />
                <strong>{data.domain}</strong>
                <span>{results.length.toLocaleString()} visible</span>
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  disabled={results.length === 0}
                  onClick={() => void copyText(results.map((item) => item.name).join('\n'), 'all')}
                >
                  {copied === 'all' ? <Check size={12} /> : <ClipboardCopy size={12} />}
                  {copied === 'all' ? 'Copied' : 'Copy'}
                </button>
                <button type="button" onClick={() => exportResults('txt')}>
                  <FileText size={12} /> TXT
                </button>
                <button type="button" onClick={() => exportResults('csv')}>
                  <Download size={12} /> CSV
                </button>
                <button type="button" onClick={() => exportResults('json')}>
                  <FileJson size={12} /> JSON
                </button>
              </div>
            </div>

            <div className={styles.tableHeader} aria-hidden="true">
              <span>#</span>
              <span>Hostname</span>
              <span>Depth</span>
              <span>First seen</span>
              <span>Actions</span>
            </div>

            <div className={`${styles.resultList} os-scrollbar`}>
              {visibleResults.length ? (
                visibleResults.map((item, index) => (
                  <div className={styles.resultRow} key={item.name}>
                    <span className={styles.rowNumber}>{String(index + 1).padStart(2, '0')}</span>
                    <div className={styles.hostname} title={item.name}>
                      <Globe2 size={12} />
                      <span>{item.name}</span>
                      {item.wildcard && <em>Wildcard</em>}
                    </div>
                    <span className={styles.depthBadge} title={`${item.depth} level(s) below apex`}>
                      <Layers3 size={10} /> L{item.depth}
                    </span>
                    <time dateTime={item.firstSeen ?? undefined}>{formatDate(item.firstSeen)}</time>
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        onClick={() => void copyText(item.name, item.name)}
                        aria-label={`Copy ${item.name}`}
                        title="Copy hostname"
                      >
                        {copied === item.name ? <Check size={12} /> : <ClipboardCopy size={12} />}
                      </button>
                      <a
                        href={`https://${item.name}`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open ${item.name}`}
                        title="Open website"
                      >
                        <ExternalLink size={12} />
                      </a>
                    </div>
                  </div>
                ))
              ) : (
                <div className={styles.noResults}>
                  <Search size={20} />
                  <span>No hostnames match the current filter.</span>
                </div>
              )}
            </div>

            {visibleCount < results.length && (
              <button
                className={styles.loadMore}
                type="button"
                onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
              >
                Show next {Math.min(PAGE_SIZE, results.length - visibleCount).toLocaleString()} ·{' '}
                {(results.length - visibleCount).toLocaleString()} remaining
              </button>
            )}
          </section>

          <footer className={styles.notice}>
            <AlertTriangle size={12} />
            <span>
              Passive public records only. A listed hostname may be historical or offline. Assess
              only domains you own or are authorized to test.
            </span>
            {data.truncated && <strong>Result set capped at 50,000 entries.</strong>}
          </footer>
        </div>
      )}
    </div>
  );
}
