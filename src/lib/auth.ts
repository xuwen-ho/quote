import { auth } from "@/auth";

/**
 * Get the authenticated user ID from the session, falling back to x-user-id header.
 */
export async function getUserId(): Promise<string | null> {
  const session = await auth();
  if (session?.user?.id) return session.user.id;
  return null;
}

/**
 * Legacy: extract user ID from request header (for backwards compatibility).
 */
export function getUserIdFromRequest(request: Request): string | null {
  const userId = request.headers.get("x-user-id");
  if (!userId) return null;

  const normalized = userId.trim();
  return normalized.length > 0 ? normalized : null;
}
