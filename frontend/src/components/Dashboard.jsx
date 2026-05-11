import React, { useEffect, useState } from 'react';
import { fetchStats, fetchSessions, fetchSession } from '../api';

const StatCard = ({ label, value, hint, accent = 'blue' }) => {
    const accents = {
        blue: 'text-blue-600 bg-blue-50 border-blue-100',
        amber: 'text-amber-700 bg-amber-50 border-amber-100',
        emerald: 'text-emerald-700 bg-emerald-50 border-emerald-100',
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

const formatDate = (iso) => {
    if (!iso) return '-';
    try {
        return new Date(iso).toLocaleString();
    } catch {
        return iso;
    }
};

const Dashboard = () => {
    const [stats, setStats] = useState(null);
    const [sessions, setSessions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selectedSession, setSelectedSession] = useState(null);
    const [sessionLoading, setSessionLoading] = useState(false);

    const loadData = async () => {
        setLoading(true);
        setError(null);
        try {
            const [s, list] = await Promise.all([fetchStats(), fetchSessions(100)]);
            setStats(s);
            setSessions(list);
        } catch (e) {
            console.error(e);
            setError('Failed to load dashboard data. Is MongoDB configured?');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    const openSession = async (sessionId) => {
        setSessionLoading(true);
        try {
            const s = await fetchSession(sessionId);
            setSelectedSession(s);
        } catch (e) {
            console.error(e);
            alert('Failed to load session details.');
        } finally {
            setSessionLoading(false);
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
                <div className="font-semibold mb-1">Dashboard error</div>
                <div className="text-sm">{error}</div>
                <button onClick={loadData} className="mt-3 text-xs font-bold px-3 py-1.5 rounded-md bg-red-600 text-white hover:bg-red-700">Retry</button>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            <div className="flex items-end justify-between px-2">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">Regeneration Insights</h2>
                    <p className="text-xs text-slate-500 mt-1">Track which sessions are getting regenerated vs blindly copy-pasted.</p>
                </div>
                <button onClick={loadData} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200">
                    Refresh
                </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                <StatCard label="Total Sessions" value={stats.total_sessions} accent="blue" />
                <StatCard label="Total Checks" value={stats.total_checks} accent="slate" />
                <StatCard
                    label="Engagement Rate"
                    value={`${stats.engagement_rate ?? 0}%`}
                    hint="checks regenerated or edited"
                    accent="emerald"
                />
                <StatCard
                    label="Regeneration Rate"
                    value={`${stats.regeneration_rate}%`}
                    hint={`${stats.total_regenerated_checks} of ${stats.total_checks} via AI`}
                    accent="amber"
                />
                <StatCard
                    label="Manual Edit Rate"
                    value={`${stats.manual_edit_rate ?? 0}%`}
                    hint={`${stats.total_manually_edited_checks ?? 0} of ${stats.total_checks} hand-edited`}
                    accent="violet"
                />
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Recent Sessions</h3>
                    <span className="text-xs text-slate-400">{sessions.length} sessions</span>
                </div>
                {sessions.length === 0 ? (
                    <div className="p-10 text-center text-sm text-slate-400">No sessions yet.</div>
                ) : (
                    <table className="min-w-full divide-y divide-slate-100">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">Created</th>
                                <th className="px-6 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">Session</th>
                                <th className="px-6 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">Preview</th>
                                <th className="px-6 py-3 text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider">Checks</th>
                                <th className="px-6 py-3 text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider">Regen'd</th>
                                <th className="px-6 py-3 text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider">Edited</th>
                                <th className="px-6 py-3 text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider">Engagement</th>
                                <th className="px-6 py-3"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {sessions.map((s) => {
                                const regen = s.regenerated_checks_count || 0;
                                const edited = s.manually_edited_checks_count || 0;
                                const engaged = Math.min(regen + edited, s.total_checks || 0);
                                const engRate = s.total_checks ? Math.round((engaged / s.total_checks) * 100) : 0;
                                const engColor = engRate === 0 ? 'text-slate-400' : engRate < 25 ? 'text-amber-600' : 'text-emerald-700';
                                return (
                                    <tr key={s.session_id} className="hover:bg-slate-50">
                                        <td className="px-6 py-3 text-xs text-slate-600">{formatDate(s.created_at)}</td>
                                        <td className="px-6 py-3 text-[11px] font-mono text-slate-500">{s.session_id.slice(0, 10)}…</td>
                                        <td className="px-6 py-3 text-xs text-slate-600 max-w-md truncate">{s.raw_text_preview || '-'}</td>
                                        <td className="px-6 py-3 text-xs text-right text-slate-700 font-semibold">{s.total_checks}</td>
                                        <td className="px-6 py-3 text-xs text-right text-amber-700 font-semibold">
                                            {regen}
                                            {(s.total_regenerations || 0) > regen && (
                                                <span className="text-[10px] text-slate-400 ml-1">({s.total_regenerations} total)</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-3 text-xs text-right text-violet-700 font-semibold">
                                            {edited}
                                            {(s.total_manual_edits || 0) > edited && (
                                                <span className="text-[10px] text-slate-400 ml-1">({s.total_manual_edits} total)</span>
                                            )}
                                        </td>
                                        <td className={`px-6 py-3 text-xs text-right font-bold ${engColor}`}>{engRate}%</td>
                                        <td className="px-6 py-3 text-right">
                                            <button
                                                onClick={() => openSession(s.session_id)}
                                                className="text-[11px] font-bold text-blue-600 hover:text-blue-800"
                                            >
                                                View →
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            {selectedSession && (
                <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={() => setSelectedSession(null)}>
                    <div
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                            <div>
                                <h3 className="text-base font-bold text-slate-800">Session detail</h3>
                                <p className="text-[11px] font-mono text-slate-400">{selectedSession.session_id}</p>
                            </div>
                            <button onClick={() => setSelectedSession(null)} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
                        </div>
                        {sessionLoading ? (
                            <div className="p-10 flex items-center justify-center">
                                <div className="w-6 h-6 border-2 border-blue-500/30 border-t-blue-600 rounded-full animate-spin"></div>
                            </div>
                        ) : (
                            <div className="overflow-y-auto p-6 space-y-4">
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                                    <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                                        <div className="text-[10px] font-bold uppercase text-slate-400">Created</div>
                                        <div className="mt-1 font-semibold text-slate-700">{formatDate(selectedSession.created_at)}</div>
                                    </div>
                                    <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                                        <div className="text-[10px] font-bold uppercase text-slate-400">Total Checks</div>
                                        <div className="mt-1 font-semibold text-slate-700">{selectedSession.total_checks}</div>
                                    </div>
                                    <div className="p-3 rounded-lg bg-amber-50 border border-amber-100">
                                        <div className="text-[10px] font-bold uppercase text-amber-700">Regenerated</div>
                                        <div className="mt-1 font-semibold text-amber-800">
                                            {selectedSession.regenerated_checks_count || 0} ({selectedSession.total_regenerations || 0} total)
                                        </div>
                                    </div>
                                    <div className="p-3 rounded-lg bg-violet-50 border border-violet-100">
                                        <div className="text-[10px] font-bold uppercase text-violet-700">Manually Edited</div>
                                        <div className="mt-1 font-semibold text-violet-800">
                                            {selectedSession.manually_edited_checks_count || 0} ({selectedSession.total_manual_edits || 0} total)
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    {(selectedSession.checks || []).map((c) => {
                                        const bg = c.is_manually_edited && c.is_regenerated
                                            ? 'bg-gradient-to-r from-amber-50/40 to-violet-50/40 border-violet-200'
                                            : c.is_manually_edited
                                                ? 'bg-violet-50/40 border-violet-200'
                                                : c.is_regenerated
                                                    ? 'bg-amber-50/40 border-amber-200'
                                                    : 'bg-slate-50 border-slate-100';
                                        return (
                                            <div key={c.check_index} className={`p-4 rounded-xl border ${bg}`}>
                                                <div className="flex items-start justify-between gap-2 flex-wrap">
                                                    <div className="text-sm font-semibold text-slate-800 flex items-center gap-2 flex-wrap">
                                                        {c.check_name}
                                                        {c.is_regenerated && (
                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-800 uppercase">
                                                                ↻ {c.regeneration_count}x
                                                            </span>
                                                        )}
                                                        {c.is_manually_edited && (
                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-violet-100 text-violet-800 uppercase">
                                                                ✎ {c.manual_edit_count}x
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="mt-1 text-[11px] text-slate-500">{c.category}</div>
                                                <div className="mt-2 text-xs text-slate-700 whitespace-pre-wrap">{c.qc_prompt}</div>

                                                {c.is_regenerated && c.regeneration_history?.length > 0 && (
                                                    <details className="mt-3">
                                                        <summary className="text-[11px] font-bold text-amber-700 cursor-pointer hover:text-amber-900">
                                                            Regeneration history ({c.regeneration_history.length})
                                                        </summary>
                                                        <div className="mt-2 space-y-2">
                                                            {c.regeneration_history.map((h, hi) => (
                                                                <div key={hi} className="p-3 rounded-lg bg-white border border-amber-100 text-[11px]">
                                                                    <div className="text-slate-400">{formatDate(h.timestamp)}</div>
                                                                    <div className="mt-1"><span className="font-bold text-slate-600">Instruction:</span> {h.instruction}</div>
                                                                    <div className="mt-1"><span className="font-bold text-slate-600">Old:</span> <span className="text-slate-500">{h.old_prompt}</span></div>
                                                                    <div className="mt-1"><span className="font-bold text-slate-600">New:</span> <span className="text-slate-700">{h.new_prompt}</span></div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </details>
                                                )}

                                                {c.is_manually_edited && c.manual_edit_history?.length > 0 && (
                                                    <details className="mt-3">
                                                        <summary className="text-[11px] font-bold text-violet-700 cursor-pointer hover:text-violet-900">
                                                            Manual edit history ({c.manual_edit_history.length})
                                                        </summary>
                                                        <div className="mt-2 space-y-2">
                                                            {c.manual_edit_history.map((h, hi) => (
                                                                <div key={hi} className="p-3 rounded-lg bg-white border border-violet-100 text-[11px]">
                                                                    <div className="text-slate-400">{formatDate(h.timestamp)}</div>
                                                                    <div className="mt-1"><span className="font-bold text-slate-600">Before:</span> <span className="text-slate-500">{h.old_prompt}</span></div>
                                                                    <div className="mt-1"><span className="font-bold text-slate-600">After:</span> <span className="text-slate-700">{h.new_prompt}</span></div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </details>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default Dashboard;
