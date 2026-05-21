import React, { useEffect, useMemo, useState } from 'react';
import { fetchQCGeneralSection } from '../api';

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

const formatDate = (iso) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
};

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

// ─── Run history — AI vs Human comparison ─────────────────────────────────
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
                            <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
                                <span className="text-[11px] text-slate-600 font-semibold">{formatDate(run.date)}</span>
                                <span className="text-[11px] text-slate-500">
                                    File: {files.length > 0 ? files.join(', ') : '—'}
                                </span>
                                <span className="text-[11px] text-slate-400">project {run.project_id ?? '—'}</span>
                            </div>
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

// ─── Checks Trend — which check fails most ────────────────────────────────
const ChecksTrend = ({ checks }) => {
    const top = useMemo(() => {
        const sorted = [...(checks || [])].sort((a, b) => (b.ai?.fail || 0) - (a.ai?.fail || 0));
        return sorted.slice(0, 12).filter((c) => (c.ai?.fail || 0) > 0);
    }, [checks]);

    const maxFail = top.length > 0 ? (top[0].ai?.fail || 0) : 0;

    return (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100">
                <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Checks Trend</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">Which general checks fail the most (by AI fail count)</p>
            </div>
            {top.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-400">No failing checks in this window.</div>
            ) : (
                <div className="p-4 space-y-2">
                    {top.map((c, idx) => {
                        const fail = c.ai?.fail || 0;
                        const pct = maxFail > 0 ? (fail / maxFail) * 100 : 0;
                        return (
                            <div key={`${c.check_name}-${idx}`} className="flex items-center gap-3">
                                <span className="text-[11px] text-slate-400 w-5 text-right">{idx + 1}</span>
                                <div className="flex-1 min-w-0">
                                    <div className="text-xs font-semibold text-slate-800 truncate">{c.check_name}</div>
                                    <div className="mt-0.5 h-2 rounded-full bg-slate-100 overflow-hidden">
                                        <div className="h-full bg-rose-500" style={{ width: `${pct}%` }} />
                                    </div>
                                </div>
                                <span className="text-xs font-bold text-rose-700 tabular-nums w-16 text-right">
                                    {fail} fail{fail !== 1 ? 's' : ''}
                                </span>
                                <span className="text-[11px] text-slate-400 tabular-nums w-16 text-right">
                                    {c.human?.fail || 0} human
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

// ─── Date helpers ─────────────────────────────────────────────────────────
const toInputDate = (d) => d.toISOString().slice(0, 10);
const toIsoStart = (s) => (s ? `${s}T00:00:00` : undefined);
const toIsoEnd = (s) => (s ? `${s}T23:59:59` : undefined);

// ─── Main page ────────────────────────────────────────────────────────────
const GeneralAnalytics = () => {
    const defaultRange = useMemo(() => {
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - 30);
        return { from: toInputDate(start), to: toInputDate(end) };
    }, []);

    const [range, setRange] = useState(defaultRange);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [expanded, setExpanded] = useState({});
    const [statusFilter, setStatusFilter] = useState('all');

    const toggle = (key) => setExpanded((e) => ({ ...e, [key]: !e[key] }));

    const loadData = async (r) => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetchQCGeneralSection({
                from: toIsoStart(r.from), to: toIsoEnd(r.to),
            });
            setData(res);
        } catch (e) {
            console.error(e);
            setError(
                e?.response?.data?.detail ||
                'Failed to load general checks analytics. Check the proxy backend and SOLAR_AGENTS env vars.'
            );
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData(defaultRange);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const checks = data?.checks || [];
    const visibleChecks = checks.filter((c) => matchesStatusFilter(c, statusFilter));

    return (
        <div className="space-y-8">
            {/* Header + filters */}
            <div className="flex items-end justify-between flex-wrap gap-4 px-2">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">General Checks Analytics</h2>
                    <p className="text-xs text-slate-500 mt-1">
                        General checks — AI verdict vs human review, side by side.
                    </p>
                </div>
                <div className="flex items-end gap-2 flex-wrap">
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
                        onClick={() => loadData(range)}
                        className="text-xs font-bold px-4 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                    >
                        Apply
                    </button>
                </div>
            </div>

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
                        onClick={() => loadData(range)}
                        className="mt-3 text-xs font-bold px-3 py-1.5 rounded-md bg-red-600 text-white hover:bg-red-700"
                    >
                        Retry
                    </button>
                </div>
            )}

            {!loading && !error && (
                <>
                    {/* Checks trend */}
                    <ChecksTrend checks={checks} />

                    {/* Full check table */}
                    <div>
                        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                            <h3 className="text-lg font-bold text-slate-800">All General Checks</h3>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Show checks with:</span>
                                <StatusFilter value={statusFilter} onChange={setStatusFilter} />
                            </div>
                        </div>
                        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                            {visibleChecks.length === 0 ? (
                                <div className="p-10 text-center text-sm text-slate-400">
                                    {checks.length === 0
                                        ? 'No general checks for this window.'
                                        : `No checks match the "${statusFilter}" filter.`}
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="min-w-full divide-y divide-slate-100">
                                        <thead className="bg-slate-50">
                                            <tr>
                                                <th className="px-4 py-3 w-8"></th>
                                                <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">Check</th>
                                                <th className="px-4 py-3 text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider">Runs</th>
                                                <th className="px-4 py-3 text-right text-[10px] font-bold text-violet-700 uppercase tracking-wider">Human Reviewed</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {visibleChecks.map((c, idx) => {
                                                const key = `${c.check_name}|${c.headline}|${idx}`;
                                                const open = !!expanded[key];
                                                return (
                                                    <React.Fragment key={key}>
                                                        <tr className="hover:bg-slate-50 cursor-pointer" onClick={() => toggle(key)}>
                                                            <td className="px-4 py-3 text-slate-400 text-xs">{open ? '▼' : '▶'}</td>
                                                            <td className="px-4 py-3 text-xs">
                                                                <div className="font-semibold text-slate-800">{c.check_name}</div>
                                                                <div className="text-[11px] text-slate-400">{c.headline}</div>
                                                            </td>
                                                            <td className="px-4 py-3 text-xs text-right text-slate-700 font-semibold">{c.total_runs}</td>
                                                            <td className="px-4 py-3 text-xs text-right text-violet-700 font-semibold">{c.reviewed_count}</td>
                                                        </tr>
                                                        {open && (
                                                            <tr>
                                                                <td colSpan={4} className="p-0">
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
                    </div>
                </>
            )}
        </div>
    );
};

export default GeneralAnalytics;
