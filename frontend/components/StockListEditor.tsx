"use client";
import { useState } from "react";
import { setConfig } from "@/lib/api";

interface Props {
  configKey: string;
  label: string;
  initialStocks: string[];
  onSaved?: () => void;
}

export default function StockListEditor({ configKey, label, initialStocks, onSaved }: Props) {
  const [text,    setText]    = useState(initialStocks.join("\n"));
  const [saving,  setSaving]  = useState(false);
  const [message, setMessage] = useState("");

  async function handleSave() {
    setSaving(true);
    setMessage("");
    const stocks = text.split("\n").map(s => s.trim()).filter(Boolean);
    try {
      await setConfig(configKey, stocks);
      setMessage("Saved");
    } catch {
      setMessage("Error saving");
    } finally {
      setSaving(false);
      onSaved?.();
    }
  }

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-3">
      <label className="block text-sm font-medium text-white">{label}</label>
      <textarea
        value={text} onChange={e => setText(e.target.value)}
        rows={8}
        placeholder="One symbol per line, e.g. NSE:SBIN-EQ"
        className="w-full bg-gray-800 text-white text-sm font-mono rounded-lg p-3 border border-gray-700 resize-y focus:outline-none focus:border-brand-500"
      />
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave} disabled={saving}
          className="bg-brand-600 hover:bg-brand-500 text-white text-sm px-4 py-1.5 rounded-lg transition disabled:opacity-50"
        >
          {saving ? "Saving\u2026" : "Save"}
        </button>
        {message && <span className="text-sm text-gray-400">{message}</span>}
        <span className="text-sm text-gray-500 ml-auto">
          {text.split("\n").filter(Boolean).length} stocks
        </span>
      </div>
    </div>
  );
}
