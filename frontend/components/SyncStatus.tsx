"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { triggerSync, getSyncStatus, SyncStatus as SyncStatusType } from "@/lib/api";

interface Props {
  timeframe: string;
  onSyncComplete?: () => void;
}

export default function SyncStatus({ timeframe, onSyncComplete }: Props) {
  const [status, setStatus] = useState<SyncStatusType>({ status: "idle" });
  const [syncing, setSyncing] = useState(false);
  const prevStatus = useRef<string>("idle");

  const fetchStatus = useCallback(async () => {
    try {
      const s = await getSyncStatus(timeframe) as SyncStatusType;
      setStatus(s);
      if (s.status === "running") {
        setSyncing(true);
      } else {
        if (prevStatus.current === "running") {
          if (s.status === "success") {
            toast.success("Sync complete", { description: s.message ?? undefined });
            onSyncComplete?.();
          } else if (s.status === "error") {
            toast.error("Sync failed", { description: s.message ?? undefined });
          }
        }
        setSyncing(false);
      }
      prevStatus.current = s.status;
    } catch { /* ignore */ }
  }, [timeframe, onSyncComplete]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  useEffect(() => {
    if (!syncing) return;
    const id = setInterval(fetchStatus, 3000);
    return () => clearInterval(id);
  }, [syncing, fetchStatus]);

  async function handleSync() {
    setSyncing(true);
    prevStatus.current = "running";
    setStatus({ status: "running", message: "Starting…" });
    try {
      await triggerSync(timeframe);
      toast.info("Sync started");
    } catch {
      toast.error("Failed to start sync");
      setSyncing(false);
    }
  }

  const color =
    status.status === "success" ? "text-green-400"
    : status.status === "error" ? "text-red-400"
    : status.status === "running" ? "text-yellow-400"
    : "text-gray-400";

  return (
    <div className="flex items-center gap-3">
      <span className={`text-sm ${color}`}>
        {status.status === "running"
          ? `Syncing… ${status.current ?? 0}/${status.total ?? "?"}`
          : status.message ?? status.status}
      </span>
      <button
        onClick={handleSync} disabled={syncing}
        className="flex items-center gap-1.5 text-sm bg-gray-800 hover:bg-gray-700 text-white px-3 py-1.5 rounded-lg transition disabled:opacity-50"
      >
        <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
        {syncing ? "Syncing…" : "Refresh"}
      </button>
    </div>
  );
}
