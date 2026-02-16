import React, { useState } from 'react';

const CheckGenerator = ({ onGenerate, isLoading }) => {
    const [rawText, setRawText] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!rawText.trim()) return;
        onGenerate(rawText);
    };

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-end">
                <div>
                    <h2 className="text-xl font-semibold text-slate-800">Raw Data Input</h2>
                    <p className="text-sm text-slate-500">Paste the jurisdiction text or permit data below.</p>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
                <textarea
                    className="w-full h-64 p-4 text-slate-700 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all shadow-sm"
                    placeholder="Paste raw text here..."
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                    disabled={isLoading}
                />
                <div className="flex justify-end">
                    <button
                        type="submit"
                        className="btn-primary px-8 py-3 text-lg font-medium shadow-lg shadow-blue-200"
                        disabled={isLoading || !rawText.trim()}
                    >
                        {isLoading ? (
                            <>
                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                Analyzing Data...
                            </>
                        ) : (
                            <>
                                ✨ Generate QC Checklist
                            </>
                        )}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default CheckGenerator;
