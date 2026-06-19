import React, { useEffect, useMemo, useState } from 'react';
import { fetchQCSection, fetchQCGeneralSection } from '../api';

// ─── Status helpers (kept in sync with QCAnalytics) ───────────────────────
const classifyStatus = (raw) => {
    const s = (raw || '').toString().trim().toLowerCase();
    if (['consistent', 'pass'].includes(s)) return 'pass';
    if (['inconsistent', 'fail', 'missing_data', 'missing data'].includes(s)) return 'fail';
    if (['warning', 'warn'].includes(s)) return 'warning';
    if (['not applicable', 'not_applicable', 'na', 'n/a'].includes(s)) return 'na';
    return 'unknown';
};

const DIM_STYLE = {
    AHJ: 'bg-violet-50 text-violet-700 border-violet-200',
    Utility: 'bg-amber-50 text-amber-700 border-amber-200',
    General: 'bg-blue-50 text-blue-700 border-blue-200',
};

// ─── Date helpers ─────────────────────────────────────────────────────────
const toInputDate = (d) => d.toISOString().slice(0, 10);
const toIsoStart = (s) => (s ? `${s}T00:00:00` : undefined);
const toIsoEnd = (s) => (s ? `${s}T23:59:59` : undefined);

const dayKey = (iso) => {
    if (!iso) return 'Unknown date';
    try { return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }); }
    catch { return iso.slice(0, 10); }
};
const dayKeySortable = (iso) => {
    if (!iso) return '0000-00-00';
    try { return new Date(iso).toISOString().slice(0, 10); } catch { return String(iso).slice(0, 10); }
};
const formatTime = (iso) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
};

