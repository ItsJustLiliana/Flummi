const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    clearProfileField,
    formatColor,
    formatLanguages,
    getProfile,
    getProfilePath,
    getProfilesPath,
    normalizeLanguages,
    normalizeColor,
    normalizeUrl,
    setProfileSocial,
    updateProfile
} = require('../stores/profile-store');
const { getGlobalUserDir } = require('../utils/global-user-storage');

function cleanupProfile(userId) {
    fs.rmSync(getGlobalUserDir(userId), { recursive: true, force: true });

    const profilesPath = getProfilesPath();

    try {
        const raw = JSON.parse(fs.readFileSync(profilesPath, 'utf8'));

        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            delete raw[userId];
            fs.mkdirSync(path.dirname(profilesPath), { recursive: true });
            fs.writeFileSync(profilesPath, JSON.stringify(raw, null, 4));
        }
    } catch {
        // No global profile file exists yet.
    }
}

test('profile store updates, formats, and clears profile fields', () => {
    const guildId = `test-profile-${process.pid}`;
    const userId = '123456';
    cleanupProfile(userId);

    try {
        const profile = updateProfile(userId, guildId, {
            nickname: 'Marij',
            bio: 'Bot enjoyer',
            color: '#ff1744',
            website: 'https://example.com/me',
            birthday: '17-06',
            timezone: 'utc+2',
            languages: 'Dutch, English, Japanese'
        });

        assert.equal(profile.nickname, 'Marij');
        assert.equal(profile.bio, 'Bot enjoyer');
        assert.equal(formatColor(profile.color), '#FF1744');
        assert.equal(profile.website, 'https://example.com/me');
        assert.equal(profile.birthday, '17-06');
        assert.equal(profile.timezone, 'UTC+2');
        assert.equal(formatLanguages(profile.languages), '🇳🇱 Dutch, 🇬🇧 English, 🇯🇵 Japanese');
        assert.equal(fs.existsSync(getProfilePath(userId)), true);

        setProfileSocial(userId, guildId, 'github', 'marij');
        assert.deepEqual(getProfile(userId, guildId).socials, { github: 'marij' });

        clearProfileField(userId, guildId, 'bio');
        assert.equal(getProfile(userId, guildId).bio, null);
    } finally {
        cleanupProfile(userId);
    }
});

test('profile validation accepts safe colors and http urls only', () => {
    assert.equal(normalizeColor('#1E88E5'), 0x1E88E5);
    assert.equal(normalizeColor('nope'), null);
    assert.equal(normalizeUrl('https://example.com/banner.png'), 'https://example.com/banner.png');
    assert.equal(normalizeUrl('javascript:alert(1)'), null);
});

test('profile languages normalize known flags and keep unknown labels', () => {
    assert.deepEqual(normalizeLanguages('nl, English, xx: Klingon, Elvish'), [
        { label: 'Dutch', flag: 'NL' },
        { label: 'English', flag: 'GB' },
        { label: 'Klingon', flag: 'XX' },
        { label: 'Elvish', flag: null }
    ]);
    assert.equal(formatLanguages('nl, English'), '🇳🇱 Dutch, 🇬🇧 English');
});

test('profile store ignores removed mood favorite and location fields', () => {
    const userId = '654321';
    cleanupProfile(userId);

    try {
        updateProfile(userId, null, {
            nickname: 'Privacy Enjoyer',
            location: 'Nope',
            mood: 'Confused',
            favorite: 'Oversharing'
        });

        const profile = getProfile(userId);

        assert.equal(profile.nickname, 'Privacy Enjoyer');
        assert.equal(Object.prototype.hasOwnProperty.call(profile, 'location'), false);
        assert.equal(Object.prototype.hasOwnProperty.call(profile, 'mood'), false);
        assert.equal(Object.prototype.hasOwnProperty.call(profile, 'favorite'), false);
    } finally {
        cleanupProfile(userId);
    }
});
