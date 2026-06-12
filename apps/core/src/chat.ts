import {
  listCreatorMessages,
  loadConfig,
  openDatabase,
  runCreatorChat,
} from "@maximus/agent-runtime";
import { withAgentLock } from "./agent-lock.js";
import { createToolExecutor, getChatToolDefinitions, loadOrCreateWallet } from "@maximus/tools";
import { loadWalletSnapshot } from "./wallet-snapshot.js";

async function chatRemote(baseUrl: string, secret: string, message: string): Promise<void> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message }),
  });

  const data = (await res.json()) as { error?: string; response?: string };
  if (!res.ok) {
    throw new Error(data.error ?? `Chat failed (${res.status})`);
  }

  console.log(data.response ?? JSON.stringify(data, null, 2));
}

export async function runChat(message: string): Promise<void> {
  const trimmed = message.trim();
  if (!trimmed) {
    throw new Error("Usage: npm run chat --workspace=@maximus/core -- \"your message\"");
  }

  const remoteUrl = process.env.MAXIMUS_URL;
  const remoteSecret = process.env.MAXIMUS_WAKE_SECRET ?? process.env.WAKE_SECRET;

  if (remoteUrl && remoteSecret) {
    await chatRemote(remoteUrl, remoteSecret, trimmed);
    return;
  }

  await withAgentLock(async () => {
    const config = loadConfig();
    const db = openDatabase(config);
    const wallet = await loadWalletSnapshot(config);
    const keypair = loadOrCreateWallet(config);
    const tools = getChatToolDefinitions(db);
    const executeTool = createToolExecutor(db, config, keypair);
    const result = await runCreatorChat(db, config, trimmed, wallet, tools, executeTool, 1);
    console.log(result.response);
  });
}

export async function printMessages(limit = 20): Promise<void> {
  const remoteUrl = process.env.MAXIMUS_URL;
  const remoteSecret = process.env.MAXIMUS_WAKE_SECRET ?? process.env.WAKE_SECRET;

  if (remoteUrl && remoteSecret) {
    const res = await fetch(`${remoteUrl.replace(/\/$/, "")}/messages`, {
      headers: { Authorization: `Bearer ${remoteSecret}` },
    });
    const data = (await res.json()) as { messages?: Array<{ content: string; response: string | null }> };
    if (!res.ok) throw new Error("Could not fetch messages");
    for (const row of [...(data.messages ?? [])].reverse()) {
      console.log(`You: ${row.content}`);
      if (row.response) console.log(`Maximus: ${row.response}\n`);
    }
    return;
  }

  const db = openDatabase(loadConfig());
  for (const row of [...listCreatorMessages(db, limit)].reverse()) {
    console.log(`You: ${row.content}`);
    if (row.response) console.log(`Maximus: ${row.response}\n`);
  }
}
