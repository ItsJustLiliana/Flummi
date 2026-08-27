const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    MessageFlags,
    SlashCommandBuilder
} = require('discord.js');
const { COLORS } = require('../utils/command-ui');
const { canAddTriggers, isAdmin } = require('../stores/access-store');
const { checkCooldown } = require('../utils/cooldowns');
const { readSettings } = require('../stores/settings-store');
const {
    addTrigger,
    appendAuditEntry,
    findTriggerIndex,
    getAllTriggerStats,
    getTriggerStats,
    getTriggers,
    readAuditLog,
    updateTrigger
} = require('../stores/trigger-store');

const pendingRemovals = new Map();

function formatTimestamp(date) {
    const pad = value => String(value).padStart(2, '0');

    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate())
    ].join('-') + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function executeAdd(interaction) {
    const guildId = interaction.guildId;

    if (!canAddTriggers(interaction.user.id, guildId, interaction.memberPermissions)) {
        return interaction.reply({
            content: 'You do not have permission to add triggers.',
            flags: MessageFlags.Ephemeral
        });
    }

    const settings = readSettings(guildId);

    if (settings.triggerActionCooldownEnabled) {
        const cooldown = checkCooldown(
            interaction.user.id,
            'trigger-action',
            settings.triggerActionCooldownSeconds
        );

        if (!cooldown.allowed) {
            return interaction.reply({
                content: `Please wait ${cooldown.remaining} more second(s) before adding another trigger.`,
                flags: MessageFlags.Ephemeral
            });
        }
    }

    const phrase = interaction.options.getString('phrase').trim();
    const response = interaction.options.getString('response');
    const image = interaction.options.getAttachment('image');

    if (phrase.length > settings.maxTriggerLength) {
        return interaction.reply({
            content: `Trigger phrase cannot exceed ${settings.maxTriggerLength} characters (yours is ${phrase.length}).`,
            flags: MessageFlags.Ephemeral
        });
    }

    if (!response && !image) {
        return interaction.reply({
            content: 'You must provide either a response, an image, or both.',
            flags: MessageFlags.Ephemeral
        });
    }

    const result = addTrigger({
        trigger: phrase,
        response: response || null,
        image: image ? image.url : null,
        addedById: interaction.user.id,
        addedByTag: interaction.user.tag,
        addedAt: formatTimestamp(new Date())
    }, guildId);

    if (!result.ok) {
        if (result.reason === 'duplicate') {
            return interaction.reply({
                content: `Trigger "${phrase}" already exists.`,
                flags: MessageFlags.Ephemeral
            });
        }

        if (result.reason === 'limit-reached') {
            return interaction.reply({
                content: 'Trigger limit reached. Delete a trigger before adding another one.',
                flags: MessageFlags.Ephemeral
            });
        }

        return interaction.reply({
            content: 'Failed to save trigger.',
            flags: MessageFlags.Ephemeral
        });
    }

    appendAuditEntry({
        action: 'add',
        trigger: phrase,
        byId: interaction.user.id,
        byTag: interaction.user.tag,
        at: formatTimestamp(new Date())
    }, guildId);

    return interaction.reply({
        content: `Added trigger "${phrase}" successfully.`,
        flags: MessageFlags.Ephemeral
    });
}

