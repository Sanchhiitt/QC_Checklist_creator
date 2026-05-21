import React, { useEffect, useMemo, useState } from 'react';
import {
    fetchQCStates,
    fetchQCSection,
    fetchQCStateTrend,
} from '../api';

// ─── Status helpers ───────────────────────────────────────────────────────
const classifyStatus = (raw) => {
    const s = (raw || '').toString().trim().toLowerCase();
    if (['consistent', 'pass'].includes(s)) return 'pass';
    if (['inconsistent', 'fail', 'missing_data', 'missing data'].includes(s)) return 'fail';
    if (['warning', 'warn'].includes(s)) return 'warning';
    if (['not applicable', 'not_applicable', 'na', 'n/a'].includes(s)) return 'na';
    return 'unknown';
};

const STATUS_STYLE = {
    pass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    fail: 'bg-rose-50 text-rose-700 border-rose-200',
    warning: 'bg-amber-50 text-amber-700 border-amber-200',
    na: 'bg-slate-50 text-slate-500 border-slate-200',
    unknown: 'bg-slate-50 text-slate-500 border-slate-200',
};

const StatusBadge = ({ status }) => {
    const cls = classifyStatus(status);
    return (
        <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-bold uppercase border ${STATUS_STYLE[cls]}`}>
            {status || '—'}
        </span>
    );
};

// ─── Small UI primitives ──────────────────────────────────────────────────
const StatCard = ({ label, value, hint, accent = 'blue' }) => {
    const accents = {
        blue: 'text-blue-600 bg-blue-50 border-blue-100',
        amber: 'text-amber-700 bg-amber-50 border-amber-100',
        emerald: 'text-emerald-700 bg-emerald-50 border-emerald-100',
        rose: 'text-rose-700 bg-rose-50 border-rose-100',
        slate: 'text-slate-700 bg-slate-50 border-slate-100',
        violet: 'text-violet-700 bg-violet-50 border-violet-100',
    };
    return (
        <div className={`p-4 rounded-2xl border ${accents[accent]} shadow-sm`}>
            <div className="text-[10px] font-bold uppercase tracking-wider opacity-80">{label}</div>
            <div className="mt-1 text-2xl font-bold">{value}</div>
            {hint && <div className="mt-0.5 text-[11px] opacity-70">{hint}</div>}
        </div>
    );
};

const PassRateBar = ({ rate }) => {
    const pct = Math.max(0, Math.min(100, Number(rate) || 0));
    const color = pct >= 80 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-rose-500';
    return (
        <div className="flex items-center gap-2 min-w-[90px]">
            <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[11px] font-bold text-slate-600 tabular-nums">{pct.toFixed(0)}%</span>
        </div>
    );
};

const formatDate = (iso) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
};

// Per-check accuracy. A run with no human feedback counts as 100%; a run a
// human changed (challenged) counts against it.
const AccuracyCell = ({ accuracy, reviewed }) => {
    if (accuracy == null) {
        return <span className="text-slate-300">—</span>;
    }
    const color = accuracy >= 80 ? 'text-emerald-700' : accuracy >= 50 ? 'text-amber-700' : 'text-rose-700';
    const title = reviewed > 0
        ? `Human gave feedback on ${reviewed} run(s); runs with no feedback count as correct`
        : 'No human feedback on this check — counted as 100%';
    return (
        <span className={`font-bold ${color}`} title={title}>
            {accuracy}%
        </span>
    );
};

// Tiny pass/fail/warn count chips
const CountChips = ({ counts }) => (
    <div className="flex gap-1">
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-bold">{counts?.pass ?? 0}P</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 font-bold">{counts?.fail ?? 0}F</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-bold">{counts?.warning ?? 0}W</span>
    </div>
);

// Status filter — keep a check only if the HUMAN recorded that status at
// least once. AI counts are ignored here. Checks never human-reviewed are
// hidden for pass/fail/warning (shown only under "All").
const matchesStatusFilter = (check, filter) => {
    if (filter === 'all') return true;
    const human = check.human || {};
    return (human[filter] || 0) > 0;
};

const StatusFilter = ({ value, onChange }) => {
    const opts = [
        { id: 'all', label: 'All' },
        { id: 'pass', label: 'Pass' },
        { id: 'fail', label: 'Fail' },
        { id: 'warning', label: 'Warning' },
    ];
    return (
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
            {opts.map((o) => (
                <button
                    key={o.id}
                    onClick={() => onChange(o.id)}
                    className={`text-xs font-bold px-3 py-1 rounded-md transition-all ${
                        value === o.id ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    }`}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
};

// ─── Run history — AI vs Human comparison table ───────────────────────────
const RunComparison = ({ runs }) => {
    if (!runs || runs.length === 0) {
        return <div className="px-6 py-4 text-xs text-slate-400">No run history.</div>;
    }
    return (
        <div className="bg-slate-50/70 px-6 py-4">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                Run history — {runs.length} run{runs.length > 1 ? 's' : ''} · AI vs Human
            </div>
            <div className="space-y-2">
                {runs.map((run, idx) => {
                    const human = run.human || {};
                    const ai = run.ai || {};
                    const files = Array.isArray(run.files) ? run.files : [];
                    const reasons = Array.isArray(ai.reasons) ? ai.reasons : [];
                    return (
                        <div key={run.run_id || idx} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                            {/* Run meta */}
                            <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
                                <span className="text-[11px] text-slate-600 font-semibold">{formatDate(run.date)}</span>
                                <span className="text-[11px] text-slate-500">
                                    File: {files.length > 0 ? files.join(', ') : '—'}
                                </span>
                                <span className="text-[11px] text-slate-400">project {run.project_id ?? '—'}</span>
                            </div>
                            {/* AI vs Human two columns */}
                            <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100">
                                {/* AI */}
                                <div className="p-3">
                                    <div className="flex items-center gap-2 mb-1.5">
                                        <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600">AI Response</span>
                                        <StatusBadge status={ai.status} />
                                    </div>
                                    {reasons.length > 0 ? (
                                        <ul className="list-disc list-inside text-[11px] text-slate-600 space-y-0.5">
                                            {reasons.slice(0, 5).map((r, ri) => (
                                                <li key={ri}>{typeof r === 'object' ? JSON.stringify(r) : r}</li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <div className="text-[11px] text-slate-400">No reason provided.</div>
                                    )}
                                </div>
                                {/* Human */}
                                <div className={`p-3 ${human.reviewed ? 'bg-violet-50/30' : ''}`}>
                                    <div className="flex items-center gap-2 mb-1.5">
                                        <span className="text-[10px] font-bold uppercase tracking-wider text-violet-700">Human Review</span>
                                        {human.reviewed
                                            ? <StatusBadge status={human.status} />
                                            : <span className="text-[10px] text-slate-400 italic">not reviewed</span>}
                                    </div>
                                    {human.reviewed ? (
                                        <div className="space-y-1">
                                            {(human.feedback || []).map((f, fi) => (
                                                <div key={fi} className="text-[11px] text-slate-700">
                                                    <span className="font-bold text-violet-700 uppercase">{f.status}</span>
                                                    {f.remarks ? <span> — {f.remarks}</span> : null}
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="text-[11px] text-slate-400">No human feedback yet.</div>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// ─── A section: AHJ or Utility ────────────────────────────────────────────
const SectionBlock = ({ title, geoLabel, data, accent, statusFilter }) => {
    const [expanded, setExpanded] = useState({});
    const [sectionOpen, setSectionOpen] = useState(true);
    const toggle = (key) => setExpanded((e) => ({ ...e, [key]: !e[key] }));

    const allChecks = data?.checks || [];
    const checks = allChecks.filter((c) => matchesStatusFilter(c, statusFilter));

    return (
        <div className="space-y-4">
            <button
                onClick={() => setSectionOpen((o) => !o)}
                className="flex items-center gap-2 text-lg font-bold text-slate-800 hover:text-blue-600 transition-colors"
            >
                <span className="text-slate-400 text-base">{sectionOpen ? '▼' : '▶'}</span>
                {title}
                <span className="text-xs font-medium text-slate-400">({checks.length})</span>
            </button>

            {/* Check table */}
            {sectionOpen && (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                {checks.length === 0 ? (
                    <div className="p-10 text-center text-sm text-slate-400">
                        No {title.toLowerCase()} for this selection.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-slate-100">
                            <thead className="bg-slate-50">
                                <tr>
                                    <th className="px-4 py-3 w-8"></th>
                                    <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">Check</th>
                                    <th className="px-4 py-3 text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider">Accuracy</th>
                                    <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">{geoLabel}</th>
                                    <th className="px-4 py-3 text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider">Runs</th>
                                    <th className="px-4 py-3 text-right text-[10px] font-bold text-violet-700 uppercase tracking-wider">Human Reviewed</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {checks.map((c, idx) => {
                                    const key = `${c.check_name}|${c.headline}|${c.geo}|${idx}`;
                                    const open = !!expanded[key];
                                    return (
                                        <React.Fragment key={key}>
                                            <tr className="hover:bg-slate-50 cursor-pointer" onClick={() => toggle(key)}>
                                                <td className="px-4 py-3 text-slate-400 text-xs">{open ? '▼' : '▶'}</td>
                                                <td className="px-4 py-3 text-xs">
                                                    <div className="font-semibold text-slate-800">{c.check_name}</div>
                                                    <div className="text-[11px] text-slate-400">{c.headline}</div>
                                                </td>
                                                <td className="px-4 py-3 text-xs text-right">
                                                    <AccuracyCell accuracy={c.accuracy} reviewed={c.reviewed_count} />
                                                </td>
                                                <td className="px-4 py-3 text-xs text-slate-600">
                                                    <div>{c.geo || '—'}</div>
                                                    {c.geo_state ? <div className="text-[11px] text-slate-400">{c.geo_state}</div> : null}
                                                </td>
                                                <td className="px-4 py-3 text-xs text-right text-slate-700 font-semibold">{c.total_runs}</td>
                                                <td className="px-4 py-3 text-xs text-right text-violet-700 font-semibold">{c.reviewed_count}</td>
                                            </tr>
                                            {open && (
                                                <tr>
                                                    <td colSpan={6} className="p-0">
                                                        <RunComparison runs={c.runs} />
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            )}
        </div>
    );
};

// ─── Performance matrix — top jurisdictions by accuracy ───────────────────
// Groups the section's checks by jurisdiction (geo), computes a weighted
// accuracy (Σ correct ÷ Σ runs), and ranks them. Has its own state filter
// and a best↔worst sort toggle. Always shows the top 20.
const PerformanceMatrix = ({ title, geoLabel, data }) => {
    const [stateFilter, setStateFilter] = useState('all');
    const [sortDir, setSortDir] = useState('best'); // 'best' = best→worst

    const checks = data?.checks || [];

    const states = useMemo(() => {
        const s = new Set();
        for (const c of checks) if (c.geo_state) s.add(c.geo_state);
        return [...s].sort();
    }, [checks]);

    const rows = useMemo(() => {
        const map = {};
        for (const c of checks) {
            if (!c.geo) continue;
            if (stateFilter !== 'all' && (c.geo_state || '') !== stateFilter) continue;
            if (!map[c.geo]) {
                map[c.geo] = { geo: c.geo, state: c.geo_state || '—', correct: 0, total: 0, checks: 0 };
            }
            map[c.geo].correct += c.correct_count || 0;
            map[c.geo].total += c.total_runs || 0;
            map[c.geo].checks += 1;
        }
        const arr = Object.values(map).map((r) => ({
            ...r,
            accuracy: r.total > 0 ? Math.round((r.correct * 10000) / r.total) / 100 : 0,
        }));
        arr.sort((a, b) => (sortDir === 'best' ? b.accuracy - a.accuracy : a.accuracy - b.accuracy));
        return arr.slice(0, 20);
    }, [checks, stateFilter, sortDir]);

    return (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
                <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">{title}</h3>
                <div className="flex items-center gap-2">
                    <select
                        value={stateFilter}
                        onChange={(e) => setStateFilter(e.target.value)}
                        className="text-xs border border-slate-200 rounded-lg px-2 py-1.5"
                    >
                        <option value="all">All states</option>
                        {states.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <button
                        onClick={() => setSortDir((d) => (d === 'best' ? 'worst' : 'best'))}
                        className="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200"
                        title="Toggle sort order"
                    >
                        {sortDir === 'best' ? 'Best → Worst' : 'Worst → Best'}
                    </button>
                </div>
            </div>
            {rows.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-400">No {geoLabel} data.</div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-100">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="px-4 py-2 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider w-10">#</th>
                                <th className="px-4 py-2 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">{geoLabel}</th>
                                <th className="px-4 py-2 text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider">Runs</th>
                                <th className="px-4 py-2 text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider">Accuracy</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {rows.map((r, idx) => {
                                const color = r.accuracy >= 80 ? 'text-emerald-700' : r.accuracy >= 50 ? 'text-amber-700' : 'text-rose-700';
                                return (
                                    <tr key={r.geo} className="hover:bg-slate-50">
                                        <td className="px-4 py-2.5 text-xs font-bold text-slate-400">{idx + 1}</td>
                                        <td className="px-4 py-2.5 text-xs">
                                            <div className="font-semibold text-slate-800">{r.geo}</div>
                                            <div className="text-[11px] text-slate-400">
                                                {r.state} · {r.checks} check{r.checks > 1 ? 's' : ''}
                                            </div>
                                        </td>
                                        <td className="px-4 py-2.5 text-xs text-right text-slate-600 font-semibold">{r.total}</td>
                                        <td className={`px-4 py-2.5 text-xs text-right font-bold ${color}`}>{r.accuracy}%</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

// ─── State-trend table ────────────────────────────────────────────────────
const TrendTable = ({ title, rows }) => (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">{title}</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">Ranked by AI failures — highest first</p>
        </div>
        {(!rows || rows.length === 0) ? (
            <div className="p-8 text-center text-sm text-slate-400">No data.</div>
        ) : (
            <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50">
                    <tr>
                        <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">State</th>
                        <th className="px-4 py-3 text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider">Checks</th>
                        <th className="px-4 py-3 text-left text-[10px] font-bold text-blue-600 uppercase tracking-wider">AI (P/F/W)</th>
                        <th className="px-4 py-3 text-left text-[10px] font-bold text-violet-700 uppercase tracking-wider">Human (P/F/W)</th>
                        <th className="px-4 py-3 text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider">AI Pass rate</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {rows.map((r, idx) => (
                        <tr key={r.state || idx} className={`hover:bg-slate-50 ${idx === 0 ? 'bg-rose-50/40' : ''}`}>
                            <td className="px-4 py-3 text-xs font-semibold text-slate-800">{r.state}</td>
                            <td className="px-4 py-3 text-xs text-right text-slate-700">{r.total_checks}</td>
                            <td className="px-4 py-3"><CountChips counts={r.ai} /></td>
                            <td className="px-4 py-3">
                                {r.reviewed_count > 0
                                    ? <CountChips counts={r.human} />
                                    : <span className="text-[11px] text-slate-400 italic">—</span>}
                            </td>
                            <td className="px-4 py-3 text-right"><PassRateBar rate={r.ai_pass_rate} /></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        )}
    </div>
);

// ─── Date helpers ─────────────────────────────────────────────────────────
const toInputDate = (d) => d.toISOString().slice(0, 10);
const toIsoStart = (s) => (s ? `${s}T00:00:00` : undefined);
const toIsoEnd = (s) => (s ? `${s}T23:59:59` : undefined);

// ─── Main page ────────────────────────────────────────────────────────────
const QCAnalytics = () => {
    const defaultRange = useMemo(() => {
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - 30);
        return { from: toInputDate(start), to: toInputDate(end) };
    }, []);

    const [range, setRange] = useState(defaultRange);
    const [states, setStates] = useState([]);
    const [selectedState, setSelectedState] = useState('');
    const [ahjData, setAhjData] = useState(null);
    const [utilData, setUtilData] = useState(null);
    const [matrixAhj, setMatrixAhj] = useState(null);
    const [matrixUtil, setMatrixUtil] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [statusFilter, setStatusFilter] = useState('all');

    const loadData = async (state, r) => {
        setLoading(true);
        setError(null);
        const params = { from: toIsoStart(r.from), to: toIsoEnd(r.to) };
        try {
            const [ahj, util, ahjAll, utilAll] = await Promise.all([
                fetchQCSection({ dimension: 'ahj', state: state || undefined, ...params }),
                fetchQCSection({ dimension: 'utility', state: state || undefined, ...params }),
                // The performance matrix always spans every state, regardless
                // of the page's state filter — fetch all-states data for it.
                state ? fetchQCSection({ dimension: 'ahj', ...params }) : Promise.resolve(null),
                state ? fetchQCSection({ dimension: 'utility', ...params }) : Promise.resolve(null),
            ]);
            setAhjData(ahj);
            setUtilData(util);
            setMatrixAhj(ahjAll || ahj);
            setMatrixUtil(utilAll || util);
        } catch (e) {
            console.error(e);
            setError(
                e?.response?.data?.detail ||
                'Failed to load analytics. Check the proxy backend and SOLAR_AGENTS env vars.'
            );
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        (async () => {
            try {
                const res = await fetchQCStates({
                    from: toIsoStart(defaultRange.from), to: toIsoEnd(defaultRange.to),
                });
                const list = res.states || [];
                setStates(list);
                const initial = list.length > 0 ? list[0] : '';
                setSelectedState(initial);
                await loadData(initial, defaultRange);
            } catch (e) {
                console.error(e);
                setError(
                    e?.response?.data?.detail ||
                    'Failed to load states. Check the proxy backend and SOLAR_AGENTS env vars.'
                );
                setLoading(false);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const applyFilters = () => loadData(selectedState, range);

    return (
        <div className="space-y-10">
            {/* Header + filters */}
            <div className="flex items-end justify-between flex-wrap gap-4 px-2">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">QC Analytics</h2>
                    <p className="text-xs text-slate-500 mt-1">
                        AHJ &amp; Utility checks — AI verdict vs human review, side by side.
                    </p>
                </div>
                <div className="flex items-end gap-2 flex-wrap">
                    <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">State</label>
                        <select
                            value={selectedState}
                            onChange={(e) => setSelectedState(e.target.value)}
                            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 min-w-[150px]"
                        >
                            <option value="">All states</option>
                            {states.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">From</label>
                        <input
                            type="date"
                            value={range.from}
                            onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
                            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5"
                        />
                    </div>
                    <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">To</label>
                        <input
                            type="date"
                            value={range.to}
                            onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
                            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5"
                        />
                    </div>
                    <button
                        onClick={applyFilters}
                        className="text-xs font-bold px-4 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                    >
                        Apply
                    </button>
                </div>
            </div>

            {/* Performance matrix — top jurisdictions by accuracy */}
            {!loading && !error && (
                <div className="space-y-3">
                    <div className="px-2">
                        <h3 className="text-lg font-bold text-slate-800">Performance Matrix</h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                            Top 20 jurisdictions by accuracy — spans all states; filter &amp; sort inside each box.
                        </p>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <PerformanceMatrix title="AHJ Performance" geoLabel="AHJ" data={matrixAhj} />
                        <PerformanceMatrix title="Utility Performance" geoLabel="Utility" data={matrixUtil} />
                    </div>
                </div>
            )}

            {/* Status filter — instant, client-side */}
            {!loading && !error && (
                <div className="flex items-center gap-2 px-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Show checks with:</span>
                    <StatusFilter value={statusFilter} onChange={setStatusFilter} />
                </div>
            )}

            {loading && (
                <div className="flex items-center justify-center py-20">
                    <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-600 rounded-full animate-spin"></div>
                </div>
            )}

            {!loading && error && (
                <div className="p-6 rounded-xl bg-red-50 border border-red-100 text-red-700">
                    <div className="font-semibold mb-1">Analytics error</div>
                    <div className="text-sm whitespace-pre-wrap">{error}</div>
                    <button
                        onClick={applyFilters}
                        className="mt-3 text-xs font-bold px-3 py-1.5 rounded-md bg-red-600 text-white hover:bg-red-700"
                    >
                        Retry
                    </button>
                </div>
            )}

            {!loading && !error && (
                <>
                    <SectionBlock title="AHJ Checks" geoLabel="AHJ" data={ahjData} accent="violet" statusFilter={statusFilter} />
                    <SectionBlock title="Utility Checks" geoLabel="Utility" data={utilData} accent="amber" statusFilter={statusFilter} />
                </>
            )}
        </div>
    );
};

export default QCAnalytics;
