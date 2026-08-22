const MAX_COMMAND_DESCRIPTION_LENGTH = 100;

function accessSuffix(requiredRole) {
    if (requiredRole === 'developer') return ' (developer only)';
    if (requiredRole === 'manager') return ' (manager only)';
    return '';
}

function appendAccessSuffix(description, requiredRole, maxLength = MAX_COMMAND_DESCRIPTION_LENGTH) {
    const suffix = accessSuffix(requiredRole);
    const text = String(description || 'No description.').trim();

    if (!suffix || text.toLowerCase().endsWith(suffix)) return text.slice(0, maxLength);

    return `${text.slice(0, Math.max(0, maxLength - suffix.length)).trimEnd()}${suffix}`;
}

function commandPayloadWithAccessDescriptions(command, getRequiredCommandRole) {
    const payload = command.data.toJSON();
    payload.description = appendAccessSuffix(
        payload.description,
        getRequiredCommandRole(payload.name, null, command)
    );

    for (const option of payload.options || []) {
        if (option.type === 1) {
            option.description = appendAccessSuffix(
                option.description,
                getRequiredCommandRole(payload.name, option.name, command)
            );
            continue;
        }

        if (option.type !== 2) continue;
        for (const subcommand of option.options || []) {
            if (subcommand.type !== 1) continue;
            subcommand.description = appendAccessSuffix(
                subcommand.description,
                getRequiredCommandRole(payload.name, subcommand.name, command, option.name)
            );
        }
    }

    return payload;
}

module.exports = {
    MAX_COMMAND_DESCRIPTION_LENGTH,
    appendAccessSuffix,
    commandPayloadWithAccessDescriptions
};
