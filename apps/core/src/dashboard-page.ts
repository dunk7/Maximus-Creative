import { LUCIDE_CSS, lucide } from "./ui-icons.js";

export function renderDashboardPage(): string {
  const i = lucide;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#09090f">
  <title>Maximus — Status</title>
  <style>
    :root {
      --bg: #09090f;
      --surface: #12121a;
      --surface-2: #1a1a26;
      --border: #2a2a38;
      --text: #ececf1;
      --text-muted: #8b8b9a;
      --accent: #4c6ef5;
      --accent-soft: #4c6ef522;
      --radius: 14px;
      --safe-top: env(safe-area-inset-top, 0px);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: calc(1.25rem + var(--safe-top)) 1rem 2rem;
      letter-spacing: -0.01em;
    }
    ${LUCIDE_CSS}
    .wrap { max-width: 820px; margin: 0 auto; }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 1.75rem;
      flex-wrap: wrap;
    }
    .brand { display: flex; align-items: center; gap: 0.85rem; }
    .brand-icon {
      width: 44px; height: 44px;
      border-radius: 14px;
      background: linear-gradient(135deg, var(--accent), #7950f2);
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 6px 20px #4c6ef533;
    }
    .brand-icon .lucide { width: 24px; height: 24px; stroke: #fff; }
    h1 { margin: 0; font-size: 1.35rem; font-weight: 650; }
    .subtitle { color: var(--text-muted); margin: 0.2rem 0 0; font-size: 0.88rem; }
    .nav { display: flex; gap: 0.5rem; flex-shrink: 0; }
    .nav a {
      color: var(--text);
      text-decoration: none;
      font-size: 0.84rem;
      font-weight: 600;
      padding: 0.5rem 0.85rem;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--surface);
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
    }
    .nav a .lucide { width: 15px; height: 15px; }
    .nav a:hover { border-color: #4c6ef566; }
    .nav a.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
    .grid {
      display: grid;
      gap: 0.75rem;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      margin-bottom: 1.75rem;
    }
    .stat {
      padding: 1rem 1.05rem;
      background: var(--surface);
      border-radius: var(--radius);
      border: 1px solid var(--border);
    }
    .stat-head {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.72rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 0.45rem;
    }
    .stat-head .lucide { width: 14px; height: 14px; opacity: 0.7; }
    .stat .val { font-size: 1.15rem; font-weight: 650; }
    section { margin-bottom: 1.75rem; }
    section h2 {
      font-size: 0.95rem;
      font-weight: 650;
      margin: 0 0 0.65rem;
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }
    section h2 .lucide { width: 16px; height: 16px; color: #91a7ff; }
    .card {
      padding: 1rem 1.1rem;
      background: var(--surface);
      border-radius: var(--radius);
      border: 1px solid var(--border);
    }
    code { word-break: break-all; font-size: 0.84rem; color: #adb5bd; }
    .journal { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.65rem; }
    .journal li {
      padding: 0.95rem 1.05rem;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
    }
    .journal .meta { color: var(--text-muted); font-size: 0.78rem; margin-bottom: 0.35rem; }
    .memory-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.55rem; }
    .memory-list li {
      padding: 0.85rem 1rem;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      font-size: 0.88rem;
    }
    .memory-list .meta { color: var(--text-muted); font-size: 0.75rem; margin-bottom: 0.3rem; }
    .memory-type {
      display: inline-block;
      font-size: 0.68rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #91a7ff;
      margin-right: 0.35rem;
    }
    .offline {
      padding: 1.25rem;
      border: 1px solid #e0313144;
      border-radius: var(--radius);
      background: #2a1515;
      color: #ff8787;
      display: flex;
      gap: 0.75rem;
      align-items: flex-start;
    }
    .offline .lucide { width: 20px; height: 20px; flex-shrink: 0; margin-top: 0.1rem; }
    .refresh {
      font-size: 0.78rem;
      color: var(--text-muted);
      margin-top: 1.5rem;
      text-align: center;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.35rem;
    }
    .refresh .lucide { width: 13px; height: 13px; opacity: 0.6; }
    .skeleton {
      background: linear-gradient(90deg, var(--surface) 25%, var(--surface-2) 50%, var(--surface) 75%);
      background-size: 200% 100%;
      animation: shimmer 1.2s infinite;
      border-radius: 8px;
      height: 1.3rem;
    }
    @keyframes shimmer { to { background-position: -200% 0; } }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div class="brand">
        <div class="brand-icon">${i("bot", 24)}</div>
        <div>
          <h1>Maximus</h1>
          <p class="subtitle">Live system status</p>
        </div>
      </div>
      <nav class="nav">
        <a href="/" class="primary">${i("messageSquare", 15)}<span>Chat</span></a>
        <a href="/dashboard">${i("layoutDashboard", 15)}<span>Status</span></a>
      </nav>
    </header>
    <div id="content">
      <div class="grid" id="stats">
        <div class="stat"><div class="stat-head">${i("activity", 14)}<span>Tick</span></div><div class="val skeleton"></div></div>
        <div class="stat"><div class="stat-head">${i("refreshCw", 14)}<span>Uptime</span></div><div class="val skeleton"></div></div>
        <div class="stat"><div class="stat-head">${i("target", 14)}<span>Goals</span></div><div class="val skeleton"></div></div>
        <div class="stat"><div class="stat-head">${i("brain", 14)}<span>Memories</span></div><div class="val skeleton"></div></div>
        <div class="stat"><div class="stat-head">${i("wallet", 14)}<span>Balance</span></div><div class="val skeleton"></div></div>
        <div class="stat"><div class="stat-head">${i("bot", 14)}<span>Model</span></div><div class="val skeleton"></div></div>
      </div>
    </div>
    <p class="refresh" id="refreshNote">${i("refreshCw", 13)}<span>Refreshing every 30s</span></p>
  </div>
  <script>
    const REFRESH_MS = 30000;
    const ICONS = {
      activity: ${JSON.stringify(i("activity", 14))},
      refreshCw: ${JSON.stringify(i("refreshCw", 14))},
      target: ${JSON.stringify(i("target", 14))},
      brain: ${JSON.stringify(i("brain", 14))},
      wallet: ${JSON.stringify(i("wallet", 14))},
      bot: ${JSON.stringify(i("bot", 14))},
      bookOpen: ${JSON.stringify(i("bookOpen", 16))},
      brain: ${JSON.stringify(i("brain", 16))},
      clock: ${JSON.stringify(i("clock", 14))},
      x: ${JSON.stringify(i("x", 20))},
    };

    function esc(s) {
      return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    }

    function stat(label, value, iconName) {
      return '<div class="stat"><div class="stat-head">' + ICONS[iconName] + '<span>' + esc(label) + '</span></div><div class="val">' + esc(value) + '</div></div>';
    }

    function render(status) {
      const uptime = Math.floor(status.uptime_seconds / 60) + "m";
      const bal = status.wallet_balance_sol != null
        ? status.wallet_balance_sol.toFixed(4) + " SOL"
        : "—";
      const model = (status.active_llm && status.active_llm.label) || "—";

      let html = '<div class="grid">';
      html += stat("Tick", "#" + status.tick_number, "activity");
      html += stat("Uptime", uptime, "refreshCw");
      html += stat("Tick interval", status.tick_interval_label || "—", "clock");
      html += stat("Goals", String(status.active_goals), "target");
      html += stat("Memories", String(status.memory_count), "brain");
      html += stat("Balance", bal, "wallet");
      html += stat("Model", model, "bot");
      html += "</div>";

      if (status.identity && status.identity.mission) {
        html += '<section><h2>' + ICONS.bookOpen + '<span>Mission</span></h2><div class="card"><p style="margin:0">' + esc(status.identity.mission) + "</p></div></section>";
      }

      if (status.wallet_pubkey) {
        html += '<section><h2>' + ICONS.wallet + '<span>Wallet</span></h2><div class="card"><code>' + esc(status.wallet_pubkey) + "</code></div></section>";
      }

      html += "<section><h2>" + ICONS.bookOpen + "<span>Recent journal</span></h2>";
      const journal = status.recent_journal || [];
      if (!journal.length) {
        html += '<p style="color:var(--text-muted);font-size:0.9rem">No journal entries yet.</p>';
      } else {
        html += '<ul class="journal">';
        for (const e of journal) {
          html += '<li><div class="meta">Tick #' + e.tick_number + " · " + esc(e.created_at) + "</div><div>" + esc(e.content) + "</div></li>";
        }
        html += "</ul>";
      }
      html += "</section>";

      if (status.last_task && status.last_task.summary) {
        html += "<section><h2>" + ICONS.clock + "<span>Last task</span></h2>";
        html += '<div class="card"><div class="meta">' + esc(status.last_task.status || "unknown") +
          (status.last_task.at ? " · " + esc(status.last_task.at) : "") +
          "</div><div>" + esc(status.last_task.summary) + "</div></div></section>";
      }

      html += "<section><h2>" + ICONS.brain + "<span>Memories</span></h2>";
      const memories = status.recent_memories || [];
      if (!memories.length) {
        html += '<p style="color:var(--text-muted);font-size:0.9rem">No memories stored yet.</p>';
      } else {
        html += '<ul class="memory-list">';
        for (const m of memories) {
          html += '<li><div class="meta"><span class="memory-type">' + esc(m.type) +
            "</span>#" + m.id + " · imp " + m.importance + " · " + esc(m.created_at) +
            "</div><div>" + esc(m.content) + "</div></li>";
        }
        html += "</ul>";
      }
      html += "</section>";

      document.getElementById("content").innerHTML = html;
      document.getElementById("refreshNote").innerHTML = ICONS.refreshCw + '<span>Updated ' + new Date().toLocaleTimeString() + " · refreshes every 30s</span>";
    }

    function renderOffline() {
      document.getElementById("content").innerHTML =
        '<div class="offline">' + ICONS.x +
        '<div><p style="margin:0 0 0.35rem;font-weight:600">Core is not responding</p>' +
        '<p style="margin:0;opacity:0.85;font-size:0.9rem">Check that Maximus is running on the host.</p></div></div>';
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
}