async function executeEdit(interaction) {
    const guildId = interaction.guildId;
    if (!isAdmin(interaction.user.id, guildId, interaction.memberPermissions)) {
        return interaction.reply({
            content: 'You need admin permissions to edit triggers.',
            flags: MessageFlags.Ephemeral
        });
    }
    const phrase = interaction.options.getString('phrase').trim();
    const response = interaction.options.getString('response');
    const image = interaction.options.getAttachment('image');
    const triggers = getTriggers(guildId);
    const index = findTriggerIndex(triggers, phrase);

    if (index === -1) {
        return interaction.reply({
            content: `Trigger "${phrase}" was not found.`,
            flags: MessageFlags.Ephemeral
        });
    }

    if (response === null && !image) {
        return interaction.reply({
            content: 'Provide a new response, a new image, or both.',
            flags: MessageFlags.Ephemeral
        });
    }

    const nextUpdates = {};

    if (response !== null) {
        nextUpdates.response = response;
    }

    if (image) {
        nextUpdates.image = image.url;
    }

    const result = updateTrigger(phrase, nextUpdates, guildId);

    if (!result.ok) {
        return interaction.reply({
            content: 'Failed to update trigger.',
            flags: MessageFlags.Ephemeral
        });
    }

    appendAuditEntry({
        action: 'edit',
        trigger: result.trigger.trigger,
        byId: interaction.user.id,
        byTag: interaction.user.tag,
        at: formatTimestamp(new Date()),
        changes: nextUpdates
    }, guildId);

    return interaction.reply({
        content: `Updated trigger "${result.trigger.trigger}".`,
        flags: MessageFlags.Ephemeral
    });
}

async function executeRemove(interaction) {
    const guildId = interaction.guildId;
    if (!isAdmin(interaction.user.id, guildId, interaction.memberPermissions)) {
        return interaction.reply({
            content: 'You need admin permissions to remove triggers.',
            flags: MessageFlags.Ephemeral
        });
    }
    const phrase = interaction.options.getString('phrase').trim();
    const triggers = getTriggers(guildId);
    const index = findTriggerIndex(triggers, phrase);

    if (index === -1) {
        return interaction.reply({
            content: `Trigger "${phrase}" was not found.`,
            flags: MessageFlags.Ephemeral
        });
    }

    pendingRemovals.set(`${guildId || 'global'}:${interaction.user.id}`, phrase);

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('removetrigger:confirm')
            .setLabel('Yes, remove it')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('removetrigger:cancel')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
    );

    return interaction.reply({
        content: `Are you sure you want to remove trigger **"${phrase}"**?`,
        components: [row],
        flags: MessageFlags.Ephemeral
    });
}

async function executeList(interaction) {
    let triggers = getTriggers(interaction.guildId);
    const filter = interaction.options.getString('filter');

    if (filter) {
        const lower = filter.toLowerCase();
        triggers = triggers.filter(trigger =>
            typeof trigger.trigger === 'string' && trigger.trigger.toLowerCase().includes(lower)
        );
    }

    if (triggers.length === 0) {
        return interaction.reply({
            content: filter ? `No triggers matching "${filter}".` : 'No triggers found.',
            flags: MessageFlags.Ephemeral
        });
    }

    let output = triggers
        .map(trigger => `- ${trigger.trigger} -> ${trigger.response || '[image only]'}`)
        .join('\n');

    if (output.length > 1900) {
        output = output.slice(0, 1900) + '\n...and more. Use a filter to narrow results.';
    }

    return interaction.reply({ content: output, flags: MessageFlags.Ephemeral });
}

async function executeInfo(interaction) {
    const guildId = interaction.guildId;
    const triggerName = interaction.options.getString('phrase').trim();
    const triggers = getTriggers(guildId);
    const match = triggers.find(trigger =>
        typeof trigger.trigger === 'string' &&
        trigger.trigger.toLowerCase() === triggerName.toLowerCase()
    );

    if (!match) {
        return interaction.reply({
            content: `Trigger "${triggerName}" was not found.`,
            flags: MessageFlags.Ephemeral
        });
    }

    const uses = getTriggerStats(match.trigger, guildId);
    const audit = readAuditLog(guildId).find(entry =>
        typeof entry.trigger === 'string' &&
        entry.trigger.toLowerCase() === match.trigger.toLowerCase()
    );

    const embed = new EmbedBuilder()
        .setTitle(`Trigger Info: ${match.trigger}`)
        .setColor(COLORS.danger)
        .addFields(
            { name: 'Added By', value: `${match.addedByTag || 'unknown'} (${match.addedById || 'unknown'})`, inline: false },
            { name: 'Added At', value: match.addedAt || 'unknown', inline: true },
            { name: 'Uses', value: String(uses), inline: true }
        );

    if (audit) {
        embed.addFields({
            name: 'Latest Change',
            value: `${String(audit.action || 'unknown').toUpperCase()} by ${audit.byTag || audit.byId || 'unknown'} at ${audit.at || 'unknown'}`,
            inline: false
        });
    }

    return interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral
    });
}

