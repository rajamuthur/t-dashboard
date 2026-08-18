"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { isLoggedIn, clearToken } from "@/lib/auth";
import FyersTokenBadge from "@/components/FyersTokenBadge";
import IndexTicker from "@/components/IndexTicker";
import {
  LayoutDashboard, TrendingUp, Calendar, CandlestickChart, Settings, LogOut,
  ChevronDown, CalendarDays, Heart, PieChart, Activity, Radio, BookOpen,
  Shapes, Target, FlaskConical, Scale, Eye, GitFork, Bell,
  type LucideIcon,
} from "lucide-react";

type NavItem = { href: string; label: string; icon: LucideIcon };

const OVERVIEW: NavItem = { href: "/dashboard", label: "Overview", icon: LayoutDashboard };

const GROUPS: { key: string; label: string; items: NavItem[] }[] = [
  { key: "markets", label: "Markets", items: [
    { href: "/dashboard/watchlist",   label: "Watchlist",    icon: Eye },
    { href: "/dashboard/alerts",      label: "Alerts",       icon: Bell },
    { href: "/dashboard/charts",      label: "Charts",       icon: CandlestickChart },
    { href: "/dashboard/live-charts", label: "Live Charts",  icon: Radio },
  ]},
  { key: "analysis", label: "Analysis", items: [
    { href: "/dashboard/weekly",         label: "Weekly",    icon: TrendingUp },
    { href: "/dashboard/monthly",        label: "Monthly",   icon: Calendar },
    { href: "/dashboard/daily-patterns", label: "Daily",     icon: Activity },
    { href: "/dashboard/analytics",      label: "Analytics", icon: PieChart },
  ]},
  { key: "scanners", label: "Scanners", items: [
    { href: "/dashboard/patterns", label: "Patterns",      icon: Shapes },
    { href: "/dashboard/vcp",      label: "VCP Scanner",   icon: Target },
    { href: "/dashboard/swing",    label: "Swing Trading", icon: TrendingUp },
    { href: "/dashboard/ema",      label: "EMA Cross",     icon: GitFork },
    { href: "/dashboard/futures",  label: "Futures Basis", icon: Scale },
  ]},
  { key: "trading", label: "Trading", items: [
    { href: "/dashboard/trades",   label: "Trades & P&L", icon: BookOpen },
    { href: "/dashboard/backtest", label: "Backtest",     icon: FlaskConical },
  ]},
  { key: "system", label: "System", items: [
    { href: "/dashboard/holidays", label: "Holidays", icon: CalendarDays },
    { href: "/dashboard/health",   label: "Health",   icon: Heart },
    { href: "/dashboard/settings", label: "Settings", icon: Settings },
  ]},
];

const LS_GROUPS = "sidebar:groups";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(GROUPS.map(g => [g.key, true])));

  useEffect(() => {
    if (!isLoggedIn()) { router.replace("/login"); return; }
    setReady(true);
  }, [router]);

  // Restore collapse state, then force-open whichever group owns the active route.
  useEffect(() => {
    let next: Record<string, boolean> = Object.fromEntries(GROUPS.map(g => [g.key, true]));
    try {
      const raw = window.localStorage.getItem(LS_GROUPS);
      if (raw) next = { ...next, ...JSON.parse(raw) };
    } catch {}
    const activeGroup = GROUPS.find(g => g.items.some(i => pathname.startsWith(i.href)));
    if (activeGroup) next[activeGroup.key] = true;
    setOpen(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleGroup(key: string) {
    setOpen(prev => {
      const next = { ...prev, [key]: !prev[key] };
      try { window.localStorage.setItem(LS_GROUPS, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  if (!ready) return null;

  function handleLogout() { clearToken(); router.replace("/login"); }
  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);

  return (
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
      <aside className="w-56 shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="px-4 py-5 border-b border-gray-800 flex items-center justify-between">
          <span className="text-lg font-semibold text-white">Dashboard</span>
          <FyersTokenBadge />
        </div>

        <nav className="flex-1 min-h-0 overflow-y-auto py-3 space-y-1 px-2">
          {/* Overview — pinned */}
          <Link href={OVERVIEW.href}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition ${
              isActive(OVERVIEW.href) ? "bg-brand-600 text-white" : "text-gray-400 hover:bg-gray-800 hover:text-white"
            }`}>
            <OVERVIEW.icon size={16} />{OVERVIEW.label}
          </Link>

          {GROUPS.map(group => (
            <div key={group.key} className="pt-1">
              <button onClick={() => toggleGroup(group.key)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-300">
                <span>{group.label}</span>
                <ChevronDown size={12} className={`ml-auto transition-transform ${open[group.key] ? "" : "-rotate-90"}`} />
              </button>
              {open[group.key] && (
                <div className="mt-0.5 space-y-0.5">
                  {group.items.map(({ href, label, icon: Icon }) => (
                    <Link key={href} href={href}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition ${
                        isActive(href) ? "bg-brand-600 text-white" : "text-gray-400 hover:bg-gray-800 hover:text-white"
                      }`}>
                      <Icon size={16} />{label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        <button onClick={handleLogout}
          className="flex items-center gap-3 px-5 py-4 text-sm text-gray-400 hover:text-white border-t border-gray-800 transition">
          <LogOut size={16} /> Sign out
        </button>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-11 shrink-0 border-b border-gray-800 bg-gray-900 flex items-center px-6 overflow-x-auto">
          <IndexTicker />
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