// ─── Small UI primitives ──────────────────────────────────────────────────
const StatCard = ({ label, value, hint, accent = 'blue' }) => {
    const accents = {
        blue: 'text-blue-600 bg-blue-50 border-blue-100',
        amber: 'text-amber-700 bg-amber-50 border-amber-100',
        emerald: 'text-emerald-700 bg-emerald-50 border-emerald-100',
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

const CountChips = ({ pass, fail, warning }) => (
    <div className="flex gap-1">
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-bold">{pass}P</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 font-bold">{fail}F</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-bold">{warning}W</span>
    </div>
);

// ─── Aggregate per-check run history into one row per run/project ──────────
// The /section endpoints return runs nested under each check, so the same run
// appears once per check it touched. We dedupe by run_id and roll the per-check
// AI verdicts up into a pass/fail/warning summary for the whole run.
const aggregateRuns = (sections) => {
    const map = new Map();
    for (const { data, dim } of sections) {
        const checks = data?.checks || [];
        for (const c of checks) {
            const runs = Array.isArray(c.runs) ? c.runs : [];
            for (const run of runs) {
                const id = run.run_id ?? `${run.project_id ?? 'na'}|${run.date ?? 'na'}`;
                let r = map.get(id);
                if (!r) {
                    r = {
                        run_id: id, date: run.date || null, project_id: run.project_id ?? null,
                        files: new Set(), states: new Set(), dims: new Set(),
                        checks: 0, pass: 0, fail: 0, warning: 0, reviewed: 0,
                    };
                    map.set(id, r);
                }
                if (run.date && (!r.date || new Date(run.date) > new Date(r.date))) r.date = run.date;
                if (run.project_id != null) r.project_id = run.project_id;
                (Array.isArray(run.files) ? run.files : []).forEach((f) => f && r.files.add(f));
                if (c.geo_state) r.states.add(c.geo_state);
                else if (c.geo) r.states.add(c.geo);
                r.dims.add(dim);
                r.checks += 1;
                const cls = classifyStatus(run.ai?.status);
                if (cls === 'pass') r.pass += 1;
                else if (cls === 'fail') r.fail += 1;
                else if (cls === 'warning') r.warning += 1;
                if (run.human?.reviewed) r.reviewed += 1;
            }
        }
    }
    return [...map.values()]
        .map((r) => ({ ...r, files: [...r.files], states: [...r.states], dims: [...r.dims] }))
        .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
};

// ─── Main page ────────────────────────────────────────────────────────────
const RunLog = () => {
    const defaultRange = useMemo(() => {
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - 30);
        return { from: toInputDate(start), to: toInputDate(end) };
    }, []);

    const [range, setRange] = useState(defaultRange);
    const [runs, setRuns] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [query, setQuery] = useState('');

    const loadData = async (r) => {
        setLoading(true);
        setError(null);
        const params = { from: toIsoStart(r.from), to: toIsoEnd(r.to) };
        try {
            const [ahj, util, general] = await Promise.all([
                fetchQCSection({ dimension: 'ahj', ...params }),
                fetchQCSection({ dimension: 'utility', ...params }),
                fetchQCGeneralSection({ ...params }),
            ]);
            setRuns(aggregateRuns([
                { data: ahj, dim: 'AHJ' },
                { data: util, dim: 'Utility' },
                { data: general, dim: 'General' },
            ]));
        } catch (e) {
            console.error(e);
            setError(
                e?.response?.data?.detail ||
                'Failed to load run log. Check the proxy backend and SOLAR_AGENTS env vars.'
            );
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData(defaultRange);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const applyFilters = () => loadData(range);

    // Client-side text filter over filename / project / state.
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return runs;
        return runs.filter((r) =>
            r.files.some((f) => f.toLowerCase().includes(q)) ||
            String(r.project_id ?? '').toLowerCase().includes(q) ||
            r.states.some((s) => s.toLowerCase().includes(q))
        );
    }, [runs, query]);

    // Group runs by calendar day for display.
    const groups = useMemo(() => {
        const m = new Map();
        for (const r of filtered) {
            const k = dayKeySortable(r.date);
            if (!m.has(k)) m.set(k, { sortKey: k, label: dayKey(r.date), runs: [] });
            m.get(k).runs.push(r);
        }
        return [...m.values()].sort((a, b) => (a.sortKey < b.sortKey ? 1 : -1));
    }, [filtered]);

    const totals = useMemo(() => {
        const fileSet = new Set();
        const projSet = new Set();
        for (const r of filtered) {
            r.files.forEach((f) => fileSet.add(f));
            if (r.project_id != null) projSet.add(r.project_id);
        }
        return { runs: filtered.length, files: fileSet.size, projects: projSet.size, days: groups.length };
    }, [filtered, groups]);

    return (
        <div className="space-y-8">
            {/* Header + filters */}
            <div className="flex items-end justify-between flex-wrap gap-4 px-2">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">Run Log</h2>
                    <p className="text-xs text-slate-500 mt-1">
                        Which files / projects were QC&apos;d in a date range — one row per run, grouped by day.
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
                        onClick={applyFilters}
                        className="text-xs font-bold px-4 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                    >
                        Apply
                    </button>
                </div>
            </div>

            {!loading && !error && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <StatCard label="Runs" value={totals.runs} accent="blue" />
                    <StatCard label="Files" value={totals.files} accent="violet" />
                    <StatCard label="Projects" value={totals.projects} accent="emerald" />
                    <StatCard label="Active Days" value={totals.days} accent="slate" />
                </div>
            )}

            {!loading && !error && runs.length > 0 && (
                <div className="px-2">
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Filter by file name, project id, or state…"
                        className="w-full sm:w-96 text-xs border border-slate-200 rounded-lg px-3 py-2"
                    />
                </div>
            )}

            {loading && (
                <div className="flex items-center justify-center py-20">
                    <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-600 rounded-full animate-spin"></div>
                </div>
            )}

            {!loading && error && (
                <div className="p-6 rounded-xl bg-red-50 border border-red-100 text-red-700">
                    <div className="font-semibold mb-1">Run Log error</div>
                    <div className="text-sm whitespace-pre-wrap">{error}</div>
                    <button
                        onClick={applyFilters}
                        className="mt-3 text-xs font-bold px-3 py-1.5 rounded-md bg-red-600 text-white hover:bg-red-700"
                    >
                        Retry
                    </button>
                </div>
            )}

            {!loading && !error && groups.length === 0 && (
                <div className="p-10 text-center text-sm text-slate-400 bg-white border border-slate-200 rounded-2xl">
                    No runs found in this date range.
                </div>
            )}

            {!loading && !error && groups.map((g) => (
                <div key={g.sortKey} className="space-y-2">
                    <div className="flex items-center gap-2 px-2">
                        <h3 className="text-sm font-bold text-slate-700">{g.label}</h3>
                        <span className="text-xs font-medium text-slate-400">
                            {g.runs.length} run{g.runs.length > 1 ? 's' : ''}
                        </span>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-slate-100">
                                <thead className="bg-slate-50">
                                    <tr>
                                        <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">Time</th>
                                        <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">Project</th>
                                        <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">File(s)</th>
                                        <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">State</th>
                                        <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">Type</th>
                                        <th className="px-4 py-3 text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider">Checks</th>
                                        <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">AI (P/F/W)</th>
                                        <th className="px-4 py-3 text-right text-[10px] font-bold text-violet-700 uppercase tracking-wider">Human Reviewed</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {g.runs.map((r) => (
                                        <tr key={r.run_id} className="hover:bg-slate-50 align-top">
                                            <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">{formatTime(r.date)}</td>
                                            <td className="px-4 py-3 text-xs font-mono text-slate-600">{r.project_id ?? '—'}</td>
                                            <td className="px-4 py-3 text-xs text-slate-700">
                                                {r.files.length === 0 ? (
                                                    <span className="text-slate-400">—</span>
                                                ) : (
                                                    <div className="flex flex-col gap-0.5 max-w-md">
                                                        {r.files.map((f, i) => (
                                                            <span key={i} className="font-medium break-all">{f}</span>
                                                        ))}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-xs text-slate-600">{r.states.join(', ') || '—'}</td>
                                            <td className="px-4 py-3">
                                                <div className="flex flex-wrap gap-1">
                                                    {r.dims.map((d) => (
                                                        <span key={d} className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-bold uppercase border ${DIM_STYLE[d] || 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                                                            {d}
                                                        </span>
                                                    ))}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-xs text-right text-slate-700 font-semibold">{r.checks}</td>
                                            <td className="px-4 py-3"><CountChips pass={r.pass} fail={r.fail} warning={r.warning} /></td>
                                            <td className="px-4 py-3 text-xs text-right text-violet-700 font-semibold">{r.reviewed}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
};

export default RunLog;
