import { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";

// Utility functions
const fmtBytes = (b: number) => {
  if (!b || b === 0) return "0 B";
  const k = 1024, s = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(Math.abs(b)) / Math.log(k)), 3);
  return (b / Math.pow(k, i)).toFixed(1) + " " + s[i];
};

const fmtPct = (n: number) => (n || 0).toFixed(1) + "%";

// API helper
const api = async (path: string, password: string, opts: RequestInit = {}) => {
  const r = await fetch("/api" + path, {
    ...opts,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + password, ...opts.headers }
  });
  if (r.status === 401) throw new Error("Unauthorized");
  return r;
};

// Copy to clipboard
const copyText = async (text: string) => {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return; } catch {}
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;left:-9999px";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
};

// Icons
const DbIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <ellipse cx={12} cy={6} rx={8} ry={3} />
    <path d="M4 6v6c0 1.657 3.582 3 8 3s8-1.343 8-3V6" />
    <path d="M4 12v6c0 1.657 3.582 3 8 3s8-1.343 8-3v-6" />
  </svg>
);

const ChartIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
  </svg>
);

const PlusIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
  </svg>
);

const UploadIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
  </svg>
);

const CopyIcon = ({ className = "w-3.5 h-3.5" }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <rect x={9} y={9} width={13} height={13} rx={2} />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const CheckIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
  </svg>
);

const ChevronIcon = ({ className = "w-3 h-3" }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
  </svg>
);

const TableIcon = ({ className = "w-3.5 h-3.5" }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 0 1-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0 1 12 18.375m9.75-12.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125m19.5 0v1.5c0 .621-.504 1.125-1.125 1.125M2.25 5.625v1.5c0 .621.504 1.125 1.125 1.125m0 0h17.25m-17.25 0h7.5c.621 0 1.125.504 1.125 1.125M3.375 8.25c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25-3.75h-7.5c-.621 0-1.125.504-1.125 1.125m8.625-1.125c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125" />
  </svg>
);

const CloudIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.332-7.257 3 3 0 0 0-3.758-3.848 5.25 5.25 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15Z" />
  </svg>
);

const TrashIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
  </svg>
);

const DownloadIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
  </svg>
);

