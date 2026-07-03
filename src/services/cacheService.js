const cacheStore = new Map();

function getCacheItem(key) {
  const cached = cacheStore.get(key);

  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    cacheStore.delete(key);
    return null;
  }

  return cached.value;
}

function setCacheItem(key, value, ttlMs) {
  cacheStore.set(key, {
    value,
    expiresAt: Date.now() + ttlMs
  });
}

async function getOrSetCache(key, ttlMs, resolver) {
  const cached = getCacheItem(key);

  if (cached) {
    return cached;
  }

  const fresh = await resolver();
  setCacheItem(key, fresh, ttlMs);
  return fresh;
}

function invalidateCachePrefix(prefix) {
  Array.from(cacheStore.keys()).forEach((key) => {
    if (key.startsWith(prefix)) {
      cacheStore.delete(key);
    }
  });
}

function invalidateUserViewCaches(userIds = []) {
  userIds
    .map((userId) => String(userId))
    .filter(Boolean)
    .forEach((userId) => {
      invalidateCachePrefix(`dashboard:${userId}`);
      invalidateCachePrefix(`export:${userId}`);
      invalidateCachePrefix(`rooms:${userId}`);
      invalidateCachePrefix(`faculty:${userId}`);
    });
}

module.exports = {
  getOrSetCache,
  invalidateCachePrefix,
  invalidateUserViewCaches
};
