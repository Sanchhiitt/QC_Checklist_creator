import React, { useEffect, useMemo, useState } from 'react';
import {
    fetchQCAnalyticsOverview,
    fetchQCAnalyticsByAHJ,
    fetchQCAnalyticsByUtility,
    fetchQCAnalyticsByState,
    fetchQCTopFailingChecks,
} from '../api';

// ─── Small UI primitives (match Dashboard.jsx's look) ─────────────────────
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
        <div className={`p-5 rounded-2xl border ${accents[accent]} shadow-sm`}>
            <div className="text-[10px] font-bold uppercase tracking-wider opacity-80">{label}</div>
            <div className="mt-2 text-3xl font-bold">{value}</div>
            {hint && <div className="mt-1 text-[11px] opacity-70">{hint}</div>}
        </div>
    );
};

const PassRateBar = ({ rate }) => {
    const pct = Math.max(0, Math.min(100, Number(rate) || 0));
    const color = pct >= 80 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-rose-500';
    return (
        <div className="flex items-center gap-2 min-w-[110px]">
            <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[11px] font-bold text-slate-600 tabular-nums">{pct.toFixed(0)}%</span>
        </div>
    );
};

const Section = ({ title, count, children, action }) => (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
                <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">{title}</h3>
                {count != null && <span className="text-xs text-slate-400">{count} rows</span>}
            </div>
            {action}
        </div>
        {children}
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
    const [overview, setOverview] = useState(null);
    const [byAhj, setByAhj] = useState([]);
    const [byUtility, setByUtility] = useState([]);
    const [byState, setByState] = useState([]);
    const [topFailing, setTopFailing] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Filters for the top-failing section only
    const [filters, setFilters] = useState({ ahj: '', utility: '', state: '', limit: 10 });

    const loadAll = async (r = range) => {
        setLoading(true);
        setError(null);
        const params = { from: toIsoStart(r.from), to: toIsoEnd(r.to) };
        try {
            const [ov, ahj, util, state, top] = await Promise.all([
                fetchQCAnalyticsOverview(params),
                fetchQCAnalyticsByAHJ(params),
                fetchQCAnalyticsByUtility(params),
                fetchQCAnalyticsByState(params),
                fetchQCTopFailingChecks({ ...params, limit: filters.limit }),
            ]);
            setOverview(ov);
            setByAhj(ahj.rows || []);
            setByUtility(util.rows || []);
            setByState(state.rows || []);
            setTopFailing(top.rows || []);
        } catch (e) {
            console.error(e);
            setError(
                e?.response?.data?.detail ||
                'Failed to load analytics. Check that the proxy backend is reachable and SOLAR_AGENTS env vars are set.'
            );
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadAll(defaultRange);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const refreshTopFailing = async () => {
        const params = {
            from: toIsoStart(range.from),
            to: toIsoEnd(range.to),
            ahj: filters.ahj || undefined,
            utility: filters.utility || undefined,
            state: filters.state || undefined,
            limit: filters.limit,
        };
        try {
            const res = await fetchQCTopFailingChecks(params);
            setTopFailing(res.rows || []);
        } catch (e) {
            console.error(e);
            alert(e?.response?.data?.detail || 'Failed to refresh top failing checks.');
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-600 rounded-full animate-spin"></div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-6 rounded-xl bg-red-50 border border-red-100 text-red-700">
                <div className="font-semibold mb-1">Analytics error</div>
                <div className="text-sm whitespace-pre-wrap">{error}</div>
                <button
                    onClick={() => loadAll()}
                    className="mt-3 text-xs font-bold px-3 py-1.5 rounded-md bg-red-600 text-white hover:bg-red-700"
                >
                    Retry
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            {/* Header + date range */}
            <div className="flex items-end justify-between flex-wrap gap-4 px-2">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">QC Analytics</h2>
                    <p className="text-xs text-slate-500 mt-1">
                        AHJ + Utility check performance across all QC runs in the selected window.
                    </p>
                </div>
                <div className="flex items-end gap-2">
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
                        onClick={() => loadAll()}
                        className="text-xs font-bold px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                    >
                        Apply
                    </button>
                    <button
                        onClick={() => { setRange(defaultRange); loadAll(defaultRange); }}
                        className="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
                    >
                        Last 30d
                    </button>
                </div>
            </div>

            {/* Overview cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                <StatCard label="Total Runs" value={overview?.total_runs ?? 0} accent="blue" />
                <StatCard label="Total Checks" value={overview?.total_checks ?? 0} accent="slate" />
                <StatCard
                    label="Pass Rate"
                    value={`${overview?.pass_rate ?? 0}%`}
                    hint={`${overview?.pass ?? 0} pass / ${overview?.fail ?? 0} fail`}
                    accent="emerald"
                />
                <StatCard label="Failures" value={overview?.fail ?? 0} hint={`${overview?.warning ?? 0} warnings`} accent="rose" />
                <StatCard
                    label="AHJ Checks"
                    value={overview?.ahj_checks ?? 0}
                    hint={`${overview?.distinct_ahjs ?? 0} unique AHJs`}
                    accent="violet"
                />
                <StatCard
                    label="Utility Checks"
                    value={overview?.utility_checks ?? 0}
                    hint={`${overview?.distinct_utilities ?? 0} unique utilities`}
                    accent="amber"
                />
            </div>

            {/* Three breakdown tables */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Section title="By AHJ" count={byAhj.length}>
                    {byAhj.length === 0 ? (
                        <div className="p-10 text-center text-sm text-slate-400">No AHJ checks in this window.</div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-slate-100">
                                <thead className="bg-slate-50">
                                    <tr>
                                        <Th>AHJ</Th>
                                        <Th>States</Th>
                                        <Th right>Runs</Th>
                                        <Th right>Checks</Th>
                                        <Th right>Fail</Th>
                                        <Th right>Warn</Th>
                                        <Th right>Pass rate</Th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {byAhj.map((r) => (
                                        <tr key={r.ahj} className="hover:bg-slate-50">
                                            <Td bold>{r.ahj}</Td>
                                            <Td muted>{(r.states || []).join(', ') || '—'}</Td>
                                            <Td right>{r.total_runs}</Td>
                                            <Td right>{r.total_checks}</Td>
                                            <Td right rose>{r.fail}</Td>
                                            <Td right amber>{r.warning}</Td>
                                            <Td right><PassRateBar rate={r.pass_rate} /></Td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Section>

                <Section title="By Utility" count={byUtility.length}>
                    {byUtility.length === 0 ? (
                        <div className="p-10 text-center text-sm text-slate-400">No utility checks in this window.</div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-slate-100">
                                <thead className="bg-slate-50">
                                    <tr>
                                        <Th>Utility</Th>
                                        <Th>States</Th>
                                        <Th right>Runs</Th>
                                        <Th right>Checks</Th>
                                        <Th right>Fail</Th>
                                        <Th right>Warn</Th>
                                        <Th right>Pass rate</Th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {byUtility.map((r) => (
                                        <tr key={r.utility} className="hover:bg-slate-50">
                                            <Td bold>{r.utility}</Td>
                                            <Td muted>{(r.states || []).join(', ') || '—'}</Td>
                                            <Td right>{r.total_runs}</Td>
                                            <Td right>{r.total_checks}</Td>
                                            <Td right rose>{r.fail}</Td>
                                            <Td right amber>{r.warning}</Td>
                                            <Td right><PassRateBar rate={r.pass_rate} /></Td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Section>
            </div>

            <Section title="By State" count={byState.length}>
                {byState.length === 0 ? (
                    <div className="p-10 text-center text-sm text-slate-400">No state-level checks in this window.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-slate-100">
                            <thead className="bg-slate-50">
                                <tr>
                                    <Th>State</Th>
                                    <Th right>Runs</Th>
                                    <Th right>Checks</Th>
                                    <Th right>AHJ checks</Th>
                                    <Th right>Utility checks</Th>
                                    <Th right>Fail</Th>
                                    <Th right>Warn</Th>
                                    <Th right>Pass rate</Th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {byState.map((r) => (
                                    <tr key={r.state} className="hover:bg-slate-50">
                                        <Td bold>{r.state}</Td>
                                        <Td right>{r.total_runs}</Td>
                                        <Td right>{r.total_checks}</Td>
                                        <Td right>{r.ahj_checks}</Td>
                                        <Td right>{r.utility_checks}</Td>
                                        <Td right rose>{r.fail}</Td>
                                        <Td right amber>{r.warning}</Td>
                                        <Td right><PassRateBar rate={r.pass_rate} /></Td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Section>

            {/* Top failing checks with filters */}
            <Section
                title="Top failing checks"
                count={topFailing.length}
                action={
                    <div className="flex items-center gap-2 flex-wrap">
                        <input
                            type="text"
                            placeholder="AHJ"
                            value={filters.ahj}
                            onChange={(e) => setFilters((f) => ({ ...f, ahj: e.target.value }))}
                            className="text-xs border border-slate-200 rounded-md px-2 py-1 w-28"
                        />
                        <input
                            type="text"
                            placeholder="Utility"
                            value={filters.utility}
                            onChange={(e) => setFilters((f) => ({ ...f, utility: e.target.value }))}
                            className="text-xs border border-slate-200 rounded-md px-2 py-1 w-28"
                        />
                        <input
                            type="text"
                            placeholder="State"
                            value={filters.state}
                            onChange={(e) => setFilters((f) => ({ ...f, state: e.target.value }))}
                            className="text-xs border border-slate-200 rounded-md px-2 py-1 w-28"
                        />
                        <input
                            type="number"
                            min={1}
                            max={100}
                            value={filters.limit}
                            onChange={(e) => setFilters((f) => ({ ...f, limit: Number(e.target.value) || 10 }))}
                            className="text-xs border border-slate-200 rounded-md px-2 py-1 w-16"
                        />
                        <button
                            onClick={refreshTopFailing}
                            className="text-xs font-bold px-3 py-1 rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200"
                        >
                            Apply
                        </button>
                    </div>
                }
            >
                {topFailing.length === 0 ? (
                    <div className="p-10 text-center text-sm text-slate-400">No failing checks for this filter.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-slate-100">
                            <thead className="bg-slate-50">
                                <tr>
                                    <Th>Check</Th>
                                    <Th>Headline</Th>
                                    <Th>Scope</Th>
                                    <Th right>Total</Th>
                                    <Th right>Fail</Th>
                                    <Th right>Warn</Th>
                                    <Th right>Pass</Th>
                                    <Th right>Pass rate</Th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {topFailing.map((r, idx) => {
                                    const scope = [
                                        ...(r.ahjs || []).map((a) => `AHJ:${a}`),
                                        ...(r.utilities || []).map((u) => `Util:${u}`),
                                        ...(r.states || []).map((s) => `State:${s}`),
                                    ];
                                    return (
                                        <tr key={`${r.check_name}-${idx}`} className="hover:bg-slate-50">
                                            <Td bold>{r.check_name}</Td>
                                            <Td muted>{r.headline}</Td>
                                            <Td muted>
                                                <div className="flex flex-wrap gap-1 max-w-xs">
                                                    {scope.slice(0, 4).map((s) => (
                                                        <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{s}</span>
                                                    ))}
                                                    {scope.length > 4 && <span className="text-[10px] text-slate-400">+{scope.length - 4}</span>}
                                                </div>
                                            </Td>
                                            <Td right>{r.total_checks}</Td>
                                            <Td right rose>{r.fail}</Td>
                                            <Td right amber>{r.warning}</Td>
                                            <Td right emerald>{r.pass}</Td>
                                            <Td right><PassRateBar rate={r.pass_rate} /></Td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </Section>
        </div>
    );
};

// ─── Tiny table cell helpers (kept inline to avoid sprawl) ────────────────
const Th = ({ children, right }) => (
    <th className={`px-4 py-3 text-${right ? 'right' : 'left'} text-[10px] font-bold text-slate-500 uppercase tracking-wider`}>
        {children}
    </th>
);

const Td = ({ children, right, bold, muted, rose, amber, emerald }) => {
    const cls = [
        'px-4 py-3 text-xs',
        right ? 'text-right' : '',
        bold ? 'text-slate-800 font-semibold' : '',
        muted ? 'text-slate-500' : '',
        rose ? 'text-rose-700 font-semibold' : '',
        amber ? 'text-amber-700 font-semibold' : '',
        emerald ? 'text-emerald-700 font-semibold' : '',
        !(bold || muted || rose || amber || emerald) ? 'text-slate-700' : '',
    ].filter(Boolean).join(' ');
    return <td className={cls}>{children}</td>;
};

export default QCAnalytics;
