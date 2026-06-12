const USER_AGENT = "Maximus/1.0 (autonomous agent)";

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchWebUrl(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });

    const text = await res.text();
    if (!res.ok) {
      return `HTTP ${res.status} ${res.statusText}\n${text.slice(0, 4000)}`;
    }

    return text.slice(0, 50_000);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Fetch failed: ${message}`;
  } finally {
    clearTimeout(timeout);
  }
}

async function searchDuckDuckGoInstant(query: string): Promise<string | null> {
  const res = await fetch(
    `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1`,
    { headers: { "User-Agent": USER_AGENT } }
  );
  if (!res.ok) return null;

  const data = (await res.json()) as {
    Abstract?: string;
    AbstractText?: string;
    Heading?: string;
    RelatedTopics?: Array<{ Text?: string; Topics?: Array<{ Text?: string }> }>;
  };

  const parts: string[] = [];
  if (data.AbstractText) parts.push(`${data.Heading ?? "Summary"}: ${data.AbstractText}`);
  if (data.Abstract && !data.AbstractText) parts.push(data.Abstract);

  for (const topic of data.RelatedTopics ?? []) {
    if (topic.Text) parts.push(topic.Text);
    for (const sub of topic.Topics ?? []) {
      if (sub.Text) parts.push(sub.Text);
    }
  }

  return parts.length > 0 ? parts.slice(0, 12).join("\n") : null;
}

async function searchDuckDuckGoHtml(query: string): Promise<string | null> {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) return null;

  const html = await res.text();
  const snippets = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => stripHtml(m[1] ?? ""))
    .filter(Boolean);

  const titles = [...html.matchAll(/class="result__a"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => stripHtml(m[1] ?? ""))
    .filter(Boolean);

  const lines: string[] = [];
  for (let i = 0; i < Math.min(titles.length, snippets.length, 8); i++) {
    lines.push(`${i + 1}. ${titles[i]} — ${snippets[i]}`);
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

export async function searchWeb(query: string): Promise<string> {
  const errors: string[] = [];

  try {
    const instant = await searchDuckDuckGoInstant(query);
    if (instant) return instant.slice(0, 30_000);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  try {
    const html = await searchDuckDuckGoHtml(query);
    if (html) return html.slice(0, 30_000);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  // Handy for crypto price questions without an API key
  if (/sol|solana|btc|bitcoin|eth|ethereum|price/i.test(query)) {
    try {
      const coin = /sol/i.test(query) ? "solana" : /btc|bitcoin/i.test(query) ? "bitcoin" : /eth/i.test(query) ? "ethereum" : "";
      if (coin) {
        const res = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${coin}&vs_currencies=usd`,
          { headers: { "User-Agent": USER_AGENT } }
        );
        if (res.ok) {
          const data = (await res.json()) as Record<string, { usd?: number }>;
          const usd = data[coin]?.usd;
          if (usd != null) return `${coin} price: $${usd} USD (CoinGecko)`;
        }
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return errors.length > 0
    ? `Search failed: ${errors.join("; ")}`
    : "No search results found. Try web_fetch with a specific URL.";
}
