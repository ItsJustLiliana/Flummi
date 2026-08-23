const { MessageFlags } = require('discord.js');
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { isDeveloper, isAdmin } = require('../stores/access-store');
const {
    getShots,
    addShots,
    removeShots,
    readShotAuditLog,
    gambleShots,
    setShots
} = require('../stores/shot-store');

const defaultMaxShots = 5;
const maxAllowedGamble = 25;

function getTargetUser(interaction) {
    return interaction.options.getUser('user') || interaction.user;
}

function canManageTarget(interaction, targetUser) {
    return targetUser.id === interaction.user.id || isAdmin(interaction.user.id, interaction.guildId, interaction.memberPermissions);
}

function formatUserLabel(user) {
    return user.id ? `<@${user.id}>` : user.tag;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shots')
        .setDescription('Track and gamble virtual shots')
        .addSubcommand(subcommand =>
            subcommand
                .setName('check')
                .setDescription('Check your current shot total')
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('Member to check')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add shots to yourself or another member if you are staff')
                .addIntegerOption(option =>
                    option
                        .setName('amount')
                        .setDescription('How many shots to add')
                        .setMinValue(1)
                        .setMaxValue(100)
                        .setRequired(true)
                )
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('Member to update')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove shots from yourself or another member if you are staff')
                .addIntegerOption(option =>
                    option
                        .setName('amount')
                        .setDescription('How many shots to remove')
                        .setMinValue(1)
                        .setMaxValue(100)
                        .setRequired(true)
                )
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('Member to update')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Set an exact shot total for yourself or another member if you are staff')
                .addIntegerOption(option =>
                    option
                        .setName('amount')
                        .setDescription('Exact shot total to set')
                        .setMinValue(0)
                        .setMaxValue(10000)
                        .setRequired(true)
                )
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('Member to update')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('reset')
                .setDescription('Reset your shot total or another member if you are staff')
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('Member to reset')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('gamble')
                .setDescription('Roll a weighted shot gamble')
                .addIntegerOption(option =>
                    option
                        .setName('max')
                        .setDescription(`Max shots to roll, default ${defaultMaxShots}`)
                        .setMinValue(1)
                        .setMaxValue(maxAllowedGamble)
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('audit')
                .setDescription('Developer audit log for shot changes')
                .addIntegerOption(option =>
                    option
                        .setName('limit')
                        .setDescription('How many audit entries to show')
                        .setMinValue(1)
                        .setMaxValue(20)
                        .setRequired(false)
                )
        ),

    async execute(interaction) {
        const guildId = interaction.guildId;
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'audit') {
            if (!isDeveloper(interaction.user.id)) {
                await interaction.reply({
                    content: 'Only developers can use the shot audit.',
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            const limit = interaction.options.getInteger('limit') || 10;
            const entries = readShotAuditLog(guildId).slice(0, limit);
            const embed = new EmbedBuilder()
                .setTitle('Shot Audit')
                .setColor(0xFF1744)
                .setDescription(entries.length > 0
                    ? entries.map((entry, index) => {
                        const amount = Number.isFinite(entry.amount) ? ` ${entry.amount} shot(s)` : '';
                        const maxShots = Number.isFinite(entry.maxShots) ? ` (max ${entry.maxShots})` : '';
                        return `${index + 1}. ${entry.at} | ${entry.action} | by <@${entry.byUserId}> | target <@${entry.targetUserId}> | ${entry.previousTotal} -> ${entry.newTotal} | ${amount}${maxShots}`;
                    }).join('\n')
                    : 'No shot audit entries yet.');

            await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
            return;
        }

        if (subcommand === 'gamble') {
            const maxShots = interaction.options.getInteger('max') || defaultMaxShots;
            const result = gambleShots(interaction.user.id, guildId, maxShots, interaction.user.id);

            await interaction.reply({
                content: `You rolled **${result.rolledShots} shot(s)** with a max of ${result.maxShots}. Your total is now *${result.total}*.`
            });
            return;
        }

        const targetUser = getTargetUser(interaction);

        if (!canManageTarget(interaction, targetUser)) {
            await interaction.reply({
                content: 'You can only change your own shots unless you are an admin or developer.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        if (subcommand === 'check') {
            const total = getShots(targetUser.id, guildId);

            await interaction.reply({
                content: `${formatUserLabel(targetUser)} currently has ${total} shot(s).`,
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        if (subcommand === 'add') {
            const amount = interaction.options.getInteger('amount');
            const updated = addShots(targetUser.id, amount, guildId, interaction.user.id);

            await interaction.reply({
                content: `Added ${amount} shot(s) to ${formatUserLabel(targetUser)}. Total: ${updated.total}.`,
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        if (subcommand === 'remove') {
            const amount = interaction.options.getInteger('amount');
            const before = getShots(targetUser.id, guildId);
            const updated = removeShots(targetUser.id, amount, guildId, interaction.user.id);
            const removed = before - updated.total;

            await interaction.reply({
                content: `Removed ${removed} shot(s) from ${formatUserLabel(targetUser)}. Total: ${updated.total}.`,
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        if (subcommand === 'set') {
            const amount = interaction.options.getInteger('amount');
            const updated = setShots(targetUser.id, amount, guildId, interaction.user.id);

            await interaction.reply({
                content: `Set ${formatUserLabel(targetUser)} to ${updated.total} shot(s).`,
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        if (subcommand === 'reset') {
            const updated = setShots(targetUser.id, 0, guildId, interaction.user.id);

            await interaction.reply({
                content: `Reset ${formatUserLabel(targetUser)} to ${updated.total} shot(s).`,
                flags: MessageFlags.Ephemeral
            });
            return;
        }
    }
};
