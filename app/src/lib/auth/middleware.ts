import { NextRequest } from "next/server";
import { verifyTideJWT, hasRole, extractToken } from "./tideJWT";
import { verifyDpop } from "./verifyDpop";
import type { JWTPayload } from "jose";
import { WALKTHROUGH, wtJwt } from "@/walkthrough/server";

type AuthHandler = (req: NextRequest, jwt: JWTPayload) => Promise<Response>;

export function withAuth(handler: AuthHandler) {
  return async (req: NextRequest) => {
    try {
      // Walkthrough mode only (see src/walkthrough/server.ts): simulated persona tokens, no Tide.
      const wt = WALKTHROUGH ? req.headers.get("authorization")?.match(/^Bearer wt\.(\w+)$/) : null;
      if (wt) {
        const jwt = wtJwt(wt[1]);
        if (!jwt) throw new Error("Unknown walkthrough persona");
        return handler(req, jwt);
      }
      const token = extractToken(req.headers.get("authorization"));
      const jwt = await verifyTideJWT(token);
      // The signature alone is not enough. This realm issues sender-constrained tokens (cnf.jkt),
      // and without checking the DPoP proof a stolen token replays as a plain `Bearer` and passes
      // (AP-43). verifyDpop rejects an unbound token, a Bearer-scheme replay, a proof signed by a
      // different key, and a proof for another URL or method. It throws; the catch below answers 401.
      await verifyDpop(req, token, jwt as { cnf?: { jkt?: string } });
      return handler(req, jwt);
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "Unauthorized" },
        { status: 401 }
      );
    }
  };
}

export function withRole(role: string, handler: AuthHandler) {
  return withAuth(async (req, jwt) => {
    if (!hasRole(jwt, role)) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    return handler(req, jwt);
  });
}
