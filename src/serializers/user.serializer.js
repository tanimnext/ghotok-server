/** Everything the account owner (or staff) may see about an account. */
export function toUserDTO(user) {
  if (!user) return null;
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email ?? null,
    phone: user.phone ?? null,
    role: user.role,
    status: user.status,
    emailVerified: !!user.emailVerified,
    phoneVerified: !!user.phoneVerified,
    isVerified: !!(user.emailVerified || user.phoneVerified),
    connectionBalance: user.connectionBalance ?? 0,
    connectionsPurchased: user.connectionsPurchased ?? 0,
    connectionsUsed: user.connectionsUsed ?? 0,
    language: user.language ?? 'en',
    lastLoginAt: user.lastLoginAt ?? null,
    createdAt: user.createdAt,
  };
}

/** A compact reference to a user, for staff lists. */
export function toUserSummary(user) {
  if (!user || !user._id) return null;
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email ?? null,
    phone: user.phone ?? null,
    role: user.role,
    status: user.status,
  };
}
