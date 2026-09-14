import { getAuthUserId } from "@convex-dev/auth/server";

type AuthedCtx = Parameters<typeof getAuthUserId>[0];

export async function requireUserId(ctx: AuthedCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Não autenticado. Faça login para continuar.");
  return userId;
}
