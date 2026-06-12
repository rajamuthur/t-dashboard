"use client";
import { useEffect, useRef } from "react";
import {
  INDICATORS, CATEGORY_ORDER, CATEGORY_LABEL, INDICATOR_COLOR, IndicatorCategory,
} from "@/lib/indicatorCatalog";

interface Props {
  enabled: Set<string>;
  onToggle: (id: string) => void;
  onSetMany: (ids: string[], on: boolean) => void;
  onClose: () => void;
}

export default function IndicatorsPanel({ enabled, onToggle, onSetMany, onClose }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);

  // Click-outside / Esc to dismiss
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const allIds = INDICATORS.map(i => i.id);
  const allOn = allIds.every(id => enabled.has(id));

  return (
    <div
      ref={rootRef}
      className="absolute z-20 top-full right-1 mt-1 w-64 max-h-[26rem] overflow-y-auto rounded-md border border-gray-700 bg-gray-900 shadow-2xl text-xs"
    >
      {/* Bulk-toggle header */}
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 px-2 py-1.5 bg-gray-900 border-b border-gray-800">
        <span className="text-[10px] tracking-wider text-gray-400 font-semibold">
          {enabled.size} of {allIds.length} active
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onSetMany(allIds, !allOn)}
            className="px-1.5 py-0.5 rounded border border-gray-700 hover:border-brand-500 hover:text-brand-300 text-[10px]"
            title={allOn ? "Deselect all" : "Select all"}
          >
            {allOn ? "Clear" : "Select all"}
          </button>
          {!allOn && enabled.size > 0 && (
            <button
              type="button"
              onClick={() => onSetMany(allIds, false)}
              className="px-1.5 py-0.5 rounded border border-gray-700 hover:border-red-500 hover:text-red-300 text-[10px]"
              title="Deselect all"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {CATEGORY_ORDER.map((cat: IndicatorCategory) => {
        const items = INDICATORS.filter(i => i.category === cat);
        if (items.length === 0) return null;
        const ids = items.map(i => i.id);
        const catAllOn = ids.every(id => enabled.has(id));
        const catAnyOn = ids.some(id => enabled.has(id));
        return (
          <div key={cat} className="px-2 pt-2 pb-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] tracking-wider text-gray-500 font-semibold">
                {CATEGORY_LABEL[cat]}
              </span>
              <button
                type="button"
                onClick={() => onSetMany(ids, !catAllOn)}
                className="text-[10px] text-gray-500 hover:text-brand-300"
                title={catAllOn ? "Hide all in category" : "Show all in category"}
              >
                {catAllOn ? "−" : catAnyOn ? "±" : "+"}
              </button>
            </div>
            <div className="space-y-0.5">
              {items.map(i => {
                const on = enabled.has(i.id);
                const swatch = INDICATOR_COLOR[i.id] ?? INDICATOR_COLOR[`${i.id}_line`] ?? "#94a3b8";
                return (
                  <label
                    key={i.id}
                    className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-gray-800 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => onToggle(i.id)}
                      className="w-3.5 h-3.5 accent-brand-500"
                    />
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-sm"
                      style={{ background: swatch }}
                    />
                    <span className={on ? "text-gray-100" : "text-gray-400"}>{i.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