async function executeStats(interaction) {
    const guildId = interaction.guildId;
    const limit = interaction.options.getInteger('limit') || 10;
    const stats = getAllTriggerStats(guildId);
    const rows = getTriggers(guildId)
        .filter(trigger => typeof trigger.trigger === 'string' && trigger.trigger.trim())
        .map(trigger => ({
            name: trigger.trigger,
            count: Number(stats[trigger.trigger.toLowerCase()]) || 0
        }))
        .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
        .slice(0, limit);

    const embed = new EmbedBuilder()
        .setTitle('Trigger Stats')
        .setColor(COLORS.danger)
        .setDescription(rows.length
            ? rows.map((row, index) => `${index + 1}. ${row.name} - ${row.count} use(s)`).join('\n')
            : 'No trigger usage data yet.');

    return interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral
    });
}

async function executeAudit(interaction) {
    const limit = interaction.options.getInteger('limit') || 5;
    const audit = readAuditLog(interaction.guildId).slice(0, limit);

    const embed = new EmbedBuilder()
        .setTitle('Trigger Audit Log')
        .setColor(COLORS.danger)
        .setDescription(audit.length
            ? audit.map(entry => {
                const action = String(entry.action || 'unknown').toUpperCase();
                const trigger = entry.trigger || 'unknown';
                const actor = entry.byTag || entry.byId || 'unknown';
                const at = entry.at || 'unknown';
                return `- ${action} ${trigger} by ${actor} at ${at}`;
            }).join('\n')
            : 'No trigger changes recorded yet.');

    return interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral
    });
}

module.exports = {
    pendingRemovals,

    data: new SlashCommandBuilder()
        .setName('trigger')
        .setDescription('Manage trigger responses')
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add a trigger')
                .addStringOption(option =>
                    option.setName('phrase').setDescription('Trigger phrase').setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('response').setDescription('Text response').setRequired(false)
                )
                .addAttachmentOption(option =>
                    option.setName('image').setDescription('Image to send').setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('edit')
                .setDescription('Edit an existing trigger')
                .addStringOption(option =>
                    option.setName('phrase').setDescription('Trigger phrase to edit').setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('response').setDescription('New text response').setRequired(false)
                )
                .addAttachmentOption(option =>
                    option.setName('image').setDescription('New image to send').setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove an existing trigger by phrase')
                .addStringOption(option =>
                    option.setName('phrase').setDescription('Exact trigger phrase to remove').setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('Shows all triggers')
                .addStringOption(option =>
                    option.setName('filter').setDescription('Filter by keyword').setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('info')
                .setDescription('Show metadata about a trigger')
                .addStringOption(option =>
                    option.setName('phrase').setDescription('Trigger phrase to inspect').setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('stats')
                .setDescription('Show trigger usage statistics')
                .addIntegerOption(option =>
                    option.setName('limit').setDescription('How many top triggers to show').setMinValue(1).setMaxValue(25).setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('audit')
                .setDescription('Show recent trigger changes')
                .addIntegerOption(option =>
                    option.setName('limit').setDescription('How many entries to show').setMinValue(1).setMaxValue(10).setRequired(false)
                )
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'add') return executeAdd(interaction);
        if (subcommand === 'edit') return executeEdit(interaction);
        if (subcommand === 'remove') return executeRemove(interaction);
        if (subcommand === 'list') return executeList(interaction);
        if (subcommand === 'info') return executeInfo(interaction);
        if (subcommand === 'stats') return executeStats(interaction);
        if (subcommand === 'audit') return executeAudit(interaction);

        return interaction.reply({
            content: 'Unknown trigger action.',
            flags: MessageFlags.Ephemeral
        });
    }
};
