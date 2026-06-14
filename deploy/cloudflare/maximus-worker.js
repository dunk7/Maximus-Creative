/**
 * Cloudflare Worker — proxy maximus.voronyz.com → Akash ingress.
 * Deploy: Workers & Pages → Create → paste → Deploy → add custom domain maximus.voronyz.com
 */
const ORIGIN = "https://qv59d2a5k5fvre2m9ams4316p4.ingress.jjozzietech.com.au";

export default {
  async fetch(request) {
    const incoming = new URL(request.url);
    const target = new URL(incoming.pathname + incoming.search, ORIGIN);

    const headers = new Headers(request.headers);
    headers.delete("host");

    const init = {
      method: request.method,
      headers,
      redirect: "manual",
    };

    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
    }

    return fetch(target, init);
  },
};
