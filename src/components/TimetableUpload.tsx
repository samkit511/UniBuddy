import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, FileText, Download, X, Loader, ChevronDown, ChevronUp } from "lucide-react";
import axios from "axios";
import toast from "react-hot-toast";

interface SlotEntry {
  slot: number;
  time: string;
  classes: Record<string, string>;
}

interface TimetablePage {
  page: number;
  class: string;
  schedule: SlotEntry[];
  legend: Record<string, string>;
}

interface TimetableResult {
  filename: string;
  total_pages: number;
  timetables: TimetablePage[];
}

const DAYS = ["Mo", "Tu", "We", "Th", "Fr"];
const DAY_LABELS: Record<string, string> = {
  Mo: "Monday", Tu: "Tuesday", We: "Wednesday", Th: "Thursday", Fr: "Friday",
};

export default function TimetableUpload() {
  const [result, setResult] = useState<TimetableResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedPage, setExpandedPage] = useState<number | null>(0);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Only PDF files are supported.");
      return;
    }
    setLoading(true);
    setResult(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await axios.post("http://10.10.135.52:9000/timetable", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setResult(res.data);
      setExpandedPage(0);
      const msg = res.data.message || `Parsed ${res.data.total_pages} page(s) successfully!`;
      toast.success(msg);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Failed to parse PDF.");
    } finally {
      setLoading(false);
    }
  };

  const downloadJSON = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = result.filename.replace(".pdf", ".json");
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Upload Zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
        onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all
          ${dragOver ? "border-purple-400 bg-purple-500/10" : "border-gray-600 hover:border-purple-500 hover:bg-purple-500/5"}`}
      >
        <input ref={fileRef} type="file" accept=".pdf" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        {loading ? (
          <div className="flex flex-col items-center gap-3 text-purple-400">
            <Loader className="animate-spin" size={36} />
            <p>Parsing timetable...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 text-gray-400">
            <Upload size={36} className={dragOver ? "text-purple-400" : ""} />
            <p className="text-lg font-medium">Drop timetable PDF here or click to browse</p>
            <p className="text-sm">Supports GD Goenka University timetable format</p>
          </div>
        )}
      </div>

      {/* Results */}
      <AnimatePresence>
        {result && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-green-400">
                <FileText size={18} />
                <span className="font-medium">{result.filename}</span>
                <span className="text-gray-400 text-sm">— {result.total_pages} class(es) found</span>
              </div>
              <button onClick={downloadJSON}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm transition-colors">
                <Download size={14} /> Download JSON
              </button>
            </div>

            {/* Per-page timetables */}
            {result.timetables.map((tt, idx) => (
              <div key={idx} className="bg-gray-800/50 border border-gray-700 rounded-xl overflow-hidden">
                {/* Accordion header */}
                <button
                  onClick={() => setExpandedPage(expandedPage === idx ? null : idx)}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-700/30 transition-colors"
                >
                  <span className="font-semibold text-white">
                    Page {tt.page}{tt.class ? ` — ${tt.class}` : ""}
                  </span>
                  {expandedPage === idx ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>

                <AnimatePresence>
                  {expandedPage === idx && (
                    <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }}
                      className="overflow-hidden">
                      <div className="px-5 pb-5 space-y-4">
                        {/* Timetable grid */}
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs border-collapse">
                            <thead>
                              <tr className="bg-gray-700/50">
                                <th className="border border-gray-600 px-3 py-2 text-left text-gray-300">Time</th>
                                {DAYS.map(d => (
                                  <th key={d} className="border border-gray-600 px-3 py-2 text-gray-300">{DAY_LABELS[d]}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {tt.schedule.map((slot) => (
                                <tr key={slot.slot} className="hover:bg-gray-700/20">
                                  <td className="border border-gray-600 px-3 py-2 text-gray-400 whitespace-nowrap">{slot.time}</td>
                                  {DAYS.map(d => (
                                    <td key={d} className="border border-gray-600 px-3 py-2 text-center text-gray-200">
                                      {slot.classes[d] ? (
                                        <span className="bg-purple-600/20 text-purple-300 px-2 py-1 rounded text-xs block">
                                          {slot.classes[d]}
                                        </span>
                                      ) : "—"}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {/* Legend */}
                        {Object.keys(tt.legend).length > 0 && (
                          <div>
                            <p className="text-gray-400 text-xs font-semibold mb-2 uppercase tracking-wide">Legend</p>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-1">
                              {Object.entries(tt.legend).map(([code, name]) => (
                                <div key={code} className="flex gap-2 text-xs">
                                  <span className="text-purple-400 font-mono font-bold">{code}</span>
                                  <span className="text-gray-300">{name}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
