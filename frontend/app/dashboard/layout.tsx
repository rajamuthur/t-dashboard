"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { isLoggedIn, clearToken } from "@/lib/auth";
import FyersTokenBadge from "@/components/FyersTokenBadge";
import {
  LayoutDashboard, TrendingUp, Calendar,
  CandlestickChart, Settings, LogOut, ChevronDown, BarChart2, CalendarDays, Heart, PieChart, Activity, Radio, BookOpen, Shapes, Target, FlaskConical,
} from "lucide-react";

const ANALYSIS_ITEMS = [
  { href: "/dashboard/weekly",          label: "Weekly",  icon: TrendingUp },
  { href: "/dashboard/monthly",         label: "Monthly", icon: Calendar   },
  { href: "/dashboard/daily-patterns",  label: "Daily",   icon: Activity   },
];

const TOP_NAV = [
  { href: "/dashboard",              label: "Overview",     icon: LayoutDashboard },
  { href: "/dashboard/analytics",    label: "Analytics",    icon: PieChart        },
  { href: "/dashboard/charts",       label: "Charts",       icon: CandlestickChart },
  { href: "/dashboard/live-charts",  label: "Live Charts",  icon: Radio },
  { href: "/dashboard/patterns",     label: "Patterns",     icon: Shapes },
  { href: "/dashboard/vcp",          label: "VCP Scanner",  icon: Target },
  { href: "/dashboard/backtest",     label: "Backtest",     icon: FlaskConical },
  { href: "/dashboard/trades",       label: "Trades & P&L", icon: BookOpen },
  { href: "/dashboard/holidays",     label: "Holidays",     icon: CalendarDays },
  { href: "/dashboard/health",       label: "Health",       icon: Heart },
  { href: "/dashboard/settings",     label: "Settings",     icon: Settings },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isLoggedIn()) { router.replace("/login"); return; }
    setReady(true);
  }, [router]);

  if (!ready) return null;

  function handleLogout() {
    clearToken();
    router.replace("/login");
  }

  const isActive  = (href: string) => pathname === href;
  const isAnalysis = ANALYSIS_ITEMS.some(i => pathname.startsWith(i.href));

  return (
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
      <aside className="w-56 shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="px-4 py-5 border-b border-gray-800 flex items-center justify-between">
          <span className="text-lg font-semibold text-white">Dashboard</span>
          <FyersTokenBadge />
        </div>

        <nav className="flex-1 py-4 space-y-1 px-2">
          {/* Top nav items */}
          {TOP_NAV.slice(0, 1).map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition ${
                isActive(href) ? "bg-brand-600 text-white" : "text-gray-400 hover:bg-gray-800 hover:text-white"
              }`}>
              <Icon size={16} />{label}
            </Link>
          ))}

          {/* Analysis accordion — always expanded */}
          <div>
            <div className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm ${
              isAnalysis ? "text-brand-500" : "text-gray-400"
            }`}>
              <BarChart2 size={16} />
              <span className="font-medium">Analysis</span>
              <ChevronDown size={14} className="ml-auto" />
            </div>
            <div className="ml-4 mt-1 space-y-0.5 border-l border-gray-800 pl-3">
              {ANALYSIS_ITEMS.map(({ href, label, icon: Icon }) => (
                <Link key={href} href={href}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition ${
                    pathname.startsWith(href) ? "bg-brand-600 text-white" : "text-gray-400 hover:bg-gray-800 hover:text-white"
                  }`}>
                  <Icon size={14} />{label}
                </Link>
              ))}
            </div>
          </div>

          {/* Remaining top nav */}
          {TOP_NAV.slice(1).map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition ${
                isActive(href) ? "bg-brand-600 text-white" : "text-gray-400 hover:bg-gray-800 hover:text-white"
              }`}>
              <Icon size={16} />{label}
            </Link>
          ))}
        </nav>

        <button onClick={handleLogout}
          className="flex items-center gap-3 px-5 py-4 text-sm text-gray-400 hover:text-white border-t border-gray-800 transition">
          <LogOut size={16} /> Sign out
        </button>
      </aside>

      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
