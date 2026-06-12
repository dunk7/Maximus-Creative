const STATUS_URL = process.env.MAXIMUS_STATUS_URL ?? "http://127.0.0.1:4747/status";

interface AgentStatus {
  agent: string;
  uptime_seconds: number;
  tick_number: string;
  last_tick_at: string | null;
  wallet_pubkey: string | null;
  wallet_balance_sol: number | null;
  active_goals: number;
  memory_count: number;
  identity: { name: string; mission: string } | null;
  active_llm?: {
    provider: string | null;
    model: string | null;
    label: string | null;
    at: string | null;
    fallbacks_used: string | null;
  };
  recent_journal: Array<{ tick_number: number; content: string; created_at: string }>;
}

async function getStatus(): Promise<AgentStatus | null> {
  try {
    const res = await fetch(STATUS_URL, { next: { revalidate: 30 } });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function Home() {
  const status = await getStatus();

  return (
    <main style={{ maxWidth: 800, margin: "0 auto", padding: "2rem 1.5rem" }}>
      <header style={{ marginBottom: "2rem" }}>
        <h1 style={{ margin: 0, fontSize: "2rem" }}>Maximus</h1>
        <p style={{ opacity: 0.7, marginTop: "0.5rem" }}>
          Autonomous core — read-only window into the immortal process
        </p>
      </header>

      {!status ? (
        <section style={{ padding: "1rem", border: "1px solid #333", borderRadius: 8 }}>
          <p>Maximus core is not reachable at {STATUS_URL}</p>
          <p style={{ opacity: 0.7 }}>Start it with <code>npm run core</code></p>
        </section>
      ) : (
        <>
          <section style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", marginBottom: "2rem" }}>
            <Stat label="Tick" value={`#${status.tick_number}`} />
            <Stat label="Uptime" value={`${Math.floor(status.uptime_seconds / 60)}m`} />
            <Stat label="Goals" value={String(status.active_goals)} />
            <Stat label="Memories" value={String(status.memory_count)} />
            <Stat label="Balance" value={status.wallet_balance_sol != null ? `${status.wallet_balance_sol.toFixed(4)} SOL` : "—"} />
            <Stat label="Model" value={status.active_llm?.label ?? "—"} />
          </section>

          {status.identity && (
            <section style={{ marginBottom: "2rem" }}>
              <h2>Mission</h2>
              <p>{status.identity.mission}</p>
            </section>
          )}

          {status.wallet_pubkey && (
            <section style={{ marginBottom: "2rem" }}>
              <h2>Wallet</h2>
              <code style={{ wordBreak: "break-all" }}>{status.wallet_pubkey}</code>
            </section>
          )}

          <section>
            <h2>Recent journal</h2>
            {status.recent_journal.length === 0 ? (
              <p style={{ opacity: 0.7 }}>No journal entries yet.</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0 }}>
                {status.recent_journal.map((entry, i) => (
                  <li key={i} style={{ marginBottom: "1rem", padding: "1rem", background: "#14141c", borderRadius: 8 }}>
                    <div style={{ opacity: 0.5, fontSize: "0.85rem", marginBottom: "0.5rem" }}>
                      Tick #{entry.tick_number} · {entry.created_at}
                    </div>
                    <div>{entry.content}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: "1rem", background: "#14141c", borderRadius: 8 }}>
      <div style={{ opacity: 0.5, fontSize: "0.85rem" }}>{label}</div>
      <div style={{ fontSize: "1.25rem", fontWeight: 600 }}>{value}</div>
    </div>
  );
}
