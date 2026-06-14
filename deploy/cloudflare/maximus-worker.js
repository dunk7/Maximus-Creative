/**
 * Cloudflare Worker — proxy maximus.voronyz.com → Akash ingress.
 * Deploy: Workers & Pages → Create → paste → Deploy → add custom domain maximus.voronyz.com
 */
const ORIGIN = "https://jtv203rpi9edvakcduvhjukks0.ingress.jjozzietech.com.au";

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
