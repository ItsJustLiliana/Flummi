function flattenValues(value, prefix = '', output = {}) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [key, nestedValue] of Object.entries(value)) {
            flattenValues(nestedValue, prefix ? `${prefix}.${key}` : key, output);
        }
        return output;
    }

    if (prefix) output[prefix] = value;
    return output;
}

function humanizeField(field) {
    const leaf = String(field || '').split('.').pop() || 'setting';
    const words = leaf
        .replace(/Ids?$/i, '')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .trim();
    return words ? words[0].toUpperCase() + words.slice(1).toLowerCase() : 'Setting';
}

function buildFieldChanges(before, after, labels = {}) {
    const previous = flattenValues(before);
    const next = flattenValues(after);
    const fields = [...new Set([...Object.keys(previous), ...Object.keys(next)])].sort();

    return fields
        .filter(field => JSON.stringify(previous[field]) !== JSON.stringify(next[field]))
        .map(field => ({
            field,
            label: labels[field] || humanizeField(field),
            before: previous[field] === undefined ? null : previous[field],
            after: next[field] === undefined ? null : next[field]
        }));
}

module.exports = { buildFieldChanges, humanizeField };
