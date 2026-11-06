import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { AccessTokens, AuthContext, StaffRole, SubjectKind } from "./tokens";

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

/** Bearer access token required; optionally restricted to subject kinds and staff roles. */
export function requireAuth(tokens: AccessTokens, kinds: SubjectKind[], roles?: StaffRole[]): preHandlerHookHandler {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization;
    const ctx = header?.startsWith("Bearer ") ? await tokens.verify(header.slice(7)) : null;
    if (!ctx) return reply.code(401).send({ error: "unauthorized" });
    if (!kinds.includes(ctx.kind) || (roles && (!ctx.role || !roles.includes(ctx.role)))) {
      return reply.code(403).send({ error: "forbidden" });
    }
    req.auth = ctx;
  };
}
