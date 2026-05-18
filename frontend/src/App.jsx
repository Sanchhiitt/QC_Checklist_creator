import React, { useState } from 'react';
import CheckGenerator from './components/CheckGenerator';
import ChecksTable from './components/ChecksTable';
import Dashboard from './components/Dashboard';
import QCAnalytics from './components/QCAnalytics';
import { generateChecks } from './api';

function App() {
    const [checks, setChecks] = useState([]);
    const [sessionId, setSessionId] = useState(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [message, setMessage] = useState(null);
    const [view, setView] = useState('generator'); // 'generator' | 'dashboard' | 'analytics'

    const handleUpdateCheck = (index, updatedCheck) => {
        const newChecks = [...checks];
        newChecks[index] = updatedCheck;
        setChecks(newChecks);
    };

    const handleGenerate = async (rawText) => {
        setIsGenerating(true);
        setMessage(null);
        try {
            const data = await generateChecks(rawText);
            // Backwards-compatible: if server returns an array, treat it as plain checks
            const generated = Array.isArray(data) ? data : (data.checks || []);
            const sid = Array.isArray(data) ? null : (data.session_id || null);
            const enriched = generated.map((c) => ({
                ...c,
                is_regenerated: false,
                regeneration_count: 0,
            }));
            setChecks(enriched);
            setSessionId(sid);
            setTimeout(() => {
                window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
            }, 100);
        } catch (error) {
            console.error("Error generating checks:", error);
            setMessage({ type: 'error', text: 'Failed to generate checks. Please check your API key.' });
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="min-h-screen pb-20">
            {/* Sleek Top Navigation */}
            <nav className="bg-white border-b border-slate-200 py-4 px-6 mb-8 sticky top-0 z-10">
                <div className="max-w-7xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold">Q</div>
                        <h1 className="text-xl font-bold text-slate-900 tracking-tight">QC Genius <span className="text-blue-600 font-medium">Pro</span></h1>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setView('generator')}
                            className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${view === 'generator' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                        >
                            Generator
                        </button>
                        <button
                            onClick={() => setView('dashboard')}
                            className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${view === 'dashboard' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                        >
                            Dashboard
                        </button>
                        <button
                            onClick={() => setView('analytics')}
                            className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${view === 'analytics' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                        >
                            QC Analytics
                        </button>
                        <span className="hidden md:inline text-xs font-medium text-blue-600 italic ml-2">v2.1</span>
                    </div>
                </div>
            </nav>

            <div className="container px-4">
                {view === 'generator' && (
                    <div className="grid grid-cols-1 gap-8">
                        <div className="glass-card bg-white border border-slate-200 rounded-2xl p-8 shadow-xl shadow-slate-200/50">
                            <CheckGenerator onGenerate={handleGenerate} isLoading={isGenerating} />
                            {sessionId && (
                                <p className="mt-4 text-[11px] text-slate-400">
                                    Session: <span className="font-mono text-slate-600">{sessionId}</span>
                                </p>
                            )}
                        </div>

                        {message && (
                            <div className={`p-4 rounded-xl border flex items-center gap-3 animate-in fade-in duration-300 ${message.type === 'error'
                                    ? 'bg-red-50 border-red-100 text-red-700'
                                    : 'bg-emerald-50 border-emerald-100 text-emerald-700'
                                }`}>
                                {message.type === 'error' ? '⚠️' : '✅'}
                                <span className="text-sm font-medium">{message.text}</span>
                            </div>
                        )}

                        <div id="results-area">
                            <ChecksTable
                                checks={checks}
                                onUpdateCheck={handleUpdateCheck}
                                sessionId={sessionId}
                            />
                        </div>
                    </div>
                )}
                {view === 'dashboard' && <Dashboard />}
                {view === 'analytics' && <QCAnalytics />}
            </div>

            <footer className="mt-20 py-8 border-t border-slate-200 text-center text-slate-400 text-xs">
                &copy; 2026 Wattmonk QC Solutions. Powered by Gemini Flash 2.0.
            </footer>
        </div>
    );
}

export default App;
