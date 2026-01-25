interface Tokens {
  accessToken: string
  refreshToken: string
  expiresAt: string
}

const tokenCache = new Map<string, Tokens>()

export async function setTokens(
  serverId: string,
  accessToken: string,
  refreshToken: string,
  expiresAt: string
): Promise<void> {
  const tokens = { accessToken, refreshToken, expiresAt }
  tokenCache.set(serverId, tokens)
  await window.api.storage.setTokens(serverId, tokens)
}

export async function getTokens(serverId: string): Promise<Tokens | null> {
  const cached = tokenCache.get(serverId)
  if (cached) return cached
  const tokens = await window.api.storage.getTokens(serverId)
  if (tokens) tokenCache.set(serverId, tokens)
  return tokens
}

export async function clearTokens(serverId: string): Promise<void> {
  tokenCache.delete(serverId)
  await window.api.storage.clearTokens(serverId)
}

export async function clearAllAuthData(): Promise<void> {
  tokenCache.clear()
  await window.api.storage.clearTokens()
}
