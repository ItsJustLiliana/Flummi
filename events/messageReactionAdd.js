const { handleStarReaction } = require('../services/community-management-service');

module.exports = {
    name: 'messageReactionAdd',
    async execute(reaction, user) {
        await handleStarReaction(reaction, user).catch(error => console.warn(`Starboard update failed: ${error.message}`));
        if (user.bot || !reaction.message.guildId) return;
        const ratings = { '1️⃣': 1, '2️⃣': 2, '3️⃣': 3, '4️⃣': 4, '5️⃣': 5 };
        const rating = ratings[reaction.emoji.toString()];
        if (!rating) return;
        const store = require('../stores/community-management-store');
        const ticket = store.readState(reaction.message.guildId).tickets.find(entry => entry.ratingMessageId === reaction.message.id && entry.ownerId === user.id);
        if (!ticket) return;
        store.updateTicket(reaction.message.guildId, ticket.id, { rating, ratedAt: new Date().toISOString() });
        await require('../services/workflow-service').runWorkflows(reaction.message.guild, 'ticket.rating', { userId: user.id, channelId: reaction.message.channelId, rating, ticket: { ...ticket, rating } }).catch(error => console.warn(`Ticket rating workflow failed: ${error.message}`));
    }
};
