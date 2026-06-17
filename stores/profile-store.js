const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const globalDir = path.join(dataDir, 'global');
const profilesPath = path.join(globalDir, 'profiles.json');

const defaultProfileColor = 0x1E88E5;
const maxBioLength = 500;
const maxShortFieldLength = 80;

function readJson(filePath, fallbackValue) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return fallbackValue;
    }
}

function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 4));
}

function formatTimestamp(date = new Date()) {
    const pad = value => String(value).padStart(2, '0');

    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate())
    ].join('-') + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function getProfilesPath() {
    return profilesPath;
}

function normalizeText(value, maxLength) {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();

    if (!trimmed) {
        return null;
    }

    return trimmed.slice(0, maxLength);
}

function normalizeUrl(value) {
    const trimmed = normalizeText(value, 500);

    if (!trimmed) {
        return null;
    }

    try {
        const parsed = new URL(trimmed);

        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return null;
        }

        return parsed.toString();
    } catch {
        return null;
    }
}

function normalizeColor(value) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xFFFFFF) {
        return value;
    }

    const raw = String(value || '').trim().replace(/^#/, '');

    if (!/^[0-9a-fA-F]{6}$/.test(raw)) {
        return null;
    }

    return Number.parseInt(raw, 16);
}

function formatColor(color) {
    const normalized = normalizeColor(color) ?? defaultProfileColor;
    return `#${normalized.toString(16).padStart(6, '0').toUpperCase()}`;
}

function emptyProfile(userId) {
    return {
        userId: String(userId),
        nickname: null,
        bio: null,
        pronouns: null,
        location: null,
        mood: null,
        favorite: null,
        website: null,
        bannerUrl: null,
        color: defaultProfileColor,
        socials: {},
        createdAt: null,
        updatedAt: null
    };
}

function normalizeSocials(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const socials = {};

    for (const [platform, handle] of Object.entries(source)) {
        const cleanPlatform = normalizeText(platform.toLowerCase(), 30);
        const cleanHandle = normalizeText(handle, 80);

        if (cleanPlatform && cleanHandle) {
            socials[cleanPlatform] = cleanHandle;
        }
    }

    return socials;
}

function normalizeProfile(userId, profile) {
    const source = profile && typeof profile === 'object' && !Array.isArray(profile) ? profile : {};

    return {
        userId: String(userId),
        nickname: normalizeText(source.nickname, maxShortFieldLength),
        bio: normalizeText(source.bio, maxBioLength),
        pronouns: normalizeText(source.pronouns, maxShortFieldLength),
        location: normalizeText(source.location, maxShortFieldLength),
        mood: normalizeText(source.mood, maxShortFieldLength),
        favorite: normalizeText(source.favorite, maxShortFieldLength),
        website: normalizeUrl(source.website),
        bannerUrl: normalizeUrl(source.bannerUrl),
        color: normalizeColor(source.color) ?? defaultProfileColor,
        socials: normalizeSocials(source.socials),
        createdAt: typeof source.createdAt === 'string' ? source.createdAt : null,
        updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : null
    };
}

function readProfileRecord() {
    migrateLegacyGuildProfiles();

    const record = readJson(getProfilesPath(), {});
    return record && typeof record === 'object' && !Array.isArray(record) ? record : {};
}

function saveProfileRecord(record) {
    writeJson(getProfilesPath(), record);
    return record;
}

let migrationAttempted = false;

function migrateLegacyGuildProfiles() {
    if (migrationAttempted) {
        return;
    }

    migrationAttempted = true;

    const guildsDir = path.join(dataDir, 'guilds');

    if (!fs.existsSync(guildsDir)) {
        return;
    }

    const existingGlobal = readJson(profilesPath, {});
    const merged = existingGlobal && typeof existingGlobal === 'object' && !Array.isArray(existingGlobal)
        ? { ...existingGlobal }
        : {};
    let changed = false;

    for (const entry of fs.readdirSync(guildsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
            continue;
        }

        const legacyPath = path.join(guildsDir, entry.name, 'profiles.json');
        const legacyRecord = readJson(legacyPath, {});

        if (!legacyRecord || typeof legacyRecord !== 'object' || Array.isArray(legacyRecord)) {
            continue;
        }

        for (const [userId, profile] of Object.entries(legacyRecord)) {
            if (!merged[userId]) {
                merged[userId] = normalizeProfile(userId, profile);
                changed = true;
                continue;
            }

            const existingUpdatedAt = merged[userId].updatedAt || '';
            const next = normalizeProfile(userId, profile);

            if ((next.updatedAt || '') > existingUpdatedAt) {
                merged[userId] = next;
                changed = true;
            }
        }
    }

    if (changed) {
        saveProfileRecord(merged);
    }
}

function getProfile(userId) {
    const record = readProfileRecord();
    return normalizeProfile(userId, record[String(userId)] || emptyProfile(userId));
}

function updateProfile(userId, _guildId, updates) {
    const record = readProfileRecord();
    const current = getProfile(userId);
    const now = formatTimestamp();

    const next = normalizeProfile(userId, {
        ...current,
        ...updates,
        socials: updates.socials || current.socials,
        createdAt: current.createdAt || now,
        updatedAt: now
    });

    record[String(userId)] = next;
    saveProfileRecord(record);
    return next;
}

function setProfileSocial(userId, guildId, platform, handle) {
    const profile = getProfile(userId);
    const cleanPlatform = normalizeText(platform, 30)?.toLowerCase();

    if (!cleanPlatform) {
        throw new Error('Invalid social platform.');
    }

    const socials = { ...profile.socials };
    const cleanHandle = normalizeText(handle, 80);

    if (cleanHandle) {
        socials[cleanPlatform] = cleanHandle;
    } else {
        delete socials[cleanPlatform];
    }

    return updateProfile(userId, guildId, { socials });
}

function clearProfileField(userId, guildId, field) {
    const clearable = new Set([
        'nickname',
        'bio',
        'pronouns',
        'location',
        'mood',
        'favorite',
        'website',
        'banner',
        'color',
        'socials'
    ]);
    const normalizedField = String(field || '').trim().toLowerCase();

    if (!clearable.has(normalizedField)) {
        throw new Error('Invalid profile field.');
    }

    if (normalizedField === 'banner') {
        return updateProfile(userId, guildId, { bannerUrl: null });
    }

    if (normalizedField === 'color') {
        return updateProfile(userId, guildId, { color: defaultProfileColor });
    }

    if (normalizedField === 'socials') {
        return updateProfile(userId, guildId, { socials: {} });
    }

    return updateProfile(userId, guildId, { [normalizedField]: null });
}

module.exports = {
    defaultProfileColor,
    maxBioLength,
    maxShortFieldLength,
    clearProfileField,
    formatColor,
    getProfile,
    getProfilesPath,
    readProfileRecord,
    normalizeColor,
    normalizeText,
    normalizeUrl,
    setProfileSocial,
    updateProfile
};
