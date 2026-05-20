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

// ─── Small UI primitives (match Dashboard.jsx) ────────────────────────────
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
        <div className="flex items-center gap-2 min-w-[100px]">
            <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[11px] font-bold text-slate-600 tabular-nums">{pct.toFixed(0)}%</span>
        </div>
    );
};

const formatDate = (iso) => {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleString();
    } catch {
        return iso;
    }
};

// ─── Run history (shown when a check row is expanded) ─────────────────────
const RunHistory = ({ runs }) => {
    if (!runs || runs.length === 0) {
        return <div className="px-6 py-4 text-xs text-slate-400">No run history.</div>;
    }
    return (
        <div className="bg-slate-50/70 px-6 py-4">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                Run history — {runs.length} run{runs.length > 1 ? 's' : ''}
            </div>
            <div className="space-y-2">
                {runs.map((run, idx) => {
                    const fb = run.feedback || [];
                    const reasons = run.reasons || [];
                    return (
                        <div key={run.run_id || idx} className="bg-white border border-slate-200 rounded-lg p-3">
                            <div className="flex items-center justify-between gap-3 flex-wrap">
                                <div className="flex items-center gap-3 flex-wrap">
                                    <StatusBadge status={run.effective_status} />
                                    {run.has_feedback && (
                                        <span className="text-[10px] font-bold text-violet-700 bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded">
                                            ✎ human-reviewed
                                        </span>
                                    )}
                                    <span className="text-[11px] text-slate-500">{formatDate(run.date)}</span>
                                </div>
                                <span className="text-[11px] text-slate-400">
                                    project {run.project_id ?? '—'}
                                </span>
                            </div>

                            {/* File(s) the check ran for */}
                            <div className="mt-1.5 text-[11px] text-slate-600">
                                <span className="font-bold text-slate-500">File: </span>
                                {(run.files && run.files.length > 0) ? run.files.join(', ') : '—'}
                            </div>

                            {/* LLM original verdict if feedback overrode it */}
                            {run.has_feedback && run.llm_status &&
                                classifyStatus(run.llm_status) !== classifyStatus(run.effective_status) && (
                                <div className="mt-1 text-[11px] text-slate-400">
                                    AI originally marked it <span className="font-semibold">{run.llm_status}</span>,
                                    overridden by reviewer.
                                </div>
                            )}

                            {/* Human feedback */}
                            {fb.length > 0 && (
                                <div className="mt-2 space-y-1">
                                    {fb.map((f, fi) => (
                                        <div key={fi} className="text-[11px] bg-violet-50/60 border border-violet-100 rounded px-2 py-1">
                                            <span className="font-bold text-violet-700 uppercase">{f.status}</span>
                                            {f.remarks ? <span className="text-slate-700"> — {f.remarks}</span> : null}
                                            {f.timestamp && (
                                                <span className="text-slate-400"> ({formatDate(f.timestamp)})</span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* LLM reasons (the AI's own explanation) */}
                            {reasons.length > 0 && (
                                <div className="mt-2">
                                    <div className="text-[10px] font-bold uppercase text-slate-400 mb-0.5">AI reason</div>
                                    <ul className="list-disc list-inside text-[11px] text-slate-600 space-y-0.5">
                                        {reasons.slice(0, 4).map((r, ri) => <li key={ri}>{r}</li>)}
                                    </ul>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// ─── A section: AHJ or Utility ────────────────────────────────────────────
const SectionBlock = ({ title, geoLabel, data, accent }) => {
    const [expanded, setExpanded] = useState({});
    const toggle = (key) => setExpanded((e) => ({ ...e, [key]: !e[key] }));

    const summary = data?.summary || {};
    const checks = data?.checks || [];

    return (
        <div className="space-y-4">
            <h3 className="text-lg font-bold text-slate-800">{title}</h3>

            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <StatCard label="Checks" value={summary.distinct_checks ?? 0} accent={accent} />
                <StatCard label="Total Runs" value={summary.total_checks ?? 0} accent="slate" />
                <StatCard label="Pass" value={summary.pass ?? 0} accent="emerald" />
                <StatCard label="Fail" value={summary.fail ?? 0} accent="rose" />
                <StatCard label="Warning" value={summary.warning ?? 0} accent="amber" />
                <StatCard
                    label="Pass Rate"
                    value={`${summary.pass_rate ?? 0}%`}
                    hint={`${summary.feedback_count ?? 0} reviewed`}
                    accent="blue"
                />
            </div>

            {/* Check table */}
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
                                    <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">{geoLabel}</th>
                                    <th className="px-4 py-3 text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider">Runs</th>
                                    <th className="px-4 py-3 text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider">Pass</th>
                                    <th className="px-4 py-3 text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider">Fail</th>
                                    <th className="px-4 py-3 text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider">Warn</th>
                                    <th className="px-4 py-3 text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider">Pass rate</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {checks.map((c, idx) => {
                                    const key = `${c.check_name}|${c.headline}|${c.geo}|${idx}`;
                                    const open = !!expanded[key];
                                    return (
                                        <React.Fragment key={key}>
                                            <tr
                                                className="hover:bg-slate-50 cursor-pointer"
                                                onClick={() => toggle(key)}
                                            >
                                                <td className="px-4 py-3 text-slate-400 text-xs">{open ? '▼' : '▶'}</td>
                                                <td className="px-4 py-3 text-xs">
                                                    <div className="font-semibold text-slate-800">{c.check_name}</div>
                                                    <div className="text-[11px] text-slate-400">{c.headline}</div>
                                                </td>
                                                <td className="px-4 py-3 text-xs text-slate-600">{c.geo}</td>
                                                <td className="px-4 py-3 text-xs text-right text-slate-700 font-semibold">{c.total_runs}</td>
                                                <td className="px-4 py-3 text-xs text-right text-emerald-700 font-semibold">{c.pass}</td>
                                                <td className="px-4 py-3 text-xs text-right text-rose-700 font-semibold">{c.fail}</td>
                                                <td className="px-4 py-3 text-xs text-right text-amber-700 font-semibold">{c.warning}</td>
                                                <td className="px-4 py-3 text-right"><PassRateBar rate={c.pass_rate} /></td>
                                            </tr>
                                            {open && (
                                                <tr>
                                                    <td colSpan={8} className="p-0">
                                                        <RunHistory runs={c.runs} />
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
    );
};

// ─── State-trend table ────────────────────────────────────────────────────
const TrendTable = ({ title, rows }) => (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">{title}</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">Ranked by failures — highest first</p>
        </div>
        {(!rows || rows.length === 0) ? (
            <div className="p-8 text-center text-sm text-slate-400">No data.</div>
        ) : (
            <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50">
                    <tr>
                        <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">State</th>
                        <th className="px-4 py-3 text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider">Checks</th>
                        <th className="px-4 py-3 text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider">Pass</th>
                        <th className="px-4 py-3 text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider">Fail</th>
                        <th className="px-4 py-3 text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider">Warn</th>
                        <th className="px-4 py-3 text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider">Pass rate</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {rows.map((r, idx) => (
                        <tr key={r.state || idx} className={`hover:bg-slate-50 ${idx === 0 ? 'bg-rose-50/40' : ''}`}>
                            <td className="px-4 py-3 text-xs font-semibold text-slate-800">{r.state}</td>
                            <td className="px-4 py-3 text-xs text-right text-slate-700">{r.total_checks}</td>
                            <td className="px-4 py-3 text-xs text-right text-emerald-700 font-semibold">{r.pass}</td>
                            <td className="px-4 py-3 text-xs text-right text-rose-700 font-semibold">{r.fail}</td>
                            <td className="px-4 py-3 text-xs text-right text-amber-700 font-semibold">{r.warning}</td>
                            <td className="px-4 py-3 text-right"><PassRateBar rate={r.pass_rate} /></td>
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
    const [selectedState, setSelectedState] = useState('');   // '' = All states
    const [ahjData, setAhjData] = useState(null);
    const [utilData, setUtilData] = useState(null);
    const [ahjTrend, setAhjTrend] = useState([]);
    const [utilTrend, setUtilTrend] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Load the section + trend data for the current filters.
    const loadData = async (state, r) => {
        setLoading(true);
        setError(null);
        const params = { from: toIsoStart(r.from), to: toIsoEnd(r.to) };
        try {
            const [ahj, util, ahjT, utilT] = await Promise.all([
                fetchQCSection({ dimension: 'ahj', state: state || undefined, ...params }),
                fetchQCSection({ dimension: 'utility', state: state || undefined, ...params }),
                fetchQCStateTrend({ dimension: 'ahj', ...params }),
                fetchQCStateTrend({ dimension: 'utility', ...params }),
            ]);
            setAhjData(ahj);
            setUtilData(util);
            setAhjTrend(ahjT.rows || []);
            setUtilTrend(utilT.rows || []);
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

    // On mount — load the state list, pick the first state, then load data.
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
                        AHJ &amp; Utility check performance. Pick a state to keep clusters clean.
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
                    {/* AHJ section */}
                    <SectionBlock
                        title="AHJ Checks"
                        geoLabel="AHJ"
                        data={ahjData}
                        accent="violet"
                    />

                    {/* Utility section */}
                    <SectionBlock
                        title="Utility Checks"
                        geoLabel="Utility"
                        data={utilData}
                        accent="amber"
                    />

                    {/* State trend */}
                    <div className="space-y-4">
                        <div>
                            <h3 className="text-lg font-bold text-slate-800">State Trend</h3>
                            <p className="text-xs text-slate-500 mt-1">
                                Which states&apos; checks fail / pass the most (across all states, ignores the state filter above).
                            </p>
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <TrendTable title="AHJ — by state" rows={ahjTrend} />
                            <TrendTable title="Utility — by state" rows={utilTrend} />
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default QCAnalytics;
