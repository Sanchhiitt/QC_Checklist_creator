import React, { useState, useEffect, useRef } from 'react';
import { regeneratePrompt } from '../api';
import * as XLSX from 'xlsx';

const CATEGORIES = [
    'Cover Page',
    'Site Plan',
    'Roof Plan And Modules',
    'Attachment Detail',
    'String Layout And Bom',
    'Electrical Line Diagram And Calculations',
    'Electrical Specifications And Notes',
    'Signage And Placard',
    'Equipment Specification',
    'Electrical Load Calculation',
    'Equipment Elevation'
];

const ChecksTable = ({ checks, onUpdateCheck }) => {
    const [editingIndex, setEditingIndex] = useState(null);
    const [editValues, setEditValues] = useState({});
    const [regeneratingIndex, setRegeneratingIndex] = useState(null);
    const [userInstruction, setUserInstruction] = useState('');
    const [isRegenerating, setIsRegenerating] = useState(false);
    const [selectedIndices, setSelectedIndices] = useState([]);
    const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
    const dropdownRef = useRef(null);

    useEffect(() => {
        if (checks.length > 0 && selectedIndices.length === 0) {
            setSelectedIndices(checks.map((_, i) => i));
        }
    }, [checks.length]);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setShowCategoryDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    if (!checks.length) return null;

    const handleEdit = (index, check) => {
        setEditingIndex(index);
        // Ensure categories are handled as an array
        const categoriesArr = check.category.split(',').map(c => c.trim()).filter(c => c);
        setEditValues({
            check_name: check.check_name,
            categories: categoriesArr
        });
    };

    const handleSaveEdit = (index) => {
        onUpdateCheck(index, {
            ...checks[index],
            check_name: editValues.check_name,
            category: editValues.categories.join(', ')
        });
        setEditingIndex(null);
    };

    const toggleCategory = (cat) => {
        setEditValues(prev => {
            const { categories } = prev;
            if (categories.includes(cat)) {
                return { ...prev, categories: categories.filter(c => c !== cat) };
            } else {
                return { ...prev, categories: [...categories, cat] };
            }
        });
    };

    const handleRegenerate = async (index, currentPrompt) => {
        if (!userInstruction.trim()) return;
        setIsRegenerating(true);
        try {
            const newPrompt = await regeneratePrompt(currentPrompt, userInstruction);
            onUpdateCheck(index, {
                ...checks[index],
                qc_prompt: newPrompt
            });
            setRegeneratingIndex(null);
            setUserInstruction('');
        } catch (error) {
            console.error("Error regenerating prompt:", error);
            alert("Failed to regenerate prompt. Please try again.");
        } finally {
            setIsRegenerating(false);
        }
    };

    const handleDownloadExcel = () => {
        const selectedChecks = checks.filter((_, index) => selectedIndices.includes(index));
        const data = selectedChecks.map(check => ({
            "Check Name": check.check_name,
            "Category": check.category,
            "QC Prompt": check.qc_prompt
        }));

        const worksheet = XLSX.utils.json_to_sheet(data);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "QC Checklist");

        // Formatting cols
        worksheet["!cols"] = [
            { wch: 30 }, // Check Name
            { wch: 40 }, // Category
            { wch: 80 }, // QC Prompt
        ];

        XLSX.writeFile(workbook, "QC_Checklist.xlsx");
    };

    return (
        <div className="mt-12 space-y-6">
            <div className="flex items-center justify-between px-2">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">Generated Checks</h2>
                    <p className="text-xs text-slate-500 mt-1">Review, edit, and export your QC checklist.</p>
                </div>
                <div className="flex items-center gap-4">
                    <button
                        onClick={handleDownloadExcel}
                        disabled={selectedIndices.length === 0}
                        className={`flex items-center gap-2 text-[11px] font-bold px-4 py-2 rounded-lg transition-all shadow-sm border ${selectedIndices.length > 0
                                ? 'text-emerald-700 bg-emerald-50 border-emerald-100 hover:bg-emerald-100 shadow-emerald-100/50'
                                : 'text-slate-400 bg-slate-50 border-slate-100 cursor-not-allowed'
                            }`}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                        Export {selectedIndices.length} Selected
                    </button>
                    <span className="text-sm font-medium text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
                        {checks.length} items
                    </span>
                </div>
            </div>

            <div className="overflow-hidden bg-white border border-slate-200 rounded-xl shadow-sm">
                <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-50">
                        <tr>
                            <th className="px-6 py-4 text-left w-12">
                                <input
                                    type="checkbox"
                                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                    checked={selectedIndices.length === checks.length && checks.length > 0}
                                    onChange={() => {
                                        if (selectedIndices.length === checks.length) setSelectedIndices([]);
                                        else setSelectedIndices(checks.map((_, i) => i));
                                    }}
                                />
                            </th>
                            <th className="px-4 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider w-1/4">Check Details</th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider w-3/4">QC Prompt & Logic</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                        {checks.map((check, index) => (
                            <tr
                                key={index}
                                className={`transition-colors ${selectedIndices.includes(index) ? 'bg-white' : 'bg-slate-50/30'}`}
                            >
                                <td className="px-6 py-6 align-top">
                                    <input
                                        type="checkbox"
                                        className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer mt-1"
                                        checked={selectedIndices.includes(index)}
                                        onChange={() => {
                                            setSelectedIndices(prev => prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]);
                                        }}
                                    />
                                </td>
                                <td className="px-4 py-6 align-top">
                                    {editingIndex === index ? (
                                        <div className="space-y-4">
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-400 uppercase">Check Name</label>
                                                <input
                                                    className="mt-1 block w-full border border-slate-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                                    value={editValues.check_name}
                                                    onChange={(e) => setEditValues({ ...editValues, check_name: e.target.value })}
                                                />
                                            </div>
                                            <div className="relative" ref={dropdownRef}>
                                                <label className="text-[10px] font-bold text-slate-400 uppercase">Categories</label>
                                                <div
                                                    className="mt-1 flex flex-wrap gap-1 border border-slate-300 rounded-lg p-2 text-sm min-h-[40px] cursor-pointer bg-white"
                                                    onClick={() => setShowCategoryDropdown(!showCategoryDropdown)}
                                                >
                                                    {editValues.categories.length > 0 ? (
                                                        editValues.categories.map(cat => (
                                                            <span key={cat} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md text-[10px] font-bold">
                                                                {cat}
                                                                <button
                                                                    className="hover:text-blue-900"
                                                                    onClick={(e) => { e.stopPropagation(); toggleCategory(cat); }}
                                                                >
                                                                    &times;
                                                                </button>
                                                            </span>
                                                        ))
                                                    ) : (
                                                        <span className="text-slate-400">Select categories...</span>
                                                    )}
                                                </div>
                                                {showCategoryDropdown && (
                                                    <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                                                        {CATEGORIES.map(cat => (
                                                            <div
                                                                key={cat}
                                                                className={`px-4 py-2 text-xs cursor-pointer flex items-center justify-between hover:bg-slate-50 ${editValues.categories.includes(cat) ? 'text-blue-600 font-bold bg-blue-50/50' : 'text-slate-600'}`}
                                                                onClick={() => toggleCategory(cat)}
                                                            >
                                                                {cat}
                                                                {editValues.categories.includes(cat) && <span>✓</span>}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex gap-2">
                                                <button className="bg-blue-600 text-white text-[11px] font-bold px-3 py-1.5 rounded-md hover:bg-blue-700" onClick={() => handleSaveEdit(index)}>Save</button>
                                                <button className="bg-slate-100 text-slate-600 text-[11px] font-bold px-3 py-1.5 rounded-md hover:bg-slate-200" onClick={() => setEditingIndex(null)}>Cancel</button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className={`space-y-3 transition-opacity ${selectedIndices.includes(index) ? 'opacity-100' : 'opacity-50'}`}>
                                            <div className="flex items-start justify-between">
                                                <span className="text-sm font-semibold text-slate-900 leading-tight">{check.check_name}</span>
                                                <button
                                                    className="ml-2 p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all border border-transparent hover:border-blue-100"
                                                    onClick={() => handleEdit(index, check)}
                                                    title="Edit check"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                                        <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                                                    </svg>
                                                </button>
                                            </div>
                                            <div className="flex flex-wrap gap-1.5">
                                                {check.category.split(',').map(cat => cat.trim()).filter(c => c).map(cat => (
                                                    <div key={cat} className="inline-flex items-center px-2.5 py-0.5 rounded-md text-[10px] font-bold bg-blue-50 text-blue-700 uppercase tracking-wider">
                                                        {cat}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </td>
                                <td className="px-6 py-6 align-top">
                                    <div className={`bg-slate-50 rounded-xl p-4 border border-slate-100 transition-opacity ${selectedIndices.includes(index) ? 'opacity-100' : 'opacity-50'}`}>
                                        <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap font-medium">
                                            {check.qc_prompt}
                                        </p>
                                        <div className="mt-4 pt-4 border-t border-slate-200 flex justify-between items-center">
                                            {regeneratingIndex === index ? (
                                                <div className="w-full space-y-3">
                                                    <textarea
                                                        placeholder="Tell AI what to fix..."
                                                        className="w-full text-sm p-3 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 outline-none min-h-[80px]"
                                                        value={userInstruction}
                                                        onChange={(e) => setUserInstruction(e.target.value)}
                                                    />
                                                    <div className="flex items-center gap-3">
                                                        <button
                                                            className="bg-slate-900 text-white text-xs font-bold px-4 py-2 rounded-lg hover:bg-slate-800 flex items-center gap-2"
                                                            onClick={() => handleRegenerate(index, check.qc_prompt)}
                                                            disabled={isRegenerating}
                                                        >
                                                            {isRegenerating ? (
                                                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                                            ) : '🚀 Rewrite Prompt'}
                                                        </button>
                                                        <button
                                                            className="text-slate-500 text-xs font-bold hover:text-slate-700"
                                                            onClick={() => { setRegeneratingIndex(null); setUserInstruction(''); }}
                                                            disabled={isRegenerating}
                                                        >
                                                            Discard
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <button
                                                    className="flex items-center gap-2 text-[11px] font-bold text-blue-700 hover:text-blue-900 bg-white border border-blue-100 px-3 py-2 rounded-lg shadow-sm hover:shadow transition-all"
                                                    onClick={() => setRegeneratingIndex(index)}
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                                        <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                                                    </svg>
                                                    Refine with AI
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default ChecksTable;
