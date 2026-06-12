import { getToken, clearToken } from "./auth";

const BASE = "/api/backend";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  if (res.status === 401 || res.status === 403) {
    clearToken();
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

// Auth
export async function login(username: string, password: string): Promise<string> {
  const data = await request<{ access_token: string }>("/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  return data.access_token;
}

// Candles
export interface Candle {
  symbol: string; timeframe: string; date: string;
  open: number; high: number; low: number; close: number; volume: number;
}
export function getCandles(symbol: string, timeframe: string, limit = 500): Promise<Candle[]> {
  return request(`/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&limit=${limit}`);
}
export function getSymbols(timeframe: string): Promise<string[]> {
  return request(`/candles/symbols?timeframe=${timeframe}`);
}

// Scans
export interface ScanResult {
  symbol: string; timeframe: string; analysis_type: string;
  scanned_at: string; matched: number;
  details: { stop_loss?: number; entry_close?: number } | null;
  candle_date: string | null;
}
export function getScans(params: {
  timeframe?: string; analysis_type?: string; matched_only?: boolean; limit?: number;
}): Promise<ScanResult[]> {
  const q = new URLSearchParams();
  if (params.timeframe)     q.set("timeframe",     params.timeframe);
  if (params.analysis_type) q.set("analysis_type", params.analysis_type);
  if (params.matched_only !== undefined) q.set("matched_only", String(params.matched_only));
  if (params.limit)         q.set("limit",         String(params.limit));
  return request(`/scans?${q}`);
}
export function getAnalysisTypes(): Promise<string[]> {
  return request("/scans/types");
}
export function runScan(timeframe: string, analysis_type: string): Promise<{ status: string }> {
  return request(`/scans/run?timeframe=${timeframe}&analysis_type=${analysis_type}`, { method: "POST" });
}

// Config
export function getConfig(key: string): Promise<{ key: string; value: unknown }> {
  return request(`/config/${key}`);
}
export function setConfig(key: string, value: unknown): Promise<{ key: string; value: unknown }> {
  return request(`/config/${key}`, { method: "PUT", body: JSON.stringify({ value }) });
}

// Sync
export interface SyncStatus { status: string; current?: number; total?: number; message?: string }
export function triggerSync(timeframe: string): Promise<{ status: string }> {
  return request(`/sync/trigger?timeframe=${timeframe}`, { method: "POST" });
}
export function getSyncStatus(timeframe?: string): Promise<SyncStatus | Record<string, SyncStatus>> {
  const q = timeframe ? `?timeframe=${timeframe}` : "";
  return request(`/sync/status${q}`);
}
export interface SyncLog {
  id: number; timeframe: string; started_at: string;
  finished_at: string | null; status: string; message: string | null;
  rows_saved: number; stocks_scanned: number;
  data_from: string | null; data_to: string | null;
}
export function getSyncLogs(timeframe?: string): Promise<SyncLog[]> {
  const q = timeframe ? `?timeframe=${timeframe}` : "";
  return request(`/sync/logs${q}`);
}

export interface SyncCoverageRow {
  period_date: string;
  stocks_count: number;
  week_start?: string;
}
export function getSyncCoverage(timeframe: string): Promise<SyncCoverageRow[]> {
  return request(`/sync/coverage?timeframe=${timeframe}`);
}

// Enhanced scan result with outcome
export interface ScanResultFull extends ScanResult {
  id: number;
  outcome: "success" | "failure" | "pending" | "open" | null;
  outcome_price: number | null;
  outcome_date: string | null;
  is_eow_alert?: number;
}

export interface ScansResponse {
  data: ScanResultFull[];
  total: number;
}

export async function getScansV2(params: {
  timeframe?: string;
  analysis_type?: string;
  matched_only?: boolean;
  outcome?: string;
  symbol_filter?: string;
  from_date?: string;
  to_date?: string;
  sort_by?: string;
  sort_dir?: string;
  limit?: number;
  offset?: number;
}): Promise<ScansResponse> {
  const q = new URLSearchParams();
  if (params.timeframe)      q.set("timeframe",      params.timeframe);
  if (params.analysis_type)  q.set("analysis_type",  params.analysis_type);
  if (params.matched_only !== undefined) q.set("matched_only", String(params.matched_only));
  if (params.outcome)        q.set("outcome",         params.outcome);
  if (params.symbol_filter)  q.set("symbol_filter",   params.symbol_filter);
  if (params.from_date)      q.set("from_date",       params.from_date);
  if (params.to_date)        q.set("to_date",         params.to_date);
  if (params.sort_by)        q.set("sort_by",         params.sort_by);
  if (params.sort_dir)       q.set("sort_dir",        params.sort_dir);
  if (params.limit !== undefined)  q.set("limit",  String(params.limit));
  if (params.offset !== undefined) q.set("offset", String(params.offset));

  const token = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`/api/backend/scans?${q}`, { headers });
  if (res.status === 401 || res.status === 403) {
    clearToken(); window.location.href = "/login"; throw new Error("Unauthorized");
  }
  const data = await res.json();
  const total = parseInt(res.headers.get("X-Total-Count") ?? "0", 10);
  return { data, total };
}

export interface LegendEntry {
  label: string;
  color: string;
  text:  string;
}

export interface ScanDetail {
  signal: ScanResultFull;
  candles: Candle[];
  pattern_length: number;
  window_size?:   number;
  marker_labels?: string[] | null;
  marker_colors?: string[] | null;
  marker_offset?: number;
  legend?:        LegendEntry[] | null;
}

export function getScanDetail(scanId: number): Promise<ScanDetail> {
  return request(`/scans/${scanId}/detail`);
}

export function fetchOutcome(scanId: number): Promise<ScanResultFull> {
  return request(`/scans/${scanId}/fetch-outcome`, { method: "POST" });
}

export async function getAllScans(timeframe: string): Promise<ScanResultFull[]> {
  const PAGE = 200;
  const first = await getScansV2({ timeframe, matched_only: true, limit: PAGE, offset: 0, sort_by: "candle_date", sort_dir: "asc" });
  if (first.total <= PAGE) return first.data;
  const pages = Math.ceil(first.total / PAGE);
  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, (_, i) =>
      getScansV2({ timeframe, matched_only: true, limit: PAGE, offset: (i + 1) * PAGE, sort_by: "candle_date", sort_dir: "asc" })
    )
  );
  return [first.data, ...rest.map(r => r.data)].flat();
}

