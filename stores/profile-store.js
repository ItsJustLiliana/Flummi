const fs = require('fs');
const path = require('path');
const {
    ensureGlobalUserDir,
    getGlobalUserFilePath,
    getGlobalUsersDir
} = require('../utils/global-user-storage');

const dataDir = path.join(__dirname, '..', 'data');
const globalDir = path.join(dataDir, 'global');
const profilesPath = path.join(globalDir, 'profiles.json');
const usersDir = getGlobalUsersDir();

const defaultProfileColor = 0x1E88E5;
const maxBioLength = 500;
const maxShortFieldLength = 80;
const maxLanguages = 8;

const languageAliases = {
    nl: { label: 'Dutch', flag: 'NL' },
    dutch: { label: 'Dutch', flag: 'NL' },
    nederlands: { label: 'Dutch', flag: 'NL' },
    en: { label: 'English', flag: 'GB' },
    english: { label: 'English', flag: 'GB' },
    engels: { label: 'English', flag: 'GB' },
    de: { label: 'German', flag: 'DE' },
    german: { label: 'German', flag: 'DE' },
    duits: { label: 'German', flag: 'DE' },
    fr: { label: 'French', flag: 'FR' },
    french: { label: 'French', flag: 'FR' },
    frans: { label: 'French', flag: 'FR' },
    es: { label: 'Spanish', flag: 'ES' },
    spanish: { label: 'Spanish', flag: 'ES' },
    spaans: { label: 'Spanish', flag: 'ES' },
    it: { label: 'Italian', flag: 'IT' },
    italian: { label: 'Italian', flag: 'IT' },
    italiaans: { label: 'Italian', flag: 'IT' },
    pt: { label: 'Portuguese', flag: 'PT' },
    portuguese: { label: 'Portuguese', flag: 'PT' },
    portuguees: { label: 'Portuguese', flag: 'PT' },
    pl: { label: 'Polish', flag: 'PL' },
    polish: { label: 'Polish', flag: 'PL' },
    pools: { label: 'Polish', flag: 'PL' },
    tr: { label: 'Turkish', flag: 'TR' },
    turkish: { label: 'Turkish', flag: 'TR' },
    turks: { label: 'Turkish', flag: 'TR' },
    ar: { label: 'Arabic', flag: null },
    arabic: { label: 'Arabic', flag: null },
    arabisch: { label: 'Arabic', flag: null },
    ja: { label: 'Japanese', flag: 'JP' },
    japanese: { label: 'Japanese', flag: 'JP' },
    japans: { label: 'Japanese', flag: 'JP' },
    ko: { label: 'Korean', flag: 'KR' },
    korean: { label: 'Korean', flag: 'KR' },
    koreaans: { label: 'Korean', flag: 'KR' },
    zh: { label: 'Chinese', flag: 'CN' },
    chinese: { label: 'Chinese', flag: 'CN' },
    chinees: { label: 'Chinese', flag: 'CN' },
    ru: { label: 'Russian', flag: 'RU' },
    russian: { label: 'Russian', flag: 'RU' },
    russisch: { label: 'Russian', flag: 'RU' }
};

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

