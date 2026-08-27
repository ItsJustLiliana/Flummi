const fs = require('fs');
const path = require('path');
const { AttachmentBuilder } = require('discord.js');

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

async function fetchAllMessages(channel, maximum = 10000) {
    const messages = [];
    let before;
    while (messages.length < maximum) {
        const page = await channel.messages.fetch({ limit: Math.min(100, maximum - messages.length), ...(before ? { before } : {}) });
        if (!page.size) break;
        messages.push(...page.values());
        before = page.last().id;
        if (page.size < 100) break;
    }
    return messages.sort((left, right) => left.createdTimestamp - right.createdTimestamp);
}

function serializeMessage(message) {
    return {
        id: message.id, createdAt: message.createdAt?.toISOString?.() || new Date(message.createdTimestamp).toISOString(),
        editedAt: message.editedAt?.toISOString?.() || null,
        author: { id: message.author?.id, tag: message.author?.tag || message.author?.username || 'Unknown', bot: Boolean(message.author?.bot), avatarUrl: message.author?.displayAvatarURL?.() || null },
        content: message.content || '',
        attachments: [...(message.attachments?.values?.() || [])].map(file => ({ id: file.id, name: file.name, url: file.url, contentType: file.contentType, size: file.size })),
        embeds: (message.embeds || []).map(embed => embed.toJSON ? embed.toJSON() : embed),
        reactions: [...(message.reactions?.cache?.values?.() || [])].map(reaction => ({ emoji: reaction.emoji?.toString?.() || reaction.emoji?.name, count: reaction.count }))
    };
}

function header(ticket) {
    return {
        id: ticket.id, topic: ticket.topic, openerId: ticket.ownerId, claimerId: ticket.claimedBy || null,
        assignedTo: ticket.assignedTo || null, priority: ticket.priority || 'normal', tags: ticket.tags || [],
        openedAt: ticket.createdAt, claimedAt: ticket.claimedAt || null, closedAt: ticket.closedAt || new Date().toISOString(),
        closedBy: ticket.closedBy || null, closeReason: ticket.closeReason || 'No reason supplied'
    };
}

function renderText(transcript) {
    const h = transcript.ticket;
    return [`Ticket ${h.id}`, `Topic: ${h.topic}`, `Opener: ${h.openerId}`, `Claimer: ${h.claimerId || '-'}`, `Priority: ${h.priority}`, `Tags: ${h.tags.join(', ') || '-'}`, `Opened: ${h.openedAt}`, `Closed: ${h.closedAt}`, `Close reason: ${h.closeReason}`, '']
        .concat(transcript.messages.map(message => `[${message.createdAt}] ${message.author.tag} (${message.author.id}): ${message.content}${message.attachments.map(file => `\n  attachment: ${file.name} ${file.url}`).join('')}${message.embeds.length ? `\n  embeds: ${JSON.stringify(message.embeds)}` : ''}${message.reactions.length ? `\n  reactions: ${message.reactions.map(reaction => `${reaction.emoji} x${reaction.count}`).join(', ')}` : ''}`)).join('\n');
}

function renderHtml(transcript) {
    const h = transcript.ticket;
    const messages = transcript.messages.map(message => `<article><img src="${escapeHtml(message.author.avatarUrl || '')}" alt=""><div><header><strong>${escapeHtml(message.author.tag)}</strong><time>${escapeHtml(message.createdAt)}</time></header><p>${escapeHtml(message.content).replace(/\n/g, '<br>') || '<em>No text</em>'}</p>${message.attachments.map(file => `<a href="${escapeHtml(file.url)}">📎 ${escapeHtml(file.name)}</a>`).join(' ')}${message.embeds.map(embed => `<pre>${escapeHtml(JSON.stringify(embed, null, 2))}</pre>`).join('')}${message.reactions.length ? `<small>${message.reactions.map(reaction => `${escapeHtml(reaction.emoji)} × ${reaction.count}`).join(' ')}</small>` : ''}</div></article>`).join('');
    return `<!doctype html><html><head><meta charset="utf-8"><title>Ticket ${escapeHtml(h.id)}</title><style>body{margin:0;background:#10131a;color:#e8eaf0;font:15px system-ui}main{max-width:920px;margin:auto;padding:32px}.meta,article{background:#191e29;border:1px solid #303746;border-radius:12px;padding:16px;margin:12px 0}article{display:grid;grid-template-columns:42px 1fr;gap:12px}img{width:42px;height:42px;border-radius:50%;background:#303746}header{display:flex;justify-content:space-between;gap:10px}time,small{color:#9aa4b5}p{white-space:normal;line-height:1.5}a{color:#91caff}pre{white-space:pre-wrap;background:#10131a;padding:10px;border-radius:8px;overflow:auto}</style></head><body><main><h1>Ticket ${escapeHtml(h.id)}</h1><section class="meta"><b>Topic:</b> ${escapeHtml(h.topic)}<br><b>Opener:</b> ${escapeHtml(h.openerId)}<br><b>Claimer:</b> ${escapeHtml(h.claimerId || '-')}<br><b>Priority:</b> ${escapeHtml(h.priority)}<br><b>Tags:</b> ${escapeHtml(h.tags.join(', ') || '-')}<br><b>Opened:</b> ${escapeHtml(h.openedAt)}<br><b>Closed:</b> ${escapeHtml(h.closedAt)}<br><b>Reason:</b> ${escapeHtml(h.closeReason)}</section>${messages}</main></body></html>`;
}

async function createTicketTranscript(channel, ticket, formats = ['html', 'txt', 'json']) {
    const transcript = { version: 1, generatedAt: new Date().toISOString(), ticket: header(ticket), messages: (await fetchAllMessages(channel)).map(serializeMessage) };
    const buffers = { json: Buffer.from(JSON.stringify(transcript, null, 2)), txt: Buffer.from(renderText(transcript)), html: Buffer.from(renderHtml(transcript)) };
    return [...new Set(formats)].filter(format => buffers[format]).map(format => ({ format, name: `${ticket.id}.${format}`, buffer: buffers[format], attachment: new AttachmentBuilder(buffers[format], { name: `${ticket.id}.${format}` }) }));
}

function persistTranscripts(guildId, ticketId, files) {
    const folder = path.join(__dirname, '..', 'data', 'guilds', String(guildId), 'tickets', 'transcripts', String(ticketId));
    fs.mkdirSync(folder, { recursive: true });
    for (const file of files) fs.writeFileSync(path.join(folder, file.name), file.buffer);
    return folder;
}

function pruneTranscripts(guildId, retentionDays, now = Date.now()) {
    const root = path.join(__dirname, '..', 'data', 'guilds', String(guildId), 'tickets', 'transcripts');
    if (!fs.existsSync(root)) return 0;
    let removed = 0;
    const cutoff = now - Math.max(1, Number(retentionDays) || 90) * 86400000;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const folder = path.join(root, entry.name);
        if (fs.statSync(folder).mtimeMs < cutoff) { fs.rmSync(folder, { recursive: true, force: true }); removed += 1; }
    }
    return removed;
}

module.exports = { createTicketTranscript, escapeHtml, fetchAllMessages, persistTranscripts, pruneTranscripts, renderHtml, renderText, serializeMessage };
