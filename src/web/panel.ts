export const PANEL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PgForge</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: { sans: ['Inter', 'sans-serif'], mono: ['JetBrains Mono', 'monospace'] },
          colors: {
            brand: { 50: '#f0f9ff', 100: '#e0f2fe', 500: '#0ea5e9', 600: '#0284c7' },
            ink: { 0: '#0f172a', 1: '#334155', 2: '#64748b', 3: '#94a3b8' }
          }
        }
      }
    }
  </script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', sans-serif; background: #fafafa; color: #0f172a; -webkit-font-smoothing: antialiased; }
    ::-webkit-scrollbar { width: 4px; height: 4px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 2px; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
    .fade-in { animation: fadeIn 0.2s ease-out; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .pulse { animation: pulse 2s ease-in-out infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .spin { animation: spin 0.6s linear infinite; }
    .chart-container { position: relative; height: 80px; }
  </style>
</head>
<body class="min-h-screen">
  <div id="app"></div>

  <script>
    // ===== STATE =====
    const state = {
      password: localStorage.getItem('pgforge_password') || '',
      page: 'dashboard',
      dbs: [],
      dbName: null,
      period: '1h',
      selectedDb: 'all',
      machineStats: null,
      dbStats: {},
      tableData: null,
      tablePage: 1,
      tableSchema: null,
      tableTable: null
    };

    let charts = {};
    let refreshInterval = null;
    let explorerRefreshInterval = null;
    let isRefreshing = false;
    let promoIdx = 0;
    let promoInterval = null;
    let lastUpdate = Date.now();

    const ROWS_PER_PAGE = 12;
    const GUMROAD_URL = 'https://pappydev.gumroad.com/l/easy-pg-postgres-client';
    const PROMO_IMAGES = [
      'https://public-files.gumroad.com/plc38ywwh1bmja0q1aubo167n7hp',
      'https://public-files.gumroad.com/2ldj7jmfxxwf4ynx48ni6zp26row'
    ];
    const palette = ['#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

    const icons = {
      db: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.657 3.582 3 8 3s8-1.343 8-3V6"/><path d="M4 12v6c0 1.657 3.582 3 8 3s8-1.343 8-3v-6"/></svg>',
      chart: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"/></svg>',
      plus: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>',
      upload: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"/></svg>',
      copy: '<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
      check: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>',
      x: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"/></svg>',
      chevron: '<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5"/></svg>',
      chevronLeft: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5"/></svg>',
      chevronRight: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5"/></svg>',
      table: '<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 0 1-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0 1 12 18.375m9.75-12.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125m19.5 0v1.5c0 .621-.504 1.125-1.125 1.125M2.25 5.625v1.5c0 .621.504 1.125 1.125 1.125m0 0h17.25m-17.25 0h7.5c.621 0 1.125.504 1.125 1.125M3.375 8.25c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25-3.75h-7.5c-.621 0-1.125.504-1.125 1.125m8.625-1.125c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125"/></svg>',
      link: '<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"/></svg>'
    };

    // ===== API =====
    async function api(path, opt = {}) {
      const r = await fetch('/api' + path, { ...opt, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.password, ...opt.headers } });
      if (r.status === 401) { state.password = ''; localStorage.removeItem('pgforge_password'); render(); throw new Error('Unauthorized'); }
      return r;
    }

    // ===== UTILS =====
    function escapeHtml(str) { return str ? String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;') : ''; }
    function fmtBytes(b) { if (!b || b === 0) return '0 B'; const k = 1024, s = ['B', 'KB', 'MB', 'GB']; const i = Math.min(Math.floor(Math.log(Math.abs(b)) / Math.log(k)), 3); return (b / Math.pow(k, i)).toFixed(1) + ' ' + s[i]; }
    function fmtPct(n) { return (n || 0).toFixed(1) + '%'; }

    function toast(msg, type = 'success') {
      const t = document.getElementById('toast');
      if (!t) return;
      t.className = 'fixed bottom-4 right-4 px-4 py-2 rounded-lg text-sm font-medium z-50 transition-all ' + (type === 'success' ? 'bg-slate-900 text-white' : 'bg-red-500 text-white');
      t.innerHTML = msg;
      t.style.opacity = '1'; t.style.transform = 'translateY(0)';
      setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2500);
    }

    // ===== DATA LOADING =====
    async function loadDbs() {
      try {
        const r = await api('/databases');
        if (r.ok) {
          state.dbs = await r.json();
          for (const db of state.dbs.filter(d => d.status === 'running')) {
            loadDbStats(db.name);
          }
          render();
        }
      } catch (e) { console.error(e); }
    }

    async function loadDbStats(name) {
      try {
        const r = await api('/metrics?period=1h&database=' + encodeURIComponent(name));
        if (r.ok) {
          const data = await r.json();
          if (data && data.length > 0) {
            const now = Date.now();
            // Try to get recent data (last 15 min), fall back to all data if none
            let recent = data.filter(d => d.timestamp > now - 15 * 60 * 1000);
            if (recent.length === 0) recent = data;
            const last = recent[recent.length - 1];
            state.dbStats[name] = {
              cpu: recent.reduce((a, b) => a + (b.cpu_percent || 0), 0) / recent.length,
              memory: last.memory_mb || 0,
              connections: last.connections || 0,
              disk: last.disk_mb || 0
            };
            updateDbCardValues(name);
          }
        }
      } catch (e) { console.error(e); }
    }

    async function loadMachineStats() {
      try {
        const r = await api('/machine');
        if (r.ok) { state.machineStats = await r.json(); updateMachineValues(); }
      } catch (e) { console.error(e); }
    }

    async function loadMetrics() {
      if (state.selectedDb === 'machine') { updateMachineValues(); return; }
      try {
        let url = '/metrics?period=' + state.period;
        if (state.selectedDb === 'all') url += '&grouped=true';
        else url += '&database=' + encodeURIComponent(state.selectedDb);
        const r = await api(url);
        if (r.ok) drawCharts(await r.json());
      } catch (e) { console.error(e); }
    }

    async function loadSchema(dbName) {
      const el = document.getElementById('schema');
      if (!el) return;
      el.innerHTML = '<div class="flex items-center justify-center py-8"><span class="w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full spin"></span></div>';
      try {
        const r = await api('/databases/' + encodeURIComponent(dbName) + '/schema');
        if (r.ok) renderSchemaList(await r.json());
        else el.innerHTML = '<div class="py-6 text-center text-slate-400 text-xs">Failed to load</div>';
      } catch (e) { el.innerHTML = '<div class="py-6 text-center text-slate-400 text-xs">Failed to load</div>'; }
    }

    async function loadTable(schema, table) {
      state.tableSchema = schema;
      state.tableTable = table;
      state.tablePage = 1;
      const content = document.getElementById('tbl-content');
      if (!content) return;
      content.innerHTML = '<div class="flex items-center justify-center py-12"><span class="w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full spin"></span></div>';
      try {
        const r = await api('/databases/' + encodeURIComponent(state.dbName) + '/table/' + encodeURIComponent(schema) + '/' + encodeURIComponent(table));
        if (r.ok) {
          state.tableData = await r.json();
          renderTableContent();
        } else {
          content.innerHTML = '<div class="py-12 text-center text-slate-400 text-xs">Failed to load</div>';
        }
      } catch (e) { content.innerHTML = '<div class="py-12 text-center text-slate-400 text-xs">Failed to load</div>'; }
    }

    // ===== UPDATE VALUES =====
    function updateDbCardValues(name) {
      const s = state.dbStats[name];
      if (!s) return;
      const el = (id) => document.getElementById(id + '-' + name);
      if (el('db-cpu')) el('db-cpu').textContent = fmtPct(s.cpu);
      if (el('db-mem')) el('db-mem').textContent = fmtBytes(s.memory * 1024 * 1024);
      if (el('db-conn')) el('db-conn').textContent = s.connections;
      if (el('db-disk')) el('db-disk').textContent = fmtBytes(s.disk * 1024 * 1024);
    }

    function updateMachineValues() {
      if (!state.machineStats) return;
      const cpuEl = document.getElementById('machine-cpu');
      const memEl = document.getElementById('machine-mem');
      const diskEl = document.getElementById('machine-disk');
      if (cpuEl) cpuEl.textContent = fmtPct(state.machineStats.cpu_percent);
      if (memEl) memEl.textContent = fmtBytes(state.machineStats.memory_mb * 1024 * 1024);
      if (diskEl) diskEl.textContent = fmtBytes(state.machineStats.disk_mb * 1024 * 1024);
    }

    function updateMetricValues(last) {
      const cpuEl = document.getElementById('cpu-val');
      const memEl = document.getElementById('mem-val');
      const connEl = document.getElementById('conn-val');
      const diskEl = document.getElementById('disk-val');
      if (cpuEl) cpuEl.textContent = fmtPct(last.cpu_percent);
      if (memEl) memEl.textContent = fmtBytes((last.memory_mb || 0) * 1024 * 1024);
      if (connEl) connEl.textContent = last.connections || 0;
      if (diskEl) diskEl.textContent = fmtBytes((last.disk_mb || 0) * 1024 * 1024);
    }

    // ===== CHARTS =====
    function formatLabel(ts) {
      const d = new Date(ts);
      switch (state.period) {
        case '1h': case '24h': return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        case '7d': return d.toLocaleDateString('en-US', { weekday: 'short' });
        default: return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }
    }

    function drawCharts(data) {
      const isGrouped = data?.databases && Array.isArray(data.databases);
      if (isGrouped) {
        if (!data.total?.length) { showNoData(); return; }
        updateMetricValues(data.total[data.total.length - 1] || {});
        const labels = data.total.map(d => formatLabel(d.timestamp));
        ['cpu', 'mem', 'conn', 'disk'].forEach((id, i) => {
          const field = ['cpu_percent', 'memory_mb', 'connections', 'disk_mb'][i];
          const ctx = document.getElementById(id + '-chart');
          if (!ctx) return;
          const datasets = data.databases.map((db, j) => ({
            label: db.database, data: db.metrics.map(m => m[field] || 0),
            borderColor: palette[j % palette.length], backgroundColor: 'transparent', borderWidth: 1.5, tension: 0.4, pointRadius: 0
          }));
          if (charts[id]) { charts[id].data = { labels, datasets }; charts[id].update('none'); }
          else { charts[id] = new Chart(ctx, { type: 'line', data: { labels, datasets }, options: chartOpts(true) }); }
        });
      } else {
        if (!data?.length) { showNoData(); return; }
        updateMetricValues(data[data.length - 1] || {});
        const labels = data.map(d => formatLabel(d.timestamp));
        [['cpu', 'cpu_percent', '#0ea5e9'], ['mem', 'memory_mb', '#22c55e'], ['conn', 'connections', '#f59e0b'], ['disk', 'disk_mb', '#8b5cf6']].forEach(([id, field, color]) => {
          const ctx = document.getElementById(id + '-chart');
          if (!ctx) return;
          const vals = data.map(m => m[field] || 0);
          if (charts[id]) { charts[id].data.labels = labels; charts[id].data.datasets[0].data = vals; charts[id].update('none'); }
          else { charts[id] = new Chart(ctx, { type: 'line', data: { labels, datasets: [{ data: vals, borderColor: color, backgroundColor: color + '10', borderWidth: 2, tension: 0.4, pointRadius: 0, fill: true }] }, options: chartOpts(false) }); }
        });
      }
    }

    function chartOpts(legend) {
      return {
        responsive: true, maintainAspectRatio: false, interaction: { intersect: false, mode: 'index' },
        plugins: { legend: legend ? { display: true, position: 'bottom', labels: { boxWidth: 6, padding: 8, font: { size: 10 }, usePointStyle: true } } : { display: false }, tooltip: { backgroundColor: '#0f172a', titleColor: '#fff', bodyColor: '#94a3b8', padding: 8, cornerRadius: 4, displayColors: false } },
        scales: { x: { display: false }, y: { display: false, beginAtZero: true } }
      };
    }

    function showNoData() {
      ['cpu', 'mem', 'conn', 'disk'].forEach(id => {
        const c = document.getElementById(id + '-chart');
        if (c?.parentElement) c.parentElement.innerHTML = '<div class="flex items-center justify-center h-full text-slate-400 text-xs">No data</div>';
      });
    }

    // ===== REFRESH =====
    function startRefresh() {
      triggerRefresh();
      if (refreshInterval) clearInterval(refreshInterval);
      refreshInterval = setInterval(triggerRefresh, 2000);
    }

    function stopRefresh() { if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; } }
    function stopExplorerRefresh() { if (explorerRefreshInterval) { clearInterval(explorerRefreshInterval); explorerRefreshInterval = null; } }

    function startExplorerRefresh() {
      triggerExplorerRefresh();
      if (explorerRefreshInterval) clearInterval(explorerRefreshInterval);
      explorerRefreshInterval = setInterval(triggerExplorerRefresh, 2000);
    }

    async function triggerExplorerRefresh() {
      if (!state.dbName) return;
      try {
        await loadDbStats(state.dbName);
        updateLiveIndicator();
      } catch (e) { console.error(e); }
    }

    function updateLiveIndicator() {
      lastUpdate = Date.now();
      const el = document.getElementById('live-indicator');
      if (el) {
        el.classList.add('opacity-100');
        el.classList.remove('opacity-0');
        setTimeout(() => {
          el.classList.add('opacity-0');
          el.classList.remove('opacity-100');
        }, 400);
      }
    }

    async function triggerRefresh() {
      if (isRefreshing) return;
      isRefreshing = true;
      try {
        await Promise.all([loadMetrics(), loadMachineStats()]);
        for (const db of state.dbs.filter(d => d.status === 'running')) loadDbStats(db.name);
      } finally { isRefreshing = false; }
    }

    // ===== NAVIGATION =====
    function nav(p) {
      state.page = p;
      if (p.startsWith('explorer-')) state.dbName = p.replace('explorer-', '');
      state.tableData = null; state.tablePage = 1;
      render();
      if (state.page === 'dashboard') { stopExplorerRefresh(); startRefresh(); }
      else if (state.page.startsWith('explorer-')) { stopRefresh(); loadSchema(state.dbName); startExplorerRefresh(); }
      else { stopRefresh(); stopExplorerRefresh(); }
    }

    function setPeriod(p) {
      if (state.period === p) return;
      state.period = p;
      Object.keys(charts).forEach(k => { if (charts[k]) { charts[k].destroy(); delete charts[k]; } });
      document.querySelectorAll('.period-btn').forEach(btn => {
        btn.className = 'period-btn px-3 py-1 text-xs font-medium rounded-md transition-colors ' + (btn.dataset.period === p ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-700');
      });
      triggerRefresh();
    }

    function selectView(v) {
      state.selectedDb = v;
      Object.keys(charts).forEach(k => { if (charts[k]) { charts[k].destroy(); delete charts[k]; } });
      render();
      triggerRefresh();
    }

    // ===== TABLE PAGINATION =====
    function setTablePage(p) {
      state.tablePage = p;
      renderTableContent();
    }

    function renderTableContent() {
      const content = document.getElementById('tbl-content');
      if (!content || !state.tableData) return;
      const d = state.tableData;
      const rows = d.rows || [];
      const totalRows = d.totalRows || rows.length;
      const totalPages = Math.ceil(rows.length / ROWS_PER_PAGE);
      const currentPage = state.tablePage;
      const startIdx = (currentPage - 1) * ROWS_PER_PAGE;
      const pageRows = rows.slice(startIdx, startIdx + ROWS_PER_PAGE);
      const isFirstPage = currentPage === 1;

      let h = '<div class="px-3 py-2 border-b border-slate-100 flex items-center justify-between">' +
        '<div class="text-xs"><span class="text-slate-400">' + escapeHtml(state.tableSchema) + '.</span><span class="font-medium text-slate-700">' + escapeHtml(state.tableTable) + '</span></div>' +
        '<div class="flex items-center gap-2"><span class="text-[10px] text-slate-400">' + totalRows + ' rows</span>';

      // Pagination controls
      if (totalPages > 1) {
        h += '<div class="flex items-center gap-1">';
        h += '<button onclick="setTablePage(' + (currentPage - 1) + ')" ' + (currentPage === 1 ? 'disabled' : '') + ' class="p-1 rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed">' + icons.chevronLeft + '</button>';
        h += '<span class="text-xs text-slate-600 px-2">' + currentPage + '/' + totalPages + '</span>';
        h += '<button onclick="setTablePage(' + (currentPage + 1) + ')" ' + (currentPage === totalPages ? 'disabled' : '') + ' class="p-1 rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed">' + icons.chevronRight + '</button>';
        h += '</div>';
      }
      h += '</div></div>';

      if (!d.columns?.length) { content.innerHTML = h + '<div class="py-12 text-center text-slate-400 text-xs">No columns</div>'; return; }
      if (!pageRows.length) { content.innerHTML = h + '<div class="py-12 text-center text-slate-400 text-xs">No data on this page</div>'; return; }

      // If not first page, show blurred content with promo
      if (!isFirstPage) {
        h += '<div class="relative flex-1 overflow-hidden">';
        h += '<div class="absolute inset-0 overflow-auto blur-[3px] select-none pointer-events-none opacity-60">';
        h += '<table class="w-full text-xs"><thead class="bg-slate-50 sticky top-0"><tr>';
        d.columns.forEach(c => h += '<th class="px-3 py-2 text-left font-medium text-slate-500 whitespace-nowrap">' + escapeHtml(c.name) + '</th>');
        h += '</tr></thead><tbody class="divide-y divide-slate-50">';
        pageRows.forEach(r => {
          h += '<tr>';
          d.columns.forEach(c => {
            const v = r[c.name];
            h += '<td class="px-3 py-2 font-mono text-slate-600 max-w-xs truncate">' + (v === null ? 'null' : escapeHtml(String(v))) + '</td>';
          });
          h += '</tr>';
        });
        h += '</tbody></table></div>';

        // Promo overlay
        h += '<div class="absolute inset-0 bg-white/90 flex items-center justify-center">';
        h += '<div class="text-center max-w-sm px-6">';
        h += '<div class="mb-4 text-slate-600 text-sm">For the best experience browsing your database, use a dedicated SQL client</div>';

        // Image carousel
        h += '<a href="' + GUMROAD_URL + '" target="_blank" class="block mb-4">';
        h += '<div class="relative w-64 h-40 mx-auto rounded-lg overflow-hidden shadow-lg border border-slate-200">';
        h += '<img id="promo-img" src="' + PROMO_IMAGES[0] + '" alt="PgForge Client" class="w-full h-full object-cover transition-opacity duration-300"/>';
        h += '<div class="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">';
        PROMO_IMAGES.forEach((_, i) => h += '<span class="promo-dot w-2 h-2 rounded-full transition-colors ' + (i === 0 ? 'bg-white' : 'bg-white/50') + '"></span>');
        h += '</div></div></a>';

        h += '<a href="' + GUMROAD_URL + '" target="_blank" class="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors">';
        h += '<span class="w-5 h-5 rounded bg-gradient-to-br from-sky-400 to-indigo-500 flex items-center justify-center text-[8px] font-bold">PG</span>';
        h += 'Get PgForge Client</a>';
        h += '<div class="mt-2 text-xs text-slate-400">A professional PostgreSQL client</div>';
        h += '</div></div></div>';

        content.innerHTML = h;
        startPromoCarousel();
        return;
      }

      // First page - show normal data
      h += '<div class="overflow-auto flex-1"><table class="w-full text-xs"><thead class="bg-slate-50 sticky top-0 z-10"><tr>';
      d.columns.forEach(c => h += '<th class="px-3 py-2 text-left font-medium text-slate-500 whitespace-nowrap">' + escapeHtml(c.name) + '</th>');
      h += '</tr></thead><tbody class="divide-y divide-slate-50">';
      pageRows.forEach(r => {
        h += '<tr class="hover:bg-slate-50">';
        d.columns.forEach(c => {
          const v = r[c.name];
          h += v === null ? '<td class="px-3 py-2 font-mono text-slate-300 italic">null</td>' : '<td class="px-3 py-2 font-mono text-slate-600 max-w-xs truncate" title="' + escapeHtml(String(v)) + '">' + escapeHtml(String(v)) + '</td>';
        });
        h += '</tr>';
      });
      h += '</tbody></table></div>';
      content.innerHTML = h;
    }

    function startPromoCarousel() {
      if (promoInterval) clearInterval(promoInterval);
      promoInterval = setInterval(() => {
        promoIdx = (promoIdx + 1) % PROMO_IMAGES.length;
        const img = document.getElementById('promo-img');
        if (img) {
          img.style.opacity = '0';
          setTimeout(() => { img.src = PROMO_IMAGES[promoIdx]; img.style.opacity = '1'; }, 150);
        }
        document.querySelectorAll('.promo-dot').forEach((dot, i) => {
          dot.classList.toggle('bg-white', i === promoIdx);
          dot.classList.toggle('bg-white/50', i !== promoIdx);
        });
      }, 3000);
    }

    // ===== SCHEMA LIST =====
    function renderSchemaList(schema) {
      const el = document.getElementById('schema');
      if (!el || !schema) return;
      const entries = Object.entries(schema);
      if (!entries.length) { el.innerHTML = '<div class="py-6 text-center text-slate-400 text-xs">No tables</div>'; return; }

      let h = '';
      for (const [s, tables] of entries) {
        if (!Array.isArray(tables)) continue;
        h += '<div class="border-b border-slate-100 last:border-0">' +
          '<button onclick="toggleSchema(this)" class="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-left text-xs">' +
          '<span class="schema-chevron text-slate-400 transition-transform" style="transform:rotate(90deg)">' + icons.chevron + '</span>' +
          '<span class="font-medium text-slate-700">' + escapeHtml(s) + '</span>' +
          '<span class="ml-auto text-[10px] text-slate-400">' + tables.length + '</span></button>' +
          '<div class="schema-tables">';
        for (const t of tables) {
          const name = t?.name || t;
          if (name) h += '<button onclick="loadTable(\\'' + escapeHtml(s) + '\\',\\'' + escapeHtml(name) + '\\')" class="table-btn w-full flex items-center gap-2 px-3 py-1.5 pl-7 text-xs text-slate-500 hover:bg-sky-50 hover:text-sky-600 text-left">' + icons.table + '<span class="truncate">' + escapeHtml(name) + '</span></button>';
        }
        h += '</div></div>';
      }
      el.innerHTML = h;
    }

    function toggleSchema(btn) {
      const ch = btn.querySelector('.schema-chevron'), tb = btn.nextElementSibling;
      const hidden = tb.classList.contains('hidden');
      ch.style.transform = hidden ? 'rotate(90deg)' : 'rotate(0deg)';
      tb.classList.toggle('hidden');
    }

    // ===== AUTH =====
    async function login(e) {
      e.preventDefault();
      const pw = document.getElementById('pw').value;
      const remember = document.getElementById('remember').checked;
      const btn = e.target.querySelector('button');
      const err = document.getElementById('err');
      btn.disabled = true; btn.innerHTML = '<span class="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full spin"></span>';
      err.classList.add('hidden');
      try {
        const r = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
        if (!r.ok) { err.textContent = 'Invalid password'; err.classList.remove('hidden'); return; }
        state.password = pw;
        if (remember) localStorage.setItem('pgforge_password', pw);
        await loadDbs();
      } catch { err.textContent = 'Connection failed'; err.classList.remove('hidden'); }
      finally { btn.disabled = false; btn.textContent = 'Sign in'; }
    }

    // ===== MODALS =====
    function openCreate() { document.getElementById('create-modal').classList.remove('hidden'); document.getElementById('create-name').value = ''; document.getElementById('create-form').classList.remove('hidden'); document.getElementById('create-result').classList.add('hidden'); }
    function closeCreate() { document.getElementById('create-modal').classList.add('hidden'); if (!document.getElementById('create-result').classList.contains('hidden')) loadDbs(); }

    async function doCreate(e) {
      e.preventDefault();
      const name = document.getElementById('create-name').value.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true; btn.innerHTML = '<span class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full spin"></span>';
      try {
        const r = await api('/databases', { method: 'POST', body: JSON.stringify({ name }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Failed');
        document.getElementById('create-form').classList.add('hidden');
        document.getElementById('create-result').classList.remove('hidden');
        document.getElementById('create-url').textContent = d.url;
      } catch (e) { toast(e.message, 'error'); }
      finally { btn.disabled = false; btn.innerHTML = 'Create'; }
    }

    function openImport() { document.getElementById('import-modal').classList.remove('hidden'); document.getElementById('import-url').value = ''; document.getElementById('import-name').value = ''; document.getElementById('import-form').classList.remove('hidden'); document.getElementById('import-progress').classList.add('hidden'); document.getElementById('import-result').classList.add('hidden'); document.getElementById('import-error').classList.add('hidden'); }
    function closeImport() { document.getElementById('import-modal').classList.add('hidden'); if (!document.getElementById('import-result').classList.contains('hidden')) loadDbs(); }

    async function doImport(e) {
      e.preventDefault();
      const url = document.getElementById('import-url').value;
      const name = document.getElementById('import-name').value.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      const btn = e.target.querySelector('button[type=submit]');
      const prog = document.getElementById('import-progress');
      const fill = prog.querySelector('.progress-fill');
      const pct = prog.querySelector('.progress-pct');
      const errEl = document.getElementById('import-error');
      btn.disabled = true; document.getElementById('import-url').disabled = true; document.getElementById('import-name').disabled = true; prog.classList.remove('hidden'); errEl.classList.add('hidden');
      let p = 0;
      const iv = setInterval(() => { p = Math.min(p + Math.random() * 8, 85); fill.style.width = p + '%'; pct.textContent = Math.round(p) + '%'; }, 500);
      try {
        const r = await api('/databases/import', { method: 'POST', body: JSON.stringify({ sourceUrl: url, name: name || undefined }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Import failed');
        clearInterval(iv); fill.style.width = '100%'; pct.textContent = '100%';
        setTimeout(() => { document.getElementById('import-form').classList.add('hidden'); prog.classList.add('hidden'); document.getElementById('import-result').classList.remove('hidden'); document.getElementById('import-result-url').textContent = d.url; }, 300);
      } catch (e) { clearInterval(iv); prog.classList.add('hidden'); errEl.textContent = e.message; errEl.classList.remove('hidden'); btn.disabled = false; document.getElementById('import-url').disabled = false; document.getElementById('import-name').disabled = false; }
    }

    function copyUrl(id) {
      const el = document.getElementById(id);
      if (!el) return;
      const text = el.textContent || el.innerText;

      // Find the associated copy button
      const btnId = id === 'create-url' ? 'create-copy-btn' : id === 'import-result-url' ? 'import-copy-btn' : null;
      const btn = btnId ? document.getElementById(btnId) : null;

      navigator.clipboard.writeText(text).then(() => {
        if (btn) {
          const span = btn.querySelector('span');
          if (span) {
            const originalText = span.textContent;
            span.textContent = 'Copied!';
            btn.classList.add('bg-emerald-500');
            btn.classList.remove('bg-slate-900', 'hover:bg-slate-800');
            setTimeout(() => {
              span.textContent = originalText;
              btn.classList.remove('bg-emerald-500');
              btn.classList.add('bg-slate-900', 'hover:bg-slate-800');
            }, 2000);
          }
        }
        toast('Copied to clipboard');
      }).catch(() => toast('Failed to copy', 'error'));
    }
    function copyToClipboard(text) {
      navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard')).catch(() => toast('Failed to copy', 'error'));
    }

    // ===== RENDER =====
    function render() {
      const app = document.getElementById('app');
      if (!state.password) { stopRefresh(); app.innerHTML = authHTML(); document.getElementById('auth-form').addEventListener('submit', login); return; }
      app.innerHTML = appHTML();
      document.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => nav(b.dataset.nav)));
      if (state.page === 'dashboard') startRefresh();
      else { stopRefresh(); if (state.page.startsWith('explorer-')) loadSchema(state.dbName); }
    }

    function authHTML() {
      return '<div class="min-h-screen flex items-center justify-center p-4"><div class="w-full max-w-xs fade-in">' +
        '<div class="text-center mb-8"><div class="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-slate-900 text-white mb-4">' + icons.db + '</div>' +
        '<h1 class="text-lg font-semibold text-slate-900">PgForge</h1><p class="text-slate-400 text-sm mt-1">Sign in to continue</p></div>' +
        '<form id="auth-form" class="space-y-4">' +
        '<input type="password" id="pw" class="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm placeholder:text-slate-400 focus:border-slate-400 focus:ring-0 outline-none" placeholder="Password" autofocus>' +
        '<label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" id="remember" class="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-0"/><span class="text-sm text-slate-500">Remember me</span></label>' +
        '<div id="err" class="hidden text-red-500 text-xs"></div>' +
        '<button type="submit" class="w-full py-2.5 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors">Sign in</button></form></div></div>';
    }

    function appHTML() {
      const isExp = state.page.startsWith('explorer-');
      return '<div class="flex min-h-screen">' + sidebarHTML() + '<main class="flex-1 ml-52 p-6">' + (isExp ? explorerHTML() : dashHTML()) + '</main></div>' + createModalHTML() + importModalHTML() +
        '<div id="toast" class="fixed bottom-4 right-4 px-4 py-2 rounded-lg opacity-0 translate-y-12 transition-all duration-200 z-50"></div>';
    }

    function sidebarHTML() {
      let dbItems = '';
      state.dbs.forEach(d => {
        const active = state.page === 'explorer-' + d.name;
        const s = state.dbStats[d.name];
        dbItems += '<button data-nav="explorer-' + d.name + '" class="w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ' + (active ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50') + '">' +
          '<div class="flex items-center gap-2">' + icons.db + '<span class="truncate font-medium">' + escapeHtml(d.name) + '</span>' +
          (d.status === 'running' ? '<span class="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-500 pulse"></span>' : '<span class="ml-auto w-1.5 h-1.5 rounded-full bg-slate-300"></span>') + '</div>' +
          (d.status === 'running' && s ? '<div class="mt-1.5 grid grid-cols-4 gap-1 text-[9px] text-slate-400">' +
            '<div><span id="db-cpu-' + d.name + '" class="text-slate-600 font-medium">' + fmtPct(s.cpu) + '</span> cpu</div>' +
            '<div><span id="db-mem-' + d.name + '" class="text-slate-600 font-medium">' + fmtBytes(s.memory * 1024 * 1024) + '</span></div>' +
            '<div><span id="db-conn-' + d.name + '" class="text-slate-600 font-medium">' + s.connections + '</span> conn</div>' +
            '<div><span id="db-disk-' + d.name + '" class="text-slate-600 font-medium">' + fmtBytes(s.disk * 1024 * 1024) + '</span></div></div>' : '') +
          '</button>';
      });

      return '<nav class="fixed left-0 top-0 bottom-0 w-52 bg-white border-r border-slate-100 flex flex-col">' +
        '<div class="p-4 border-b border-slate-100"><div class="flex items-center gap-2">' +
        '<div class="w-7 h-7 rounded-lg bg-slate-900 flex items-center justify-center text-white">' + icons.db + '</div>' +
        '<span class="text-sm font-semibold text-slate-900">PgForge</span>' +
        '<span class="ml-auto flex items-center gap-1 text-[10px] text-emerald-600"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500 pulse"></span>Live</span></div></div>' +
        '<div class="p-3 border-b border-slate-100 flex gap-2">' +
        '<button onclick="openCreate()" class="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800">' + icons.plus + 'New</button>' +
        '<button onclick="openImport()" class="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium hover:bg-slate-200">' + icons.upload + 'Import</button></div>' +
        '<div class="flex-1 overflow-y-auto p-3">' +
        '<div class="mb-3"><div class="text-[10px] font-medium text-slate-400 uppercase tracking-wider px-3 mb-2">Overview</div>' +
        '<button data-nav="dashboard" class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ' + (state.page === 'dashboard' ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50') + '">' + icons.chart + 'Dashboard</button></div>' +
        '<div><div class="text-[10px] font-medium text-slate-400 uppercase tracking-wider px-3 mb-2">Databases</div><div class="space-y-1">' + dbItems + '</div></div></div></nav>';
    }

    function dashHTML() {
      const running = state.dbs.filter(d => d.status === 'running').length;
      let viewTabs = '<button onclick="selectView(\\'machine\\')" class="view-tab px-3 py-1 text-xs font-medium rounded-md transition-colors ' + (state.selectedDb === 'machine' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-700') + '">Host</button>' +
        '<button onclick="selectView(\\'all\\')" class="view-tab px-3 py-1 text-xs font-medium rounded-md transition-colors ' + (state.selectedDb === 'all' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-700') + '">All DBs</button>';
      state.dbs.forEach(d => viewTabs += '<button onclick="selectView(\\'' + escapeHtml(d.name) + '\\')" class="view-tab px-3 py-1 text-xs font-medium rounded-md transition-colors ' + (state.selectedDb === d.name ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-700') + '">' + escapeHtml(d.name) + '</button>');

      return '<div class="fade-in max-w-5xl">' +
        '<div class="flex items-center justify-between mb-6"><div><h1 class="text-lg font-semibold text-slate-900">Dashboard</h1><p class="text-slate-400 text-sm">' + running + ' of ' + state.dbs.length + ' running</p></div>' +
        '<div class="flex items-center gap-2 bg-slate-100 rounded-lg p-1">' +
        ['1h', '24h', '7d', '30d', 'all'].map(p => '<button onclick="setPeriod(\\'' + p + '\\')" data-period="' + p + '" class="period-btn px-3 py-1 text-xs font-medium rounded-md transition-colors ' + (state.period === p ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-700') + '">' + p.toUpperCase() + '</button>').join('') +
        '</div></div>' +
        '<div class="flex gap-2 mb-6 overflow-x-auto pb-1">' + viewTabs + '</div>' +
        (state.selectedDb === 'machine' ? machineStatsHTML() : metricsCardsHTML()) +
        '</div>';
    }

    function machineStatsHTML() {
      const m = state.machineStats;
      return '<div class="grid grid-cols-3 gap-4">' +
        '<div class="bg-white rounded-xl border border-slate-100 p-4"><div class="text-xs text-slate-400 mb-1">CPU Usage</div><div id="machine-cpu" class="text-2xl font-semibold text-slate-900 tabular-nums">' + (m ? fmtPct(m.cpu_percent) : '-') + '</div></div>' +
        '<div class="bg-white rounded-xl border border-slate-100 p-4"><div class="text-xs text-slate-400 mb-1">Memory</div><div id="machine-mem" class="text-2xl font-semibold text-slate-900 tabular-nums">' + (m ? fmtBytes(m.memory_mb * 1024 * 1024) : '-') + '</div></div>' +
        '<div class="bg-white rounded-xl border border-slate-100 p-4"><div class="text-xs text-slate-400 mb-1">Disk</div><div id="machine-disk" class="text-2xl font-semibold text-slate-900 tabular-nums">' + (m ? fmtBytes(m.disk_mb * 1024 * 1024) : '-') + '</div></div></div>';
    }

    function metricsCardsHTML() {
      return '<div class="grid grid-cols-2 gap-4">' +
        ['CPU', 'Memory', 'Connections', 'Disk'].map((l, i) => {
          const id = ['cpu', 'mem', 'conn', 'disk'][i];
          const color = ['#0ea5e9', '#22c55e', '#f59e0b', '#8b5cf6'][i];
          return '<div class="bg-white rounded-xl border border-slate-100 p-4"><div class="flex items-center justify-between mb-2"><span class="text-xs text-slate-400">' + l + '</span><span id="' + id + '-val" class="text-sm font-semibold tabular-nums" style="color:' + color + '">-</span></div><div class="chart-container"><canvas id="' + id + '-chart"></canvas></div></div>';
        }).join('') +
        '</div>';
    }

    function explorerHTML() {
      const db = state.dbs.find(d => d.name === state.dbName);
      const connUrl = db ? 'postgresql://' + db.user + ':' + db.password + '@' + db.host + ':' + db.port + '/' + db.database : '';
      const s = state.dbStats[state.dbName];

      return '<div class="fade-in h-[calc(100vh-48px)] flex flex-col max-w-6xl">' +
        '<div class="mb-4 flex-shrink-0"><div class="flex items-center justify-between">' +
        '<div><h1 class="text-lg font-semibold text-slate-900">' + escapeHtml(state.dbName) + '</h1><p class="text-slate-400 text-sm">Browse tables and data</p></div>' +
        (db && connUrl ? '<button onclick="copyToClipboard(\\'' + escapeHtml(connUrl) + '\\')" class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs text-slate-600 font-mono transition-colors">' + icons.link + '<span class="max-w-xs truncate">' + escapeHtml(connUrl) + '</span>' + icons.copy + '</button>' : '') +
        '</div>' +
        (db && db.status === 'running' ? '<div class="relative"><div id="live-indicator" class="absolute -top-1 right-0 flex items-center gap-1.5 text-[10px] text-emerald-600 opacity-0 transition-opacity duration-300"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>Updated</div>' +
          '<div class="grid grid-cols-4 gap-3 mt-4">' +
          '<div class="bg-white rounded-lg border border-slate-100 px-3 py-2"><div class="text-[10px] text-slate-400 uppercase">CPU <span class="text-slate-300">(15min)</span></div><div id="db-cpu-' + state.dbName + '" class="text-sm font-semibold text-slate-900 tabular-nums">' + (s ? fmtPct(s.cpu) : '-') + '</div></div>' +
          '<div class="bg-white rounded-lg border border-slate-100 px-3 py-2"><div class="text-[10px] text-slate-400 uppercase">Memory <span class="text-slate-300">(15min)</span></div><div id="db-mem-' + state.dbName + '" class="text-sm font-semibold text-slate-900 tabular-nums">' + (s ? fmtBytes(s.memory * 1024 * 1024) : '-') + '</div></div>' +
          '<div class="bg-white rounded-lg border border-slate-100 px-3 py-2"><div class="text-[10px] text-slate-400 uppercase">Connections <span class="text-slate-300">(live)</span></div><div id="db-conn-' + state.dbName + '" class="text-sm font-semibold text-slate-900 tabular-nums">' + (s ? s.connections : '-') + '</div></div>' +
          '<div class="bg-white rounded-lg border border-slate-100 px-3 py-2"><div class="text-[10px] text-slate-400 uppercase">Disk <span class="text-slate-300">(live)</span></div><div id="db-disk-' + state.dbName + '" class="text-sm font-semibold text-slate-900 tabular-nums">' + (s ? fmtBytes(s.disk * 1024 * 1024) : '-') + '</div></div></div></div>' : '') +
        '</div>' +
        '<div class="flex-1 grid grid-cols-[200px_1fr] gap-4 min-h-0">' +
        '<div class="bg-white rounded-xl border border-slate-100 overflow-hidden flex flex-col"><div class="px-3 py-2 border-b border-slate-100 text-xs font-medium text-slate-500">Tables</div><div id="schema" class="flex-1 overflow-y-auto"></div></div>' +
        '<div id="tbl-content" class="bg-white rounded-xl border border-slate-100 overflow-hidden flex flex-col"><div class="flex-1 flex items-center justify-center text-slate-400 text-xs">Select a table</div></div></div></div>';
    }

    function createModalHTML() {
      return '<div id="create-modal" class="hidden fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50 p-4" onclick="if(event.target===this)closeCreate()">' +
        '<div class="bg-white rounded-xl w-full max-w-md fade-in shadow-xl"><div class="p-4 border-b border-slate-100"><h2 class="text-sm font-semibold text-slate-900">New Database</h2></div>' +
        '<form id="create-form" onsubmit="doCreate(event)"><div class="p-4"><label class="block text-xs text-slate-500 mb-1.5">Name</label>' +
        '<input type="text" id="create-name" class="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm placeholder:text-slate-400 focus:border-slate-400 focus:ring-0 outline-none" placeholder="my-database" pattern="[a-zA-Z0-9-]+" required></div>' +
        '<div class="flex gap-2 p-4 pt-0"><button type="button" onclick="closeCreate()" class="flex-1 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">Cancel</button><button type="submit" class="flex-1 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800">Create</button></div></form>' +
        '<div id="create-result" class="hidden p-4">' +
        '<div class="flex items-center justify-center mb-4"><div class="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">' + icons.check + '</div></div>' +
        '<h3 class="text-center text-sm font-semibold text-slate-900 mb-1">Database Created!</h3>' +
        '<p class="text-center text-xs text-slate-500 mb-4">Your database is ready to use</p>' +
        '<div class="bg-slate-50 rounded-lg p-3 mb-3"><div class="text-[10px] text-slate-400 uppercase mb-1">Connection URL</div><div id="create-url" class="font-mono text-xs text-slate-700 break-all select-all"></div></div>' +
        '<button id="create-copy-btn" onclick="copyUrl(\\'create-url\\')" class="w-full py-2.5 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 flex items-center justify-center gap-1.5 transition-colors">' + icons.copy + '<span>Copy URL</span></button>' +
        '<button onclick="closeCreate()" class="w-full mt-2 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">Done</button></div></div></div>';
    }

    function importModalHTML() {
      return '<div id="import-modal" class="hidden fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50 p-4" onclick="if(event.target===this&&document.getElementById(\\'import-progress\\').classList.contains(\\'hidden\\'))closeImport()">' +
        '<div class="bg-white rounded-xl w-full max-w-md fade-in shadow-xl"><div class="p-4 border-b border-slate-100"><h2 class="text-sm font-semibold text-slate-900">Import Database</h2><p class="text-xs text-slate-400 mt-0.5">From Neon, Supabase, or any PostgreSQL</p></div>' +
        '<form id="import-form" onsubmit="doImport(event)"><div class="p-4 space-y-3">' +
        '<div><label class="block text-xs text-slate-500 mb-1.5">Database Name</label>' +
        '<input type="text" id="import-name" class="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm placeholder:text-slate-400 focus:border-slate-400 focus:ring-0 outline-none" placeholder="my-imported-db" pattern="[a-zA-Z0-9-]+" required></div>' +
        '<div><label class="block text-xs text-slate-500 mb-1.5">Source Connection URL</label>' +
        '<input type="text" id="import-url" class="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm font-mono placeholder:text-slate-400 focus:border-slate-400 focus:ring-0 outline-none" placeholder="postgresql://user:pass@host/db" required></div>' +
        '<div id="import-error" class="hidden p-2 rounded-lg bg-red-50 text-xs text-red-600"></div>' +
        '<div id="import-progress" class="hidden"><div class="flex justify-between text-xs mb-1"><span class="text-slate-400">Importing...</span><span class="progress-pct text-slate-600 font-medium">0%</span></div><div class="h-1 bg-slate-200 rounded-full overflow-hidden"><div class="progress-fill h-full bg-slate-900 transition-all" style="width:0"></div></div></div></div>' +
        '<div class="flex gap-2 p-4 pt-0"><button type="button" onclick="closeImport()" class="flex-1 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">Cancel</button><button type="submit" class="flex-1 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800">Import</button></div></form>' +
        '<div id="import-result" class="hidden p-4">' +
        '<div class="flex items-center justify-center mb-4"><div class="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">' + icons.check + '</div></div>' +
        '<h3 class="text-center text-sm font-semibold text-slate-900 mb-1">Import Complete!</h3>' +
        '<p class="text-center text-xs text-slate-500 mb-4">Your database has been imported successfully</p>' +
        '<div class="bg-slate-50 rounded-lg p-3 mb-3"><div class="text-[10px] text-slate-400 uppercase mb-1">Connection URL</div><div id="import-result-url" class="font-mono text-xs text-slate-700 break-all select-all"></div></div>' +
        '<button id="import-copy-btn" onclick="copyUrl(\\'import-result-url\\')" class="w-full py-2.5 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 flex items-center justify-center gap-1.5 transition-colors">' + icons.copy + '<span>Copy URL</span></button>' +
        '<button onclick="closeImport()" class="w-full mt-2 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">Done</button></div></div></div>';
    }

    // ===== INIT =====
    render();
    if (state.password) loadDbs();
  </script>
</body>
</html>`;
