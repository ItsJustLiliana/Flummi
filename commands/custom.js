const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const store = require('../stores/custom-command-store');
const { removeSyncedCommand, syncCommand } = require('../services/custom-command-service');

module.exports = {
    adminSubcommands: ['create', 'remove', 'list'],
    data: new SlashCommandBuilder().setName('custom').setDescription('Build server-specific slash commands')
        .addSubcommand(c => c.setName('create').setDescription('Create or update a custom command')
            .addStringOption(o => o.setName('name').setDescription('Slash-command name').setRequired(true).setMaxLength(32))
            .addStringOption(o => o.setName('description').setDescription('Command description').setRequired(true).setMaxLength(100))
            .addStringOption(o => o.setName('response').setDescription('Text or embed description').setRequired(true).setMaxLength(4000))
            .addStringOption(o => o.setName('type').setDescription('Response type').addChoices({ name: 'Plain text', value: 'text' }, { name: 'Embed', value: 'embed' }))
            .addRoleOption(o => o.setName('required-role').setDescription('Required server role'))
            .addChannelOption(o => o.setName('allowed-channel').setDescription('Restrict to one channel'))
            .addIntegerOption(o => o.setName('cooldown').setDescription('Cooldown in seconds').setMinValue(0).setMaxValue(86400))
            .addBooleanOption(o => o.setName('ephemeral').setDescription('Only the caller sees the response'))
            .addStringOption(o => o.setName('image').setDescription('Embed image URL'))
            .addStringOption(o => o.setName('buttons').setDescription('JSON array of {label,url} buttons')))
        .addSubcommand(c => c.setName('remove').setDescription('Remove a custom command').addStringOption(o => o.setName('name').setDescription('Command name').setRequired(true)))
        .addSubcommand(c => c.setName('list').setDescription('List custom commands')),
    async execute(interaction) {
        const action = interaction.options.getSubcommand();
        if (action === 'list') {
            const rows = store.readCommands(interaction.guildId);
            return interaction.reply({ content: rows.length ? rows.map(row => `/${row.name} â€” ${row.description} (${row.enabled ? 'enabled' : 'disabled'})`).join('\n') : 'No custom commands configured.', flags: MessageFlags.Ephemeral });
        }
        const name = store.normalizeName(interaction.options.getString('name', true));
        if (interaction.client.commands.has(name)) return interaction.reply({ content: 'That name belongs to a built-in Flummi command.', flags: MessageFlags.Ephemeral });
        if (action === 'remove') { const removed = store.removeCommand(interaction.guildId, name); if (removed) await removeSyncedCommand(interaction.guild, name); return interaction.reply({ content: removed ? `Removed /${name}.` : 'Command not found.', flags: MessageFlags.Ephemeral }); }
        let buttons = [];
        try { buttons = JSON.parse(interaction.options.getString('buttons') || '[]'); } catch { return interaction.reply({ content: 'Buttons must be a valid JSON array.', flags: MessageFlags.Ephemeral }); }
        const command = store.upsertCommand(interaction.guildId, { name, description: interaction.options.getString('description', true), content: interaction.options.getString('response', true), responseType: interaction.options.getString('type') || 'text', requiredRoleId: interaction.options.getRole('required-role')?.id, allowedChannelIds: interaction.options.getChannel('allowed-channel') ? [interaction.options.getChannel('allowed-channel').id] : [], cooldownSeconds: interaction.options.getInteger('cooldown') || 0, ephemeral: interaction.options.getBoolean('ephemeral') ?? true, imageUrl: interaction.options.getString('image') || '', buttons });
        await syncCommand(interaction.guild, command);
        return interaction.reply({ content: `/${command.name} is ready.`, flags: MessageFlags.Ephemeral });
    }
};
