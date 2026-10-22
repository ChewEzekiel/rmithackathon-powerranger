"use client";

import { useCallback } from "react";
import { useTideCloak } from "@tidecloak/nextjs";
import { IAMService } from "@tidecloak/js";

/** Call our API with the DPoP-bound token (secureFetch turns the Bearer header into a DPoP proof). */
export function useApi() {
  const { getToken, secureFetch } = useTideCloak();
  return useCallback(
    async (path: string, init: RequestInit = {}) => {
      const token = await getToken(); // fresh each call: secureFetch adds DPoP only for the SDK's current token
      const res = await secureFetch(`${window.location.origin}${path}`, {
        ...init,
        headers: { ...(init.headers || {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { status: res.status, body });
      return body;
    },
    [getToken, secureFetch],
  );
}

/**
 * Call TideCloak's admin API from the ADMIN'S OWN browser with their DPoP-bound token, never via our
 * server: a governed write then becomes a change request filed by that human, and approvals are
 * credited to them (Tide canon AP-89).
 */
export function useTideAdmin() {
  const { getToken, secureFetch, getConfig } = useTideCloak();
  return useCallback(
    async (path: string, init: RequestInit = {}) => {
      const token = await getToken();
      const c = getConfig() as { "auth-server-url": string; realm: string };
      const res = await secureFetch(`${c["auth-server-url"].replace(/\/+$/, "")}/admin/realms/${c.realm}${path}`, {
        ...init,
        headers: { ...(init.headers || {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      const text = await res.text();
      let body: unknown = text;
      try { body = text ? JSON.parse(text) : null; } catch {}
      return { status: res.status, body };
    },
    [getToken, secureFetch, getConfig],
  );
}

const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Decrypt every post of a room in one enclave round. The room id is the only tag. */
export async function decryptAll(ciphertexts: string[], roomId: string, policyB64: string): Promise<string[]> {
  if (!ciphertexts.length) return [];
  const out = await IAMService.doDecrypt(
    ciphertexts.map((encrypted) => ({ encrypted, tags: [roomId] })),
    fromBase64(policyB64),
  );
  return (out as (string | Uint8Array)[]).map((o) => (typeof o === "string" ? o : new TextDecoder().decode(o)));
}

/** Network refusals arrive as a threshold failure; the contract's real message is in `cause`. */
export function tideError(e: unknown): string {
  const err = e as { message?: string; cause?: unknown };
  const cause = err?.cause as { message?: string } | string | undefined;
  const c = typeof cause === "string" ? cause : cause?.message;
  return [err?.message || String(e), c].filter(Boolean).join(" - ");
}
