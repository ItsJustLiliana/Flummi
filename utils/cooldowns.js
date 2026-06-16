const cooldowns = new Map();

function getCooldownKey(userId, key) {
    return `${userId}:${key}`;
}

function getRemainingCooldownSeconds(userId, key, cooldownSeconds) {
    const cooldownKey = getCooldownKey(userId, key);
    const expiresAt = cooldowns.get(cooldownKey) || 0;
    const now = Date.now();

    if (expiresAt <= now) {
        return 0;
    }

    return Math.ceil((expiresAt - now) / 1000);
}

function startCooldown(userId, key, cooldownSeconds) {
    const cooldownKey = getCooldownKey(userId, key);
    const expiresAt = Date.now() + cooldownSeconds * 1000;
    cooldowns.set(cooldownKey, expiresAt);
    return expiresAt;
}

function checkCooldown(userId, key, cooldownSeconds) {
    const remaining = getRemainingCooldownSeconds(userId, key, cooldownSeconds);

    if (remaining > 0) {
        return { allowed: false, remaining };
    }

    startCooldown(userId, key, cooldownSeconds);
    return { allowed: true, remaining: 0 };
}

module.exports = {
    checkCooldown,
    getRemainingCooldownSeconds,
    startCooldown
};
