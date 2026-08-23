const { ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const operationsStore = require('../stores/operations-store');
const { moduleConfig, scanServer, snapshotGuild, previewSnapshot, restoreSnapshot } = require('../services/operations-service');
const moderationStore = require('../stores/moderation-store');
const { executeModerationAction } = require('../services/moderation-service');
const { generateAiReply } = require('../services/ai-chat');

module.exports = {
    adminOnly: true,
    data: new SlashCommandBuilder()
        .setName('server')
        .setDescription('Server safety, engagement, and operations tools')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(command => command.setName('doctor').setDescription('Scan this server for safety and configuration problems'))
        .addSubcommand(command => command.setName('snapshot').setDescription('Save a role and channel configuration snapshot'))
        .addSubcommand(command => command.setName('snapshot-preview').setDescription('Preview missing items from a recovery snapshot')
            .addStringOption(option => option.setName('snapshot').setDescription('Snapshot ID').setRequired(true)))
        .addSubcommand(command => command.setName('snapshot-restore').setDescription('Recreate missing roles and channels from a snapshot')
            .addStringOption(option => option.setName('snapshot').setDescription('Snapshot ID').setRequired(true))
            .addStringOption(option => option.setName('confirmation').setDescription('Type RESTORE').setRequired(true)))
        .addSubcommand(command => command.setName('incidents').setDescription('Show recent security incidents'))
        .addSubcommand(command => command.setName('approve-ban').setDescription('Second-approve a pending permanent ban')
            .addStringOption(option => option.setName('case').setDescription('Pending approval case ID').setRequired(true)))
        .addSubcommand(command => command.setName('copilot').setDescription('Summarize, translate, or review a report or incident')
            .addStringOption(option => option.setName('mode').setDescription('Type of assistance').setRequired(true).addChoices({ name: 'Summarize', value: 'summarize' }, { name: 'Suggest next steps', value: 'suggest' }, { name: 'Translate to English', value: 'translate' }))
            .addStringOption(option => option.setName('record').setDescription('Report or incident ID; defaults to newest').setRequired(false)))
        .addSubcommand(command => command.setName('poll').setDescription('Create a native Discord poll')
            .addStringOption(option => option.setName('question').setDescription('Poll question').setRequired(true).setMaxLength(300))
            .addStringOption(option => option.setName('choices').setDescription('Choices separated by |').setRequired(true).setMaxLength(1000))
            .addIntegerOption(option => option.setName('hours').setDescription('Duration in hours').setMinValue(1).setMaxValue(168)))
        .addSubcommand(command => command.setName('giveaway').setDescription('Start a reaction giveaway')
            .addStringOption(option => option.setName('prize').setDescription('Prize').setRequired(true).setMaxLength(300))
            .addIntegerOption(option => option.setName('minutes').setDescription('Duration in minutes').setRequired(true).setMinValue(1).setMaxValue(10080)))
        .addSubcommand(command => command.setName('embed').setDescription('Send a polished announcement embed')
            .addStringOption(option => option.setName('title').setDescription('Embed title').setRequired(true).setMaxLength(256))
            .addStringOption(option => option.setName('message').setDescription('Embed message').setRequired(true).setMaxLength(4000)))
        .addSubcommand(command => command.setName('temporary-role').setDescription('Give a member a role for a limited time')
            .addUserOption(option => option.setName('member').setDescription('Member').setRequired(true))
            .addRoleOption(option => option.setName('role').setDescription('Role to assign').setRequired(true))
            .addIntegerOption(option => option.setName('minutes').setDescription('Duration in minutes').setRequired(true).setMinValue(1).setMaxValue(43200)))
        .addSubcommand(command => command.setName('voice-role').setDescription('Link a role to presence in one voice channel')
            .addChannelOption(option => option.setName('channel').setDescription('Voice channel').addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice).setRequired(true))
            .addRoleOption(option => option.setName('role').setDescription('Role to assign while connected').setRequired(true)))
        .addSubcommand(command => command.setName('feed').setDescription('Follow an RSS or Atom creator feed')
            .addStringOption(option => option.setName('url').setDescription('HTTPS RSS or Atom URL').setRequired(true))
            .addChannelOption(option => option.setName('channel').setDescription('Announcement channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
            .addStringOption(option => option.setName('name').setDescription('Feed name').setRequired(false).setMaxLength(80))),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === 'doctor') {
            if (!moduleConfig(interaction.guildId, 'serverDoctor')) return interaction.reply({ content: 'Server Doctor is not enabled.', flags: MessageFlags.Ephemeral });
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const result = await scanServer(interaction.guild);
            const lines = result.checks.slice(0, 10).map(check => `${check.severity === 'critical' ? '🔴' : '🟠'} **${check.title}** — ${check.detail}`);
            return interaction.editReply(`**Server health: ${result.score}/100**\n${lines.join('\n') || '🟢 No problems found.'}`);
        }
        if (subcommand === 'snapshot') {
            if (!moduleConfig(interaction.guildId, 'backups')) return interaction.reply({ content: 'Configuration Backup & Recovery is not enabled.', flags: MessageFlags.Ephemeral });
            const snapshot = snapshotGuild(interaction.guild, `manual by ${interaction.user.id}`);
            return interaction.reply({ content: `Saved snapshot **${snapshot.id}** with ${snapshot.roles.length} roles and ${snapshot.channels.length} channels.`, flags: MessageFlags.Ephemeral });
        }
        if (subcommand === 'snapshot-preview' || subcommand === 'snapshot-restore') {
            if (!moduleConfig(interaction.guildId, 'backups')) return interaction.reply({ content: 'Configuration Backup & Recovery is not enabled.', flags: MessageFlags.Ephemeral });
            const snapshotId = interaction.options.getString('snapshot', true);
            const preview = previewSnapshot(interaction.guild, snapshotId);
            if (!preview) return interaction.reply({ content: 'Snapshot not found.', flags: MessageFlags.Ephemeral });
            if (subcommand === 'snapshot-preview') return interaction.reply({ content: `**${snapshotId}** can recreate ${preview.missingRoles.length} missing roles and ${preview.missingChannels.length} missing channels. Existing items will not be overwritten or deleted.`, flags: MessageFlags.Ephemeral });
            if (interaction.options.getString('confirmation', true) !== 'RESTORE') return interaction.reply({ content: 'Type `RESTORE` exactly to confirm recovery.', flags: MessageFlags.Ephemeral });
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const result = await restoreSnapshot(interaction.guild, snapshotId);
            return interaction.editReply(`Recovery completed: ${result.restoredRoles} roles and ${result.restoredChannels} channels recreated. Existing items were left unchanged.`);
        }
        if (subcommand === 'incidents') {
            if (!moduleConfig(interaction.guildId, 'incidentCenter')) return interaction.reply({ content: 'Incident Center is not enabled.', flags: MessageFlags.Ephemeral });
            const incidents = operationsStore.readState(interaction.guildId).incidents.slice(0, 10);
            return interaction.reply({ content: incidents.length ? incidents.map(item => `**${item.id}** — ${item.summary} (${item.status})`).join('\n') : 'No incidents have been recorded.', flags: MessageFlags.Ephemeral });
        }
        if (subcommand === 'approve-ban') {
            const approval = moderationStore.getCase(interaction.guildId, interaction.options.getString('case', true));
            if (!approval || approval.action !== 'ban-approval' || approval.status !== 'pending') return interaction.reply({ content: 'That is not a pending permanent-ban approval.', flags: MessageFlags.Ephemeral });
            if (approval.moderatorId === interaction.user.id) return interaction.reply({ content: 'A different administrator must provide the second approval.', flags: MessageFlags.Ephemeral });
            const completed = await executeModerationAction({ guild: interaction.guild, action: 'ban', actorId: interaction.user.id, actorLabel: interaction.user.tag, targetId: approval.targetId, reason: approval.reason, source: 'manual', metadata: { approved: true, approvalCaseId: approval.id } });
            moderationStore.updateCase(interaction.guildId, approval.id, { status: 'completed', metadata: { ...approval.metadata, approvedBy: interaction.user.id, resolutionCaseId: completed.id } }, { id: interaction.user.id, label: interaction.user.tag });
            return interaction.reply({ content: `Permanent ban approved. Completed as **${completed.id}**.`, flags: MessageFlags.Ephemeral });
        }
        if (subcommand === 'copilot') {
            const config = moduleConfig(interaction.guildId, 'copilot');
            if (!config) return interaction.reply({ content: 'Flummi Copilot is not enabled.', flags: MessageFlags.Ephemeral });
            const mode = interaction.options.getString('mode', true);
            if ((mode === 'summarize' && !config.summariesEnabled) || (mode === 'suggest' && !config.suggestionsEnabled) || (mode === 'translate' && !config.translationEnabled)) return interaction.reply({ content: 'That Copilot capability is turned off.', flags: MessageFlags.Ephemeral });
            const state = operationsStore.readState(interaction.guildId);
            const recordId = interaction.options.getString('record');
            const record = recordId ? [...state.reports, ...state.incidents].find(entry => entry.id === recordId) : (state.reports[0] || state.incidents[0]);
            if (!record) return interaction.reply({ content: 'No report or incident is available to review.', flags: MessageFlags.Ephemeral });
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const safeRecord = { id: record.id, type: record.id.startsWith('report-') ? 'report' : 'incident', reason: record.reason, summary: record.summary, status: record.status, actions: record.actions, messageContext: record.messageContext };
            try {
                const result = await generateAiReply({ userInput: `You are a staff copilot. ${mode === 'summarize' ? 'Summarize' : mode === 'suggest' ? 'Suggest careful, reversible next steps for' : 'Translate all non-English content to English in'} this Discord moderation record. Do not invent facts and do not claim an action was taken. Record: ${JSON.stringify(safeRecord)}`, history: [], memorySummary: '', userProfile: null, externalUserProfile: null, userId: interaction.user.id, guildId: interaction.guildId, channelId: interaction.channelId });
                return interaction.editReply(`**Copilot review for ${record.id}**\n${result.text.slice(0, 1800)}\n\n*No action was applied.*`);
            } catch (error) { return interaction.editReply(`Copilot could not complete this review: ${error.message}`); }
        }
        const engagement = moduleConfig(interaction.guildId, 'engagement');
        if (!engagement) return interaction.reply({ content: 'Engagement & Utilities is not enabled.', flags: MessageFlags.Ephemeral });
        if (subcommand === 'poll') {
            if (!engagement.polls) return interaction.reply({ content: 'Polls are turned off.', flags: MessageFlags.Ephemeral });
            const answers = interaction.options.getString('choices', true).split('|').map(text => text.trim()).filter(Boolean).slice(0, 10);
            if (answers.length < 2) return interaction.reply({ content: 'Provide at least two choices separated by `|`.', flags: MessageFlags.Ephemeral });
            await interaction.channel.send({ poll: { question: { text: interaction.options.getString('question', true) }, answers: answers.map(text => ({ text })), duration: interaction.options.getInteger('hours') || 24, allowMultiselect: false } });
            return interaction.reply({ content: 'Poll published.', flags: MessageFlags.Ephemeral });
        }
        if (subcommand === 'giveaway') {
            if (!engagement.giveaways) return interaction.reply({ content: 'Giveaways are turned off.', flags: MessageFlags.Ephemeral });
            const minutes = interaction.options.getInteger('minutes', true);
            const prize = interaction.options.getString('prize', true);
            const embed = new EmbedBuilder().setTitle('🎉 Giveaway').setDescription(`**${prize}**\n\nReact with 🎉 to enter. Ends <t:${Math.floor((Date.now() + minutes * 60000) / 1000)}:R>.`).setColor(0x7785ff).setTimestamp();
            const message = await interaction.channel.send({ embeds: [embed] });
            await message.react('🎉');
            operationsStore.addGiveaway(interaction.guildId, { channelId: interaction.channelId, messageId: message.id, prize, endsAt: new Date(Date.now() + minutes * 60000).toISOString() });
            return interaction.reply({ content: 'Giveaway started.', flags: MessageFlags.Ephemeral });
        }
        if (subcommand === 'temporary-role') {
            if (!engagement.temporaryRoles) return interaction.reply({ content: 'Temporary roles are turned off.', flags: MessageFlags.Ephemeral });
            const member = interaction.options.getMember('member');
            const role = interaction.options.getRole('role', true);
            const minutes = interaction.options.getInteger('minutes', true);
            if (!member || role.managed || role.position >= interaction.guild.members.me.roles.highest.position) return interaction.reply({ content: 'Flummi cannot assign that role because of the Discord role hierarchy.', flags: MessageFlags.Ephemeral });
            await member.roles.add(role, `Temporary role by ${interaction.user.tag}`);
            operationsStore.addTemporaryRole(interaction.guildId, { userId: member.id, roleId: role.id, removeAt: new Date(Date.now() + minutes * 60000).toISOString() });
            return interaction.reply({ content: `<@${member.id}> has <@&${role.id}> for ${minutes} minute${minutes === 1 ? '' : 's'}.`, allowedMentions: { parse: [] }, flags: MessageFlags.Ephemeral });
        }
        if (subcommand === 'voice-role') {
            if (!engagement.voiceLinkedRoles) return interaction.reply({ content: 'Voice-linked roles are turned off.', flags: MessageFlags.Ephemeral });
            const channel = interaction.options.getChannel('channel', true);
            const role = interaction.options.getRole('role', true);
            if (role.managed || role.position >= interaction.guild.members.me.roles.highest.position) return interaction.reply({ content: 'Flummi cannot assign that role because of the Discord role hierarchy.', flags: MessageFlags.Ephemeral });
            operationsStore.setVoiceRoleLink(interaction.guildId, channel.id, role.id);
            return interaction.reply({ content: `Linked <@&${role.id}> to <#${channel.id}>.`, allowedMentions: { parse: [] }, flags: MessageFlags.Ephemeral });
        }
        if (subcommand === 'feed') {
            if (!engagement.feeds) return interaction.reply({ content: 'Creator feeds are turned off.', flags: MessageFlags.Ephemeral });
            const url = interaction.options.getString('url', true);
            let parsed;
            try { parsed = new URL(url); } catch { return interaction.reply({ content: 'Enter a valid HTTPS feed URL.', flags: MessageFlags.Ephemeral }); }
            if (parsed.protocol !== 'https:' || /^(?:localhost|127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/i.test(parsed.hostname)) return interaction.reply({ content: 'Only public HTTPS feed URLs are allowed.', flags: MessageFlags.Ephemeral });
            const channel = interaction.options.getChannel('channel', true);
            const feed = operationsStore.addFeed(interaction.guildId, { url: parsed.toString(), channelId: channel.id, name: interaction.options.getString('name') || parsed.hostname, lastItemUrl: null, lastCheckedAt: null });
            return interaction.reply({ content: `Creator feed **${feed.name}** will post in <#${channel.id}>.`, allowedMentions: { parse: [] }, flags: MessageFlags.Ephemeral });
        }
        if (!engagement.embedBuilder) return interaction.reply({ content: 'The embed builder is turned off.', flags: MessageFlags.Ephemeral });
        await interaction.channel.send({ embeds: [new EmbedBuilder().setTitle(interaction.options.getString('title', true)).setDescription(interaction.options.getString('message', true)).setColor(0x7785ff).setTimestamp()] });
        return interaction.reply({ content: 'Embed published.', flags: MessageFlags.Ephemeral });
    }
};
