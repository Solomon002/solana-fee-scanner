import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const terms = ['zero fee', 'free withdrawal', 'no fee', 'zero withdrawal fee', 'Solana', 'USDT', 'USDC'];
const queries = ['zero withdrawal fee USDT Solana', 'free withdrawal USDC Solana', 'zero fee withdrawal Solana 2026', 'no fee USDT withdrawal Solana', 'free USDC withdrawal Solana'];

function Highlight({ text = '' }) {
  const pattern = new RegExp(`(${terms.join('|')})`, 'gi');
  return String(text).split(pattern).map((part, i) => terms.some((term) => term.toLowerCase() === part.toLowerCase())
    ? <mark key={i}>{part}</mark> : part);
}
function Icon({ name, size = 18 }) {
  const paths = {
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    refresh: <><path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M5.6 9a7 7 0 0 1 11.6-2L20 12M4 12l2.8 5a7 7 0 0 0 11.6-2"/></>,
    arrow: <><path d="M7 17 17 7M7 7h10v10"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    spark: <><path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z"/><path d="m19 14 1.2 2.8L23 18l-2.8 1.2L19 22l-1.2-2.8L15 18l2.8-1.2L19 14Z"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
function relativeDate(date) {
  if (!date || Number.isNaN(Date.parse(date))) return 'Date unavailable';
  const ms = Date.now() - Date.parse(date);
  const days = Math.floor(ms / 86400000);
  if (days < 0) return 'Recently';
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function App() {
  const [results, setResults] = useState([]);
  const [errors, setErrors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updated, setUpdated] = useState(null);
  const [source, setSource] = useState('All sources');
  const [keyword, setKeyword] = useState('');
  const [sort, setSort] = useState('newest');
  const [auto, setAuto] = useState(true);
  const [nextRefresh, setNextRefresh] = useState(30 * 60);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch('/api/search');
      if (!response.ok) throw new Error(`Search request failed (${response.status})`);
      const data = await response.json();
      setResults(data.results || []);
      setErrors(data.errors || []);
      setUpdated(data.checkedAt || new Date().toISOString());
      setNextRefresh(30 * 60);
    } catch (error) {
      setErrors([{ source: 'Connection', message: error.message }]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!auto) return undefined;
    const timer = window.setInterval(() => setNextRefresh((n) => {
      if (n <= 1) { refresh(true); return 30 * 60; }
      return n - 1;
    }), 1000);
    return () => window.clearInterval(timer);
  }, [auto, refresh]);

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return results.filter((item) => (source === 'All sources' || item.source === source)
      && (!q || `${item.title} ${item.snippet}`.toLowerCase().includes(q)))
      .sort((a, b) => sort === 'newest' ? (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0) : (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0));
  }, [results, source, keyword, sort]);

  const countdown = `${String(Math.floor(nextRefresh / 60)).padStart(2, '0')}:${String(nextRefresh % 60).padStart(2, '0')}`;
  return <div className="app-shell">
    <header className="topbar"><a className="brand" href="#"><span className="brand-mark"><span /></span><span>solana<span className="brand-light">signal</span></span></a><div className="top-status"><span className="live-dot" /> LIVE SCAN <span className="top-divider">/</span> PUBLIC WEB</div></header>
    <main className="container">
      <section className="hero">
        <div className="hero-copy"><div className="eyebrow"><span className="eyebrow-line" /> SOLANA WITHDRAWAL INTELLIGENCE</div><h1>Find the <em>free</em><br className="mobile-break"/> way out.</h1><p className="hero-sub">Tracking zero-fee USDT &amp; USDC withdrawals across the open web.</p>
          <div className="source-legend"><span><i className="source-icon reddit-icon">r</i> REDDIT</span><span><i className="source-icon google-icon">G</i> GOOGLE</span><span><i className="chain-icon">◎</i> SOLANA</span></div>
        </div>
        <div className="hero-orbit"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="orbit-core"><span>◎</span><small>SOL</small></div><div className="orbit-tag tag-one">USDT</div><div className="orbit-tag tag-two">USDC</div><div className="orbit-tag tag-three">0 FEE</div></div>
      </section>
      <section className="metrics" aria-label="Search summary">
        <div className="metric"><span className="metric-label">MATCHING RESULTS</span><strong>{loading && results.length === 0 ? '—' : filtered.length.toString().padStart(2, '0')}</strong><span className="metric-note"><span className="metric-dot"/> {results.length} indexed across sources</span></div>
        <div className="metric metric-updated"><span className="metric-label">LAST SCAN</span><strong className="updated-time">{updated ? new Date(updated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</strong><span className="metric-note"><Icon name="clock" size={14}/> {updated ? relativeDate(updated) : 'Waiting for scan'}</span></div>
        <button className={`refresh-button ${loading ? 'is-loading' : ''}`} onClick={() => refresh()} disabled={loading}><Icon name="refresh" size={16}/><span>{loading ? 'SCANNING' : 'REFRESH NOW'}</span></button>
      </section>
      <section className="toolbar" aria-label="Filter results">
        <div className="toolbar-left"><span className="filter-label">FILTER BY</span><div className="segmented">{['All sources', 'Reddit', 'Google'].map((item) => <button key={item} className={source === item ? 'selected' : ''} onClick={() => setSource(item)}>{item}</button>)}</div></div>
        <label className="keyword-search"><Icon name="search" size={17}/><input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Search keywords..." aria-label="Search keywords"/>{keyword && <button className="clear-search" onClick={() => setKeyword('')} aria-label="Clear search">×</button>}</label>
        <label className="sort-select"><span>SORT</span><select value={sort} onChange={(e) => setSort(e.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
      </section>
      <section className="results-section">
        <div className="section-heading"><div><span className="section-kicker">THE SIGNAL FEED</span><h2>Latest mentions <span className="heading-count">({filtered.length})</span></h2></div><div className="auto-refresh"><span className="auto-dot"/><span>AUTO-REFRESH <b>{auto ? `IN ${countdown}` : 'PAUSED'}</b></span><button onClick={() => { setAuto(!auto); if (!auto) setNextRefresh(30 * 60); }} aria-label={auto ? 'Pause auto refresh' : 'Resume auto refresh'} className={`toggle ${auto ? 'on' : ''}`}><span/></button></div></div>
        {errors.length > 0 && <div className="error-banner"><span className="error-mark">!</span><div><strong>{errors.some((e) => e.source === 'Reddit' || e.source === 'Google') ? 'Some sources could not be reached' : 'Could not load results'}</strong><p>{errors.map((e) => `${e.source}: ${e.message}`).join(' · ')}</p></div></div>}
        {loading && results.length === 0 ? <div className="loading-state"><span className="spinner"/><span>Scanning Reddit and Google<span className="loading-dots">...</span></span><small>This can take a few seconds</small></div>
          : filtered.length === 0 ? <div className="empty-state"><span className="empty-icon"><Icon name="search" size={22}/></span><strong>{results.length ? 'No results match your filters' : 'No mentions found yet'}</strong><p>{results.length ? 'Try another keyword or source.' : 'Run a refresh in a moment, or check your API configuration.'}</p>{keyword && <button onClick={() => { setKeyword(''); setSource('All sources'); }}>Clear filters</button>}</div>
          : <div className="cards">{filtered.map((item) => <article className="result-card" key={item.id}><div className="card-top"><span className={`source-badge ${item.source.toLowerCase()}`}><i>{item.source === 'Reddit' ? 'r' : 'G'}</i>{item.source}</span><span className="result-date"><Icon name="clock" size={13}/>{relativeDate(item.date)}</span></div><h3><Highlight text={item.title}/></h3><p className="snippet"><Highlight text={item.snippet}/></p><div className="card-bottom"><span className="result-domain">{item.source === 'Reddit' ? 'reddit.com' : (() => { try { return new URL(item.url).hostname.replace(/^www\./, ''); } catch { return 'web result'; } })()}</span><a href={item.url} target="_blank" rel="noreferrer" className="view-link">VIEW POST <Icon name="arrow" size={14}/></a></div></article>)}</div>}
      </section>
      <section className="query-strip"><div className="query-title"><span className="query-icon"><Icon name="spark" size={16}/></span><div><strong>ACTIVE SEARCH QUERIES</strong><small>Searching for fee-free stablecoin withdrawals</small></div></div><div className="query-list">{queries.map((q) => <span key={q}>{q}</span>)}</div></section>
      <footer><span>© 2026 SOLANA SIGNAL</span><span>PUBLIC DATA · UPDATED EVERY 30 MIN</span><span>BUILT FOR THE ON-CHAIN CURIOUS <b>◎</b></span></footer>
    </main>
  </div>;
}

createRoot(document.getElementById('root')).render(<App/>);