function getProfilePath(userId) {
    return getGlobalUserFilePath(userId, 'profile.json');
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

function normalizeBirthday(value) {
    const trimmed = normalizeText(value, 20);

    if (!trimmed) {
        return null;
    }

    if (/^\d{1,2}[/-]\d{1,2}$/.test(trimmed) || /^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return trimmed;
    }

    return trimmed;
}

function normalizeTimezone(value) {
    const trimmed = normalizeText(value, 40);

    if (!trimmed) {
        return null;
    }

    return trimmed
        .replace(/^utc/i, 'UTC')
        .replace(/^gmt/i, 'GMT');
}

function countryCodeToFlag(countryCode) {
    if (!countryCode || !/^[A-Z]{2}$/.test(countryCode)) {
        return '';
    }

    return countryCode
        .split('')
        .map(char => String.fromCodePoint(127397 + char.charCodeAt(0)))
        .join('');
}

function normalizeLanguageEntry(value) {
    const trimmed = normalizeText(value, 40);

    if (!trimmed) {
        return null;
    }

    const key = trimmed.toLowerCase();
    const known = languageAliases[key];

    if (known) {
        return {
            label: known.label,
            flag: known.flag
        };
    }

    const countryCodeMatch = trimmed.match(/^([a-zA-Z]{2})[:|]\s*(.+)$/);

    if (countryCodeMatch) {
        return {
            label: normalizeText(countryCodeMatch[2], 40),
            flag: countryCodeMatch[1].toUpperCase()
        };
    }

    return {
        label: trimmed,
        flag: null
    };
}

function normalizeLanguages(value) {
    if (Array.isArray(value)) {
        return value
            .map(item => {
                if (typeof item === 'string') {
                    return normalizeLanguageEntry(item);
                }

                if (item && typeof item === 'object') {
                    const label = normalizeText(item.label, 40);
                    const flag = normalizeText(item.flag, 2)?.toUpperCase() || null;
                    return label ? { label, flag } : null;
                }

                return null;
            })
            .filter(Boolean)
            .slice(0, maxLanguages);
    }

    const trimmed = normalizeText(value, 300);

    if (!trimmed) {
        return [];
    }

    const seen = new Set();

    return trimmed
        .split(/[,\n]/)
        .map(normalizeLanguageEntry)
        .filter(Boolean)
        .filter(language => {
            const key = language.label.toLowerCase();

            if (seen.has(key)) {
                return false;
            }

            seen.add(key);
            return true;
        })
        .slice(0, maxLanguages);
}

function formatLanguages(languages) {
    const normalized = normalizeLanguages(languages);

    if (normalized.length === 0) {
        return 'Not set';
    }

    return normalized
        .map(language => {
            const flag = countryCodeToFlag(language.flag);
            return flag ? `${flag} ${language.label}` : language.label;
        })
        .join(', ');
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
        birthday: null,
        timezone: null,
        languages: [],
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
        birthday: normalizeBirthday(source.birthday),
        timezone: normalizeTimezone(source.timezone),
        languages: normalizeLanguages(source.languages),
        website: normalizeUrl(source.website),
        bannerUrl: normalizeUrl(source.bannerUrl),
        color: normalizeColor(source.color) ?? defaultProfileColor,
        socials: normalizeSocials(source.socials),
        createdAt: typeof source.createdAt === 'string' ? source.createdAt : null,
        updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : null
    };
}

let migrationAttempted = false;

function collectLegacyProfileRecord() {
    const guildsDir = path.join(dataDir, 'guilds');
    const mergedSource = readJson(profilesPath, {});
    const merged = mergedSource && typeof mergedSource === 'object' && !Array.isArray(mergedSource)
        ? { ...mergedSource }
        : {};

    if (!fs.existsSync(guildsDir)) {
        return merged;
    }

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
                continue;
            }

            const existingUpdatedAt = merged[userId].updatedAt || '';
            const next = normalizeProfile(userId, profile);

            if ((next.updatedAt || '') > existingUpdatedAt) {
                merged[userId] = next;
            }
        }
    }

    return merged;
}

function shouldPreferProfile(nextProfile, existingProfile, existingFileExists) {
    if (!existingFileExists) {
        return true;
    }

    if (nextProfile.updatedAt && (!existingProfile.updatedAt || nextProfile.updatedAt > existingProfile.updatedAt)) {
        return true;
    }

    return false;
}

function migrateLegacyProfiles() {
    if (migrationAttempted) {
        return;
    }

    migrationAttempted = true;

    const record = collectLegacyProfileRecord();

    for (const [userId, profile] of Object.entries(record)) {
        const profilePath = getProfilePath(userId);

        if (!profilePath) {
            continue;
        }

        const nextProfile = normalizeProfile(userId, profile);
        const existingFileExists = fs.existsSync(profilePath);
        const existingProfile = existingFileExists
            ? normalizeProfile(userId, readJson(profilePath, {}))
            : emptyProfile(userId);

        if (shouldPreferProfile(nextProfile, existingProfile, existingFileExists)) {
            ensureGlobalUserDir(userId);
            writeJson(profilePath, nextProfile);
        }
    }

    try {
        if (fs.existsSync(profilesPath)) {
            fs.unlinkSync(profilesPath);
        }
    } catch {
        // Best effort cleanup only.
    }
}

function getProfile(userId) {
    migrateLegacyProfiles();

    const profilePath = getProfilePath(userId);

    if (!profilePath) {
        return emptyProfile(userId);
    }

    return normalizeProfile(userId, readJson(profilePath, emptyProfile(userId)));
}

function updateProfile(userId, _guildId, updates) {
    const current = getProfile(userId);
    const now = formatTimestamp();

    const next = normalizeProfile(userId, {
        ...current,
        ...updates,
        socials: updates.socials || current.socials,
        createdAt: current.createdAt || now,
        updatedAt: now
    });

    ensureGlobalUserDir(userId);
    writeJson(getProfilePath(userId), next);
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
        'birthday',
        'timezone',
        'languages',
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
    formatLanguages,
    maxBioLength,
    maxLanguages,
    maxShortFieldLength,
    clearProfileField,
    formatColor,
    getProfile,
    getProfilePath,
    getProfilesPath,
    migrateLegacyProfiles,
    normalizeColor,
    normalizeBirthday,
    normalizeLanguages,
    normalizeText,
    normalizeTimezone,
    normalizeUrl,
    setProfileSocial,
    updateProfile
};
