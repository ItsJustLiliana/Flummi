const inviteUses = new Map();

async function snapshotGuildInvites(guild) {
    try {
        const invites = await guild.invites.fetch();
        const snapshot = new Map(invites.map(invite => [invite.code, Number(invite.uses) || 0]));
        inviteUses.set(guild.id, snapshot);
        return snapshot;
    } catch {
        return inviteUses.get(guild.id) || new Map();
    }
}

async function findUsedInvite(guild) {
    const previous = inviteUses.get(guild.id) || new Map();
    try {
        const invites = await guild.invites.fetch();
        const used = invites.find(invite => (Number(invite.uses) || 0) > (previous.get(invite.code) || 0));
        inviteUses.set(guild.id, new Map(invites.map(invite => [invite.code, Number(invite.uses) || 0])));
        return used ? { code: used.code, inviterId: used.inviterId || null } : null;
    } catch {
        return null;
    }
}

module.exports = { findUsedInvite, snapshotGuildInvites };
