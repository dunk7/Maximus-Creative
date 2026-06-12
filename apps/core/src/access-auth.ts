import type http from "node:http";
import {
  getRoleInfo,
  hashAccessToken,
  resolveRoleFromToken,
  type RoleInfo,
  type RuntimeConfig,
} from "@maximus/agent-runtime";

export function extractBearerToken(req: http.IncomingMessage): string | null {
  const auth = req.headers.authorization ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

export function resolveAccess(
  req: http.IncomingMessage,
  config: RuntimeConfig
): (RoleInfo & { token: string; tokenHash: string }) | null {
  const token = extractBearerToken(req);
  if (!token) return null;
  const role = resolveRoleFromToken(token, config);
  if (!role) return null;
  return {
    ...getRoleInfo(role),
    token,
    tokenHash: hashAccessToken(token),
  };
}