// Week calendar
export interface WeekBucket {
  week_start: string;  // YYYY-MM-DD (Monday)
  week_end:   string;  // YYYY-MM-DD (Friday)
  signals:    ScanResultFull[];
}
export function getWeekCalendar(params: {
  analysis_type?: string;
  from_date?: string;
  to_date?: string;
  weeks?: number;
}): Promise<WeekBucket[]> {
  const q = new URLSearchParams();
  if (params.analysis_type) q.set("analysis_type", params.analysis_type);
  if (params.from_date)     q.set("from_date",     params.from_date);
  if (params.to_date)       q.set("to_date",       params.to_date);
  if (params.weeks)         q.set("weeks",         String(params.weeks));
  return request(`/scans/week-calendar?${q}`);
}

// EOW scan
export interface EowStatus {
  status: string;
  message: string;
  last_run: string | null;
  matched?: number;
  signals?: Array<{ symbol: string; candle_date: string; entry_close: number; stop_loss: number }>;
}
export function triggerEowScan(): Promise<{ status: string; message: string }> {
  return request("/eow/scan", { method: "POST" });
}
export function getEowStatus(): Promise<EowStatus> {
  return request("/eow/status");
}

// NSE Holidays
export interface HolidayList {
  holidays: string[];
  count: number;
  last_updated: string;
}
export function getHolidays(): Promise<HolidayList> {
  return request("/holidays");
}
export function refreshHolidays(): Promise<HolidayList> {
  return request("/holidays/refresh", { method: "POST" });
}

// F&O refresh
export function refreshFoStocks(): Promise<{ count: number; stocks: string[]; updated: string }> {
  return request("/config/refresh-fo-stocks", { method: "POST" });
}

// Health checks
export interface HealthCheck { name: string; ok: boolean; message: string }
export interface HealthReport { overall: "ok" | "fail"; checked_at: string; checks: HealthCheck[] }
export function runHealthCheck(): Promise<HealthReport> {
  return request("/health");
}

export interface FyersLoginInfo {
  login_url: string;
  redirect_uri: string;
  instructions: string;
}
export function getFyersLoginUrl(): Promise<FyersLoginInfo> {
  return request("/health/fyers-login-url");
}

export interface TokenUpdateResult {
  ok: boolean;
  message: string;
  token_preview?: string;
  verify?: { ok: boolean; message: string };
}
export function refreshFyersToken(): Promise<TokenUpdateResult> {
  return request("/health/refresh-token", { method: "POST" });
}
export function exchangeFyersAuthCode(authCode: string): Promise<TokenUpdateResult> {
  return request("/health/exchange-auth-code", {
    method: "POST",
    body: JSON.stringify({ auth_code: authCode }),
  });
}
export function setFyersAccessToken(accessToken: string, refreshToken?: string): Promise<TokenUpdateResult> {
  return request("/health/set-access-token", {
    method: "POST",
    body: JSON.stringify({ access_token: accessToken, refresh_token: refreshToken }),
  });
}

