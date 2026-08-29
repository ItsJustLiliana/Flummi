(() => {
    const deliveryKinds = [
        ['general', 'General updates'],
        ['moderation', 'Moderation & incidents'],
        ['support', 'Support, tickets & modmail'],
        ['privacy', 'Privacy & AI consent'],
        ['workflow', 'Workflows & automation']
    ];
    const deliveryOptions = [['dashboard', 'Dashboard only'], ['dm', 'Discord DM only'], ['both', 'Dashboard + DM'], ['off', 'Off']];
    const html = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const date = value => value ? new Date(value).toLocaleString() : 'Unknown';

    async function request(url, options = {}) {
        const response = await fetch(url, options);
        if (!response.ok) {
            let message = `Request failed (${response.status})`;
            try { message = (await response.json()).error || message; } catch { /* keep status */ }
            throw new Error(message);
        }
        return response.status === 204 ? {} : response.json();
    }

    function status(id, message, type = '') {
        const node = document.getElementById(id);
        if (!node) return;
        node.textContent = message;
        node.className = `status ${type}`.trim();
    }

    async function loadNotificationPreferences() {
        const data = await request('/api/account/preferences');
        const current = data.preferences?.notificationDelivery || {};
        document.getElementById('notificationDeliveryPreferences').innerHTML = deliveryKinds.map(([key, label]) => `<label class="notification-delivery-row"><span>${html(label)}</span><select data-notification-kind="${key}">${deliveryOptions.map(([value, text]) => `<option value="${value}"${current[key] === value ? ' selected' : ''}>${html(text)}</option>`).join('')}</select></label>`).join('');
    }

    async function saveNotificationPreferences() {
        const notificationDelivery = Object.fromEntries([...document.querySelectorAll('[data-notification-kind]')].map(select => [select.dataset.notificationKind, select.value]));
        await request('/api/account/preferences', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notificationDelivery }) });
        status('notificationPreferencesStatus', 'Delivery preferences saved.', 'ok');
    }

    async function loadData() {
        const [data, guildData] = await Promise.all([request('/api/account/data'), request('/api/guilds').catch(() => ({ guilds: [] }))]);
        const summary = data.summary || {};
        document.getElementById('accountDataSummary').innerHTML = [
            ['Shared servers', summary.servers || 0],
            ['Notifications', summary.notifications || 0],
            ['AI memory messages', summary.aiMemoryMessages || 0],
            ['Correction requests', summary.correctionRequests || 0]
        ].map(([label, value]) => `<article class="card"><span>${html(label)}</span><strong>${html(value)}</strong></article>`).join('');
        const guildSelect = document.getElementById('accountCorrectionGuild');
        guildSelect.innerHTML = '<option value="">Account-wide</option>' + (guildData.guilds || []).map(guild => `<option value="${html(guild.id)}">${html(guild.name)}</option>`).join('');
        document.getElementById('accountCorrectionHistory').innerHTML = (data.correctionRequests || []).map(row => `<article class="notification-item"><div><strong>${html(row.category)} · ${html(row.status)}</strong><p>${html(row.details)}</p><small>${html(row.id)} · ${html(date(row.updatedAt || row.createdAt))}</small>${row.response ? `<p>${html(row.response)}</p>` : ''}</div></article>`).join('') || '<div class="empty">No correction requests.</div>';
    }

    async function submitCorrection() {
        const payload = { category: document.getElementById('accountCorrectionCategory').value, guildId: document.getElementById('accountCorrectionGuild').value || null, details: document.getElementById('accountCorrectionDetails').value };
        await request('/api/account/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        document.getElementById('accountCorrectionDetails').value = '';
        status('accountCorrectionStatus', 'Correction request submitted.', 'ok');
        await loadData();
    }

    async function deleteData() {
        const confirmed = typeof window.confirmAction === 'function'
            ? await window.confirmAction({ title: 'Permanently delete all your Flummi data?', message: 'This removes your account data and identifiable records from Flummi and signs out every dashboard session. This cannot be undone.', confirmLabel: 'Delete permanently' })
            : window.confirm('Permanently delete all your Flummi data?');
        if (!confirmed) return;
        if (typeof window.requestTextInput !== 'function') throw new Error('The confirmation dialog is unavailable. Reload the page and try again.');
        const typed = await window.requestTextInput({ title: 'Confirm permanent deletion', message: 'Type DELETE to confirm permanent removal.', label: 'Confirmation', confirmLabel: 'Delete data', maxLength: 6, validate: value => value === 'DELETE' ? '' : 'Enter DELETE exactly.' });
        if (typed !== 'DELETE') return status('accountDeletionStatus', 'Deletion cancelled: confirmation did not match.', 'error');
        const result = await request('/api/account/data', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmation: 'DELETE' }) });
        status('accountDeletionStatus', `Deleted ${result.local?.removedFiles || 0} files and scrubbed ${result.local?.rewrittenFiles || 0} shared files.`, 'ok');
        setTimeout(() => { location.href = '/'; }, 1200);
    }

    async function loadSessions() {
        const data = await request('/api/account/sessions');
        document.getElementById('accountSessionsList').innerHTML = (data.sessions || []).map(row => `<article class="notification-item"><div><strong>${row.current ? 'Current session' : 'Signed-in browser'}</strong><p>${html(row.device)}</p><small>Signed in ${html(date(row.authenticatedAt))} · expires ${html(date(row.expiresAt))}</small></div>${row.current ? '<span class="badge ok">Current</span>' : `<button class="danger compact" type="button" data-revoke-session="${html(row.id)}">Revoke</button>`}</article>`).join('') || '<div class="empty">No active sessions.</div>';
    }

    async function revokeSession(id) {
        await request('/api/account/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
        await loadSessions();
    }

    document.getElementById('saveNotificationPreferences')?.addEventListener('click', () => saveNotificationPreferences().catch(error => status('notificationPreferencesStatus', error.message, 'error')));
    document.getElementById('submitAccountCorrection')?.addEventListener('click', () => submitCorrection().catch(error => status('accountCorrectionStatus', error.message, 'error')));
    document.getElementById('deleteAccountData')?.addEventListener('click', () => deleteData().catch(error => status('accountDeletionStatus', error.message, 'error')));
    document.getElementById('logoutOtherSessions')?.addEventListener('click', async () => { await request('/api/account/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'others' }) }); await loadSessions(); });
    document.getElementById('accountSessionsList')?.addEventListener('click', event => { const button = event.target.closest('[data-revoke-session]'); if (button) revokeSession(button.dataset.revokeSession).catch(console.error); });

    window.FlummiAccountFeatures = {
        async load(tab) {
            if (tab === 'notifications') await loadNotificationPreferences();
            if (tab === 'data') await loadData();
            if (tab === 'sessions') await loadSessions();
        }
    };
})();
