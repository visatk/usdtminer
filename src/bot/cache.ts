export let cachedStats: { totalUsers: number, totalMined: number, timestamp: number } | null = null;
export const STATS_CACHE_TTL = 60000; // 60 seconds

export function updateCachedStats(users: number, mined: number) {
  cachedStats = {
    totalUsers: users,
    totalMined: mined,
    timestamp: Date.now()
  };
}