// ---------------------------------------------------------------------------
// Daily Pattern Scans
// ---------------------------------------------------------------------------

export interface DailyScanSession {
  id: number;
  analysis_type: string;
  scan_date: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "completed" | "failed";
  total_stocks: number;
  matched_count: number;
  message: string | null;
}

export interface DailyScanDetails {
  band_pct: number;
  volume_slope: number;
  vol_ratio: number;
  rsi: number;
  big_wick_ratio: number;
  entry_close: number;
  stop_loss: number;
  resistance: number;
  band_high: number;
  band_low: number;
}

export interface DailyScanResult {
  id: number;
  symbol: string;
  candle_date: string;
  scanned_at: string;
  details: DailyScanDetails | null;
  session_id: number | null;
  has_ai_analysis: boolean;
}

export interface DailyScanDetail {
  signal: DailyScanResult & { analysis_type: string; timeframe: string };
  candles: Candle[];
  entry_close: number | null;
  stop_loss: number | null;
  band_high: number | null;
}

export interface AIAnalysis {
  id: number;
  scan_result_id: number;
  symbol: string;
  analysis_type: string;
  scan_date: string;
  news_headlines: Array<{ title: string; source: string; published: string }>;
  technical_summary: string;
  success_probability: number;
  failure_probability: number;
  reasoning: string;
  reasoning_parsed: {
    technical_summary?: string;
    news_summary?: string;
    success_probability?: number;
    failure_probability?: number;
    reasoning?: string;
    target_price?: number;
    support_price?: number;
  };
  created_at: string;
}

export interface DailyScanStatus {
  status: string;
  step?: string;
  matched?: number;
  total?: number;
  session_id?: number;
  scan_date?: string;
  message?: string;
}

export function runDailyScan(analysis_type = "tight_range"): Promise<{ status: string; analysis_type: string }> {
  return request(`/daily-scans/run?analysis_type=${analysis_type}`, { method: "POST" });
}

export function getDailyScanStatus(): Promise<DailyScanStatus> {
  return request("/daily-scans/status");
}

export function getDailyScanSessions(analysis_type?: string, limit = 30): Promise<DailyScanSession[]> {
  const q = new URLSearchParams();
  if (analysis_type) q.set("analysis_type", analysis_type);
  q.set("limit", String(limit));
  return request(`/daily-scans/sessions?${q}`);
}

export function getDailyScanSession(sessionId: number): Promise<{ session: DailyScanSession; results: DailyScanResult[] }> {
  return request(`/daily-scans/sessions/${sessionId}`);
}

export async function getDailyResults(params: {
  analysis_type?: string;
  session_id?: number;
  symbol_filter?: string;
  from_date?: string;
  to_date?: string;
  sort_by?: string;
  sort_dir?: string;
  limit?: number;
  offset?: number;
}): Promise<{ data: DailyScanResult[]; total: number }> {
  const q = new URLSearchParams();
  if (params.analysis_type)   q.set("analysis_type",  params.analysis_type);
  if (params.session_id != null) q.set("session_id",  String(params.session_id));
  if (params.symbol_filter)   q.set("symbol_filter",  params.symbol_filter);
  if (params.from_date)       q.set("from_date",      params.from_date);
  if (params.to_date)         q.set("to_date",        params.to_date);
  if (params.sort_by)         q.set("sort_by",        params.sort_by);
  if (params.sort_dir)        q.set("sort_dir",       params.sort_dir);
  if (params.limit != null)   q.set("limit",          String(params.limit));
  if (params.offset != null)  q.set("offset",         String(params.offset));

  const token = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`/api/backend/daily-scans?${q}`, { headers });
  if (res.status === 401 || res.status === 403) {
    clearToken(); window.location.href = "/login"; throw new Error("Unauthorized");
  }
  const data = await res.json();
  const total = parseInt(res.headers.get("X-Total-Count") ?? "0", 10);
  return { data, total };
}

export function getDailyScanDetail(scanId: number): Promise<DailyScanDetail> {
  return request(`/daily-scans/${scanId}/detail`);
}

export function getDailyAIAnalysis(scanId: number): Promise<AIAnalysis> {
  return request(`/daily-scans/${scanId}/ai-analysis`, { method: "POST" });
}
