"use client";
import { useState } from "react";
import { Bot, Loader2, AlertCircle, ExternalLink } from "lucide-react";
import { getDailyAIAnalysis, AIAnalysis, DailyScanResult } from "@/lib/api";

interface Props {
  result: DailyScanResult;
  cached: AIAnalysis | null;
  onAnalyzed: (analysis: AIAnalysis) => void;
}

export default function AIAnalysisPanel({ result, cached, onAnalyzed }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [data, setData]       = useState<AIAnalysis | null>(cached);

  async function handleAnalyze() {
    setLoading(true);
    setError(null);
    try {
      const analysis = await getDailyAIAnalysis(result.id);
      setData(analysis);
      onAnalyzed(analysis);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }

  if (!data) {
    return (
      <div className="flex items-center gap-3 p-4 bg-gray-800/50 rounded-lg border border-gray-700">
        <Bot size={18} className="text-brand-400 shrink-0" />
        <div className="flex-1">
          <p className="text-sm text-gray-300">Get AI analysis: news sentiment, technical commentary, and success/failure probabilities.</p>
        </div>
        <button
          onClick={handleAnalyze}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 rounded-lg text-sm text-white transition"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Bot size={14} />}
          {loading ? "Analyzing…" : "Analyze with AI"}
        </button>
        {error && (
          <div className="flex items-center gap-1 text-red-400 text-xs mt-1">
            <AlertCircle size={12} /> {error}
          </div>
        )}
      </div>
    );
  }

  const parsed       = data.reasoning_parsed ?? {};
  const successPct   = Math.round((data.success_probability ?? 0.5) * 100);
  const failurePct   = Math.round((data.failure_probability ?? 0.5) * 100);
  const news         = Array.isArray(data.news_headlines) ? data.news_headlines : [];
  const target       = parsed.target_price;
  const support      = parsed.support_price;

  return (
    <div className="space-y-4">
      {/* Probability bars */}
      <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Outcome Probability</span>
          <button
            onClick={handleAnalyze}
            disabled={loading}
            title="Refresh AI analysis"
            className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1 transition"
          >
            {loading ? <Loader2 size={11} className="animate-spin" /> : <Bot size={11} />}
            Refresh
          </button>
        </div>

        <div className="space-y-2">
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-green-400 font-medium">Success (Breakout)</span>
              <span className="text-green-400 font-bold">{successPct}%</span>
            </div>
            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
              <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${successPct}%` }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-red-400 font-medium">Failure (Breakdown)</span>
              <span className="text-red-400 font-bold">{failurePct}%</span>
            </div>
            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
              <div className="h-full bg-red-500 rounded-full transition-all" style={{ width: `${failurePct}%` }} />
            </div>
          </div>
        </div>

        {(target || support) && (
          <div className="flex gap-4 mt-3 pt-3 border-t border-gray-700">
            {target  ? <div className="text-xs"><span className="text-gray-500">Target: </span><span className="text-green-400 font-medium">₹{target}</span></div>  : null}
            {support ? <div className="text-xs"><span className="text-gray-500">Support: </span><span className="text-yellow-400 font-medium">₹{support}</span></div> : null}
          </div>
        )}
      </div>

      {/* Technical summary */}
      <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Technical Analysis</p>
        <p className="text-sm text-gray-200 leading-relaxed">{data.technical_summary}</p>
      </div>

      {/* News sentiment */}
      {parsed.news_summary && (
        <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">News Sentiment</p>
          <p className="text-sm text-gray-200 leading-relaxed">{parsed.news_summary}</p>
        </div>
      )}

      {/* Reasoning */}
      {parsed.reasoning && (
        <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">AI Reasoning</p>
          <p className="text-sm text-gray-300 leading-relaxed">{parsed.reasoning}</p>
        </div>
      )}

      {/* News headlines */}
      {news.length > 0 && (
        <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Recent Headlines</p>
          <ul className="space-y-2">
            {news.map((n, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-gray-500 shrink-0" />
                <div>
                  <p className="text-xs text-gray-200">{n.title}</p>
                  {n.source && <p className="text-xs text-gray-500">{n.source} · {n.published}</p>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-gray-600">Analyzed at {new Date(data.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST</p>
    </div>
  );
}
