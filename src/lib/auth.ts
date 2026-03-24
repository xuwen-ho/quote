export function getUserIdFromRequest(request: Request): string | null {
  const userId = request.headers.get("x-user-id");
  if (!userId) return null;

  const normalized = userId.trim();
  return normalized.length > 0 ? normalized : null;
}
