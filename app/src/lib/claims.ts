import type { JWTPayload } from "jose";
import { groupPath } from "./rooms";

// Read from the VERIFIED token only (never from the request body).
export const groupsOf = (jwt: JWTPayload): string[] =>
  Array.isArray((jwt as { groups?: unknown }).groups) ? ((jwt as { groups: unknown[] }).groups.map(String)) : [];

export const isMember = (jwt: JWTPayload, roomId: string) => groupsOf(jwt).includes(groupPath(roomId));
export const isRealmAdmin = (jwt: JWTPayload) =>
  !!(jwt.resource_access as Record<string, { roles?: string[] }> | undefined)?.["realm-management"]?.roles?.includes("tide-realm-admin");
