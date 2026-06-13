import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload, FileSpreadsheet, CheckCircle2, X, Loader,
  Users, UserCheck, ChevronDown, ChevronUp,
} from "lucide-react";
import axios from "axios";
import toast from "react-hot-toast";

interface UploadResult {
  message: string;
  total_records: number;
  sample_fields: string[];
}

export default function MentorUpload() {
  const [result, setResult] = useState<UploadResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showFields, setShowFields] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    const name = file.name.toLowerCase();
    if (!name.endsWith(".xlsx") && !name.endsWith(".xls") && !name.endsWith(".csv")) {
      toast.error("Only .xlsx, .xls, or .csv files are supported.");
      return;
    }
    setLoading(true);
    setResult(null);
    const form = new FormData();
    form.append("file", file);
    try {
  const res = await axios.post(
    "http://10.10.135.52:9000/mentor-mentee",
    form,
    {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    }
  );

    console.log("SUCCESS RESPONSE:", res.data);

  setResult(res.data);
  toast.success(res.data.message || "Uploaded successfully!");
} catch (err: any) {
  console.log("ERROR:", err);
  console.log(err.response);
  console.log(err.response?.data);

  toast.error(
    err.response?.data?.message || "Upload failed. Please try again."
  );
} finally {
  setLoading(false);
}
};

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  return (
    <div className="space-y-6">
      {/* Info banner */}
      <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-xl p-4 flex gap-3">
        <UserCheck className="text-indigo-400 shrink-0 mt-0.5" size={18} />
        <div className="text-sm text-slate-300">
          <p className="font-medium text-indigo-300 mb-1">Expected columns in your Excel / CSV:</p>
          <p className="text-slate-400 leading-relaxed">
            Registration ID · Application Number · Name · Email · Phone · Department · Programme ·
            Batch Year · Gender · Quota · Academic Status · Current Year · Mentor Name · Mentor Contact · Mentor Email
          </p>
          <p className="text-slate-500 mt-2 text-xs">
            Column names are flexible — common variations are auto-detected.
          </p>
        </div>
      </div>

      {/* Upload Zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all
          ${dragOver
            ? "border-indigo-400 bg-indigo-500/10"
            : "border-gray-600 hover:border-indigo-500 hover:bg-indigo-500/5"
          }`}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
        {loading ? (
          <div className="flex flex-col items-center gap-3 text-indigo-400">
            <Loader className="animate-spin" size={36} />
            <p className="font-medium">Processing file…</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 text-gray-400">
            <FileSpreadsheet size={40} className={dragOver ? "text-indigo-400" : "text-gray-500"} />
            <p className="text-lg font-medium">Drop Excel / CSV here or click to browse</p>
            <p className="text-sm">Supports .xlsx · .xls · .csv</p>
          </div>
        )}
      </div>

      {/* Success result */}
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="bg-green-500/10 border border-green-500/30 rounded-xl p-5 space-y-3"
          >
            <div className="flex items-center gap-3">
              <CheckCircle2 className="text-green-400 shrink-0" size={22} />
              <div>
                <p className="text-green-300 font-semibold">{result.message}</p>
                <p className="text-slate-400 text-sm mt-0.5">
                  <Users className="inline mr-1" size={13} />
                  {result.total_records} student records saved to chatbot knowledge base.
                </p>
              </div>
            </div>

            {/* Detected fields accordion */}
            {result.sample_fields.length > 0 && (
              <div className="border-t border-green-500/20 pt-3">
                <button
                  onClick={() => setShowFields(!showFields)}
                  className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
                >
                  {showFields ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  {showFields ? "Hide" : "Show"} detected fields ({result.sample_fields.length})
                </button>
                <AnimatePresence>
                  {showFields && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-3 flex flex-wrap gap-2">
                        {result.sample_fields.map((f) => (
                          <span
                            key={f}
                            className="px-2 py-1 bg-slate-700 text-slate-300 rounded text-xs font-mono"
                          >
                            {f}
                          </span>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* Re-upload hint */}
            <p className="text-slate-500 text-xs">
              To update the data, simply upload a new file — it will replace the existing records.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Usage examples */}
      <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-4">
        <p className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-3">
          Chatbot query examples after upload
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {[
            "Who is the mentor of Rahul Sharma?",
            "Show details of EN24001",
            "Who is mentor of admission no 24CS101?",
            "Give complete details of Priya Singh",
            "List mentees of Dr. Mehta",
            "How many students are assigned to Prof Sharma?",
            "Show all mentees under Ankit Sir",
            "What is the mentor email of student 230160223057?",
          ].map((q) => (
            <div
              key={q}
              className="flex items-start gap-2 text-xs text-slate-400 bg-slate-800 rounded-lg px-3 py-2"
            >
              <span className="text-indigo-400 mt-0.5">›</span>
              <span>{q}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
