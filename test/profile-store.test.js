const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    clearProfileField,
    formatColor,
    getProfile,
    getProfilesPath,
    normalizeColor,
    normalizeUrl,
    setProfileSocial,
    updateProfile
} = require('../stores/profile-store');

function cleanupProfile(userId) {
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
            website: 'https://example.com/me'
        });

        assert.equal(profile.nickname, 'Marij');
        assert.equal(profile.bio, 'Bot enjoyer');
        assert.equal(formatColor(profile.color), '#FF1744');
        assert.equal(profile.website, 'https://example.com/me');

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
