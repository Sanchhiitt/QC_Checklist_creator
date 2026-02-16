import React, { useState } from 'react';
import CheckGenerator from './components/CheckGenerator';
import ChecksTable from './components/ChecksTable';
import { generateChecks } from './api';

function App() {
    const [checks, setChecks] = useState([]);
    const [isGenerating, setIsGenerating] = useState(false);
    const [message, setMessage] = useState(null);

    const handleUpdateCheck = (index, updatedCheck) => {
        const newChecks = [...checks];
        newChecks[index] = updatedCheck;
        setChecks(newChecks);
    };

    const handleGenerate = async (rawText) => {
        setIsGenerating(true);
        setMessage(null);
        try {
            const generatedChecks = await generateChecks(rawText);
            setChecks(generatedChecks);
            // Smooth scroll to results
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
                    <div className="hidden md:flex gap-6 text-sm font-medium text-slate-500">
                        <span className="text-blue-600 italic">v2.0 Beta</span>
                    </div>
                </div>
            </nav>

            <div className="container px-4">
                {/* Main Content Area */}
                <div className="grid grid-cols-1 gap-8">

                    <div className="glass-card bg-white border border-slate-200 rounded-2xl p-8 shadow-xl shadow-slate-200/50">
                        <CheckGenerator onGenerate={handleGenerate} isLoading={isGenerating} />
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
                        <ChecksTable checks={checks} onUpdateCheck={handleUpdateCheck} />
                    </div>
                </div>
            </div>

            <footer className="mt-20 py-8 border-t border-slate-200 text-center text-slate-400 text-xs">
                &copy; 2026 Wattmonk QC Solutions. Powered by Gemini Flash 2.0.
            </footer>
        </div>
    );
}

export default App;
