interface Props { outcome: string | null }
export default function OutcomeBadge({ outcome }: Props) {
  if (!outcome) return <span className="text-xs text-gray-500">—</span>;
  const map: Record<string, { label: string; cls: string }> = {
    success: { label: "Success", cls: "bg-green-900/60 text-green-400 border border-green-700" },
    failure: { label: "Failure", cls: "bg-red-900/60 text-red-400 border border-red-700" },
    pending: { label: "Pending", cls: "bg-yellow-900/60 text-yellow-400 border border-yellow-700" },
    open:    { label: "Open",    cls: "bg-gray-800 text-gray-400 border border-gray-600" },
  };
  const style = map[outcome] ?? map.open;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${style.cls}`}>
      {style.label}
    </span>
  );
}