// Types
interface Database {
  name: string;
  status: string;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

interface DbStats {
  cpu: number;
  memory: number;
  connections: number;
  disk: number;
}

interface ToastMessage {
  message: string;
  type: "success" | "error";
}

interface S3Status {
  configured: boolean;
  enabled?: boolean;
  endpoint?: string;
  bucket?: string;
  region?: string;
  intervalHours?: number;
  lastBackup?: string | null;
  connectionHealthy?: boolean;
  connectionError?: string;
}

interface S3Backup {
  key: string;
  database: string;
  timestamp: string;
  size: number;
}

// Toast component
const Toast = ({ message, type }: { message?: string; type?: string }) => {
  if (!message) return null;
  return (
    <div className={`fixed bottom-4 right-4 px-4 py-2 rounded-lg text-sm font-medium z-50 fade-in ${type === "error" ? "bg-red-500 text-white" : "bg-slate-900 text-white"}`}>
      {message}
    </div>
  );
};

// Login page
const LoginPage = ({ onLogin }: { onLogin: (pw: string, remember: boolean) => void }) => {
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });
      if (!r.ok) { setError("Invalid password"); return; }
      onLogin(password, remember);
    } catch { setError("Connection failed"); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-xs fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-slate-900 text-white mb-4">
            <DbIcon />
          </div>
          <h1 className="text-lg font-semibold text-slate-900">PgForge</h1>
          <p className="text-slate-400 text-sm mt-1">Sign in to continue</p>
        </div>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm placeholder:text-slate-400 focus:border-slate-400 focus:ring-0 outline-none"
            placeholder="Password"
            autoFocus
          />
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-0"
            />
            <span className="text-sm text-slate-500">Remember me</span>
          </label>
          {error && <div className="text-red-500 text-xs">{error}</div>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            {loading ? <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full spin" /> : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
};

// Sidebar
const Sidebar = ({
  dbs,
  dbStats,
  currentPage,
  onNavigate,
  onOpenCreate,
  onOpenImport
}: {
  dbs: Database[];
  dbStats: Record<string, DbStats>;
  currentPage: string;
  onNavigate: (page: string) => void;
  onOpenCreate: () => void;
  onOpenImport: () => void;
}) => (
  <nav className="fixed left-0 top-0 bottom-0 w-52 bg-white border-r border-slate-100 flex flex-col">
    <div className="p-4 border-b border-slate-100">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-slate-900 flex items-center justify-center text-white"><DbIcon /></div>
        <span className="text-sm font-semibold text-slate-900">PgForge</span>
        <span className="ml-auto flex items-center gap-1 text-[10px] text-emerald-600">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 pulse" />Live
        </span>
      </div>
    </div>
    <div className="p-3 border-b border-slate-100 flex gap-2">
      <button onClick={onOpenCreate} className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800">
        <PlusIcon />New
      </button>
      <button onClick={onOpenImport} className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium hover:bg-slate-200">
        <UploadIcon />Import
      </button>
    </div>
    <div className="flex-1 overflow-y-auto p-3">
      <div className="mb-3">
        <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wider px-3 mb-2">Overview</div>
        <button
          onClick={() => onNavigate("dashboard")}
          className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${currentPage === "dashboard" ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:bg-slate-50"}`}
        >
          <ChartIcon />Dashboard
        </button>
        <button
          onClick={() => onNavigate("backups")}
          className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${currentPage === "backups" ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:bg-slate-50"}`}
        >
          <CloudIcon />Backups
        </button>
      </div>
      <div>
        <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wider px-3 mb-2">Databases</div>
        <div className="space-y-1">
          {dbs.map(db => {
            const active = currentPage === "explorer-" + db.name;
            const s = dbStats[db.name];
            return (
              <button
                key={db.name}
                onClick={() => onNavigate("explorer-" + db.name)}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${active ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:bg-slate-50"}`}
              >
                <div className="flex items-center gap-2">
                  <DbIcon />
                  <span className="truncate font-medium">{db.name}</span>
                  {db.status === "running"
                    ? <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-500 pulse" />
                    : <span className="ml-auto w-1.5 h-1.5 rounded-full bg-slate-300" />
                  }
                </div>
                {db.status === "running" && s && (
                  <div className="mt-1.5 grid grid-cols-4 gap-1 text-[9px] text-slate-400">
                    <div><span className="text-slate-600 font-medium">{fmtPct(s.cpu)}</span> cpu</div>
                    <div><span className="text-slate-600 font-medium">{fmtBytes(s.memory * 1024 * 1024)}</span></div>
                    <div><span className="text-slate-600 font-medium">{s.connections}</span> conn</div>
                    <div><span className="text-slate-600 font-medium">{fmtBytes(s.disk * 1024 * 1024)}</span></div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  </nav>
);

// Dashboard
const Dashboard = ({
  dbs,
  password,
  period,
  setPeriod,
  selectedDb,
  setSelectedDb
}: {
  dbs: Database[];
  password: string;
  period: string;
  setPeriod: (p: string) => void;
  selectedDb: string;
  setSelectedDb: (d: string) => void;
}) => {
  const [machineStats, setMachineStats] = useState<{ cpu_percent: number; memory_mb: number; disk_mb: number } | null>(null);
  const [metricValues, setMetricValues] = useState({ cpu: "-", mem: "-", conn: "-", disk: "-" });
  const chartsRef = useRef<Record<string, any>>({});

  const loadMetrics = useCallback(async () => {
    try {
      let url = "/metrics?period=" + period;
      if (selectedDb === "all") url += "&grouped=true";
      else if (selectedDb !== "machine") url += "&database=" + encodeURIComponent(selectedDb);

      const r = await api(url, password);
      if (r.ok) {
        const data = await r.json();
        drawCharts(data);
      }
    } catch (e) { console.error(e); }
  }, [period, selectedDb, password]);

  const loadMachine = useCallback(async () => {
    try {
      const r = await api("/machine", password);
      if (r.ok) setMachineStats(await r.json());
    } catch (e) { console.error(e); }
  }, [password]);

  const drawCharts = (data: any) => {
    const isGrouped = data?.databases && Array.isArray(data.databases);
    const palette = ["#0ea5e9", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];
    const Chart = (window as any).Chart;

    const formatLabel = (ts: number) => {
      const d = new Date(ts);
      if (period === "1h" || period === "24h") return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
      if (period === "7d") return d.toLocaleDateString("en-US", { weekday: "short" });
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    };

    const chartOpts = (legend: boolean) => ({
      responsive: true, maintainAspectRatio: false, interaction: { intersect: false, mode: "index" },
      plugins: { legend: legend ? { display: true, position: "bottom", labels: { boxWidth: 6, padding: 8, font: { size: 10 }, usePointStyle: true } } : { display: false }, tooltip: { backgroundColor: "#0f172a", titleColor: "#fff", bodyColor: "#94a3b8", padding: 8, cornerRadius: 4, displayColors: false } },
      scales: { x: { display: false }, y: { display: false, beginAtZero: true } }
    });

    if (isGrouped) {
      if (!data.total?.length) return;
      const last = data.total[data.total.length - 1] || {};
      setMetricValues({
        cpu: fmtPct(last.cpu_percent),
        mem: fmtBytes((last.memory_mb || 0) * 1024 * 1024),
        conn: String(last.connections || 0),
        disk: fmtBytes((last.disk_mb || 0) * 1024 * 1024)
      });
      const labels = data.total.map((d: any) => formatLabel(d.timestamp));
      ["cpu", "mem", "conn", "disk"].forEach((id, i) => {
        const field = ["cpu_percent", "memory_mb", "connections", "disk_mb"][i];
        const ctx = document.getElementById(id + "-chart") as HTMLCanvasElement;
        if (!ctx) return;
        const datasets = data.databases.map((db: any, j: number) => ({
          label: db.database, data: db.metrics.map((m: any) => m[field] || 0),
          borderColor: palette[j % palette.length], backgroundColor: "transparent", borderWidth: 1.5, tension: 0.4, pointRadius: 0
        }));
        if (chartsRef.current[id]) { chartsRef.current[id].data = { labels, datasets }; chartsRef.current[id].update("none"); }
        else { chartsRef.current[id] = new Chart(ctx, { type: "line", data: { labels, datasets }, options: chartOpts(true) }); }
      });
    } else {
      if (!data?.length) return;
      const last = data[data.length - 1] || {};
      setMetricValues({
        cpu: fmtPct(last.cpu_percent),
        mem: fmtBytes((last.memory_mb || 0) * 1024 * 1024),
        conn: String(last.connections || 0),
        disk: fmtBytes((last.disk_mb || 0) * 1024 * 1024)
      });
      const labels = data.map((d: any) => formatLabel(d.timestamp));
      [["cpu", "cpu_percent", "#0ea5e9"], ["mem", "memory_mb", "#22c55e"], ["conn", "connections", "#f59e0b"], ["disk", "disk_mb", "#8b5cf6"]].forEach(([id, field, color]) => {
        const ctx = document.getElementById(id + "-chart") as HTMLCanvasElement;
        if (!ctx) return;
        const vals = data.map((m: any) => m[field] || 0);
        if (chartsRef.current[id]) { chartsRef.current[id].data.labels = labels; chartsRef.current[id].data.datasets[0].data = vals; chartsRef.current[id].update("none"); }
        else { chartsRef.current[id] = new Chart(ctx, { type: "line", data: { labels, datasets: [{ data: vals, borderColor: color, backgroundColor: color + "10", borderWidth: 2, tension: 0.4, pointRadius: 0, fill: true }] }, options: chartOpts(false) }); }
      });
    }
  };

  useEffect(() => {
    loadMetrics();
    loadMachine();
    const interval = setInterval(() => { loadMetrics(); loadMachine(); }, 2000);
    return () => clearInterval(interval);
  }, [loadMetrics, loadMachine]);

  useEffect(() => {
    Object.values(chartsRef.current).forEach((c: any) => c?.destroy?.());
    chartsRef.current = {};
  }, [selectedDb, period]);

  const running = dbs.filter(d => d.status === "running").length;
  const periods = ["1h", "24h", "7d", "30d", "all"];

  return (
    <div className="fade-in max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Dashboard</h1>
          <p className="text-slate-400 text-sm">{running} of {dbs.length} running</p>
        </div>
        <div className="flex items-center gap-2 bg-slate-100 rounded-lg p-1">
          {periods.map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${period === p ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-700"}`}
            >
              {p.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
        <button onClick={() => setSelectedDb("machine")} className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${selectedDb === "machine" ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-700"}`}>Host</button>
        <button onClick={() => setSelectedDb("all")} className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${selectedDb === "all" ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-700"}`}>All DBs</button>
        {dbs.map(db => (
          <button key={db.name} onClick={() => setSelectedDb(db.name)} className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${selectedDb === db.name ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-700"}`}>
            {db.name}
          </button>
        ))}
      </div>
      {selectedDb === "machine" ? (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-slate-100 p-4">
            <div className="text-xs text-slate-400 mb-1">CPU Usage</div>
            <div className="text-2xl font-semibold text-slate-900 tabular-nums">{machineStats ? fmtPct(machineStats.cpu_percent) : "-"}</div>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 p-4">
            <div className="text-xs text-slate-400 mb-1">Memory</div>
            <div className="text-2xl font-semibold text-slate-900 tabular-nums">{machineStats ? fmtBytes(machineStats.memory_mb * 1024 * 1024) : "-"}</div>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 p-4">
            <div className="text-xs text-slate-400 mb-1">Disk</div>
            <div className="text-2xl font-semibold text-slate-900 tabular-nums">{machineStats ? fmtBytes(machineStats.disk_mb * 1024 * 1024) : "-"}</div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {[
            { label: "CPU", value: metricValues.cpu, color: "#0ea5e9", id: "cpu" },
            { label: "Memory", value: metricValues.mem, color: "#22c55e", id: "mem" },
            { label: "Connections", value: metricValues.conn, color: "#f59e0b", id: "conn" },
            { label: "Disk", value: metricValues.disk, color: "#8b5cf6", id: "disk" }
          ].map(m => (
            <div key={m.id} className="bg-white rounded-xl border border-slate-100 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-400">{m.label}</span>
                <span className="text-sm font-semibold tabular-nums" style={{ color: m.color }}>{m.value}</span>
              </div>
              <div className="chart-container"><canvas id={m.id + "-chart"} /></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Explorer
const Explorer = ({
  dbName,
  dbs,
  password,
  dbStats,
  showToast
}: {
  dbName: string;
  dbs: Database[];
  password: string;
  dbStats: Record<string, DbStats>;
  showToast: (msg: string, type?: "success" | "error") => void;
}) => {
  const [schema, setSchema] = useState<Record<string, { name: string }[]> | null>(null);
  const [tableData, setTableData] = useState<{ columns: { name: string }[]; rows: Record<string, any>[]; totalRows: number } | null>(null);
  const [selectedTable, setSelectedTable] = useState<{ schema: string; table: string } | null>(null);
  const [expandedSchemas, setExpandedSchemas] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);

  const db = dbs.find(d => d.name === dbName);
  const s = dbStats[dbName];
  const connUrl = db ? `postgresql://${db.user}:${db.password}@${db.host}:${db.port}/${db.database}` : "";

  const loadSchema = useCallback(async () => {
    try {
      const r = await api("/databases/" + encodeURIComponent(dbName) + "/schema", password);
      if (r.ok) {
        const data = await r.json();
        setSchema(data);
        const expanded: Record<string, boolean> = {};
        Object.keys(data).forEach(s => expanded[s] = true);
        setExpandedSchemas(expanded);
      }
    } catch (e) { console.error(e); }
  }, [dbName, password]);

  const loadTable = async (schemaName: string, tableName: string) => {
    setSelectedTable({ schema: schemaName, table: tableName });
    try {
      const r = await api("/databases/" + encodeURIComponent(dbName) + "/table/" + encodeURIComponent(schemaName) + "/" + encodeURIComponent(tableName), password);
      if (r.ok) setTableData(await r.json());
    } catch (e) { console.error(e); }
  };

  const handleCopy = async () => {
    await copyText(connUrl);
    setCopied(true);
    showToast("Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => { loadSchema(); }, [loadSchema]);

  return (
    <div className="fade-in h-[calc(100vh-48px)] flex flex-col max-w-6xl">
      <div className="mb-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">{dbName}</h1>
            <p className="text-slate-400 text-sm">Browse tables and data</p>
          </div>
          {db && connUrl && (
            <div className="flex items-center gap-2">
              <div className="px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600 font-mono whitespace-nowrap select-all max-w-md truncate">{connUrl}</div>
              <button onClick={handleCopy} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-xs font-medium transition-colors ${copied ? "bg-emerald-500" : "bg-slate-900 hover:bg-slate-800"}`}>
                <CopyIcon /><span>{copied ? "Copied!" : "Copy"}</span>
              </button>
            </div>
          )}
        </div>
        {db && db.status === "running" && (
          <div className="grid grid-cols-4 gap-3 mt-4">
            {[
              { label: "CPU", value: s ? fmtPct(s.cpu) : "-" },
              { label: "Memory", value: s ? fmtBytes(s.memory * 1024 * 1024) : "-" },
              { label: "Connections", value: s ? String(s.connections) : "-" },
              { label: "Disk", value: s ? fmtBytes(s.disk * 1024 * 1024) : "-" }
            ].map(m => (
              <div key={m.label} className="bg-white rounded-lg border border-slate-100 px-3 py-2">
                <div className="text-[10px] text-slate-400 uppercase">{m.label}</div>
                <div className="text-sm font-semibold text-slate-900 tabular-nums">{m.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex-1 grid grid-cols-[200px_1fr] gap-4 min-h-0">
        <div className="bg-white rounded-xl border border-slate-100 overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b border-slate-100 text-xs font-medium text-slate-500">Tables</div>
          <div className="flex-1 overflow-y-auto">
            {schema ? Object.entries(schema).map(([schemaName, tables]) => (
              <div key={schemaName} className="border-b border-slate-100 last:border-0">
                <button
                  onClick={() => setExpandedSchemas(prev => ({ ...prev, [schemaName]: !prev[schemaName] }))}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-left text-xs"
                >
                  <span className="text-slate-400 transition-transform" style={{ transform: expandedSchemas[schemaName] ? "rotate(90deg)" : "rotate(0deg)" }}><ChevronIcon /></span>
                  <span className="font-medium text-slate-700">{schemaName}</span>
                  <span className="ml-auto text-[10px] text-slate-400">{tables.length}</span>
                </button>
                {expandedSchemas[schemaName] && tables.map(t => (
                  <button
                    key={t.name}
                    onClick={() => loadTable(schemaName, t.name)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 pl-7 text-xs text-slate-500 hover:bg-sky-50 hover:text-sky-600 text-left ${selectedTable?.schema === schemaName && selectedTable?.table === t.name ? "bg-sky-50 text-sky-600" : ""}`}
                  >
                    <TableIcon /><span className="truncate">{t.name}</span>
                  </button>
                ))}
              </div>
            )) : (
              <div className="flex items-center justify-center py-8">
                <span className="w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full spin" />
              </div>
            )}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 overflow-hidden flex flex-col">
          {tableData ? (
            <>
              <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
                <div className="text-xs">
                  <span className="text-slate-400">{selectedTable?.schema}.</span>
                  <span className="font-medium text-slate-700">{selectedTable?.table}</span>
                </div>
                <span className="text-[10px] text-slate-400">{tableData.totalRows} rows</span>
              </div>
              <div className="overflow-auto flex-1">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 sticky top-0 z-10">
                    <tr>
                      {tableData.columns?.map(c => <th key={c.name} className="px-3 py-2 text-left font-medium text-slate-500 whitespace-nowrap">{c.name}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {tableData.rows?.slice(0, 25).map((row, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        {tableData.columns?.map(c => {
                          const v = row[c.name];
                          return (
                            <td key={c.name} className={`px-3 py-2 font-mono max-w-xs truncate ${v === null ? "text-slate-300 italic" : "text-slate-600"}`} title={v !== null ? String(v) : undefined}>
                              {v === null ? "null" : String(v)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-xs">Select a table</div>
          )}
        </div>
      </div>
    </div>
  );
};

// Create Modal
const CreateModal = ({
  isOpen,
  onClose,
  password,
  onSuccess,
  showToast
}: {
  isOpen: boolean;
  onClose: () => void;
  password: string;
  onSuccess: () => void;
  showToast: (msg: string, type?: "success" | "error") => void;
}) => {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const r = await api("/databases", password, { method: "POST", body: JSON.stringify({ name: name.toLowerCase().replace(/[^a-z0-9-]/g, "-") }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      setResult(d);
    } catch (e: any) { showToast(e.message, "error"); }
    finally { setLoading(false); }
  };

  const handleCopy = async () => {
    if (result) {
      await copyText(result.url);
      setCopied(true);
      showToast("Copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClose = () => {
    if (result) onSuccess();
    setName("");
    setResult(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={(e) => e.target === e.currentTarget && handleClose()}>
      <div className="bg-white rounded-xl w-full max-w-md fade-in shadow-xl">
        <div className="p-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">New Database</h2>
        </div>
        {result ? (
          <div className="p-4">
            <div className="flex items-center justify-center mb-4">
              <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600"><CheckIcon /></div>
            </div>
            <h3 className="text-center text-sm font-semibold text-slate-900 mb-1">Database Created!</h3>
            <p className="text-center text-xs text-slate-500 mb-4">Your database is ready to use</p>
            <div className="bg-slate-50 rounded-lg p-3 mb-3">
              <div className="text-[10px] text-slate-400 uppercase mb-1">Connection URL</div>
              <div className="font-mono text-xs text-slate-700 break-all select-all">{result.url}</div>
            </div>
            <button onClick={handleCopy} className={`w-full py-2.5 rounded-lg text-white text-sm font-medium flex items-center justify-center gap-1.5 transition-colors ${copied ? "bg-emerald-500" : "bg-slate-900 hover:bg-slate-800"}`}>
              <CopyIcon /><span>{copied ? "Copied!" : "Copy URL"}</span>
            </button>
            <button onClick={handleClose} className="w-full mt-2 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">Done</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="p-4">
              <label className="block text-xs text-slate-500 mb-1.5">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm placeholder:text-slate-400 focus:border-slate-400 focus:ring-0 outline-none"
                placeholder="my-database"
                pattern="[a-zA-Z0-9-]+"
                required
              />
            </div>
            <div className="flex gap-2 p-4 pt-0">
              <button type="button" onClick={handleClose} className="flex-1 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">Cancel</button>
              <button type="submit" disabled={loading} className="flex-1 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-50">
                {loading ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full spin inline-block" /> : "Create"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

// Import Modal
const ImportModal = ({
  isOpen,
  onClose,
  password,
  onSuccess,
  showToast
}: {
  isOpen: boolean;
  onClose: () => void;
  password: string;
  onSuccess: () => void;
  showToast: (msg: string, type?: "success" | "error") => void;
}) => {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ url: string } | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setProgress(0);
    const interval = setInterval(() => setProgress(p => Math.min(p + Math.random() * 8, 85)), 500);
    try {
      const r = await api("/databases/import", password, { method: "POST", body: JSON.stringify({ sourceUrl: url, name: name.toLowerCase().replace(/[^a-z0-9-]/g, "-") || undefined }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Import failed");
      clearInterval(interval);
      setProgress(100);
      setTimeout(() => setResult(d), 300);
    } catch (e: any) { clearInterval(interval); setError(e.message); setLoading(false); }
  };

  const handleCopy = async () => {
    if (result) {
      await copyText(result.url);
      setCopied(true);
      showToast("Copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClose = () => {
    if (result) onSuccess();
    setUrl("");
    setName("");
    setResult(null);
    setError("");
    setLoading(false);
    setProgress(0);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={(e) => e.target === e.currentTarget && !loading && handleClose()}>
      <div className="bg-white rounded-xl w-full max-w-md fade-in shadow-xl">
        <div className="p-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">Import Database</h2>
          <p className="text-xs text-slate-400 mt-0.5">From Neon, Supabase, or any PostgreSQL</p>
        </div>
        {result ? (
          <div className="p-4">
            <div className="flex items-center justify-center mb-4">
              <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600"><CheckIcon /></div>
            </div>
            <h3 className="text-center text-sm font-semibold text-slate-900 mb-1">Import Complete!</h3>
            <p className="text-center text-xs text-slate-500 mb-4">Your database has been imported successfully</p>
            <div className="bg-slate-50 rounded-lg p-3 mb-3">
              <div className="text-[10px] text-slate-400 uppercase mb-1">Connection URL</div>
              <div className="font-mono text-xs text-slate-700 break-all select-all">{result.url}</div>
            </div>
            <button onClick={handleCopy} className={`w-full py-2.5 rounded-lg text-white text-sm font-medium flex items-center justify-center gap-1.5 transition-colors ${copied ? "bg-emerald-500" : "bg-slate-900 hover:bg-slate-800"}`}>
              <CopyIcon /><span>{copied ? "Copied!" : "Copy URL"}</span>
            </button>
            <button onClick={handleClose} className="w-full mt-2 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">Done</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1.5">Database Name</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} disabled={loading} className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm placeholder:text-slate-400 focus:border-slate-400 focus:ring-0 outline-none disabled:opacity-50" placeholder="my-imported-db" pattern="[a-zA-Z0-9-]+" required />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1.5">Source Connection URL</label>
                <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} disabled={loading} className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm font-mono placeholder:text-slate-400 focus:border-slate-400 focus:ring-0 outline-none disabled:opacity-50" placeholder="postgresql://user:pass@host/db" required />
              </div>
              {error && <div className="p-2 rounded-lg bg-red-50 text-xs text-red-600">{error}</div>}
              {loading && (
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-400">Importing...</span>
                    <span className="text-slate-600 font-medium">{Math.round(progress)}%</span>
                  </div>
                  <div className="h-1 bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full bg-slate-900 transition-all" style={{ width: progress + "%" }} />
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-2 p-4 pt-0">
              <button type="button" onClick={handleClose} disabled={loading} className="flex-1 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 disabled:opacity-50">Cancel</button>
              <button type="submit" disabled={loading} className="flex-1 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-50">Import</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

// Backups Page
const Backups = ({
  password,
  dbs,
  showToast
}: {
  password: string;
  dbs: Database[];
  showToast: (msg: string, type?: "success" | "error") => void;
}) => {
  const [s3Status, setS3Status] = useState<S3Status | null>(null);
  const [backups, setBackups] = useState<S3Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [configuring, setConfiguring] = useState(false);
  const [backing, setBacking] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [s3Url, setS3Url] = useState("");
  const [intervalHours, setIntervalHours] = useState(24);
  const [selectedDb, setSelectedDb] = useState<string | null>(null);

  const loadS3Status = useCallback(async () => {
    try {
      const r = await api("/s3", password);
      if (r.ok) setS3Status(await r.json());
    } catch (e) { console.error(e); }
  }, [password]);

  const loadBackups = useCallback(async () => {
    try {
      const params = selectedDb ? `?database=${encodeURIComponent(selectedDb)}` : "";
      const r = await api("/s3/backups" + params, password);
      if (r.ok) setBackups(await r.json());
    } catch (e) { console.error(e); }
  }, [password, selectedDb]);

  const handleConfigure = async (e: React.FormEvent) => {
    e.preventDefault();
    setConfiguring(true);
    try {
      const r = await api("/s3", password, {
        method: "POST",
        body: JSON.stringify({ url: s3Url, intervalHours })
      });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d.error || "Configuration failed");
      }
      showToast("S3 backup configured successfully");
      setShowConfig(false);
      setS3Url("");
      await loadS3Status();
      await loadBackups();
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setConfiguring(false);
    }
  };

  const handleToggleEnabled = async () => {
    if (!s3Status?.configured) return;
    try {
      await api("/s3", password, {
        method: "POST",
        body: JSON.stringify({ enabled: !s3Status.enabled })
      });
      showToast(s3Status.enabled ? "Backups disabled" : "Backups enabled");
      await loadS3Status();
    } catch (e: any) {
      showToast(e.message, "error");
    }
  };

  const handleRemoveConfig = async () => {
    if (!confirm("Are you sure you want to remove S3 backup configuration?")) return;
    try {
      await api("/s3", password, { method: "DELETE" });
      showToast("S3 configuration removed");
      await loadS3Status();
      setBackups([]);
    } catch (e: any) {
      showToast(e.message, "error");
    }
  };

  const handleBackupNow = async (dbName?: string) => {
    setBacking(true);
    try {
      const r = await api("/s3/backup", password, {
        method: "POST",
        body: JSON.stringify(dbName ? { database: dbName } : {})
      });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d.error || "Backup failed");
      }
      showToast(dbName ? `Backup created for ${dbName}` : "Backup completed for all databases");
      await loadS3Status();
      await loadBackups();
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setBacking(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([loadS3Status(), loadBackups()]).finally(() => setLoading(false));
  }, [loadS3Status, loadBackups]);

  const formatTimeAgo = (ts: string | null) => {
    if (!ts) return "Never";
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  // Group backups by database
  const backupsByDb: Record<string, S3Backup[]> = {};
  backups.forEach(b => {
    if (!backupsByDb[b.database]) backupsByDb[b.database] = [];
    backupsByDb[b.database].push(b);
  });

  if (loading) {
    return (
      <div className="fade-in flex items-center justify-center h-64">
        <span className="w-6 h-6 border-2 border-slate-300 border-t-slate-600 rounded-full spin" />
      </div>
    );
  }

  return (
    <div className="fade-in max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Backups</h1>
          <p className="text-slate-400 text-sm">S3-compatible cloud backup</p>
        </div>
        {s3Status?.configured && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleBackupNow()}
              disabled={backing || !s3Status.enabled}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 disabled:opacity-50"
            >
              {backing ? (
                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full spin" />
              ) : (
                <UploadIcon className="w-3.5 h-3.5" />
              )}
              Backup All
            </button>
          </div>
        )}
      </div>

      {/* S3 Configuration Card */}
      <div className="bg-white rounded-xl border border-slate-100 p-4 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${s3Status?.configured ? (s3Status.connectionHealthy ? "bg-emerald-100 text-emerald-600" : "bg-amber-100 text-amber-600") : "bg-slate-100 text-slate-400"}`}>
              <CloudIcon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                {s3Status?.configured ? "S3 Backup Configured" : "Configure S3 Backup"}
              </h3>
              <p className="text-xs text-slate-400">
                {s3Status?.configured
                  ? `${s3Status.endpoint} / ${s3Status.bucket}`
                  : "Connect to AWS S3, Cloudflare R2, or any S3-compatible storage"}
              </p>
            </div>
          </div>
          {s3Status?.configured ? (
            <div className="flex items-center gap-2">
              <button
                onClick={handleToggleEnabled}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${s3Status.enabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}
              >
                {s3Status.enabled ? "Enabled" : "Disabled"}
              </button>
              <button
                onClick={handleRemoveConfig}
                className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
              >
                <TrashIcon className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowConfig(true)}
              className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800"
            >
              Configure
            </button>
          )}
        </div>

        {s3Status?.configured && (
          <div className="grid grid-cols-4 gap-4 pt-3 border-t border-slate-100">
            <div>
              <div className="text-[10px] text-slate-400 uppercase">Status</div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={`w-1.5 h-1.5 rounded-full ${s3Status.connectionHealthy ? "bg-emerald-500" : "bg-amber-500"}`} />
                <span className="text-xs font-medium text-slate-700">{s3Status.connectionHealthy ? "Connected" : "Error"}</span>
              </div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400 uppercase">Interval</div>
              <div className="text-xs font-medium text-slate-700 mt-0.5">{s3Status.intervalHours}h</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400 uppercase">Last Backup</div>
              <div className="text-xs font-medium text-slate-700 mt-0.5">{formatTimeAgo(s3Status.lastBackup || null)}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400 uppercase">Total Backups</div>
              <div className="text-xs font-medium text-slate-700 mt-0.5">{backups.length}</div>
            </div>
          </div>
        )}

        {/* Configure Modal */}
        {showConfig && (
          <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={(e) => e.target === e.currentTarget && setShowConfig(false)}>
            <div className="bg-white rounded-xl w-full max-w-md fade-in shadow-xl">
              <div className="p-4 border-b border-slate-100">
                <h2 className="text-sm font-semibold text-slate-900">Configure S3 Backup</h2>
                <p className="text-xs text-slate-400 mt-0.5">Enter your S3-compatible storage credentials</p>
              </div>
              <form onSubmit={handleConfigure}>
                <div className="p-4 space-y-3">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1.5">S3 URL</label>
                    <input
                      type="text"
                      value={s3Url}
                      onChange={(e) => setS3Url(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-xs font-mono placeholder:text-slate-400 focus:border-slate-400 focus:ring-0 outline-none"
                      placeholder="s3://key:secret@endpoint/bucket?region=auto"
                      required
                    />
                    <p className="text-[10px] text-slate-400 mt-1">Format: s3://accessKey:secretKey@endpoint/bucket?region=auto</p>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1.5">Backup Interval (hours)</label>
                    <input
                      type="number"
                      value={intervalHours}
                      onChange={(e) => setIntervalHours(parseInt(e.target.value) || 24)}
                      min={1}
                      max={168}
                      className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:border-slate-400 focus:ring-0 outline-none"
                    />
                  </div>
                </div>
                <div className="flex gap-2 p-4 pt-0">
                  <button type="button" onClick={() => setShowConfig(false)} className="flex-1 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">Cancel</button>
                  <button type="submit" disabled={configuring} className="flex-1 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-50">
                    {configuring ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full spin inline-block" /> : "Connect"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>

      {/* Backup History */}
      {s3Status?.configured && (
        <div className="bg-white rounded-xl border border-slate-100">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Backup History</h3>
            <div className="flex gap-1">
              <button
                onClick={() => setSelectedDb(null)}
                className={`px-2 py-1 text-[10px] font-medium rounded-md transition-colors ${!selectedDb ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"}`}
              >
                All
              </button>
              {Object.keys(backupsByDb).map(db => (
                <button
                  key={db}
                  onClick={() => setSelectedDb(db)}
                  className={`px-2 py-1 text-[10px] font-medium rounded-md transition-colors ${selectedDb === db ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"}`}
                >
                  {db}
                </button>
              ))}
            </div>
          </div>
          <div className="divide-y divide-slate-50">
            {backups.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm">
                No backups yet. Click "Backup All" to create your first backup.
              </div>
            ) : (
              backups.slice(0, 20).map((backup, i) => (
                <div key={backup.key} className="px-4 py-3 flex items-center justify-between hover:bg-slate-50">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500">
                      <DbIcon className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-700">{backup.database}</div>
                      <div className="text-[10px] text-slate-400">
                        {new Date(backup.timestamp).toLocaleString()} · {fmtBytes(backup.size)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleBackupNow(backup.database)}
                      disabled={backing}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                      title="Backup now"
                    >
                      <UploadIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          {backups.length > 20 && (
            <div className="p-3 border-t border-slate-100 text-center">
              <span className="text-xs text-slate-400">Showing 20 of {backups.length} backups</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Main App
const App = () => {
  const [password, setPassword] = useState(localStorage.getItem("pgforge_password") || "");
  const [page, setPage] = useState("dashboard");
  const [dbs, setDbs] = useState<Database[]>([]);
  const [dbStats, setDbStats] = useState<Record<string, DbStats>>({});
  const [period, setPeriod] = useState("1h");
  const [selectedDb, setSelectedDb] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2500);
  };

  const handleLogin = (pw: string, remember: boolean) => {
    setPassword(pw);
    if (remember) localStorage.setItem("pgforge_password", pw);
  };

  const loadDbs = useCallback(async () => {
    try {
      const r = await api("/databases", password);
      if (r.ok) setDbs(await r.json());
    } catch (e: any) {
      if (e.message === "Unauthorized") {
        setPassword("");
        localStorage.removeItem("pgforge_password");
      }
    }
  }, [password]);

  const loadDbStats = useCallback(async (name: string) => {
    try {
      const r = await api("/metrics?period=1h&database=" + encodeURIComponent(name), password);
      if (r.ok) {
        const data = await r.json();
        if (data?.length) {
          const now = Date.now();
          let recent = data.filter((d: any) => d.timestamp > now - 15 * 60 * 1000);
          if (!recent.length) recent = data;
          const last = recent[recent.length - 1];
          setDbStats(prev => ({
            ...prev,
            [name]: {
              cpu: recent.reduce((a: number, b: any) => a + (b.cpu_percent || 0), 0) / recent.length,
              memory: last.memory_mb || 0,
              connections: last.connections || 0,
              disk: last.disk_mb || 0
            }
          }));
        }
      }
    } catch (e) { console.error(e); }
  }, [password]);

  useEffect(() => {
    if (password) {
      loadDbs();
      const interval = setInterval(loadDbs, 5000);
      return () => clearInterval(interval);
    }
  }, [password, loadDbs]);

  useEffect(() => {
    if (password && dbs.length) {
      dbs.filter(d => d.status === "running").forEach(d => loadDbStats(d.name));
      const interval = setInterval(() => {
        dbs.filter(d => d.status === "running").forEach(d => loadDbStats(d.name));
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [password, dbs, loadDbStats]);

  if (!password) {
    return <LoginPage onLogin={handleLogin} />;
  }

  const dbName = page.startsWith("explorer-") ? page.replace("explorer-", "") : null;

  const renderPage = () => {
    if (dbName) return <Explorer dbName={dbName} dbs={dbs} password={password} dbStats={dbStats} showToast={showToast} />;
    if (page === "backups") return <Backups password={password} dbs={dbs} showToast={showToast} />;
    return <Dashboard dbs={dbs} password={password} period={period} setPeriod={setPeriod} selectedDb={selectedDb} setSelectedDb={setSelectedDb} />;
  };

  return (
    <div className="flex min-h-screen">
      <Sidebar dbs={dbs} dbStats={dbStats} currentPage={page} onNavigate={setPage} onOpenCreate={() => setShowCreate(true)} onOpenImport={() => setShowImport(true)} />
      <main className="flex-1 ml-52 p-6">
        {renderPage()}
      </main>
      <CreateModal isOpen={showCreate} onClose={() => setShowCreate(false)} password={password} onSuccess={loadDbs} showToast={showToast} />
      <ImportModal isOpen={showImport} onClose={() => setShowImport(false)} password={password} onSuccess={loadDbs} showToast={showToast} />
      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
};

// Mount
const root = createRoot(document.getElementById("root")!);
root.render(<App />);
