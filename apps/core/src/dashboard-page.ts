let dashboardPageCache: string | null = null;

export function renderDashboardPage(): string {
  if (dashboardPageCache) return dashboardPageCache;
  dashboardPageCache = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#09090f">
  <title>Maximus — Dashboard</title>
  <style>
    :root {
      --bg: #09090f;
      --surface: #12121a;
      --border: #2a2a38;
      --text: #ececf1;
      --text-muted: #8b8b9a;
      --accent: #4c6ef5;
      --radius: 12px;
      --safe-top: env(safe-area-inset-top, 0px);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: calc(1.5rem + var(--safe-top)) 1.25rem 2rem;
    }
    .wrap { max-width: 800px; margin: 0 auto; }
    header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 2rem;
      flex-wrap: wrap;
    }
    h1 { margin: 0; font-size: 1.75rem; }
    .subtitle { opacity: 0.7; margin: 0.35rem 0 0; font-size: 0.95rem; }
    .nav { display: flex; gap: 0.5rem; flex-shrink: 0; }
    .nav a {
      color: var(--text);
      text-decoration: none;
      font-size: 0.88rem;
      padding: 0.45rem 0.85rem;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
    }
    .nav a:hover { border-color: var(--accent); }
    .nav a.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
    .grid {
      display: grid;
      gap: 0.85rem;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      margin-bottom: 2rem;
    }
    .stat {
      padding: 1rem;
      background: var(--surface);
      border-radius: var(--radius);
      border: 1px solid var(--border);
    }
    .stat label {
      display: block;
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      opacity: 0.55;
      margin-bottom: 0.35rem;
    }
    .stat .val { font-size: 1.2rem; font-weight: 650; }
    section { margin-bottom: 2rem; }
    section h2 { font-size: 1.05rem; margin: 0 0 0.75rem; }
    .card {
      padding: 1rem;
      background: var(--surface);
      border-radius: var(--radius);
      border: 1px solid var(--border);
    }
    code { word-break: break-all; font-size: 0.88rem; }
    .journal { list-style: none; padding: 0; margin: 0; }
    .journal li {
      padding: 1rem;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      margin-bottom: 0.75rem;
    }
    .journal .meta { opacity: 0.5; font-size: 0.82rem; margin-bottom: 0.4rem; }
    .offline {
      padding: 1rem;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface);
    }
    .refresh { font-size: 0.78rem; opacity: 0.45; margin-top: 1.5rem; text-align: center; }
    .skeleton {
      background: linear-gradient(90deg, #1a1a26 25%, #222230 50%, #1a1a26 75%);
      background-size: 200% 100%;
      animation: shimmer 1.2s infinite;
      border-radius: 8px;
      height: 1.4rem;
    }
    @keyframes shimmer { to { background-position: -200% 0; } }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div>
        <h1>Maximus</h1>
        <p class="subtitle">Autonomous core — live status</p>
      </div>
      <nav class="nav">
        <a href="/" class="primary">Chat</a>
        <a href="/dashboard">Dashboard</a>
      </nav>
    </header>
    <div id="content">
      <div class="grid" id="stats">
        <div class="stat"><label>Tick</label><div class="val skeleton"></div></div>
        <div class="stat"><label>Uptime</label><div class="val skeleton"></div></div>
        <div class="stat"><label>Goals</label><div class="val skeleton"></div></div>
        <div class="stat"><label>Memories</label><div class="val skeleton"></div></div>
        <div class="stat"><label>Balance</label><div class="val skeleton"></div></div>
        <div class="stat"><label>Model</label><div class="val skeleton"></div></div>
      </div>
    </div>
    <p class="refresh" id="refreshNote">Refreshing every 30s</p>
  </div>
  <script>
    const REFRESH_MS = 30000;

    function esc(s) {
      return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    }

    function stat(label, value) {
      return '<div class="stat"><label>' + esc(label) + '</label><div class="val">' + esc(value) + '</div></div>';
    }

    function render(status) {
      const uptime = Math.floor(status.uptime_seconds / 60) + "m";
      const bal = status.wallet_balance_sol != null
        ? status.wallet_balance_sol.toFixed(4) + " SOL"
        : "—";
      const model = (status.active_llm && status.active_llm.label) || "—";

      let html = '<div class="grid">';
      html += stat("Tick", "#" + status.tick_number);
      html += stat("Uptime", uptime);
      html += stat("Goals", String(status.active_goals));
      html += stat("Memories", String(status.memory_count));
      html += stat("Balance", bal);
      html += stat("Model", model);
      html += "</div>";

      if (status.identity && status.identity.mission) {
        html += '<section><h2>Mission</h2><div class="card"><p style="margin:0">' + esc(status.identity.mission) + "</p></div></section>";
      }

      if (status.wallet_pubkey) {
        html += '<section><h2>Wallet</h2><div class="card"><code>' + esc(status.wallet_pubkey) + "</code></div></section>";
      }

      html += "<section><h2>Recent journal</h2>";
      const journal = status.recent_journal || [];
      if (!journal.length) {
        html += '<p style="opacity:0.6">No journal entries yet.</p>';
      } else {
        html += '<ul class="journal">';
        for (const e of journal) {
          html += '<li><div class="meta">Tick #' + e.tick_number + " · " + esc(e.created_at) + "</div><div>" + esc(e.content) + "</div></li>";
        }
        html += "</ul>";
      }
      html += "</section>";

      document.getElementById("content").innerHTML = html;
      document.getElementById("refreshNote").textContent = "Updated " + new Date().toLocaleTimeString() + " · refreshes every 30s";
    }

    function renderOffline() {
      document.getElementById("content").innerHTML =
        '<div class="offline"><p style="margin:0 0 0.5rem">Core is not responding.</p>' +
        '<p style="margin:0;opacity:0.7">Start with <code>npm run core</code></p></div>';
    }

    async function load() {
      try {
        const res = await fetch("/status");
        if (!res.ok) throw new Error("bad status");
        render(await res.json());
      } catch {
        renderOffline();
      }
    }

    load();
    setInterval(load, REFRESH_MS);
  </script>
</body>
</html>`;
  return dashboardPageCache;
}
