const state = {
    authenticated: false,
    privateConnection: false,
    guildId: null,
    guilds: [],
    channels: [],
    guildMembers: new Map(),
    role: 'admin',
    actualRole: 'admin',
    globalFeatures: {},
    management: null,
    publicCommands: [],
    accountUsername: '',
    accountUserId: '',
    guildRoles: new Map(),
    preferences: null,
    settingsRevision: null
};

const guildSelect = document.getElementById('guild');
const tableStates = new WeakMap();

function uiText(source) {
    return window.FlummiI18n?.t(String(source)) || String(source);
}

function uiValue(source) {
    return window.FlummiI18n?.tExact(String(source)) || String(source);
}

function uiLocale() {
    return ({ nl: 'nl-NL', de: 'de-DE' })[window.FlummiI18n?.language] || 'en-GB';
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function backgroundUrlStyle(url) {
    const safeUrl = String(url || '').replace(/'/g, '%27');
    return `background-image: url('${safeUrl}');`;
}


const imageAverageColorCache = new Map();

function rgbToHex(red, green, blue) {
    return `#${[red, green, blue]
        .map(value =>
            Math.max(0, Math.min(255, Math.round(value)))
                .toString(16)
                .padStart(2, '0')
        )
        .join('')}`;
}

async function getImageAverageColor(url) {
    if (!url) return null;

    if (imageAverageColorCache.has(url)) {
        return imageAverageColorCache.get(url);
    }

    const pending = new Promise(resolve => {
        const image = new Image();

        image.crossOrigin = 'anonymous';
        image.decoding = 'async';

        image.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                const size = 24;

                canvas.width = size;
                canvas.height = size;

                const context = canvas.getContext('2d', {
                    willReadFrequently: true
                });

                if (!context) {
                    resolve(null);
                    return;
                }

                context.drawImage(
                    image,
                    0,
                    0,
                    size,
                    size
                );

                const pixels = context.getImageData(
                    0,
                    0,
                    size,
                    size
                ).data;

                let red = 0;
                let green = 0;
                let blue = 0;
                let weightTotal = 0;

                for (
                    let index = 0;
                    index < pixels.length;
                    index += 4
                ) {
                    const alpha =
                        pixels[index + 3] / 255;

                    if (alpha < 0.2) {
                        continue;
                    }

                    const r = pixels[index];
                    const g = pixels[index + 1];
                    const b = pixels[index + 2];

                    const max = Math.max(r, g, b);
                    const min = Math.min(r, g, b);

                    const saturation =
                        max === 0
                            ? 0
                            : (max - min) / max;

                    /*
                     * Slightly favour saturated pixels.
                     * This prevents colourful guild icons from
                     * averaging down into a muddy grey.
                     */
                    const weight =
                        alpha *
                        (0.65 + saturation * 0.75);

                    red += r * weight;
                    green += g * weight;
                    blue += b * weight;

                    weightTotal += weight;
                }

                if (!weightTotal) {
                    resolve(null);
                    return;
                }

                resolve(
                    rgbToHex(
                        red / weightTotal,
                        green / weightTotal,
                        blue / weightTotal
                    )
                );
            } catch {
                resolve(null);
            }
        };

        image.onerror = () => resolve(null);

        image.src = url;
    });

    imageAverageColorCache.set(
        url,
        pending
    );

    return pending;
}

async function applyBannerlessGuildAccent(element, iconUrl) {
    if (!element || !iconUrl) {
        return;
    }

    const color =
        await getImageAverageColor(iconUrl);

    if (!color || !element.isConnected) {
        return;
    }

    element.style.setProperty(
        '--guild-accent',
        color
    );
}

// Wraps a username with a title tooltip showing their current server nickname, when known.
function withNicknameTitle(label, nickname) {
    const safeLabel = escapeHtml(label);

    if (!nickname) {
        return safeLabel;
    }

    return `<span title="${escapeHtml(nickname)}">${safeLabel}</span>`;
}

function getColumnValue(column, row) {
    if (column.sortValue) return column.sortValue(row);
    if (column.key !== undefined) return row[column.key];
    return null;
}

function isColumnSortable(column) {
    return column.sortable !== false && (column.key !== undefined || Boolean(column.sortValue));
}

function renderTable(container, columns, rows, emptyText, defaultSort) {
    let state = tableStates.get(container);

    if (!state) {
        state = { sortIndex: null, sortDir: 1, filter: '' };

        if (defaultSort) {
            state.sortIndex = defaultSort.index;
            state.sortDir = defaultSort.dir || 1;
        }

        tableStates.set(container, state);
    }

    state.columns = columns;
    state.allRows = rows || [];
    state.page = state.page || 0;
    state.emptyText = emptyText;
    paintTable(container);
}

function paintTable(container) {
    const state = tableStates.get(container);
    if (!state) return;

    const { columns, emptyText } = state;
    let rows = state.allRows;

    if (state.filter) {
        const needle = state.filter.toLowerCase();
        rows = rows.filter(row => JSON.stringify(row).toLowerCase().includes(needle));
    }

    if (state.sortIndex !== null && columns[state.sortIndex]) {
        const column = columns[state.sortIndex];
        const dir = state.sortDir;
        rows = rows.slice().sort((a, b) => {
            const va = getColumnValue(column, a);
            const vb = getColumnValue(column, b);

            if (va == null && vb == null) return 0;
            if (va == null) return 1;
            if (vb == null) return -1;
            if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;

            return String(va).localeCompare(String(vb), undefined, { numeric: true }) * dir;
        });
    }

    const pageSize = 25;
    const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
    if (state.page >= pageCount) state.page = pageCount - 1;
    const pageRows = rows.slice(state.page * pageSize, (state.page + 1) * pageSize);
    const showSearch = state.allRows.length > 6;
    const searchBar = showSearch
        ? `<div class="table-toolbar"><input type="text" placeholder="${escapeHtml(uiText('Search...'))}" value="${escapeHtml(state.filter || '')}" data-role="table-search" /></div>`
        : '';

    if (rows.length === 0) {
        container.innerHTML = `${searchBar}<div class="empty">${escapeHtml(uiText(state.filter ? 'No matching rows.' : (emptyText || 'No data yet.')))}</div>`;
    } else {
        const head = columns.map((col, index) => {
            const sortable = isColumnSortable(col);
            const arrow = state.sortIndex === index ? (state.sortDir === 1 ? ' \u25b2' : ' \u25bc') : '';
            return `<th scope="col"${sortable ? ` data-sort-index="${index}" class="sortable"` : ''}>${escapeHtml(uiText(col.label))}${arrow}</th>`;
        }).join('');
        const body = pageRows.map((row, index) => {
            const cells = columns.map(col => `<td>${col.render ? col.render(row, index) : escapeHtml(row[col.key])}</td>`).join('');
            return `<tr>${cells}</tr>`;
        }).join('');

        const pagination = rows.length > pageSize ? `<div class="table-toolbar" style="justify-content:flex-end"><button type="button" data-role="table-prev" class="secondary" ${state.page === 0 ? 'disabled' : ''}>${escapeHtml(uiText('Previous'))}</button><span class="sub">Page ${state.page + 1} / ${pageCount}</span><button type="button" data-role="table-next" class="secondary" ${state.page >= pageCount - 1 ? 'disabled' : ''}>${escapeHtml(uiText('Next'))}</button></div>` : '';
        container.innerHTML = `${searchBar}<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${pagination}`;
    }

    const searchInput = container.querySelector('[data-role="table-search"]');

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            const caretPos = searchInput.selectionStart;
            state.filter = searchInput.value;
            paintTable(container);

            const newInput = container.querySelector('[data-role="table-search"]');
            if (newInput) {
                newInput.focus();
                newInput.setSelectionRange(caretPos, caretPos);
            }
        });
    }

    container.querySelectorAll('th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const index = Number(th.dataset.sortIndex);

            if (state.sortIndex === index) {
                if (state.sortDir === 1) {
                    state.sortDir = -1;
                } else {
                    state.sortIndex = null;
                    state.sortDir = 1;
                }
            } else {
                state.sortIndex = index;
                state.sortDir = 1;
            }

            paintTable(container);
        });
    });
    container.querySelector('[data-role="table-prev"]')?.addEventListener('click', () => { state.page--; paintTable(container); });
    container.querySelector('[data-role="table-next"]')?.addEventListener('click', () => { state.page++; paintTable(container); });
    updateLiveDurations();
}

function statCard(label, value, tooltip = '', helpSymbol = '?') {
    const warningClass = helpSymbol === '!' ? ' global-warning' : '';
    const help = tooltip ? ` <span class="help-tip${warningClass}" tabindex="0" data-tooltip="${escapeHtml(tooltip)}">${escapeHtml(helpSymbol)}</span>` : '';
    return `<div class="stat-card"><div class="label">${escapeHtml(uiText(label))}${help}</div><div class="value">${escapeHtml(uiValue(value))}</div></div>`;
}

function formatAgo(isoString) {
    if (!isoString) {
        return 'Never';
    }

    const then = new Date(isoString).getTime();

    if (Number.isNaN(then)) {
        return 'Never';
    }

    const diffMs = Date.now() - then;

    const relative = new Intl.RelativeTimeFormat(uiLocale(), { numeric: 'auto' });
    if (diffMs < 0) return relative.format(0, 'second');

    const totalSeconds = Math.floor(diffMs / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    if (days > 0) {
        return relative.format(-days, 'day');
    }

    if (hours > 0) {
        return relative.format(-hours, 'hour');
    }

    if (minutes > 0) {
        return relative.format(-minutes, 'minute');
    }

    return relative.format(0, 'second');
}

// Mirrors control-panel.js's formatDuration() so active session durations can tick locally between refreshes.
function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }

    if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    }

    return `${seconds}s`;
}

function formatDateTime(value) {
    if (!value) {
        return 'Never';
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return String(value);
    }

    return date.toLocaleString(uiLocale(), {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

async function api(pathAndQuery, options) {
    const response = await fetch(pathAndQuery, options);
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        const error = new Error(data.error || `Request failed (${response.status}).`);
        error.status = response.status;
        error.code = data.code || null;
        error.data = data;
        throw error;
    }

    return data;
}

const reauthReturnKey = 'flummi.reauthReturn';

function refreshDiscordSignIn() {
    const returnTo = `${window.location.pathname}${window.location.search}`;
    if (returnTo.startsWith('/?')) sessionStorage.setItem(reauthReturnKey, returnTo);
    window.location.assign('/auth/login?refresh=1');
}

function showPageNotice(message, { type = 'error', actionLabel = '', action = null } = {}) {
    const notice = document.getElementById('pageNotice');
    notice.className = `page-notice ${type}`;
    document.getElementById('pageNoticeMessage').textContent = message;
    const button = document.getElementById('pageNoticeAction');
    button.hidden = !actionLabel;
    button.textContent = actionLabel || 'Try again';
    button.onclick = action;
    notice.hidden = false;
}

function clearPageNotice() {
    document.getElementById('pageNotice').hidden = true;
}

function handleUiError(error, retry = null) {
    const signedOut = error?.status === 401;
    const needsReauthentication = error?.code === 'REAUTH_REQUIRED';
    showPageNotice(error?.message || 'Something went wrong. Please try again.', {
        actionLabel: needsReauthentication ? 'Refresh Discord sign-in' : signedOut ? 'Sign in' : (retry ? 'Try again' : ''),
        action: signedOut ? refreshDiscordSignIn : retry
    });
}

function confirmAction({ title = 'Confirm change', message, confirmLabel = 'Confirm', danger = true }) {
    const dialog = document.getElementById('confirmDialog');
    if (!dialog?.showModal) return Promise.resolve(window.confirm(uiText(message)));
    document.getElementById('confirmDialogTitle').textContent = uiText(title);
    document.getElementById('confirmDialogMessage').textContent = uiText(message);
    const accept = document.getElementById('confirmDialogAccept');
    accept.textContent = uiText(confirmLabel);
    accept.className = danger ? 'danger' : 'primary';
    return new Promise(resolve => {
        dialog.returnValue = 'cancel';
        document.getElementById('confirmDialogCancel').onclick = () => dialog.close('cancel');
        accept.onclick = () => dialog.close('confirm');
        dialog.onclose = () => resolve(dialog.returnValue === 'confirm');
        dialog.showModal();
    });
}

function requestTextInput({ title, message, label, value = '', placeholder = '', hint = '', confirmLabel = 'Continue', maxLength = 240, validate = null }) {
    const dialog = document.getElementById('textInputDialog');
    if (!dialog?.showModal) return Promise.resolve(null);
    const form = document.getElementById('textInputDialogForm');
    const input = document.getElementById('textInputDialogValue');
    const error = document.getElementById('textInputDialogError');
    document.getElementById('textInputDialogTitle').textContent = uiText(title);
    document.getElementById('textInputDialogMessage').textContent = uiText(message);
    document.getElementById('textInputDialogLabel').textContent = uiText(label);
    document.getElementById('textInputDialogHint').textContent = uiText(hint);
    document.getElementById('textInputDialogAccept').textContent = uiText(confirmLabel);
    input.value = value;
    input.placeholder = placeholder;
    input.maxLength = maxLength;
    error.textContent = '';

    return new Promise(resolve => {
        dialog.returnValue = 'cancel';
        document.getElementById('textInputDialogCancel').onclick = () => dialog.close('cancel');
        form.onsubmit = event => {
            event.preventDefault();
            const nextValue = input.value.trim();
            const validationMessage = !nextValue ? `${uiText(label)} is required.` : validate?.(nextValue);
            if (validationMessage) {
                error.textContent = validationMessage;
                input.focus();
                return;
            }
            dialog.close('confirm');
        };
        dialog.onclose = () => resolve(dialog.returnValue === 'confirm' ? input.value.trim() : null);
        dialog.showModal();
        requestAnimationFrame(() => {
            input.focus();
            input.select();
        });
    });
}

function withGuild(path) {
    return `${path}${path.includes('?') ? '&' : '?'}guildId=${encodeURIComponent(state.guildId || '')}`;
}

// Tooltips are rendered in one fixed overlay so cards and tables cannot clip them.
const uiTooltip = document.createElement('div');
uiTooltip.className = 'ui-tooltip';
uiTooltip.setAttribute('role', 'tooltip');
document.body.appendChild(uiTooltip);
document.documentElement.classList.add('tooltips-enhanced');
let tooltipAnchor = null;

function floatingBounds() {
    const gap = 12;
    const bounds = { left: gap, top: gap, right: window.innerWidth - gap, bottom: window.innerHeight - gap };
    const navRect = document.querySelector('.sidebar')?.getBoundingClientRect();
    if (!navRect) return bounds;
    if (navRect.height > window.innerHeight * .7 && navRect.right < window.innerWidth * .55) {
        bounds.left = Math.max(bounds.left, navRect.right + 8);
    } else if (navRect.width > window.innerWidth * .8 && navRect.bottom < 140) {
        bounds.top = Math.max(bounds.top, navRect.bottom + 8);
    }
    return bounds;
}

function positionFloatingElement(element, anchorRect) {
    const bounds = floatingBounds();
    const rect = element.getBoundingClientRect();
    const gap = 8;
    const centeredLeft = anchorRect.left + anchorRect.width / 2 - rect.width / 2;
    const left = Math.min(Math.max(centeredLeft, bounds.left), Math.max(bounds.left, bounds.right - rect.width));
    const above = anchorRect.top - rect.height - gap;
    const below = anchorRect.bottom + gap;
    const top = above >= bounds.top ? above : Math.min(below, Math.max(bounds.top, bounds.bottom - rect.height));
    element.style.left = `${Math.round(left)}px`;
    element.style.top = `${Math.round(Math.max(bounds.top, top))}px`;
}

function showHelpTooltip(anchor) {
    const message = anchor?.dataset.tooltip;
    if (!message) return;
    tooltipAnchor = anchor;
    uiTooltip.textContent = message;
    uiTooltip.classList.add('visible');
    positionFloatingElement(uiTooltip, anchor.getBoundingClientRect());
}

function hideHelpTooltip(anchor) {
    if (anchor && tooltipAnchor !== anchor) return;
    tooltipAnchor = null;
    uiTooltip.classList.remove('visible');
}

const tooltipAnchorSelector = '.help-tip[data-tooltip], [data-tailscale-disabled="true"][data-tooltip], .tab-btn[data-global-disabled="true"][data-tooltip]';

document.addEventListener('pointerover', event => {
    const anchor = event.target.closest?.(tooltipAnchorSelector);
    if (anchor) showHelpTooltip(anchor);
});
document.addEventListener('pointerout', event => {
    const anchor = event.target.closest?.(tooltipAnchorSelector);
    const nextAnchor = event.relatedTarget?.closest?.(tooltipAnchorSelector);
    if (nextAnchor) showHelpTooltip(nextAnchor);
    else if (anchor) hideHelpTooltip(anchor);
});
document.addEventListener('focusin', event => {
    const anchor = event.target.closest?.(tooltipAnchorSelector);
    if (anchor) showHelpTooltip(anchor);
});
document.addEventListener('focusout', event => {
    const anchor = event.target.closest?.(tooltipAnchorSelector);
    const nextAnchor = event.relatedTarget?.closest?.(tooltipAnchorSelector);
    if (nextAnchor) showHelpTooltip(nextAnchor);
    else if (anchor) hideHelpTooltip(anchor);
});
window.addEventListener('scroll', () => hideHelpTooltip(), true);

const tailscaleRequirementMessage = 'This feature is only available through the direct Tailscale or localhost panel.';

function applyTailscaleAvailability(root = document) {
    const targets = root.matches?.('[data-tailscale-required]')
        ? [root]
        : Array.from(root.querySelectorAll?.('[data-tailscale-required]') || []);
    for (const target of targets) {
        const unavailable = !state.privateConnection;
        target.dataset.tailscaleDisabled = String(unavailable);
        if (unavailable) {
            target.dataset.tooltip = tailscaleRequirementMessage;
            target.title = tailscaleRequirementMessage;
            target.setAttribute('aria-disabled', 'true');
        } else {
            delete target.dataset.tooltip;
            target.removeAttribute('title');
            target.removeAttribute('aria-disabled');
        }

        const controls = target.matches('button, input, select, textarea')
            ? [target]
            : Array.from(target.querySelectorAll('button, input, select, textarea'));
        for (const control of controls) {
            if (unavailable) {
                if (!control.hasAttribute('data-tailscale-was-disabled')) {
                    control.dataset.tailscaleWasDisabled = String(control.disabled);
                }
                control.disabled = true;
            } else if (control.hasAttribute('data-tailscale-was-disabled')) {
                control.disabled = control.dataset.tailscaleWasDisabled === 'true';
                delete control.dataset.tailscaleWasDisabled;
            }
        }
    }
}

const featureTooltipDefinitions = {
    setBotEnabled: 'Master switch for Flummi in this server. When off, server-specific bot behaviour is paused without removing saved settings.',
    setTriggersEnabled: 'Allows configured text triggers to respond in this server. The global Triggers switch can temporarily override this setting.',
    setCooldownEnabled: 'Prevents trigger actions from being repeated too quickly, reducing spam and accidental rapid responses.',
    setCooldownSeconds: 'Minimum waiting time before another trigger action is allowed.',
    setExactMatch: 'When enabled, a message must exactly match the trigger phrase instead of merely containing it.',
    setMaxTriggerLength: 'Maximum number of characters allowed when someone creates a new trigger phrase.',
    guildFeatureAiConversations: 'Allows members to have AI-powered conversations with Flummi in this server.',
    guildFeatureAiAttachments: 'Allows Flummi to inspect supported attachments as context for AI replies.',
    guildFeatureAiImageSearch: 'Allows AI replies to request and return relevant images from configured search providers.',
    guildFeaturePingResponses: 'Allows Flummi to respond when members mention or ping the bot.',
    guildFeaturePingSave: 'Allows configured ping requests to be saved for later viewing in the panel.',
    featureTriggers: 'Global master switch for text triggers across every server.',
    featureAiConversations: 'Global master switch for AI conversations across every server.',
    featureAiAttachments: 'Global master switch for AI attachment analysis across every server.',
    featureAiImageSearch: 'Global master switch for AI image search across every server.',
    featurePingResponses: 'Global master switch for bot mention and ping responses across every server.',
    featurePingSave: 'Global master switch for saving ping requests across every server.'
};

function installFeatureTooltips() {
    for (const [inputId, explanation] of Object.entries(featureTooltipDefinitions)) {
        const input = document.getElementById(inputId);
        const label = document.querySelector(`label[for="${inputId}"]`);
        if (!input || !label) continue;
        let tip = label.querySelector('[data-feature-help]');
        if (!tip) {
            tip = document.createElement('span');
            tip.className = 'help-tip';
            tip.tabIndex = 0;
            tip.dataset.featureHelp = 'true';
            tip.textContent = '?';
            label.append(' ', tip);
        }
        tip.dataset.tooltip = explanation;
        const surface = input.closest('.checkbox-row');
        if (surface) {
            surface.classList.add('tooltip-surface');
            surface.dataset.baseTooltip = explanation;
        }
    }
}

installFeatureTooltips();

// ---------- Tabs ----------
const tabButtons = Array.from(document.querySelectorAll('.tab-btn'));
const tabPanels = Array.from(document.querySelectorAll('.tab-panel'));
const sidebar = document.querySelector('.sidebar');
const mobileMenuToggle = document.getElementById('mobileMenuToggle');
const mobileMenuBackdrop = document.getElementById('mobileMenuBackdrop');
const mobileMenuMedia = window.matchMedia('(max-width: 820px)');
const defaultPanelTitles = Object.fromEntries(tabPanels.map(panel => {
    const heading = panel.querySelector(':scope > h2');
    const textNode = Array.from(heading?.childNodes || []).find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
    return [panel.id.replace(/^tab-/, ''), textNode?.textContent.trim() || ''];
}));
const tabRefreshTooltips = {
    voice: 'This tab refreshes every 5 seconds while open so live voice sessions and durations stay current.',
    users: 'This tab does not refresh automatically, so your permission edits and selected member are not interrupted. Use Refresh when you want current data.',
    settings: 'This tab does not refresh automatically, so unsaved settings are never overwritten. Use Refresh to reload saved values.',
    management: 'Management modules are saved per server. Enabled modules appear beneath Management in the sidebar.',
    'management-moderation': 'This editor does not refresh automatically, so pending moderation settings are not overwritten.',
    'management-automod': 'This editor does not refresh automatically, so pending AutoMod settings are not overwritten.',
    'management-cases': 'This editor does not refresh automatically, so pending case and logging settings are not overwritten.',
    'management-roles': 'This editor does not refresh automatically, so pending role settings are not overwritten.',
    'management-automation': 'This editor does not refresh automatically, so pending automation settings are not overwritten.',
    messenger: 'This tab does not refresh automatically while you are composing a message. Use Refresh to reload available channels.',
    triggers: 'This tab does not refresh automatically, so trigger drafts and edits are never overwritten. Use Refresh to reload saved triggers.',
    profiles: 'This tab does not refresh automatically, so unsaved profile fields are never overwritten. Use Refresh to reload profile data.',
    ai: 'This tab does not refresh automatically, so AI settings and panel navigation edits are never overwritten. Use Refresh to reload saved values.',
    global: 'This tab does not refresh automatically, so global feature and panel navigation edits are never overwritten. Use Refresh to reload saved values.',
    files: 'This tab never refreshes automatically. Open files are snapshots and are never locked; use Reload snapshot to fetch external changes.',
    experiments: 'This tab does not refresh automatically, so a pending experiment is not overwritten before you apply it.',
    reliability: 'This tab refreshes every 20 seconds while open. Its automatic Discord gateway and API checks update every 30 seconds.',
    logs: 'This tab refreshes every 20 seconds while open. Use Refresh now immediately after reproducing an error.',
    default: 'This tab refreshes every 20 seconds while open. Use Refresh for an immediate update.'
};

for (const panel of tabPanels) {
    const tabId = panel.id.replace(/^tab-/, '');
    const heading = panel.querySelector(':scope > h2');
    if (!heading || heading.querySelector('.help-tip')) continue;
    const tip = document.createElement('span');
    tip.className = 'help-tip';
    tip.tabIndex = 0;
    tip.dataset.refreshTooltip = 'true';
    tip.dataset.tooltip = tabRefreshTooltips[tabId] || tabRefreshTooltips.default;
    tip.textContent = '?';
    heading.append(' ', tip);
}

function setMobileMenu(open) {
    const shouldOpen = Boolean(open) && mobileMenuMedia.matches;
    sidebar.classList.toggle('mobile-menu-open', shouldOpen);
    mobileMenuToggle.setAttribute('aria-expanded', String(shouldOpen));
    mobileMenuBackdrop.classList.toggle('visible', shouldOpen);
}

mobileMenuToggle.addEventListener('click', () => setMobileMenu(!sidebar.classList.contains('mobile-menu-open')));
mobileMenuBackdrop.addEventListener('click', () => setMobileMenu(false));
document.addEventListener('keydown', event => { if (event.key === 'Escape') setMobileMenu(false); });
mobileMenuMedia.addEventListener('change', () => setMobileMenu(false));
function tabButtonLabel(button) {
    const directText = [...button.childNodes]
        .filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    return directText || button.textContent.trim();
}
const defaultTabLabels = Object.fromEntries(tabButtons.map(button => [button.dataset.tab, tabButtonLabel(button)]));
const managementModuleDefinitions = {
    moderation: { tab: 'management-moderation', title: 'Moderation', description: 'Warnings, timeouts, kicks, bans, purge tools, and safe action defaults.' },
    automod: { tab: 'management-automod', title: 'AutoMod & Safety', description: 'Spam protection, rule presets, test mode, escalation, and raid safety.' },
    cases: { tab: 'management-cases', title: 'Cases & Logs', description: 'Searchable moderation cases, event logging, retention, and staff channels.' },
    roles: { tab: 'management-roles', title: 'Roles & Onboarding', description: 'Autoroles, persistent roles, and button or select-menu role assignment.' },
    automation: { tab: 'management-automation', title: 'Automation', description: 'Welcome flows, scheduled messages, cleanup, and reusable server routines.' },
    tickets: { tab: 'management-tickets', title: 'Tickets', description: 'Private support channels with ownership, claiming, closing, and logs.' },
    suggestions: { tab: 'management-suggestions', title: 'Suggestions', description: 'Community ideas with voting and a visible admin decision workflow.' },
    joinSecurity: { tab: 'management-join-security', title: 'Join Security', description: 'New-account checks, join-burst alerts, quarantine, and raid lockdown.' },
    starboard: { tab: 'management-starboard', title: 'Starboard', description: 'Reaction-based highlights with one configurable destination and threshold.' },
    forms: { tab: 'management-forms', title: 'Forms & Appeals', description: 'Structured modal submissions for applications and moderation appeals.' },
    channels: { tab: 'management-channels', title: 'Channel Management', description: 'Locks, slowmode, sticky notices, and temporary voice rooms.' },
    integrations: { tab: 'management-integrations', title: 'Discord Integrations', description: 'Sync native Discord AutoMod rules and create Scheduled Events.' },
    serverDoctor: { tab: 'management-server-doctor', title: 'Server Doctor', description: 'Find permission, hierarchy, channel, and module problems with clear fixes.' },
    incidentCenter: { tab: 'management-incident-center', title: 'Incident Center', description: 'Anti-nuke monitoring, audit attribution, lockdown, evidence, and recovery snapshots.' },
    reports: { tab: 'management-reports', title: 'Reports & Modmail', description: 'Private member reports with a claimable staff inbox and message evidence.' },
    workflows: { tab: 'management-workflows', title: 'Workflow Studio', description: 'Audited server routines with curated recipes and a safe dry-run mode.' },
    staffOperations: { tab: 'management-staff-operations', title: 'Staff Operations', description: 'Case queues, ownership, review deadlines, notes, and sensitive-action approval.' },
    communityHealth: { tab: 'management-community-health', title: 'Community Health', description: 'Privacy-first onboarding, retention, participation, and support-quality insights.' },
    backups: { tab: 'management-backups', title: 'Backup & Recovery', description: 'Versioned role, channel, and permission snapshots for incident recovery.' },
    copilot: { tab: 'management-copilot', title: 'Flummi Copilot', description: 'Staff summaries, translations, and recommendations that always remain human-approved.' },
    engagement: { tab: 'management-engagement', title: 'Engagement & Utilities', description: 'Giveaways, levels, feeds, reminders, embeds, polls, AFK, and temporary or voice-linked roles.' }
};
const managementModuleCategories = {
    moderation: 'Safety', automod: 'Safety', cases: 'Safety', joinSecurity: 'Safety', incidentCenter: 'Safety', serverDoctor: 'Safety',
    roles: 'Members', tickets: 'Members', suggestions: 'Members', forms: 'Members', reports: 'Members', communityHealth: 'Members',
    automation: 'Automation', workflows: 'Automation', integrations: 'Automation', channels: 'Automation', backups: 'Automation',
    starboard: 'Community', engagement: 'Community', staffOperations: 'Staff', copilot: 'Staff'
};

function installManagementModuleExperience() {
    for (const [key, definition] of Object.entries(managementModuleDefinitions)) {
        const panel = document.getElementById(`tab-${definition.tab}`);
        if (!panel || panel.querySelector('[data-module-guide-toggle]')) continue;
        const intro = panel.querySelector(':scope > .tab-intro');
        const sections = [...panel.querySelectorAll(':scope > .section:not(.module-page-switch)')];
        const sectionDetails = sections.map((section, index) => {
            const heading = section.querySelector(':scope > h2, :scope > .section-title-row h2');
            if (!heading) return null;
            const id = `${definition.tab}-section-${index + 1}`;
            section.id ||= id;
            section.classList.add('module-content-section');
            if (section.querySelector('input, select, textarea, button:not([disabled])') && !sections.slice(0, index).some(item => item.querySelector('input, select, textarea, button:not([disabled])'))) {
                section.classList.add('module-primary-section');
            }
            const description = section.querySelector('.sub')?.textContent.trim() || '';
            return { id: section.id, title: heading.textContent.trim(), description };
        }).filter(Boolean);
        const guideId = `${definition.tab}-guide`;
        const toolbar = document.createElement('div');
        toolbar.className = 'module-page-toolbar';
        toolbar.innerHTML = `<span class="module-runtime-state" data-module-runtime-state="${escapeHtml(key)}"></span><div class="module-toolbar-actions"><button class="secondary compact" type="button" data-module-test="${escapeHtml(key)}" title="Checks saved resources and required Discord permissions.">Test configuration</button><button class="secondary compact" type="button" data-copy-module-link="${escapeHtml(key)}">Copy link</button><button class="secondary module-guide-button" type="button" data-module-guide-toggle="${escapeHtml(key)}" aria-expanded="false" aria-controls="${escapeHtml(guideId)}">ⓘ ${escapeHtml(uiText('How this module works'))}</button></div>`;
        intro?.after(toolbar);

        const guide = document.createElement('section');
        guide.id = guideId;
        guide.className = 'module-guide';
        guide.hidden = true;
        guide.innerHTML = `<div class="module-guide-heading"><div><span class="module-guide-eyebrow">${escapeHtml(uiText('Module guide'))}</span><h2>${escapeHtml(definition.title)}: ${escapeHtml(uiText('Detailed explanation'))}</h2></div><button class="module-guide-close" type="button" data-module-guide-close="${escapeHtml(key)}" aria-label="${escapeHtml(uiText('Close module guide'))}">×</button></div>
            <p class="module-guide-summary">${escapeHtml(definition.description)}</p>
            <div class="module-guide-grid">
                <div><h3>${escapeHtml(uiText('Recommended setup'))}</h3><ol><li>${escapeHtml(uiText('Turn the module on so its saved configuration can run.'))}</li><li>${escapeHtml(uiText('Work through the setup sections from top to bottom.'))}</li><li>${escapeHtml(uiText('Save each section before testing the result in Discord.'))}</li></ol></div>
                <div><h3>${escapeHtml(uiText('What to expect'))}</h3><ul><li>${escapeHtml(uiText('Settings apply only to the selected server.'))}</li><li>${escapeHtml(uiText('Turning the module off pauses it without deleting its settings.'))}</li><li>${escapeHtml(uiText('Discord permissions and role hierarchy can still limit actions.'))}</li></ul></div>
            </div>
            <div class="module-onboarding" data-module-onboarding="${escapeHtml(key)}"><div class="empty">Checking setup progress…</div></div>
            ${sectionDetails.length ? `<div class="module-guide-sections"><h3>${escapeHtml(uiText('On this page'))}</h3><div>${sectionDetails.map(section => `<button type="button" class="module-guide-link" data-module-section-target="${escapeHtml(section.id)}"><strong>${escapeHtml(section.title)}</strong>${section.description ? `<span>${escapeHtml(section.description)}</span>` : ''}</button>`).join('')}</div></div>` : ''}`;
        toolbar.after(guide);
    }

    document.addEventListener('click', event => {
        const toggle = event.target.closest('[data-module-guide-toggle]');
        const close = event.target.closest('[data-module-guide-close]');
        const sectionLink = event.target.closest('[data-module-section-target]');
        const testButton = event.target.closest('[data-module-test]');
        const copyButton = event.target.closest('[data-copy-module-link]');
        if (toggle || close) {
            const key = (toggle || close).dataset.moduleGuideToggle || (toggle || close).dataset.moduleGuideClose;
            const definition = managementModuleDefinitions[key];
            const guide = document.getElementById(`${definition.tab}-guide`);
            const trigger = document.querySelector(`[data-module-guide-toggle="${key}"]`);
            const open = toggle ? guide.hidden : false;
            guide.hidden = !open;
            trigger.setAttribute('aria-expanded', String(open));
            if (open) guide.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        if (sectionLink) {
            const target = document.getElementById(sectionLink.dataset.moduleSectionTarget);
            const url = new URL(window.location.href); url.hash = target?.id || ''; history.replaceState(null, '', url);
            target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            target?.classList.add('module-section-highlight');
            window.setTimeout(() => target?.classList.remove('module-section-highlight'), 1400);
        }
        if (copyButton) {
            const definition = managementModuleDefinitions[copyButton.dataset.copyModuleLink];
            const url = new URL(window.location.href); url.searchParams.set('guildId', state.guildId); url.searchParams.set('tab', definition.tab); url.hash = '';
            navigator.clipboard.writeText(url.toString()).then(() => { copyButton.textContent = 'Link copied'; window.setTimeout(() => { copyButton.textContent = 'Copy link'; }, 1400); }).catch(handleUiError);
        }
        if (testButton) {
            const original = testButton.textContent; testButton.disabled = true; testButton.textContent = 'Testing…';
            api(withGuild('/api/management/test'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ module: testButton.dataset.moduleTest }) }).then(result => {
                localStorage.setItem(`flummi.module-tested.${state.guildId}.${testButton.dataset.moduleTest}`, result.checkedAt || new Date().toISOString());
                refreshModuleOnboarding().catch(() => {});
                const problems = result.checks || [];
                testButton.textContent = problems.length ? `${problems.length} issue${problems.length === 1 ? '' : 's'} found` : 'Configuration ready';
                testButton.title = problems.length ? problems.map(check => `${check.title}: ${check.detail}`).join('\n') : 'Saved resources and required Discord permissions are available.';
                const toolbar = testButton.closest('.module-page-toolbar');
                let output = toolbar.parentElement.querySelector(':scope > .module-test-result');
                if (!output) { output = document.createElement('section'); output.className = 'module-test-result'; toolbar.after(output); }
                output.innerHTML = `<div class="section-title-row"><div><strong>Safe test result</strong><p class="sub">No Discord action was executed.</p></div><span class="badge ${result.ok ? 'ok' : 'warn'}">${result.ok ? 'Ready' : 'Needs attention'}</span></div><ol>${(result.simulation?.steps || []).map(step => `<li>${escapeHtml(step.summary)}</li>`).join('')}</ol><p>${escapeHtml(result.simulation?.outcome || '')}</p>${problems.length ? `<details><summary>${problems.length} configuration check${problems.length === 1 ? '' : 's'}</summary>${problems.map(check => `<p><strong>${escapeHtml(check.title)}</strong><br>${escapeHtml(check.detail)}</p>`).join('')}</details>` : ''}`;
            }).catch(error => { testButton.textContent = 'Test failed'; testButton.title = error.message; }).finally(() => { testButton.disabled = false; window.setTimeout(() => { testButton.textContent = original; }, 3500); });
        }
    });
}

installManagementModuleExperience();

let latestManagementValidation = null;

function renderModuleOnboarding(moduleKey, validation = latestManagementValidation) {
    const container = document.querySelector(`[data-module-onboarding="${moduleKey}"]`);
    if (!container || !state.management) return;
    const moduleIssues = [...(validation?.errors || []), ...(validation?.warnings || [])].filter(item => item.module === moduleKey || item.field?.startsWith(`${moduleKey}.`));
    const enabled = state.management.modules?.[moduleKey] === true;
    const saved = JSON.stringify(state.management?.[moduleKey]) === JSON.stringify(savedManagementSnapshot?.[moduleKey]) && state.management.modules?.[moduleKey] === savedManagementSnapshot?.modules?.[moduleKey];
    const testedAt = localStorage.getItem(`flummi.module-tested.${state.guildId}.${moduleKey}`);
    const steps = [
        { done: enabled, label: 'Enable the module', detail: enabled ? 'The module can run.' : 'Turn it on when the setup is ready.' },
        { done: moduleIssues.length === 0, label: 'Complete configuration', detail: moduleIssues[0]?.message || 'Required resources are available.' },
        { done: saved, label: 'Save the configuration', detail: saved ? 'The dashboard and saved version match.' : 'There are unsaved module changes.' },
        { done: Boolean(testedAt), label: 'Run a safe test', detail: testedAt ? `Last tested ${formatDateTime(testedAt)}.` : 'Preview what Flummi would do without sending anything.' }
    ];
    container.innerHTML = `<div class="section-title-row"><div><h3>Setup checklist</h3><p class="sub">${steps.filter(step => step.done).length} of ${steps.length} complete</p></div><span class="badge ${steps.every(step => step.done) ? 'ok' : 'warn'}">${steps.every(step => step.done) ? 'Ready' : 'In progress'}</span></div><div class="module-onboarding-steps">${steps.map(step => `<article class="${step.done ? 'done' : ''}"><span aria-hidden="true">${step.done ? '✓' : ''}</span><div><strong>${escapeHtml(step.label)}</strong><small>${escapeHtml(step.detail)}</small></div></article>`).join('')}</div>`;
}

async function refreshModuleOnboarding() {
    if (!state.guildId || !state.management || state.role === 'member') return;
    latestManagementValidation = await api(withGuild('/api/management/validate'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ management: state.management }) });
    Object.keys(managementModuleDefinitions).forEach(key => renderModuleOnboarding(key));
}

const actionPermissionExplanations = {
    managementRunAction: 'Requires the matching Discord permission (for example Moderate Members, Kick Members, Ban Members or Manage Messages) and a role below Flummi.',
    managementPublishRoles: 'Requires Manage Roles and Manage Messages. Flummi must be above every role in this menu.',
    publishWebhook: 'Requires Manage Webhooks, View Channel and Send Messages in the selected channel.',
    createServerSnapshot: 'Reading a snapshot requires View Channels; restoring one also requires Manage Roles and Manage Channels.'
};
for (const [id, explanation] of Object.entries(actionPermissionExplanations)) {
    const button = document.getElementById(id); if (!button) continue;
    button.dataset.permissionExplanation = explanation;
    button.title = explanation;
    const actions = button.closest('.actions');
    if (actions) { button.setAttribute('aria-describedby', `${id}-permission`); const note = document.createElement('small'); note.id = `${id}-permission`; note.className = 'permission-explanation'; note.textContent = explanation; actions.after(note); }
}

const moduleCommandHints = {
    tickets: ['/ticket open', '/ticket claim', '/ticket close'], suggestions: ['/suggest submit', '/suggest review'],
    forms: ['/form apply', '/form appeal'], channels: ['/channel lock', '/channel slowmode', '/channel temporary-voice'],
    integrations: ['/integration status', '/integration sync-automod', '/integration create-event'], reports: ['/community report'], starboard: ['/starboard status'],
    copilot: ['/server copilot'], engagement: ['/server poll', '/server giveaway', '/server feed', '/server temporary-role']
};

function installModuleCommandHints() {
    for (const [key, commands] of Object.entries(moduleCommandHints)) {
        const definition = managementModuleDefinitions[key];
        const panel = document.getElementById(`tab-${definition.tab}`);
        if (!panel || panel.querySelector('[data-module-command-hint]')) continue;
        const callout = document.createElement('div');
        callout.className = 'module-command-hint';
        callout.dataset.moduleCommandHint = key;
        callout.innerHTML = `<div><strong>Use it in Discord</strong><span>Configuration lives here; day-to-day actions use these guided commands.</span></div><div class="command-chip-list">${commands.map(command => `<code>${escapeHtml(command)}</code>`).join('')}</div>`;
        panel.querySelector('.module-readiness, .module-page-toolbar')?.after(callout);
    }
}

function installEngagementGroups() {
    const section = document.getElementById('advancedEngagementGiveaways')?.closest('.section');
    const originalGrid = section?.querySelector(':scope > .two-col');
    if (!originalGrid || section.querySelector('.engagement-feature-groups')) return;
    const groups = [
        ['Community events', ['advancedEngagementGiveaways', 'advancedEngagementPolls']],
        ['Progression', ['advancedEngagementLevels']],
        ['Content tools', ['advancedEngagementFeeds', 'advancedEngagementEmbeds']],
        ['Member utilities', ['advancedEngagementReminders', 'advancedEngagementAfk']],
        ['Role utilities', ['advancedEngagementTempRoles', 'advancedEngagementVoiceRoles']]
    ];
    const container = document.createElement('div');
    container.className = 'engagement-feature-groups';
    for (const [title, ids] of groups) {
        const group = document.createElement('fieldset');
        group.className = 'engagement-feature-group';
        group.innerHTML = `<legend>${escapeHtml(title)}</legend>`;
        for (const id of ids) {
            const row = document.getElementById(id)?.closest('.checkbox-row');
            if (row) group.append(row);
        }
        container.append(group);
    }
    originalGrid.replaceWith(container);
}

const structuredBuilderConfigs = {
    customCommandButtons: { label: 'command button', fields: [{ key: 'label', label: 'Button label' }, { key: 'url', label: 'Destination URL', type: 'url' }] },
    webhookFields: { label: 'embed field', fields: [{ key: 'name', label: 'Field name' }, { key: 'value', label: 'Field value', multiline: true }, { key: 'inline', label: 'Show inline', type: 'checkbox' }] },
    webhookButtons: { label: 'link button', fields: [{ key: 'label', label: 'Button label' }, { key: 'url', label: 'Destination URL', type: 'url' }] }
};

function readJsonArray(source) {
    try { const value = JSON.parse(source.value || '[]'); return Array.isArray(value) ? value : []; }
    catch { return []; }
}

function renderStructuredBuilder(sourceId) {
    const source = document.getElementById(sourceId);
    const config = structuredBuilderConfigs[sourceId];
    if (!source || !config) return;
    source.hidden = true;
    const label = source.closest('.field')?.querySelector('label');
    if (label) label.textContent = `${config.label.charAt(0).toUpperCase()}${config.label.slice(1)}s`;
    let builder = document.querySelector(`[data-structured-builder="${sourceId}"]`);
    if (!builder) {
        builder = document.createElement('div');
        builder.className = 'structured-builder';
        builder.dataset.structuredBuilder = sourceId;
        source.after(builder);
    }
    const values = readJsonArray(source);
    builder.innerHTML = `<div class="structured-builder-list">${values.map((item, index) => `<div class="structured-builder-row" data-builder-row="${index}"><div class="structured-builder-fields">${config.fields.map(field => field.type === 'checkbox' ? `<label class="checkbox-row"><input data-builder-field="${field.key}" type="checkbox" ${item[field.key] ? 'checked' : ''}><span>${field.label}</span></label>` : `<div class="field"><label>${field.label}</label>${field.multiline ? `<textarea data-builder-field="${field.key}" rows="2">${escapeHtml(item[field.key] || '')}</textarea>` : `<input data-builder-field="${field.key}" type="${field.type || 'text'}" value="${escapeHtml(item[field.key] || '')}">`}</div>`).join('')}</div><button class="danger compact" type="button" data-builder-remove="${index}" aria-label="Remove ${config.label}">Remove</button></div>`).join('')}</div><button class="secondary" type="button" data-builder-add>Add ${config.label}</button>`;
}

function syncStructuredBuilder(builder) {
    const source = document.getElementById(builder.dataset.structuredBuilder);
    const rows = [...builder.querySelectorAll('[data-builder-row]')].map(row => Object.fromEntries([...row.querySelectorAll('[data-builder-field]')].map(field => [field.dataset.builderField, field.type === 'checkbox' ? field.checked : field.value.trim()])));
    source.value = JSON.stringify(rows.filter(row => Object.values(row).some(Boolean)), null, 2);
    source.dispatchEvent(new Event('input', { bubbles: true }));
}

for (const sourceId of Object.keys(structuredBuilderConfigs)) renderStructuredBuilder(sourceId);
document.addEventListener('input', event => {
    const builder = event.target.closest('[data-structured-builder]');
    if (builder) syncStructuredBuilder(builder);
});
document.addEventListener('click', event => {
    const builder = event.target.closest('[data-structured-builder]');
    if (!builder) return;
    const remove = event.target.closest('[data-builder-remove]');
    const add = event.target.closest('[data-builder-add]');
    if (remove) {
        const values = readJsonArray(document.getElementById(builder.dataset.structuredBuilder));
        values.splice(Number(remove.dataset.builderRemove), 1);
        document.getElementById(builder.dataset.structuredBuilder).value = JSON.stringify(values);
        renderStructuredBuilder(builder.dataset.structuredBuilder);
        markManagementDirty(builder.closest('.tab-panel'), builder);
    }
    if (add) {
        const values = readJsonArray(document.getElementById(builder.dataset.structuredBuilder));
        values.push({});
        document.getElementById(builder.dataset.structuredBuilder).value = JSON.stringify(values);
        renderStructuredBuilder(builder.dataset.structuredBuilder);
        markManagementDirty(builder.closest('.tab-panel'), builder);
    }
});

const moduleReadinessRequirements = {
    automod: [['managementAutomodLogChannel', 'Choose a log channel']],
    cases: [['managementCaseLogChannel', 'Choose a case log channel']],
    roles: [['managementOnboardingChannel', 'Choose a role-menu channel'], ['managementSelfRoles', 'Choose at least one self-assignable role']],
    automation: [], tickets: [['managementTicketCategory', 'Choose a ticket category'], ['managementTicketSupportRole', 'Choose a support role']],
    suggestions: [['managementSuggestionChannel', 'Choose a suggestions channel']], joinSecurity: [['managementSecurityLog', 'Choose a security alerts channel']],
    starboard: [['managementStarboardChannel', 'Choose a Starboard channel']], forms: [['managementFormsChannel', 'Choose a submission channel'], ['managementFormsReview', 'Choose a private review channel']],
    channels: [['managementChannelsLog', 'Choose an action log channel']], integrations: [], serverDoctor: [], incidentCenter: [['advancedIncidentLog', 'Choose an incident channel']],
    reports: [['advancedReportsChannel', 'Choose a private staff channel']], workflows: [], staffOperations: [], communityHealth: [], backups: [], copilot: [], engagement: []
};
const moduleDependencies = { staffOperations: ['cases'], copilot: ['tickets', 'reports'], workflows: ['automation'], communityHealth: ['serverDoctor'] };

function enhanceDashboardEmptyState(element) {
    if (!element || element.dataset.contextualEmpty === 'true' || !element.closest('#dashboardLayout')) return;
    const message = element.textContent.trim();
    if (!message || /loading|checking|select a server|unavailable/i.test(message)) return;
    element.dataset.contextualEmpty = 'true';
    element.classList.add('contextual-empty');
    const positive = /no problems|no missing permissions/i.test(message);
    if (positive) element.classList.add('empty-positive');
    const panel = element.closest('.tab-panel');
    const managementPanel = panel?.id.startsWith('tab-management-');
    let description = positive
        ? 'Everything is configured correctly right now.'
        : managementPanel
            ? 'Configure this module or wait for new activity to appear.'
            : 'Refresh to check for new data.';
    let action = positive ? null : managementPanel ? 'configure' : 'refresh';
    let actionLabel = managementPanel ? 'Configure module' : 'Refresh data';
    if (/no matching/i.test(message)) {
        description = 'Try a different search or clear the current filter.';
        action = 'clear-search';
        actionLabel = 'Clear search';
    } else if (element.closest('#serverSnapshotsTable')) {
        description = 'Create a recovery point before making major server changes.';
        action = 'create-snapshot';
        actionLabel = 'Create snapshot';
    } else if (/no (messages|voice|activity|plays|usage|sessions)/i.test(message)) {
        description = 'This section will fill automatically when members start using the related feature.';
    }
    element.innerHTML = `<span class="contextual-empty-icon" aria-hidden="true"></span><strong>${escapeHtml(message)}</strong><span>${escapeHtml(uiText(description))}</span>${action ? `<button class="secondary" type="button" data-empty-action="${action}">${escapeHtml(uiText(actionLabel))}</button>` : ''}`;
}

function enhanceDashboardEmptyStates(root = document.getElementById('dashboardLayout')) {
    if (!root) return;
    if (root.matches?.('.empty')) enhanceDashboardEmptyState(root);
    root.querySelectorAll?.('.empty').forEach(enhanceDashboardEmptyState);
}

const dashboardEmptyObserver = new MutationObserver(records => {
    for (const record of records) {
        for (const node of record.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) enhanceDashboardEmptyStates(node);
        }
    }
});
dashboardEmptyObserver.observe(document.getElementById('dashboardLayout'), { childList: true, subtree: true });
enhanceDashboardEmptyStates();

document.getElementById('dashboardLayout').addEventListener('click', event => {
    const button = event.target.closest('[data-empty-action]');
    if (!button) return;
    const empty = button.closest('.contextual-empty');
    if (button.dataset.emptyAction === 'clear-search') {
        const search = empty.closest('.table-wrap')?.querySelector('[data-role="table-search"]');
        if (search) { search.value = ''; search.dispatchEvent(new Event('input', { bubbles: true })); }
        return;
    }
    if (button.dataset.emptyAction === 'create-snapshot') {
        document.getElementById('createServerSnapshot')?.click();
        return;
    }
    if (button.dataset.emptyAction === 'configure') {
        const panel = empty.closest('.tab-panel');
        const target = panel?.querySelector('.module-primary-section, .section');
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        target?.querySelector('input, select, textarea, button')?.focus({ preventScroll: true });
        return;
    }
    refreshActiveTab().catch(handleUiError);
});

function updateModuleReadiness(key) {
    const definition = managementModuleDefinitions[key];
    const panel = document.getElementById(`tab-${definition?.tab}`);
    const box = panel?.querySelector('[data-module-readiness]');
    if (!box) return;
    const requirements = [...(moduleReadinessRequirements[key] || [])];
    if (key === 'automation') {
        if (document.getElementById('managementWelcomeEnabled')?.checked) requirements.push(['managementWelcomeChannel', 'Choose a welcome channel']);
        if (document.getElementById('managementGoodbyeEnabled')?.checked) requirements.push(['managementGoodbyeChannel', 'Choose a goodbye channel']);
    }
    if (key === 'joinSecurity' && document.getElementById('managementSecurityAction')?.value === 'quarantine') requirements.push(['managementSecurityRole', 'Choose a quarantine role']);
    const missing = requirements.filter(([id]) => {
        const field = document.getElementById(id);
        return !field || (field.multiple ? field.selectedOptions.length === 0 : !field.value);
    });
    const missingDependencies = (moduleDependencies[key] || []).filter(dependency => state.management?.modules?.[dependency] !== true);
    const enabled = state.management?.modules?.[key] === true;
    box.dataset.ready = String(enabled && missing.length === 0);
    box.innerHTML = missing.length || missingDependencies.length
        ? `<strong>Setup incomplete</strong><span>${[...missing.map(([, message]) => message), ...missingDependencies.map(dependency => `${managementModuleDefinitions[dependency]?.title || dependency} must be enabled first`)].map(escapeHtml).join(' · ')}</span>${missing.length ? `<button type="button" class="secondary" data-readiness-target="${escapeHtml(missing[0][0])}">Fix now</button>` : `<button type="button" class="secondary" data-open-module="${escapeHtml(missingDependencies[0])}">Open dependency</button>`}`
        : `<strong>${enabled ? 'Ready and running' : 'Ready to enable'}</strong><span>${enabled ? 'Required settings are present.' : 'Your configuration is ready; turn the module on when you want it to run.'}</span>`;
}

function installModuleReadiness() {
    for (const [key, definition] of Object.entries(managementModuleDefinitions)) {
        const panel = document.getElementById(`tab-${definition.tab}`);
        const toolbar = panel?.querySelector('.module-page-toolbar');
        if (!toolbar || panel.querySelector('[data-module-readiness]')) continue;
        const box = document.createElement('div');
        box.className = 'module-readiness';
        box.dataset.moduleReadiness = key;
        toolbar.after(box);
        updateModuleReadiness(key);
    }
}

installModuleReadiness();
installModuleCommandHints();
installEngagementGroups();
document.addEventListener('change', event => {
    const panel = event.target.closest('[id^="tab-management-"]');
    const definition = Object.entries(managementModuleDefinitions).find(([, item]) => `tab-${item.tab}` === panel?.id);
    if (definition) updateModuleReadiness(definition[0]);
});
document.addEventListener('click', event => {
    const target = event.target.closest('[data-readiness-target]');
    if (!target) return;
    const field = document.getElementById(target.dataset.readinessTarget);
    field?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    field?.focus();
});

const managementSaveBar = document.createElement('div');
managementSaveBar.className = 'management-save-bar';
managementSaveBar.hidden = true;
managementSaveBar.innerHTML = '<span><strong>Unsaved changes</strong><small>Save or discard before leaving this module.</small></span><button type="button" class="secondary" data-discard-management>Discard</button><button type="button" class="primary" data-save-management-bar>Save changes</button>';
document.getElementById('dashboardLayout').append(managementSaveBar);
document.querySelectorAll('#dashboardLayout [id^="tab-management-"] [data-save-management], #dashboardLayout [id^="tab-management-"] [data-save-advanced]').forEach(button => {
    const actionRow = button.closest('.actions');
    if (actionRow && actionRow.querySelectorAll('button').length === 1) button.classList.add('module-inline-save-replaced');
});
let dirtyManagementPanel = null;
let dirtyManagementSaveButton = null;
let savedManagementSnapshot = null;

function flattenManagementValues(value, prefix = '', output = {}) {
    if (Array.isArray(value)) { output[prefix] = JSON.stringify(value); return output; }
    if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) flattenManagementValues(child, prefix ? `${prefix}.${key}` : key, output);
        return output;
    }
    output[prefix] = value;
    return output;
}

function managementChangePreview() {
    const before = flattenManagementValues(savedManagementSnapshot || {});
    const after = flattenManagementValues(state.management || {});
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
        .filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
        .map(key => ({ key, before: before[key], after: after[key] }));
}

function managementSaveTarget(panel, source) {
    if (!panel || !source) return null;
    const advancedField = source.matches?.('[data-advanced-field]') ? source : source.querySelector?.('[data-advanced-field]');
    if (advancedField) {
        const section = advancedField.dataset.advancedField?.split('.')[0];
        return panel.querySelector(`[data-save-advanced="${section}"]`);
    }
    if (source.closest?.('#workflowVisualBuilder')) return panel.querySelector('[data-save-advanced="workflows"]');
    return source.closest?.('.section')?.querySelector('[data-save-management], [data-save-advanced]') || null;
}

function markManagementDirty(panel, source) {
    if (!panel?.id.startsWith('tab-management-') || panel.id === 'tab-management') return;
    const target = managementSaveTarget(panel, source);
    if (!target) return;
    dirtyManagementPanel = panel;
    dirtyManagementSaveButton = target;
    managementSaveBar.hidden = false;
}

function clearManagementDirty() {
    dirtyManagementPanel = null;
    dirtyManagementSaveButton = null;
    managementSaveBar.hidden = true;
}

document.addEventListener('input', event => markManagementDirty(event.target.closest('.tab-panel'), event.target));
document.addEventListener('change', event => markManagementDirty(event.target.closest('.tab-panel'), event.target));
managementSaveBar.querySelector('[data-save-management-bar]').addEventListener('click', async () => {
    if (!dirtyManagementSaveButton) return;
    try {
        if (dirtyManagementSaveButton.dataset.saveManagement) collectManagementSection(dirtyManagementSaveButton.dataset.saveManagement);
        if (dirtyManagementSaveButton.dataset.saveAdvanced) collectAdvancedManagement(dirtyManagementSaveButton.dataset.saveAdvanced);
        const changes = managementChangePreview();
        if (!changes.length) { clearManagementDirty(); return; }
        const summary = changes.slice(0, 8).map(change => `${change.key.split('.').at(-1).replace(/([A-Z])/g, ' $1').replace(/^./, value => value.toUpperCase())}: ${String(change.before ?? 'empty')} → ${String(change.after ?? 'empty')}`).join('\n');
        const confirmed = await confirmAction({ title: `Save ${changes.length} setting change${changes.length === 1 ? '' : 's'}?`, message: `${summary}${changes.length > 8 ? `\n…and ${changes.length - 8} more.` : ''}`, confirmLabel: 'Save changes', danger: false });
        if (confirmed) dirtyManagementSaveButton.click();
    } catch (error) { handleUiError(error); }
});
managementSaveBar.querySelector('[data-discard-management]').addEventListener('click', () => { clearManagementDirty(); refreshActiveTab().catch(handleUiError); });
const automodRuleDefinitions = {
    badWords: { title: 'Bad words', description: 'Block configured words and phrases.', limit: 'Matches allowed', fixedLimit: true },
    serverInvites: { title: 'Discord invites', description: 'Stop unauthorized server invitation links.', limit: 'Invites per message' },
    externalLinks: { title: 'External links', description: 'Stop links outside the allowed-domain list.', limit: 'Links per message' },
    messageSpam: { title: 'Fast message spam', description: 'Limit how many messages a member can send in a window.', limit: 'Messages', window: true },
    duplicateSpam: { title: 'Repeated messages', description: 'Detect repeated identical messages.', limit: 'Repeated messages', window: true },
    mentionSpam: { title: 'Mention spam', description: 'Limit combined user and role mentions.', limit: 'Mentions per message' },
    capsSpam: { title: 'Excessive capitals', description: 'Detect messages mostly written in capitals.', limit: 'Capital letters (%)', min: 50 },
    emojiSpam: { title: 'Emoji spam', description: 'Limit Unicode and custom Discord emoji.', limit: 'Emoji per message' },
    zalgoSpam: { title: 'Zalgo text', description: 'Detect excessive combining characters.', limit: 'Combining marks' }
};
const automodPresetLimits = {
    relaxed: { serverInvites: 3, externalLinks: 3, messageSpam: 8, duplicateSpam: 4, mentionSpam: 8, capsSpam: 90, emojiSpam: 16, zalgoSpam: 18 },
    balanced: { serverInvites: 2, externalLinks: 2, messageSpam: 6, duplicateSpam: 3, mentionSpam: 6, capsSpam: 80, emojiSpam: 12, zalgoSpam: 12 },
    strict: { serverInvites: 1, externalLinks: 1, messageSpam: 5, duplicateSpam: 2, mentionSpam: 4, capsSpam: 70, emojiSpam: 8, zalgoSpam: 8 }
};
const managementChildTabIds = new Set(Object.values(managementModuleDefinitions).map(definition => definition.tab));
const analyticsChildTabIds = new Set(['stats', 'voice', 'soundboard']);
const nestedTabGroups = [
    { parent: 'analytics', label: 'Analytics', children: analyticsChildTabIds, elementId: 'analyticsNavGroup', subnavId: 'analyticsSubnav' },
    { parent: 'management', label: 'Management', children: managementChildTabIds, elementId: 'managementNavGroup', subnavId: 'managementSubnav' }
];
const nestedChildTabIds = new Set(nestedTabGroups.flatMap(group => [...group.children]));
const tabLoaders = {
    overview: loadOverview,
    analytics: loadAnalytics,
    mail: loadMailCollection,
    messenger: loadMessengerChannels,
    triggers: loadTriggers,
    voice: loadVoice,
    stats: loadStats,
    users: loadUsers,
    management: loadManagement,
    'management-moderation': loadAdvancedManagement,
    'management-automod': loadManagement,
    'management-cases': async () => { await loadAdvancedManagement(); await loadManagementTimeline(); },
    'management-roles': loadManagement,
    'management-automation': loadManagement,
    'management-tickets': loadAdvancedManagement,
    'management-suggestions': loadAdvancedManagement,
    'management-join-security': loadAdvancedManagement,
    'management-starboard': loadManagement,
    'management-forms': loadManagement,
    'management-channels': loadManagement,
    'management-integrations': loadManagement,
    'management-server-doctor': loadAdvancedManagement,
    'management-incident-center': loadAdvancedManagement,
    'management-reports': loadAdvancedManagement,
    'management-workflows': loadAdvancedManagement,
    'management-staff-operations': loadAdvancedManagement,
    'management-community-health': loadAdvancedManagement,
    'management-backups': loadAdvancedManagement,
    'management-copilot': loadAdvancedManagement,
    'management-engagement': loadAdvancedManagement,
    profiles: loadProfilesTab,
    settings: loadSettings,
    pings: loadPingRequests,
    ai: loadAi,
    global: loadGlobalSettings,
    logs: loadLogs,
    reliability: loadReliability,
    adoption: loadDeveloperStats,
    files: loadDeveloperFiles,
    soundboard: loadSoundboard,
    audit: loadAudit,
    experiments: loadExperiments
};

document.getElementById('analyticsNavToggle').addEventListener('click', event => {
    event.stopPropagation();
    setAnalyticsExpanded(event.currentTarget.getAttribute('aria-expanded') !== 'true');
});
document.getElementById('managementNavToggle').addEventListener('click', event => {
    event.stopPropagation();
    setManagementExpanded(event.currentTarget.getAttribute('aria-expanded') !== 'true');
});

tabButtons.forEach(btn => {
    btn.addEventListener('click', async () => {
        if (dirtyManagementPanel && !dirtyManagementPanel.classList.contains('active')) clearManagementDirty();
        if (dirtyManagementPanel && btn.dataset.tab !== dirtyManagementPanel.id.replace(/^tab-/, '')) {
            const leave = await confirmAction({ title: 'Discard unsaved changes?', message: 'This module has changes that have not been saved yet.', confirmLabel: 'Discard and leave' });
            if (!leave) return;
            clearManagementDirty();
            await refreshActiveTab().catch(handleUiError);
        }
        if (btn.dataset.managementModule) {
            setManagementExpanded(true);
        } else if (btn.hasAttribute('data-analytics-child')) {
            setAnalyticsExpanded(true);
        }
        setMobileMenu(false);
        tabButtons.forEach(b => b.classList.remove('active'));
        tabPanels.forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
        updateMobileSaveDock();
        const developerTool = fixedDeveloperTabIds.has(btn.dataset.tab);
        localStorage.setItem(developerTool ? 'flummi.developerTab' : 'flummi.activeTab', btn.dataset.tab);
        if (developerTool && !document.getElementById('homeViewDeveloper').hidden) {
            history.replaceState(null, '', `/?view=developer&tool=${encodeURIComponent(btn.dataset.tab)}`);
        } else if (!document.getElementById('dashboardLayout').hidden && state.guildId) {
            history.replaceState(null, '', `/?guildId=${encodeURIComponent(state.guildId)}&tab=${encodeURIComponent(btn.dataset.tab)}`);
        }
        lastAutoRefreshAt = Date.now();

        const loader = tabLoaders[btn.dataset.tab];
        if (loader) {
            loader().then(() => { clearPageNotice(); updateLiveDurations(); }).catch(error => handleUiError(error, () => loader().catch(handleUiError)));
        }
    });
});

function activeTab() {
    const active = tabButtons.find(b => b.classList.contains('active'));
    if (active) return active.dataset.tab;
    const activePanel = tabPanels.find(panel => panel.classList.contains('active'));
    return activePanel?.id.replace(/^tab-/, '') || 'overview';
}

function isDashboardVisible() {
    return document.getElementById('dashboardLayout')?.hidden === false;
}

const mobileSaveDock = document.getElementById('mobileSaveDock');
const mobileSaveDockButton = document.getElementById('mobileSaveDockButton');
const mobileSaveDockContext = document.getElementById('mobileSaveDockContext');
const mobileSaveMedia = window.matchMedia('(max-width: 820px)');
let mobileSaveTarget = null;

function dashboardSaveButtons(panel) {
    return [...(panel?.querySelectorAll('[data-save-management], [data-save-advanced], button.primary[id^="save"]') || [])]
        .filter(button => !button.classList.contains('module-inline-save-replaced') && !button.closest('[hidden]') && button.getAttribute('aria-hidden') !== 'true');
}

function updateMobileSaveDock(preferredElement = null) {
    const dashboardVisible = !document.getElementById('dashboardLayout').hidden;
    const panel = document.querySelector('#dashboardLayout .tab-panel.active');
    const buttons = dashboardSaveButtons(panel);
    if (!mobileSaveMedia.matches || !dashboardVisible || !buttons.length) {
        mobileSaveTarget = null;
        mobileSaveDock.hidden = true;
        return;
    }
    const preferredSection = preferredElement?.closest?.('.section');
    mobileSaveTarget = buttons.find(button => preferredSection && button.closest('.section') === preferredSection)
        || (buttons.includes(mobileSaveTarget) ? mobileSaveTarget : buttons[0]);
    const sectionTitle = mobileSaveTarget.closest('.section')?.querySelector(':scope > h2, :scope > .section-title-row h2')?.textContent.trim()
        || panel?.querySelector(':scope > h2')?.textContent.trim()
        || 'Current settings';
    mobileSaveDockContext.textContent = sectionTitle;
    mobileSaveDockButton.textContent = mobileSaveTarget.textContent.trim() || 'Save';
    mobileSaveDockButton.disabled = mobileSaveTarget.disabled;
    mobileSaveDock.hidden = false;
}

mobileSaveDockButton.addEventListener('click', () => {
    if (!mobileSaveTarget || mobileSaveTarget.disabled) return;
    const target = mobileSaveTarget;
    mobileSaveDockButton.disabled = true;
    target.click();
    let attempts = 0;
    const syncSaveState = () => {
        if (mobileSaveTarget !== target) { updateMobileSaveDock(); return; }
        mobileSaveDockButton.disabled = target.disabled;
        if (target.disabled && attempts++ < 40) setTimeout(syncSaveState, 250);
        else updateMobileSaveDock();
    };
    setTimeout(syncSaveState, 250);
});

document.getElementById('dashboardLayout').addEventListener('focusin', event => updateMobileSaveDock(event.target));
document.getElementById('dashboardLayout').addEventListener('input', event => updateMobileSaveDock(event.target));
document.getElementById('dashboardLayout').addEventListener('change', event => updateMobileSaveDock(event.target));
mobileSaveMedia.addEventListener('change', () => updateMobileSaveDock());

async function refreshActiveTab() {
    const loader = tabLoaders[activeTab()];
    if (loader) {
        await loader();
        updateLiveDurations();
    }
}

window.addEventListener('flummi:notification', () => {
    if (!document.querySelector('[data-account-panel="notifications"]:not([hidden])')) return;
    loadNotifications().catch(handleUiError);
});
window.addEventListener('flummi:dashboard-update', event => {
    if (!isDashboardVisible() || shouldSkipPassiveRefresh(activeTab())) return;
    if (event.detail?.guildId && String(event.detail.guildId) !== String(state.guildId)) return;
    refreshActiveTab().catch(handleUiError);
});

// Server tabs stay in the dashboard sidebar. Developer tools have their own top-level workspace.
const defaultDeveloperTabOrder = ['global', 'mail', 'messenger', 'profiles', 'ai', 'adoption', 'reliability', 'logs', 'files', 'experiments'];
const fixedDeveloperTabIds = new Set(defaultDeveloperTabOrder);
let activeDeveloperTabOrder = [...defaultDeveloperTabOrder];

const developerPanelHost = document.getElementById('homeDeveloperPanelHost');
for (const tabId of defaultDeveloperTabOrder) {
    const panel = document.getElementById(`tab-${tabId}`);
    if (panel) developerPanelHost.appendChild(panel);
}

function isDividerToken(value) {
    return typeof value === 'string' && /^-{2,}$/.test(value.trim());
}

function isTitleToken(value) {
    return typeof value === 'string' && value.startsWith('title:');
}

function titleFromToken(value) {
    return isTitleToken(value) ? value.slice('title:'.length).trim() : '';
}

function createTabDivider() {
    const hr = document.createElement('hr');
    hr.className = 'tab-divider';
    hr.dataset.generatedNav = 'true';
    return hr;
}

function createTabTitle(title) {
    const label = document.createElement('div');
    label.className = 'tab-group-label';
    label.dataset.generatedNav = 'true';
    label.textContent = title;
    return label;
}

function organizeDeveloperNav() {
    const nav = document.getElementById('homeDeveloperTabs');
    for (const tabId of activeDeveloperTabOrder) {
        const button = tabButtons.find(candidate => candidate.dataset.tab === tabId);
        if (button) nav.appendChild(button);
    }
}

function updateTabNavigationStructure() {
    const nav = document.querySelector('#dashboardLayout .tabs');
    if (!nav) return;
    const children = Array.from(nav.children);
    const visibleButton = node => (node.matches?.('.tab-btn') && !node.hidden)
        || (node.matches?.('.management-nav-group') && !node.hidden && !node.querySelector('.management-parent')?.hidden);
    for (const [index, item] of children.entries()) {
        if (!item.matches('[data-generated-nav]')) continue;
        if (item.classList.contains('tab-group-label')) {
            const nextBoundary = children.findIndex((node, nextIndex) => nextIndex > index && node.matches('[data-generated-nav]'));
            const end = nextBoundary === -1 ? children.length : nextBoundary;
            item.hidden = !children.slice(index + 1, end).some(visibleButton);
            continue;
        }
        const hasBefore = children.slice(0, index).some(visibleButton);
        const hasAfter = children.slice(index + 1).some(visibleButton);
        item.hidden = !hasBefore || !hasAfter;
    }
}

function normalizedSearchText(value) {
    return String(value || '').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

function searchTextMatches(value, query) {
    const haystack = normalizedSearchText(value);
    return normalizedSearchText(query).split(' ').filter(Boolean).every(word => haystack.includes(word));
}

const panelSearchAliases = {
    overview: 'home summary server details members channels features bot status',
    analytics: 'analytics graphs charts activity trends summary statistics',
    triggers: 'trigger response reply cooldown exact phrase automation',
    voice: 'voice call channel sessions time leaderboard activity',
    stats: 'messages chat activity heatmap channels members analytics',
    users: 'members permissions roles admin access commands block allow',
    management: 'management moderation automod safety cases logs roles onboarding automation modules features on off',
    'management-moderation': 'moderation warn timeout kick ban purge reason notify member',
    'management-automod': 'automod safety spam raid preset test enforce escalation',
    'management-cases': 'cases logs retention deleted edited messages joins leaves roles timeouts',
    'management-roles': 'roles onboarding autorole persistent interactive buttons select menu',
    'management-automation': 'automation welcome goodbye scheduled messages purge cleanup',
    'management-server-doctor': 'server doctor diagnose permissions hierarchy configuration health fixes',
    'management-incident-center': 'incident anti nuke security lockdown audit restore destructive changes',
    'management-reports': 'reports modmail member report evidence staff inbox',
    'management-workflows': 'workflow studio recipes dry run routines escalation follow up',
    'management-staff-operations': 'staff operations cases queue assignments approvals notes review',
    'management-community-health': 'community health onboarding retention participation privacy surveys',
    'management-backups': 'backup recovery snapshot roles channels permissions restore',
    'management-copilot': 'copilot ai summary translate recommendation staff approval',
    'management-engagement': 'giveaway levels xp feeds reminders embeds polls afk temporary roles voice roles',
    settings: 'settings configuration bot features limits cooldown server',
    pings: 'ping requests mentions inbox saved',
    soundboard: 'server media emoji emojis sticker stickers gif gifs soundboard',
    audit: 'audit changes history log settings who changed',
    messenger: 'messenger send message bot channel images mentions',
    profiles: 'profiles avatar banner nickname bio application guild',
    ai: 'ai artificial intelligence openrouter model memory presence startup',
    global: 'global settings features navigation tabs public site cloudflare',
    reliability: 'reliability health github update staging commits live runtime backup diagnostics',
    adoption: 'statistics servers installed active adoption usage commands members modules growth',
    files: 'developer files repository code upload download edit search tests restart',
    logs: 'bot logs console errors warnings runtime',
    experiments: 'experiments preview roles simulation admin view'
};

function searchNodeLabel(node, fallback) {
    const heading = node.matches?.('.section') ? node.querySelector(':scope > h2, :scope > h3') : null;
    return String(heading?.textContent || node.getAttribute?.('aria-label') || fallback || '').replace(/\s+/g, ' ').trim();
}

function matchingControlLabel(surface, query) {
    for (const node of surface.querySelectorAll('label, summary, button, .checkbox-row, input[placeholder], textarea[placeholder]')) {
        if (node.closest('[hidden]')) continue;
        const label = String(node.textContent || node.getAttribute?.('placeholder') || node.getAttribute?.('aria-label') || '').replace(/\s+/g, ' ').trim();
        if (label.length >= 2 && label.length <= 100 && searchTextMatches(label, query)) return label;
    }
    return '';
}

function setupWorkspaceSearch({ fieldId, resultsId, tabIds, emptyText }) {
    const field = document.getElementById(fieldId);
    const resultsContainer = document.getElementById(resultsId);
    let activeResults = [];

    function update() {
        const query = normalizedSearchText(field.value);
        activeResults = [];

        for (const tabId of tabIds) {
            const panel = document.getElementById(`tab-${tabId}`);
            const button = tabButtons.find(candidate => candidate.dataset.tab === tabId);
            if (!panel || !button || button.hidden) {
                button?.classList.remove('search-muted', 'search-match');
                continue;
            }

            const surfaces = Array.from(panel.querySelectorAll('.section')).filter(surface => !surface.closest('[hidden]'));
            if (!surfaces.length) surfaces.push(panel);
            const matches = query ? surfaces.filter(surface => searchTextMatches(`${surface.textContent} ${surface.dataset.searchKeywords || ''}`, query)) : [];
            const aliasMatches = Boolean(query) && searchTextMatches(`${button.textContent} ${panelSearchAliases[tabId] || ''}`, query);
            const tabMatches = matches.length > 0 || aliasMatches;
            button.classList.toggle('search-muted', Boolean(query) && !tabMatches);
            button.classList.toggle('search-match', Boolean(query) && tabMatches);
            const globalState = button.dataset.globalDisabled === 'true' ? ', globally disabled' : '';
            const searchState = query ? `, ${tabMatches ? 'contains matches' : 'no matches'}` : '';
            button.setAttribute('aria-label', `${button.textContent.trim()}${globalState}${searchState}`);

            const seenLabels = new Set();
            for (const surface of matches) {
                const surfaceLabel = searchNodeLabel(surface, button.textContent.trim());
                const controlLabel = matchingControlLabel(surface, query);
                const label = controlLabel && !searchTextMatches(surfaceLabel, query)
                    ? `${surfaceLabel} — ${controlLabel}`
                    : surfaceLabel;
                const key = normalizedSearchText(`${tabId} ${label}`);
                if (!label || seenLabels.has(key)) continue;
                seenLabels.add(key);
                activeResults.push({ tabId, label, node: surface });
            }
            if (aliasMatches && !matches.length) {
                activeResults.push({ tabId, label: button.textContent.trim(), node: panel });
            }
        }

        if (!query) {
            resultsContainer.hidden = true;
            resultsContainer.innerHTML = '';
            return;
        }

        const visibleResults = activeResults.slice(0, 10);
        resultsContainer.hidden = false;
        resultsContainer.innerHTML = visibleResults.length
            ? visibleResults.map((result, index) => {
                const tabLabel = tabButtons.find(button => button.dataset.tab === result.tabId)?.textContent.trim() || result.tabId;
                return `<button class="developer-search-result" type="button" data-workspace-search-result="${index}"><strong>${escapeHtml(result.label)}</strong><span>${escapeHtml(tabLabel)}</span></button>`;
            }).join('')
            : `<div class="developer-search-empty">${escapeHtml(emptyText)}</div>`;
    }

    field.addEventListener('input', update);
    field.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            field.value = '';
            update();
        } else if (event.key === 'Enter' && activeResults.length) {
            event.preventDefault();
            resultsContainer.querySelector('[data-workspace-search-result]')?.click();
        }
    });
    resultsContainer.addEventListener('click', event => {
        const resultButton = event.target.closest('[data-workspace-search-result]');
        if (!resultButton) return;
        const result = activeResults[Number(resultButton.dataset.workspaceSearchResult)];
        if (!result) return;
        tabButtons.find(button => button.dataset.tab === result.tabId)?.click();
        window.setTimeout(() => {
            if (!result.node.isConnected) return;
            result.node.scrollIntoView({ behavior: 'smooth', block: 'center' });
            result.node.classList.remove('developer-search-target');
            void result.node.offsetWidth;
            result.node.classList.add('developer-search-target');
        }, 100);
    });

    return { update };
}

const dashboardTabOrder = tabButtons
    .map(button => button.dataset.tab)
    .filter(tabId => !fixedDeveloperTabIds.has(tabId));
const developerSearch = setupWorkspaceSearch({
    fieldId: 'developerSearch',
    resultsId: 'developerSearchResults',
    tabIds: defaultDeveloperTabOrder,
    emptyText: 'No developer setting or tool matches this search.'
});
const dashboardSearch = setupWorkspaceSearch({
    fieldId: 'dashboardSearch',
    resultsId: 'dashboardSearchResults',
    tabIds: dashboardTabOrder,
    emptyText: 'No dashboard feature or setting matches this search.'
});

function applyTabOrder(order) {
    const requestedOrder = Array.isArray(order) && order.length ? order : tabButtons.map(button => button.dataset.tab);
    const nav = document.querySelector('.tabs');
    const seen = new Set();
    for (const group of nestedTabGroups) {
        const childOrder = [...group.children].sort((left, right) => {
            const leftLabel = tabButtons.find(button => button.dataset.tab === left)?.textContent.trim() || left;
            const rightLabel = tabButtons.find(button => button.dataset.tab === right)?.textContent.trim() || right;
            return leftLabel.localeCompare(rightLabel, undefined, { sensitivity: 'base' });
        });
        const subnav = document.getElementById(group.subnavId);
        for (const tabId of childOrder) {
            const child = tabButtons.find(button => button.dataset.tab === tabId);
            if (child) subnav.appendChild(child);
        }
    }
    const effectiveOrder = requestedOrder.filter(tabId => !nestedChildTabIds.has(tabId));
    for (const group of nestedTabGroups) {
        if (effectiveOrder.includes(group.parent)) continue;
        const settingsIndex = effectiveOrder.indexOf('settings');
        effectiveOrder.splice(settingsIndex >= 0 ? settingsIndex : effectiveOrder.length, 0, group.parent);
    }
    const configuredDeveloperTabs = effectiveOrder.filter(tabId => fixedDeveloperTabIds.has(tabId));
    activeDeveloperTabOrder = [
        ...new Set(configuredDeveloperTabs),
        ...defaultDeveloperTabOrder.filter(tabId => !configuredDeveloperTabs.includes(tabId))
    ];

    nav.querySelectorAll('[data-generated-nav]').forEach(element => element.remove());

    for (const tabId of effectiveOrder) {
        if (isDividerToken(tabId)) {
            nav.appendChild(createTabDivider());
            continue;
        }

        if (isTitleToken(tabId)) {
            const title = titleFromToken(tabId);
            if (title) nav.appendChild(createTabTitle(title));
            continue;
        }

        if (fixedDeveloperTabIds.has(tabId)) continue;
        const btn = tabButtons.find(b => b.dataset.tab === tabId);

        if (btn && !seen.has(tabId)) {
            const group = nestedTabGroups.find(candidate => candidate.parent === tabId);
            nav.appendChild(group ? document.getElementById(group.elementId) : btn);
            seen.add(tabId);
        }
    }

    for (const btn of tabButtons) {
        if (!fixedDeveloperTabIds.has(btn.dataset.tab) && !nestedChildTabIds.has(btn.dataset.tab) && !seen.has(btn.dataset.tab)) {
            const group = nestedTabGroups.find(candidate => candidate.parent === btn.dataset.tab);
            nav.appendChild(group ? document.getElementById(group.elementId) : btn);
        }
    }

    organizeDeveloperNav();
    updateTabNavigationStructure();
}

async function loadPanelAccount() {
    const data = await api('/auth/me');
    state.authenticated = data.authenticated === true;
    if (!state.authenticated) return false;
    state.privateConnection = data.privateConnection === true;
    state.role = ['developer', 'admin', 'member'].includes(data.role) ? data.role : 'member';
    state.actualRole = data.actualRole === 'developer' ? 'developer' : 'admin';
    state.globalFeatures = data.globalFeatures || {};
    state.accountUsername = data.user.username;
    state.accountUserId = data.user.id;
    const avatar = document.getElementById('panelAccountAvatar');
    avatar.src = data.user.avatarUrl;
    avatar.alt = `${data.user.username}'s Discord avatar`;
    document.getElementById('panelAccount').hidden = false;
    window.dispatchEvent(new CustomEvent('flummi:authenticated'));
    applyAccessVisibility();
    document.getElementById('homeSignedOut').hidden = true;
    document.getElementById('homeSignedIn').hidden = false;
    document.getElementById('homeAvatar').src = data.user.avatarUrl;
    document.getElementById('homeUsername').textContent = data.user.username;
    document.getElementById('feedbackSignedOut').hidden = true;
    document.getElementById('feedbackSignedIn').hidden = false;
    document.getElementById('supportSignedOut').hidden = true;
    document.getElementById('supportSignedIn').hidden = false;
    document.getElementById('homeDeveloperNav').hidden = state.actualRole !== 'developer';
    document.getElementById('homeLoginCta').hidden = true;
    applyTailscaleAvailability();
    return true;
}

const globalFeatureTabs = {
    triggers: 'triggersEnabled',
    pings: 'pingRequestSaveEnabled'
};

function applyGlobalFeatureNavigation() {
    const developerView = state.role === 'developer';
    for (const [tabId, featureKey] of Object.entries(globalFeatureTabs)) {
        const button = tabButtons.find(candidate => candidate.dataset.tab === tabId);
        const panel = document.getElementById(`tab-${tabId}`);
        const globallyDisabled = state.globalFeatures?.[featureKey] === false;
        const hide = globallyDisabled && !developerView;
        if (button) {
            button.hidden = hide;
            button.dataset.globalDisabled = String(globallyDisabled && developerView);
            if (globallyDisabled && developerView) {
                button.dataset.tooltip = `${defaultTabLabels[tabId]} is temporarily disabled in Global Feature Settings.`;
                button.setAttribute('aria-label', `${defaultTabLabels[tabId]} — globally disabled`);
            } else {
                delete button.dataset.tooltip;
                button.removeAttribute('aria-label');
            }
        }
        if (panel) panel.hidden = hide;
    }
    updateTabNavigationStructure();
}

function applyAccessVisibility() {
    const isDeveloper = state.role === 'developer';
    const isActualDeveloper = state.actualRole === 'developer';
    const canAccessSettings = isDeveloper || state.role === 'admin';
    const canViewAudit = canAccessSettings;
    const canManageTriggers = canAccessSettings;
    const roleName = `${state.role[0].toUpperCase()}${state.role.slice(1)}`;
    const roleLabel = isActualDeveloper && !isDeveloper ? `${roleName} preview` : roleName;
    if (state.accountUsername) {
        document.getElementById('panelAccountName').innerHTML = `<span class="account-username">${escapeHtml(state.accountUsername)}</span><span class="account-role">${escapeHtml(roleLabel)}</span>`;
    }
    const developerTabs = ['mail', 'messenger', 'profiles', 'ai', 'global', 'reliability', 'adoption', 'files', 'logs'];
    document.querySelectorAll('[data-developer-only]').forEach(element => { element.hidden = !isDeveloper; });
    developerTabs.forEach(tabId => {
        const panel = document.getElementById(`tab-${tabId}`);
        if (panel) panel.hidden = !isDeveloper;
    });
    document.querySelectorAll('[data-actual-developer-only]').forEach(element => { element.hidden = !isActualDeveloper; });
    document.getElementById('tab-experiments').hidden = !isActualDeveloper;
    const settingsButton = tabButtons.find(button => button.dataset.tab === 'settings');
    if (settingsButton) settingsButton.hidden = !canAccessSettings;
    document.getElementById('tab-settings').hidden = !canAccessSettings;
    document.querySelectorAll('[data-trigger-admin-only]').forEach(element => { element.hidden = !canManageTriggers; });
    document.querySelectorAll('[data-admin-only]').forEach(element => { element.hidden = !canAccessSettings; });
    document.querySelectorAll('[data-audit-only]').forEach(element => { element.hidden = !canViewAudit; });
    document.getElementById('memberPermissionsSection').hidden = state.role === 'member';
    applyGlobalFeatureNavigation();
    if (canAccessSettings && state.management) {
        applyManagementNavigation();
    } else {
        document.querySelectorAll('[data-management-module][data-tab]').forEach(button => { button.hidden = true; });
        setManagementExpanded(false);
    }

    organizeDeveloperNav();

    const activeButton = tabButtons.find(button => button.classList.contains('active'));
    if (!activeButton || activeButton.hidden) {
        tabButtons.forEach(button => button.classList.toggle('active', button.dataset.tab === 'overview'));
        tabPanels.forEach(panel => panel.classList.toggle('active', panel.id === 'tab-overview'));
        localStorage.setItem('flummi.activeTab', 'overview');
    }
}

document.getElementById('refreshDiscordAccess').addEventListener('click', () => {
    refreshDiscordSignIn();
});

function applyTabNames(names) {
    for (const button of tabButtons) {
        const name = typeof names?.[button.dataset.tab] === 'string' ? names[button.dataset.tab].trim() : '';
        const label = name || defaultTabLabels[button.dataset.tab];
        const persistentChildren = [...button.children].filter(child => child.matches('.nav-count'));
        if (persistentChildren.length) button.replaceChildren(document.createTextNode(`${label} `), ...persistentChildren);
        else button.textContent = label;
        const panel = document.getElementById(`tab-${button.dataset.tab}`);
        const heading = panel?.querySelector(':scope > h2');
        const textNode = Array.from(heading?.childNodes || []).find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
        if (textNode) textNode.textContent = `${name || defaultPanelTitles[button.dataset.tab]} `;
    }
}

applyTabNames(window.__PANEL_TAB_NAMES__);
applyTabOrder(window.__PANEL_TAB_ORDER__);

// Keep Settings limited to server-admin controls; platform-wide tools have their own developer tab.
const reliabilityPanel = document.getElementById('tab-reliability');
reliabilityPanel?.append(document.getElementById('developerDataTools'));

// ---------- Invite link ----------
async function loadInviteLink() {
    const links = document.querySelectorAll('[data-invite-link]');

    try {
        const data = await api('/api/invite-link');
        links.forEach(link => {
            link.href = data.url;
            link.removeAttribute('aria-disabled');
        });
    } catch {
        links.forEach(link => {
            link.href = '#';
            link.setAttribute('aria-disabled', 'true');
        });
    }
}

// ---------- Guild loading ----------
const homePageTitles = {
    servers: 'Home - Flummi',
    account: 'Account - Flummi',
    commands: 'Commands - Flummi',
    status: 'Status - Flummi',
    support: 'Support - Flummi',
    feedback: 'Feedback - Flummi',
    developer: 'Developer Tools - Flummi',
    terms: 'Terms of Service - Flummi',
    privacy: 'Privacy Policy - Flummi',
    licenses: 'Licenses - Flummi',
    archive: 'Policy Archive - Flummi',
    credits: 'Credits - Flummi'
};
const homeViewPaths = { servers: '/', account: '/account', commands: '/commands', status: '/status', support: '/support', feedback: '/feedback', terms: '/terms', privacy: '/privacy', licenses: '/licenses', archive: '/policy-archive', credits: '/credits' };
const homeViewNames = Object.keys(homeViewPaths);

function setHomePageTitle(view) {
    const title = homePageTitles[view] || homePageTitles.servers;
    document.title = window.FlummiI18n?.t(title) || title;
}

function setServerPageTitle(guildId = state.guildId) {
    const guild = state.guilds.find(row => String(row.id) === String(guildId));
    document.title = guild?.name ? `${guild.name} | Flummi` : (window.FlummiI18n?.t('Server | Flummi') || 'Server | Flummi');
}

window.addEventListener('flummi:languagechange', () => {
    if (!document.getElementById('dashboardLayout').hidden) {
        setServerPageTitle();
        refreshActiveTab().catch(error => console.error(error));
        return;
    }
    const activeView = document.querySelector('[data-home-view].active')?.dataset.homeView || 'servers';
    setHomePageTitle(activeView);
});

function renderPublicCommands(query = '') {
    const normalizedQuery = String(query || '').trim().toLowerCase();
    const rows = state.publicCommands.filter(row => !normalizedQuery || `${row.path} ${row.description} ${row.role}`.toLowerCase().includes(normalizedQuery));
    const container = document.getElementById('homeCommandsList');
    const roles = ['member', 'admin', 'developer'];
    container.innerHTML = roles.map(role => {
        const roleRows = rows.filter(row => row.role === role);
        if (!roleRows.length) return '';
        return `<section class="public-command-group"><h2>${escapeHtml(role)} commands <span class="public-command-count">${roleRows.length}</span></h2><div class="public-command-list">${roleRows.map(row => `
            <article class="public-command-row"><code>${escapeHtml(row.path)}</code><p>${escapeHtml(row.description)}${row.restricted ? ' · Selected servers only' : ''}</p><span class="command-role-badge ${escapeHtml(role)}">${escapeHtml(role)}</span><details class="command-example"><summary>Example and options</summary><div><span>Example</span><code>${escapeHtml(row.example || row.path)}</code>${row.options?.length ? `<dl>${row.options.map(option => `<div><dt>${escapeHtml(option.name)}</dt><dd>${escapeHtml(option.description)} · ${escapeHtml(option.type)} · ${option.required ? 'required' : 'optional'}</dd></div>`).join('')}</dl>` : '<p>No options are required.</p>'}</div></details></article>
        `).join('')}</div></section>`;
    }).join('') || '<div class="home-panel empty">No matching commands found.</div>';
}

async function loadPublicCommands() {
    if (!state.publicCommands.length) {
        const data = await api('/api/public/commands');
        state.publicCommands = data.commands || [];
    }
    renderPublicCommands(document.getElementById('homeCommandSearch').value);
}

async function loadPublicStatus() {
    const data = await api('/api/public/status');
    const operational = data.overall === 'operational';
    document.getElementById('publicStatusOverview').innerHTML = `<div class="public-status-summary-row"><span class="public-status-dot" aria-hidden="true"></span><div><strong>${operational ? 'All systems operational' : 'Some services need attention'}</strong><p>${operational ? 'Flummi is available and connected.' : 'One or more live checks are not fully operational.'}</p></div></div>`;
    document.getElementById('publicStatusOverview').classList.toggle('degraded', !operational);
    const componentDetail = component => {
        if (component.key === 'bot') return uiText(component.status === 'operational' ? 'Connected and ready for Discord events.' : 'The Discord connection is still starting.');
        if (component.key === 'dashboard') return uiText('The website and public API are responding.');
        if (component.key === 'gateway') return component.status === 'operational'
            ? `${uiText('Connected')}${Number.isFinite(component.latencyMs) ? ` - ${component.latencyMs} ms ${uiText('latency')}` : ''}.`
            : uiText('Not connected.');
        if (component.key === 'servers') return component.status === 'operational'
            ? `${component.serverCount || 0} ${uiText(component.serverCount === 1 ? 'server connected.' : 'servers connected.')}`
            : uiText('Server availability cannot be checked yet.');
        return uiText(component.detail || 'No details available.');
    };
    document.getElementById('publicStatusComponents').innerHTML = (data.components || []).map(component => `
        <article class="public-status-row ${escapeHtml(component.status || 'degraded')}">
            <span class="public-status-dot" aria-hidden="true"></span>
            <div><strong>${escapeHtml(uiText(component.label))}</strong><span class="public-status-detail">${escapeHtml(componentDetail(component))}</span></div>
            <span class="badge ${component.status === 'operational' ? 'ok' : 'warn'}">${escapeHtml(uiText(component.status === 'operational' ? 'Operational' : 'Degraded'))}</span>
        </article>`).join('');
    const publicBotUpdatedAt = data.publicBotUpdatedAt || data.lastLiveUpdateAt;
    const updateTime = document.getElementById('publicStatusUpdated');
    updateTime.textContent = publicBotUpdatedAt ? formatDateTime(publicBotUpdatedAt) : uiText('Not recorded yet');
    updateTime.dateTime = publicBotUpdatedAt || '';
    document.getElementById('publicStatusChecked').textContent = `${uiText('Last checked')} ${formatDateTime(data.checkedAt)}`;
    const container = document.getElementById('publicIncidentHistory');
    const incidents = data.incidents || [];
    container.innerHTML = incidents.length ? `<h2>Incident history</h2>${incidents.map(incident => `<article class="public-incident"><span class="badge ${incident.status === 'resolved' ? 'ok' : 'warn'}">${escapeHtml(incident.status)}</span><div><strong>${escapeHtml(incident.title)}</strong><p>${escapeHtml(incident.message || 'No additional details.')}</p><small>${escapeHtml(formatDateTime(incident.createdAt))}${incident.resolvedAt ? ` · Resolved ${escapeHtml(formatDateTime(incident.resolvedAt))}` : ''}</small></div></article>`).join('')}` : '<p class="sub">No public incidents have been recorded.</p>';
    const subscription = document.getElementById('publicStatusSubscription');
    subscription.hidden = !state.authenticated;
    if (state.authenticated) {
        const preferences = (await api('/api/account/preferences')).preferences;
        document.getElementById('publicStatusDelivery').value = preferences.statusSubscription || 'off';
    }
}

document.getElementById('savePublicStatusSubscription').addEventListener('click', async () => {
    const button = document.getElementById('savePublicStatusSubscription');
    const status = document.getElementById('publicStatusSubscriptionStatus');
    button.disabled = true;
    try {
        const data = await api('/api/account/preferences', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ statusSubscription: document.getElementById('publicStatusDelivery').value }) });
        state.preferences = data.preferences;
        setStatus(status, data.preferences.statusSubscription === 'off' ? 'Status notifications turned off.' : 'Status notification preference saved.', 'ok');
    } catch (error) { setStatus(status, error.message, 'error'); }
    finally { button.disabled = false; }
});

function applyAccountPreferences(preferences = state.preferences || {}) {
    state.preferences = preferences;
    document.documentElement.classList.toggle('a11y-reduced-motion', preferences.reducedMotion === true);
    document.documentElement.classList.toggle('a11y-high-contrast', preferences.highContrast === true);
    document.documentElement.classList.toggle('a11y-large-text', preferences.largeText === true);
    document.documentElement.classList.toggle('dashboard-compact', preferences.compactMode === true);
    const pinned = new Set(preferences.pinnedTabs || []);
    document.querySelectorAll('#dashboardLayout .tabs > .tab-btn, #dashboardLayout .management-parent').forEach(button => button.classList.toggle('is-pinned', pinned.has(button.dataset.tab)));
}

async function loadAccountPreferences() {
    const [data, profileData, memoryData] = await Promise.all([
        api('/api/account/preferences'),
        api('/api/account/profile'),
        api('/api/account/ai-memory')
    ]);
    applyAccountPreferences(data.preferences);
    document.getElementById('accountDefaultTab').value = data.preferences.defaultTab || 'overview';
    const pinned = new Set(data.preferences.pinnedTabs || []);
    [...document.getElementById('accountPinnedTabs').options].forEach(option => { option.selected = pinned.has(option.value); });
    document.getElementById('accountCompactMode').checked = data.preferences.compactMode === true;
    document.getElementById('accountReducedMotion').checked = data.preferences.reducedMotion === true;
    document.getElementById('accountHighContrast').checked = data.preferences.highContrast === true;
    document.getElementById('accountLargeText').checked = data.preferences.largeText === true;
    const profile = profileData.profile || {};
    document.getElementById('accountProfileNickname').value = profile.nickname || '';
    document.getElementById('accountProfilePronouns').value = profile.pronouns || '';
    document.getElementById('accountProfileTimezone').value = profile.timezone || '';
    document.getElementById('accountProfileLanguages').value = (profile.languages || []).map(language => language.label).join(', ');
    document.getElementById('accountProfileWebsite').value = profile.website || '';
    document.getElementById('accountProfileBio').value = profile.bio || '';
    document.getElementById('accountProfileColor').value = `#${Number(profile.color || 0x1e88e5).toString(16).padStart(6, '0')}`;
    document.getElementById('accountProfileIdentity').innerHTML = `${profileData.user?.avatarUrl ? `<img src="${escapeHtml(profileData.user.avatarUrl)}" alt="">` : ''}<span><strong>${escapeHtml(profile.nickname || profileData.user?.username || 'Discord user')}</strong><small>${profile.updatedAt ? `Updated ${escapeHtml(formatDateTime(profile.updatedAt))}` : 'Profile not completed yet'}</small></span>`;
    const consentGranted = profileData.aiConsent?.status === 'granted';
    document.getElementById('accountAiConsent').innerHTML = `<div><strong>AI consent</strong><span class="badge ${consentGranted ? 'ok' : ''}">${consentGranted ? 'Enabled' : profileData.aiConsent?.status === 'withdrawn' ? 'Withdrawn' : 'Not enabled'}</span></div><p>${consentGranted ? `Granted ${escapeHtml(formatDateTime(profileData.aiConsent.updatedAt))}.` : 'Flummi will ask privately before sending your first request to an AI provider.'} Read the <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.</p><button class="${consentGranted ? 'danger' : 'secondary'} compact" type="button" data-account-ai-consent="${consentGranted ? 'withdraw' : 'allow'}">${consentGranted ? 'Withdraw AI consent' : 'Enable AI'}</button>`;
    const memory = memoryData.memory || {};
    const memoryItems = Number(memory.historyMessages || 0);
    document.getElementById('accountAiMemoryBadge').textContent = memoryItems ? `${memoryItems} messages` : 'Empty';
    document.getElementById('accountAiMemoryBadge').className = `badge ${memoryItems ? 'accent' : ''}`;
    document.getElementById('accountAiMemorySummary').innerHTML = `<div class="account-summary-item"><strong>${memoryItems ? `${memoryItems} remembered messages across ${Number(memory.turns || 0)} turns` : 'No AI conversation memory stored'}</strong><span class="sub">${memory.updatedAt ? `Last changed ${escapeHtml(formatDateTime(memory.updatedAt))}` : 'Flummi will only build memory after you enable and use AI.'}</span></div><p class="sub">Clearing this removes your saved conversation context and compact summary. It does not change your AI consent.</p>`;
    document.getElementById('clearAccountAiMemory').disabled = !memoryItems && !Number(memory.summaryChars || 0);
}

async function saveAccountPreferences() {
    const status = document.getElementById('accountPreferencesStatus');
    const payload = {
        defaultTab: document.getElementById('accountDefaultTab').value,
        pinnedTabs: [...document.getElementById('accountPinnedTabs').selectedOptions].map(option => option.value),
        compactMode: document.getElementById('accountCompactMode').checked,
        reducedMotion: document.getElementById('accountReducedMotion').checked,
        highContrast: document.getElementById('accountHighContrast').checked,
        largeText: document.getElementById('accountLargeText').checked
    };
    try {
        const data = await api('/api/account/preferences', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        applyAccountPreferences(data.preferences);
        setStatus(status, 'Profile preferences saved.', 'ok');
    } catch (error) { setStatus(status, error.message, 'error'); }
}

function renderNotificationList(entries = []) {
    const container = document.getElementById('notificationList');
    const notificationHref = entry => entry.href || (/privacy/i.test(entry.type) ? '/account?tab=data' : entry.guildId && /workflow/i.test(entry.type) ? `/?guildId=${encodeURIComponent(entry.guildId)}&tab=management-workflows` : entry.guildId && /ticket|modmail|report/i.test(entry.type) ? `/?guildId=${encodeURIComponent(entry.guildId)}&tab=management-reports` : null);
    container.innerHTML = entries.length ? entries.map(entry => { const href = notificationHref(entry); return `<article class="notification-item ${entry.readAt ? '' : 'unread'}" data-notification-id="${escapeHtml(entry.id)}"><span class="notification-dot" aria-hidden="true"></span><div>${href ? `<a class="notification-link" href="${escapeHtml(href)}"><strong>${escapeHtml(entry.title)}</strong></a>` : `<strong>${escapeHtml(entry.title)}</strong>`}<p>${escapeHtml(entry.message)}</p><small>${escapeHtml(entry.type)} · ${escapeHtml(formatDateTime(entry.createdAt))}</small></div>${entry.readAt ? '' : '<button class="secondary compact" type="button" data-mark-notification>Mark read</button>'}</article>`; }).join('') : '<div class="contextual-empty"><strong>You are all caught up</strong><span>No notifications match this search.</span></div>';
}

async function loadNotifications() {
    const query = document.getElementById('notificationSearch').value.trim();
    const data = await api(`/api/notifications${query ? `?q=${encodeURIComponent(query)}` : ''}`);
    renderNotificationList(data.notifications || []);
}

document.getElementById('saveAccountPreferences').addEventListener('click', saveAccountPreferences);
document.getElementById('saveAccountProfile').addEventListener('click', async () => {
    const status = document.getElementById('accountProfileStatus');
    try {
        await api('/api/account/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: document.getElementById('accountProfileNickname').value, pronouns: document.getElementById('accountProfilePronouns').value, timezone: document.getElementById('accountProfileTimezone').value, languages: document.getElementById('accountProfileLanguages').value, website: document.getElementById('accountProfileWebsite').value, bio: document.getElementById('accountProfileBio').value, color: document.getElementById('accountProfileColor').value }) });
        setStatus(status, 'Flummi profile saved.', 'ok'); await loadAccountPreferences();
    } catch (error) { setStatus(status, error.message, 'error'); }
});
document.getElementById('accountAiConsent').addEventListener('click', async event => {
    const button = event.target.closest('[data-account-ai-consent]'); if (!button) return;
    if (button.dataset.accountAiConsent === 'allow') {
        const confirmed = await confirmAction({ title: 'Enable Flummi AI?', message: 'By enabling AI you agree to the Terms of Service and confirm that you have read the Privacy Policy.', confirmLabel: 'Enable AI', danger: false });
        if (!confirmed) return;
    }
    button.disabled = true;
    try { await api('/api/account/ai-consent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: button.dataset.accountAiConsent }) }); await loadAccountPreferences(); }
    catch (error) { handleUiError(error); button.disabled = false; }
});
document.getElementById('clearAccountAiMemory').addEventListener('click', async () => {
    const confirmed = await confirmAction({ title: 'Clear your AI memory?', message: 'This permanently removes your saved AI conversation context and summary. Your AI consent stays unchanged.', confirmLabel: 'Clear AI memory' });
    if (!confirmed) return;
    const button = document.getElementById('clearAccountAiMemory');
    button.disabled = true;
    try {
        await api('/api/account/ai-memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmation: 'CLEAR' }) });
        setStatus(document.getElementById('accountAiMemoryStatus'), 'Your AI memory has been cleared.', 'ok');
        await loadAccountPreferences();
    } catch (error) {
        setStatus(document.getElementById('accountAiMemoryStatus'), error.message, 'error');
        button.disabled = false;
    }
});
document.getElementById('markAllNotificationsRead').addEventListener('click', async () => { await api('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); await loadNotifications(); });
document.getElementById('notificationList').addEventListener('click', async event => { const row = event.target.closest('[data-notification-id]'); if (!row || !event.target.closest('[data-mark-notification]')) return; await api('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: row.dataset.notificationId }) }); await loadNotifications(); });
let notificationSearchTimer;
document.getElementById('notificationSearch').addEventListener('input', () => { clearTimeout(notificationSearchTimer); notificationSearchTimer = setTimeout(() => loadNotifications().catch(handleUiError), 250); });

let publicLicenseLoaded = false;

async function loadPublicLicense() {
    if (publicLicenseLoaded) return;
    const licenseText = document.getElementById('repositoryLicenseText');
    const status = document.getElementById('repositoryLicenseStatus');
    try {
        const data = await api('/api/public/license');
        licenseText.textContent = data.text || 'The deployed LICENSE file is empty.';
        document.getElementById('licenseUpdatedAt').textContent = data.updatedAt
            ? `Repository license · Deployed file updated ${formatDateTime(data.updatedAt)}`
            : 'Repository license · Loaded from the deployed LICENSE file';
        publicLicenseLoaded = true;
        setStatus(status, '', '');
    } catch (error) {
        licenseText.textContent = 'License unavailable.';
        setStatus(status, error.message, 'error');
    }
}

function showHomeView(name = 'servers', developerTool = null) {
    setHomeMobileMenu(false);
    document.getElementById('homeShell').hidden = false;
    document.getElementById('dashboardLayout').hidden = true;
    updateMobileSaveDock();
    setHomePageTitle(name);
    history.replaceState(null, '', name === 'developer' ? `/?view=developer${developerTool ? `&tool=${encodeURIComponent(developerTool)}` : ''}` : (homeViewPaths[name] || '/'));
    for (const button of document.querySelectorAll('[data-home-view]')) button.classList.toggle('active', button.dataset.homeView === name);
    for (const view of [...homeViewNames, 'developer']) document.getElementById(`homeView${view[0].toUpperCase()}${view.slice(1)}`).hidden = view !== name;
    if (name === 'commands') loadPublicCommands().catch(handleUiError);
    if (name === 'status') loadPublicStatus().catch(handleUiError);
    if (name === 'licenses') loadPublicLicense().catch(handleUiError);
    if (name === 'developer') activateDeveloperWorkspace(developerTool).catch(handleUiError);
}

function guildCard(row) {
    const icon = row.iconUrl
        ? `<img src="${escapeHtml(row.iconUrl)}" alt="">`
        : escapeHtml(
            row.name
                .slice(0, 2)
                .toUpperCase()
        );

    row = {
        ...row,
        role: row.displayRole || row.role
    };

    const bannerless = !row.bannerUrl;

    return `<button
        class="home-guild-card${bannerless ? ' bannerless' : ''}"
        type="button"
        data-open-guild="${escapeHtml(row.id)}"
        data-icon-url="${escapeHtml(row.iconUrl || '')}"
    ><span class="home-guild-icon">${icon}</span><span class="home-guild-copy"><strong class="home-guild-name">${escapeHtml(row.name)}</strong><span class="home-guild-role">${escapeHtml(row.role || 'member')}</span></span><span class="home-guild-arrow" aria-hidden="true">→</span></button>`;
}

function renderHomeGuilds(rows) {
    state.guilds = rows;
    const container = document.getElementById('homeGuilds');
    const emptyState = document.getElementById('homeNoServers');
    const groupContainer = document.getElementById('homeGuildGroups');
    container.hidden = false;
    const groups = [
        { title: 'Admin access', rows: rows.filter(row => row.displayRole === 'admin') },
        { title: 'Member access', rows: rows.filter(row => row.displayRole === 'member') },
        { title: 'Developer-only access', rows: rows.filter(row => row.displayRole === 'not a member') }
    ].filter(group => group.rows.length);
    emptyState.hidden = rows.length > 0;
    groupContainer.hidden = rows.length === 0;
    groupContainer.innerHTML = groups.map(group => `<section class="guild-group"><div class="guild-group-heading"><h2>${escapeHtml(group.title)}</h2><span class="guild-count">${group.rows.length} ${group.rows.length === 1 ? 'server' : 'servers'}</span></div><div class="home-guild-grid">${group.rows.map(guildCard).join('')}</div></section>`).join('');

    container
        .querySelectorAll('.home-guild-card.bannerless')
        .forEach(card => {
            applyBannerlessGuildAccent(
                card,
                card.dataset.iconUrl
            );
        });
}

async function activateDeveloperWorkspace(preferredTab = null) {
    if (state.actualRole !== 'developer') {
        showHomeView('servers');
        return;
    }

    fillGuildSelect(state.guilds);
    const selector = document.getElementById('homeDeveloperGuild');
    const rememberedGuild = localStorage.getItem('flummi.guildId');
    const selectedGuild = state.guilds.some(guild => String(guild.id) === String(rememberedGuild))
        ? String(rememberedGuild)
        : String(state.guilds[0]?.id || '');
    selector.innerHTML = state.guilds.length
        ? state.guilds.map(guild => `<option value="${escapeHtml(guild.id)}">${escapeHtml(guild.name)}</option>`).join('')
        : '<option value="">No server context available</option>';
    selector.value = selectedGuild;
    guildSelect.value = selectedGuild;
    state.guildId = selectedGuild || null;
    if (state.guildId) {
        state.role = state.guildRoles.get(String(state.guildId)) || state.role;
        localStorage.setItem('flummi.guildId', state.guildId);
    }
    applyAccessVisibility();
    await loadReleaseCenterSummary();
    if (state.guildId && state.role !== 'member') {
        try {
            await ensureManagementResources();
        } catch (error) {
            const correctionStatus = document.getElementById('analyticsCorrectionStatus');
            if (correctionStatus) setStatus(correctionStatus, `Discord members and channels could not be loaded: ${error.message}`, 'error');
        }
    }

    const requestedTool = preferredTab || new URLSearchParams(window.location.search).get('tool') || localStorage.getItem('flummi.developerTab') || 'global';
    const button = tabButtons.find(candidate => candidate.dataset.tab === requestedTool && fixedDeveloperTabIds.has(candidate.dataset.tab) && !candidate.hidden)
        || tabButtons.find(candidate => candidate.dataset.tab === 'global');
    if (button) button.click();
}

async function openDashboard(guildId, tab = null) {
    const requestedHash = window.location.hash;
    fillGuildSelect(state.guilds);
    const previousGuildId = state.guildId;
    guildSelect.value = String(guildId || state.guilds[0]?.id || '');
    state.guildId = guildSelect.value || null;
    if (!state.guildId) return;
    if (String(previousGuildId || '') !== String(state.guildId)) {
        state.management = null;
        managementChannelsGuildId = null;
    }
    setServerPageTitle(state.guildId);
    state.role = state.guildRoles.get(String(state.guildId)) || state.role;
    localStorage.setItem('flummi.guildId', state.guildId);
    applyAccessVisibility();
    if (state.role !== 'member') await loadManagement();
    document.getElementById('homeShell').hidden = true;
    document.getElementById('dashboardLayout').hidden = false;
    const rememberedDashboardTab = localStorage.getItem('flummi.activeTab');
    const selectedTab = [tab, state.preferences?.defaultTab, rememberedDashboardTab, 'overview'].find(candidate => candidate && !fixedDeveloperTabIds.has(candidate) && tabButtons.some(button => button.dataset.tab === candidate && !button.hidden)) || 'overview';
    const button = tabButtons.find(candidate => candidate.dataset.tab === selectedTab);
    if (button) button.click();
    history.replaceState(null, '', `/?guildId=${encodeURIComponent(state.guildId)}&tab=${encodeURIComponent(selectedTab)}${requestedHash}`);
    await refreshActiveTab();
    if (requestedHash) document.getElementById(requestedHash.slice(1))?.scrollIntoView({ block: 'start' });
}

async function openAccountArea(tab = 'account-profile') {
    const aliases = { 'account-profile': 'profile', profile: 'profile', consent: 'consent', memory: 'memory', notifications: 'notifications', preferences: 'preferences', data: 'data', sessions: 'sessions' };
    const destination = aliases[tab] || 'profile';
    showHomeView('account');
    document.querySelectorAll('[data-account-tab]').forEach(button => button.classList.toggle('active', button.dataset.accountTab === destination));
    document.querySelectorAll('[data-account-panel]').forEach(panel => { panel.hidden = panel.dataset.accountPanel !== destination; });
    document.title = `${destination === 'notifications' ? 'Notifications' : 'Account'} - Flummi`;
    history.replaceState(null, '', `/account?tab=${encodeURIComponent(destination)}`);
    if (destination === 'notifications') await loadNotifications();
    else if (!['data', 'sessions'].includes(destination)) await loadAccountPreferences();
    await window.FlummiAccountFeatures?.load(destination);
    clearPageNotice();
    lastAutoRefreshAt = Date.now();
}

document.querySelector('#dashboardLayout .brand')?.addEventListener('click', event => {
    // Do not hijack the existing Home/Menu buttons inside the brand area.
    if (event.target.closest('button')) return;

    showHomeView('servers');
});

document.querySelectorAll('[data-home-view]').forEach(button => button.addEventListener('click', () => {
    showHomeView(button.dataset.homeView);
    if (button.closest('.home-nav-group')) {
        homeNavPinnedGroup = null;
        homeNavHoveredGroup = null;
        closeHomeNavGroups();
    }
    setHomeMobileMenu(false);
}));
document.getElementById('homeCommandSearch').addEventListener('input', event => renderPublicCommands(event.target.value));
const homeMobileMenuToggle = document.getElementById('homeMobileMenuToggle');
const homeMobileMenuPanel = document.getElementById('homeMobileMenuPanel');
const homeNavigation = document.getElementById('homeNavigation');
const homeNavGroups = [...document.querySelectorAll('.home-nav-group')];
const homeDesktopNavMedia = window.matchMedia('(hover: hover) and (min-width: 821px)');
let homeNavPinnedGroup = null;
let homeNavHoveredGroup = null;

function closeHomeNavGroups(except = null) {
    for (const group of homeNavGroups) {
        if (group !== except) group.removeAttribute('open');
    }
}

function syncDesktopHomeNav() {
    if (!homeDesktopNavMedia.matches) return;
    const visibleGroup = homeNavHoveredGroup || homeNavPinnedGroup;
    for (const group of homeNavGroups) group.toggleAttribute('open', group === visibleGroup);
}

function setHomeMobileMenu(open) {
    const expanded = Boolean(open) && window.matchMedia('(max-width: 820px)').matches;
    homeMobileMenuToggle.setAttribute('aria-expanded', String(expanded));
    homeMobileMenuPanel.classList.toggle('open', expanded);
    homeNavigation.classList.toggle('open', expanded);
    if (!expanded) closeHomeNavGroups();
}

for (const group of homeNavGroups) {
    group.addEventListener('toggle', () => {
        if (!homeDesktopNavMedia.matches && group.open) closeHomeNavGroups(group);
    });
    group.addEventListener('pointerenter', () => {
        if (!homeDesktopNavMedia.matches) return;
        homeNavHoveredGroup = group;
        syncDesktopHomeNav();
    });
    group.addEventListener('pointerleave', () => {
        if (!homeDesktopNavMedia.matches || homeNavHoveredGroup !== group) return;
        homeNavHoveredGroup = null;
        syncDesktopHomeNav();
    });
    group.querySelector('summary')?.addEventListener('click', event => {
        if (!homeDesktopNavMedia.matches) return;
        event.preventDefault();
        homeNavPinnedGroup = homeNavPinnedGroup === group ? null : group;
        syncDesktopHomeNav();
    });
}

document.addEventListener('click', event => {
    if (!event.target.closest('.home-nav-group')) {
        homeNavPinnedGroup = null;
        homeNavHoveredGroup = null;
        closeHomeNavGroups();
    }
    if (homeMobileMenuToggle.getAttribute('aria-expanded') === 'true'
        && !event.target.closest('#homeMobileMenuPanel')
        && !event.target.closest('#homeMobileMenuToggle')) {
        setHomeMobileMenu(false);
    }
});

document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (homeMobileMenuToggle.getAttribute('aria-expanded') === 'true') {
        setHomeMobileMenu(false);
        homeMobileMenuToggle.focus();
        return;
    }
    const openGroup = homeNavGroups.find(group => group.open);
    if (!openGroup) return;
    homeNavPinnedGroup = null;
    homeNavHoveredGroup = null;
    openGroup.removeAttribute('open');
    openGroup.querySelector('summary')?.focus();
});

homeMobileMenuToggle.addEventListener('click', () => setHomeMobileMenu(homeMobileMenuToggle.getAttribute('aria-expanded') !== 'true'));
window.addEventListener('resize', () => {
    homeNavPinnedGroup = null;
    homeNavHoveredGroup = null;
    if (window.innerWidth > 820) setHomeMobileMenu(false);
    else closeHomeNavGroups();
});
document.getElementById('homeGuilds').addEventListener('click', event => {
    const card = event.target.closest('[data-open-guild]');
    if (card) openDashboard(card.dataset.openGuild).catch(handleUiError);
});
document.getElementById('dashboardHome').addEventListener('click', () => showHomeView('servers'));
document.getElementById('homeDeveloperGuild').addEventListener('change', async event => {
    const guildId = event.target.value;
    guildSelect.value = guildId;
    state.guildId = guildId || null;
    state.management = null;
    managementChannelsGuildId = null;
    if (state.guildId) {
        state.role = state.guildRoles.get(String(state.guildId)) || state.role;
        localStorage.setItem('flummi.guildId', state.guildId);
    }
    applyAccessVisibility();
    if (state.guildId && state.role !== 'member') await ensureManagementResources();
    refreshActiveTab().then(clearPageNotice).catch(error => handleUiError(error, () => refreshActiveTab().catch(handleUiError)));
});
document.getElementById('refreshDeveloperTool').addEventListener('click', () => {
    Promise.all([refreshActiveTab(), loadReleaseCenterSummary()]).then(clearPageNotice).catch(error => handleUiError(error, () => refreshActiveTab().catch(handleUiError)));
});

function fillGuildSelect(rows) {
    guildSelect.innerHTML = '';
    state.guildRoles = new Map(rows.map(row => [String(row.id), row.role || 'member']));

    if (!rows.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No guilds available';
        guildSelect.appendChild(option);
        guildSelect.disabled = true;
        showPageNotice(
            state.role !== 'developer'
                ? 'No shared server is currently available with Administrator permission.'
                : 'Flummi is not currently connected to a server.',
            { type: 'warn', actionLabel: 'Refresh Discord access', action: refreshDiscordSignIn }
        );
        return;
    }

    clearPageNotice();
    guildSelect.disabled = false;
    for (const row of rows) {
        const option = document.createElement('option');
        option.value = row.id;
        option.textContent = row.name;
        guildSelect.appendChild(option);
    }
}

async function loadGuilds() {
    const data = await api('/api/guilds');
    fillGuildSelect(data.guilds || []);

    const requestedGuildId = new URLSearchParams(window.location.search).get('guildId');
    const rememberedGuildId = localStorage.getItem('flummi.guildId');

    if (requestedGuildId && (data.guilds || []).some(guild => guild.id === requestedGuildId)) {
        guildSelect.value = requestedGuildId;
    } else if (rememberedGuildId && (data.guilds || []).some(guild => guild.id === rememberedGuildId)) {
        guildSelect.value = rememberedGuildId;
    }

    state.guildId = guildSelect.value || null;
    if (state.guildId) state.role = state.guildRoles.get(String(state.guildId)) || state.role;
    applyAccessVisibility();
    if (state.guildId) localStorage.setItem('flummi.guildId', state.guildId);
    if (state.guildId && state.role !== 'member') await ensureManagementResources();
    await refreshActiveTab();
}

guildSelect.addEventListener('change', async () => {
    state.guildId = guildSelect.value || null;
    if (state.guildId && !document.getElementById('dashboardLayout').hidden) setServerPageTitle(state.guildId);
    if (state.guildId) state.role = state.guildRoles.get(String(state.guildId)) || state.role;
    state.management = null;
    managementChannelsGuildId = null;
    applyAccessVisibility();
    if (state.guildId) localStorage.setItem('flummi.guildId', state.guildId);
    if (state.guildId && state.role !== 'member') await ensureManagementResources();
    refreshActiveTab().then(clearPageNotice).catch(error => handleUiError(error, () => refreshActiveTab().catch(handleUiError)));
});

document.getElementById('refreshAll').addEventListener('click', () => {
    refreshActiveTab().then(clearPageNotice).catch(error => handleUiError(error, () => refreshActiveTab().catch(handleUiError)));
});

// Passive refreshes must never redraw tabs that contain unsaved editors. The short
// interaction grace period also prevents a background redraw while someone is using
// filters, search fields, players, or pagination elsewhere in the panel.
const tabsExcludedFromAutoRefresh = new Set(['messenger', 'triggers', 'users', 'settings', 'management', 'management-moderation', 'management-automod', 'management-cases', 'management-roles', 'management-automation', 'profiles', 'ai', 'global', 'files', 'experiments']);
let lastPanelInteractionAt = 0;

function shouldSkipPassiveRefresh(tab = activeTab()) {
    if (tabsExcludedFromAutoRefresh.has(tab)) return true;
    const activePanel = document.getElementById(`tab-${tab}`);
    const focusedControl = activePanel?.contains(document.activeElement)
        && document.activeElement?.matches?.('input, select, textarea, button, [contenteditable="true"]');
    return focusedControl || Date.now() - lastPanelInteractionAt < 15000 || Boolean(document.querySelector('dialog[open]'));
}

for (const eventName of ['input', 'change', 'pointerdown']) {
    document.addEventListener(eventName, event => {
        if (event.target.closest?.('.tab-panel.active') && event.target.closest?.('input, select, textarea, button, [contenteditable="true"]')) {
            lastPanelInteractionAt = Date.now();
        }
    }, true);
}

let chartResizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(chartResizeTimer);
    chartResizeTimer = setTimeout(() => {
        if (state.guildId && !shouldSkipPassiveRefresh()) refreshActiveTab().catch(error => console.error(error));
    }, 120);
});

// Tabs with editable form fields, or ones that hit rate-limited Discord APIs, are skipped from the poll.
// Voice activity changes constantly, so it gets a much faster refresh than the rest.
const AUTO_REFRESH_MS = 20000;
const TAB_REFRESH_OVERRIDES = { voice: 5000 };
let autoRefreshBusy = false;
let lastAutoRefreshAt = 0;

setInterval(() => {
    if (autoRefreshBusy || !state.guildId || !isDashboardVisible() || document.visibilityState !== 'visible') {
        return;
    }

    const tab = activeTab();

    if (shouldSkipPassiveRefresh(tab)) {
        return;
    }

    const interval = TAB_REFRESH_OVERRIDES[tab] || AUTO_REFRESH_MS;

    if (Date.now() - lastAutoRefreshAt < interval) {
        return;
    }

    lastAutoRefreshAt = Date.now();
    autoRefreshBusy = true;
    refreshActiveTab()
        .catch(error => console.error(error))
        .finally(() => {
            autoRefreshBusy = false;
        });
}, 1000);

function updateLiveDurations() {
    const now = Date.now();
    document.querySelectorAll('[data-live-duration]').forEach(element => {
        const startedAt = new Date(element.dataset.liveDuration).getTime();
        if (Number.isNaN(startedAt)) {
            element.textContent = '-';
            return;
        }

        const elapsedSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
        if (element.dataset.liveSecond === String(elapsedSeconds)) return;
        element.dataset.liveSecond = String(elapsedSeconds);
        element.textContent = formatDuration(elapsedSeconds * 1000);
    });
}

// Align with the real clock rather than a drifting fixed interval. A table redraw is also
// filled immediately, so durations do not flash empty during an automatic refresh.
function scheduleLiveDurationUpdate() {
    if (document.visibilityState === 'visible') updateLiveDurations();
    const delay = Math.max(80, 1000 - (Date.now() % 1000) + 12);
    setTimeout(scheduleLiveDurationUpdate, delay);
}

scheduleLiveDurationUpdate();

// ---------- Overview ----------
function renderGuildHeader(containerId, guildInfo) {
    const container = document.getElementById(containerId);

    if (!guildInfo) {
        container.innerHTML = '';
        return;
    }

    const bannerStyle = guildInfo.bannerUrl
        ? backgroundUrlStyle(guildInfo.bannerUrl)
        : '';
    const iconStyle = guildInfo.iconUrl
        ? `background-image: url('${guildInfo.iconUrl.replace(/'/g, '%27')}');`
        : '';

    container.innerHTML = `
        <div class="guild-header">
            <div class="guild-banner${guildInfo.bannerUrl ? '' : ' guild-banner-fallback'}" style="${bannerStyle}"></div>
            <div class="guild-info">
                <div class="guild-icon" style="${iconStyle}"></div>
                <div class="guild-meta">
                    <h2>${escapeHtml(guildInfo.name)}</h2>
                    <p>${guildInfo.description ? escapeHtml(guildInfo.description) : `${escapeHtml(guildInfo.totalMemberCount)} total members &middot; created ${escapeHtml(formatDateTime(guildInfo.createdAt))}`}</p>
                </div>
            </div>
        </div>
    `;

    if (!guildInfo.bannerUrl && guildInfo.iconUrl) {
        const header =
            container.querySelector('.guild-header');

        const fallbackBanner =
            container.querySelector(
                '.guild-banner-fallback'
            );

        getImageAverageColor(
            guildInfo.iconUrl
        ).then(color => {
            if (
                !color ||
                !header?.isConnected ||
                !fallbackBanner?.isConnected
            ) {
                return;
            }

            header.style.setProperty(
                '--guild-accent',
                color
            );

            fallbackBanner.style.background =
                color;
        });
    }

}

function guildInfoStatCards(guildInfo) {
    if (!guildInfo) {
        return '';
    }

    return [
        statCard('Members', guildInfo.memberCount ?? 'Unavailable'),
        statCard('Bots', guildInfo.botCount ?? 'Unavailable'),
        statCard('Channels', guildInfo.channelCount),
        statCard('Roles', guildInfo.roleCount),
        statCard('Boost Tier', guildInfo.boostTier === '0' ? 'None' : `Level ${guildInfo.boostTier} (${guildInfo.boostCount} boosts)`),
        statCard('Verification Level', guildInfo.verificationLevel),
        statCard('Server Created', formatDateTime(guildInfo.createdAt))
    ].join('');
}

function renderOverviewCards(containerId, guildInfo, data) {
    const container = document.getElementById(containerId);

    if (!guildInfo) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = [
        statCard('Members', guildInfo.memberCount ?? 'Unavailable'),
        statCard('Bots', guildInfo.botCount ?? 'Unavailable'),
        statCard('Channels', guildInfo.channelCount),
        statCard('Total Messages Tracked', data.totalMessages),
        statCard('Triggers', `${data.triggerCount} / ${data.triggerLimit}`),
        statCard('Members in Voice Now', data.activeVoiceCount),
        statCard('Total Voice Time Tracked', data.totalVoiceFormatted),
        statCard('Admins', data.adminCount ?? 'Unavailable')
    ].join('');
}

function renderOverviewDetails(containerId, guildInfo) {
    const container = document.getElementById(containerId);

    if (!guildInfo) {
        container.innerHTML = '<p class="sub">No server details available.</p>';
        return;
    }

    const rows = [
        ['Roles', guildInfo.roleCount],
        ['Boost Tier', guildInfo.boostTier === '0' ? 'None' : `Level ${guildInfo.boostTier} (${guildInfo.boostCount} boosts)`],
        ['Verification Level', guildInfo.verificationLevel],
        ['Server Created', formatDateTime(guildInfo.createdAt)],
        ['Server Owner', guildInfo.ownerTag || 'Unknown']
    ];

    container.innerHTML = rows.map(([label, value]) => `
        <div class="detail-row">
            <span class="detail-label">${escapeHtml(uiText(label))}</span>
            <span class="detail-value">${escapeHtml(uiValue(value))}</span>
        </div>
    `).join('');
}

function renderOverviewHealth(health) {
    const container = document.getElementById('overviewHealth');
    if (!health) {
        container.innerHTML = '<div class="empty">Server health is unavailable right now.</div>';
        return;
    }
    const tone = health.critical ? 'error' : health.warnings ? 'warn' : 'ok';
    const headline = health.critical ? 'Action needed' : health.warnings ? 'Review recommended' : 'Everything looks healthy';
    const checks = (health.checks || []).slice(0, 3);
    container.innerHTML = `
        <div class="overview-health-summary"><strong>${escapeHtml(String(health.score))}<small>/100</small></strong><span><b>${escapeHtml(uiText(headline))}</b><small>${health.critical} critical · ${health.warnings} warnings${health.info ? ` · ${health.info} informational` : ''}</small></span><span class="badge ${tone}">${escapeHtml(uiText(health.critical ? 'Fix now' : health.warnings ? 'Review' : 'Healthy'))}</span></div>
        ${checks.length ? `<div class="overview-health-issues">${checks.map(check => `<article class="${escapeHtml(check.severity)}"><i aria-hidden="true"></i><span><strong>${escapeHtml(check.title)}</strong><small>${escapeHtml(check.fix || check.detail)}</small></span></article>`).join('')}</div>` : '<div class="contextual-empty empty-positive"><strong>No problems found</strong><span>Flummi can reach its configured resources and has the expected permissions.</span></div>'}
    `;
}

function renderOverviewChanges(entries = []) {
    const container = document.getElementById('overviewRecentChanges');
    if (!entries.length) {
        container.innerHTML = '<div class="empty">No dashboard changes or automatic actions yet.</div>';
        return;
    }
    container.innerHTML = entries.map(entry => {
        const actor = entry.actorName || entry.username || (entry.source === 'panel' ? 'Dashboard' : 'Flummi');
        const label = entry.message || entry.summary || entry.type || 'Server action';
        return `<article class="overview-change-item"><span class="overview-change-dot" aria-hidden="true"></span><span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(actor)} · ${escapeHtml(formatDateTime(entry.at))}</small></span>${entry.undoable ? `<button class="secondary compact" type="button" data-undo-change="${escapeHtml(entry.changeId)}">Undo</button>` : ''}</article>`;
    }).join('');
}

function renderModuleInsights(entries = []) {
    const container = document.getElementById('overviewModuleInsights');
    const visible = entries.filter(entry => entry.enabled || entry.recommendation || entry.events30d);
    container.innerHTML = visible.length ? visible.map(entry => `<article class="module-insight-card ${entry.recommendation ? 'attention' : ''}"><div><strong>${escapeHtml(managementModuleDefinitions[entry.key]?.label || entry.key)}</strong><span class="badge ${entry.enabled ? 'ok' : ''}">${entry.enabled ? 'Enabled' : 'Paused'}</span></div><p>${entry.events30d} event${entry.events30d === 1 ? '' : 's'} in 30 days${entry.lastActivityAt ? ` · Last ${escapeHtml(formatDateTime(entry.lastActivityAt))}` : ''}</p>${entry.recommendation ? `<small>${escapeHtml(entry.recommendation)}</small>` : '<small>Configured and no attention is needed.</small>'}<button class="secondary compact" type="button" data-open-module="${escapeHtml(entry.key)}">Open module</button></article>`).join('') : '<div class="empty">No module activity or recommendations yet.</div>';
}

async function loadAttentionCentre() {
    const container = document.getElementById('overviewAttentionCentre');
    if (!container || !state.guildId || !['developer', 'admin'].includes(state.role)) return;
    const data = await api(withGuild('/api/management/attention'));
    const items = data.items || [];
    container.innerHTML = items.length ? items.map(item => `<button type="button" class="attention-item ${escapeHtml(item.severity)}" data-attention-tab="${escapeHtml(item.tab)}"><span class="attention-count">${Number(item.count) || 0}</span><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}</small></span><span aria-hidden="true">→</span></button>`).join('') : '<div class="contextual-empty empty-positive"><strong>You are all caught up</strong><span>No reports, incidents, failed actions, or critical checks need attention.</span></div>';
}

document.getElementById('refreshAttentionCentre').addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    try { await loadAttentionCentre(); } catch (error) { handleUiError(error); }
    finally { event.currentTarget.disabled = false; }
});

document.getElementById('overviewAttentionCentre').addEventListener('click', event => {
    const item = event.target.closest('[data-attention-tab]');
    if (!item) return;
    document.querySelector(`.tab-btn[data-tab="${item.dataset.attentionTab}"]`)?.click();
});

document.getElementById('dashboardLayout').addEventListener('click', async event => {
    const moduleButton = event.target.closest('[data-open-module]');
    if (moduleButton) {
        const definition = managementModuleDefinitions[moduleButton.dataset.openModule];
        document.querySelector(`.tab-btn[data-tab="${definition?.tab}"]`)?.click();
        return;
    }
    const undoButton = event.target.closest('[data-undo-change]');
    if (!undoButton) return;
    const confirmed = await confirmAction({ title: 'Undo this settings change?', message: 'The server settings snapshot from before this change will be restored.', confirmLabel: 'Undo change', danger: false });
    if (!confirmed) return;
    try {
        undoButton.disabled = true;
        const result = await api(withGuild('/api/settings/undo'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: undoButton.dataset.undoChange }) });
        state.management = result.settings.management; state.settingsRevision = result.revision;
        await loadOverview();
    } catch (error) { handleUiError(error); undoButton.disabled = false; }
});

function showChartTooltip(event, row, metricLabel) {
    const tooltip = document.getElementById('chartTooltip');
    const timestamp = row.granularity === 'hour' ? `${row.date}:00` : row.date;
    let coverage = '';
    if (row.coverageStatus === 'unknown') {
        coverage = '<br><span class="chart-coverage-detail unknown">Data coverage: not recorded for this full period</span>';
    } else if (Number.isFinite(row.coveragePercent)) {
        const offline = Number(row.coverageOfflineMs) > 0 ? ` · ${formatDuration(row.coverageOfflineMs)} unavailable` : '';
        coverage = `<br><span class="chart-coverage-detail ${escapeHtml(row.coverageStatus || 'complete')}">Data coverage: ${escapeHtml(String(row.coveragePercent))}%${escapeHtml(offline)}</span>`;
    }
    tooltip.innerHTML = `<strong>${escapeHtml(formatDateTime(timestamp))}</strong><br>${escapeHtml(metricLabel)}: ${escapeHtml(String(Number(row.count) || 0))}${coverage}`;
    tooltip.classList.add('visible');
    positionFloatingElement(tooltip, {
        left: event.clientX,
        right: event.clientX,
        top: event.clientY,
        bottom: event.clientY,
        width: 0,
        height: 0
    });
}

function summarizeChartCoverage(rows, allowUnknownAverage = false) {
    const tracked = rows.filter(row => row.coverageStatus);
    if (!tracked.length) return {};
    const finite = tracked.filter(row => Number.isFinite(row.coveragePercent));
    const coverageUnknownCount = tracked.length - finite.length;
    if (!finite.length || (coverageUnknownCount && !allowUnknownAverage)) return { coveragePercent: null, coverageStatus: 'unknown', coverageUnknownCount, coverageReason: 'Coverage was not recorded for this complete period.' };
    const coveragePercent = Math.round(finite.reduce((total, row) => total + row.coveragePercent, 0) / finite.length);
    return {
        coveragePercent,
        coverageStatus: coverageUnknownCount ? 'partial' : coveragePercent >= 99 ? 'complete' : coveragePercent > 0 ? 'partial' : 'missing',
        coverageUnknownCount,
        coverageOfflineMs: finite.reduce((total, row) => total + (Number(row.coverageOfflineMs) || 0), 0),
        coverageReason: finite.some(row => row.coverageReason) ? 'Includes bot availability for this period.' : ''
    };
}

function chartCoverageColor(row) {
    if (row.coverageStatus === 'unknown') return '#a5b1d8';
    if (row.coverageStatus === 'missing') return '#ff6b7a';
    if (row.coverageStatus === 'partial') return '#ffc267';
    return '#63e6be';
}

function hideChartTooltip() {
    document.getElementById('chartTooltip').classList.remove('visible');
}

function bindChartHover(container, values, metricLabel) {
    container.querySelectorAll('[data-chart-index]').forEach(element => {
        const row = values[Number(element.dataset.chartIndex)];
        element.addEventListener('pointermove', event => showChartTooltip(event, row, metricLabel));
        element.addEventListener('pointerleave', hideChartTooltip);
    });
}

async function ensureAnalyticsChannelFilter(selectId, endpoint) {
    const select = document.getElementById(selectId);
    if (!state.guildId || select.dataset.guildId === state.guildId) return;
    const previousValue = select.value;
    const data = await api(withGuild(endpoint));
    select.innerHTML = '<option value="">All channels</option>';
    for (const channel of data.channels || []) {
        const option = document.createElement('option');
        option.value = channel.id;
        option.textContent = `#${channel.name}`;
        select.appendChild(option);
    }
    if (previousValue && (data.channels || []).some(channel => channel.id === previousValue)) select.value = previousValue;
    select.dataset.guildId = state.guildId;
}

function renderActivityChart(containerId, rows, emptyMessage, chartType = 'bar', metricLabel = 'Events') {
    const container = document.getElementById(containerId);
    const sourceValues = Array.isArray(rows) ? rows : [];
    if (!sourceValues.length) {
        container.innerHTML = `<div class="empty">${escapeHtml(emptyMessage)}</div>`;
        return;
    }
    const compact = container.classList.contains('compact');
    const containerStyle = window.getComputedStyle(container);
    const horizontalPadding = parseFloat(containerStyle.paddingLeft) + parseFloat(containerStyle.paddingRight);
    const width = Math.max(compact ? 220 : 320, Math.floor((container.clientWidth || 640) - horizontalPadding));
    const height = compact ? 76 : 160;
    const hourly = sourceValues.some(row => row.granularity === 'hour');
    const maxPoints = hourly ? sourceValues.length : Math.max(compact ? 6 : 7, Math.floor(width / (compact ? 34 : 68)));
    const values = [];
    for (let index = 0; index < sourceValues.length; index += Math.ceil(sourceValues.length / maxPoints)) {
        const group = sourceValues.slice(index, index + Math.ceil(sourceValues.length / maxPoints));
        values.push({
            date: group.length === 1 ? group[0].date : `${group[0].date} – ${group[group.length - 1].date}`,
            count: group.reduce((total, row) => total + (Number(row.count) || 0), 0),
            granularity: group.length === 1 ? group[0].granularity : null,
            ...summarizeChartCoverage(group)
        });
    }
    const maximum = Math.max(1, ...values.map(row => Number(row.count) || 0));
    const left = compact ? 4 : 42;
    // Reserve enough space for the final bar/point and its label on every chart,
    // including the compact Overview graphs.
    const right = 36;
    const top = 12;
    const bottom = compact ? 8 : 29;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const barWidth = chartType === 'bar' ? Math.min(34, Math.max(5, plotWidth / values.length * .62)) : 0;
    // Keep the first and last bars inside the plot area. Without this inset the
    // first bar extends left of the Y axis and covers its scale labels.
    const horizontalInset = chartType === 'bar' ? barWidth / 2 : 0;
    const pointWidth = Math.max(0, plotWidth - horizontalInset * 2);
    const points = values.map((row, index) => {
        const x = values.length === 1 ? left + plotWidth / 2 : left + horizontalInset + index * (pointWidth / (values.length - 1));
        const y = top + (1 - ((Number(row.count) || 0) / maximum)) * plotHeight;
        return { x, y };
    });
    const canvas = document.createElement('canvas');
    const scale = window.devicePixelRatio || 1;
    canvas.className = 'analytics-canvas';
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    canvas.style.height = `${height}px`;
    canvas.setAttribute('role', 'img');
    const chartCoverage = summarizeChartCoverage(values, true);
    const coverageAria = Number.isFinite(chartCoverage.coveragePercent) ? `, ${chartCoverage.coveragePercent}% data coverage` : chartCoverage.coverageStatus === 'unknown' ? ', data coverage unknown' : '';
    canvas.setAttribute('aria-label', uiText(`${metricLabel} over time${coverageAria}`));
    container.replaceChildren(canvas);
    if (chartCoverage.coverageStatus) {
        const coverageBadge = document.createElement('span');
        coverageBadge.className = `analytics-coverage-summary ${chartCoverage.coverageStatus}`;
        coverageBadge.textContent = Number.isFinite(chartCoverage.coveragePercent)
            ? `${chartCoverage.coveragePercent}% coverage${chartCoverage.coverageUnknownCount ? ` · ${chartCoverage.coverageUnknownCount} unknown` : ''}`
            : 'Coverage unknown';
        coverageBadge.title = Number.isFinite(chartCoverage.coverageOfflineMs) && chartCoverage.coverageOfflineMs > 0
            ? `${formatDuration(chartCoverage.coverageOfflineMs)} without reliable bot data in the visible buckets.`
            : chartCoverage.coverageReason || 'Data coverage for the visible buckets.';
        container.append(coverageBadge);
    }
    const context = canvas.getContext('2d');
    context.scale(scale, scale);
    context.font = '11px Segoe UI, sans-serif';
    context.textBaseline = 'middle';
    if (!compact) {
        for (const value of [maximum, Math.ceil(maximum / 2), 0]) {
            const y = top + (1 - value / maximum) * plotHeight;
            context.strokeStyle = '#243157'; context.setLineDash([3, 4]);
            context.beginPath(); context.moveTo(left, y); context.lineTo(width - right, y); context.stroke();
            context.setLineDash([]); context.fillStyle = '#a5b1d8'; context.textAlign = 'right'; context.fillText(String(value), left - 7, y);
        }
        context.textAlign = 'center'; context.textBaseline = 'alphabetic'; context.fillStyle = '#a5b1d8';
        const labelEvery = hourly ? Math.max(1, Math.ceil(values.length / Math.max(4, Math.floor(width / 58)))) : 1;
        points.forEach((point, index) => {
            if (index % labelEvery && index !== values.length - 1) return;
            const row = values[index];
            const label = row.granularity === 'hour' ? `${String(row.date).slice(11, 13)}:00` : String(row.date).slice(5, 10);
            context.fillText(label, point.x, height - 7);
        });
    }
    if (chartType === 'line') {
        context.strokeStyle = '#75cfff'; context.lineWidth = 3; context.lineJoin = 'round'; context.lineCap = 'round';
        for (let index = 1; index < points.length; index++) {
            const incomplete = [values[index - 1], values[index]].some(row => row.coverageStatus && row.coverageStatus !== 'complete');
            context.setLineDash(incomplete ? [5, 5] : []);
            context.beginPath(); context.moveTo(points[index - 1].x, points[index - 1].y); context.lineTo(points[index].x, points[index].y); context.stroke();
        }
        context.setLineDash([]);
        context.fillStyle = '#8be0ff';
        points.forEach((point, index) => {
            context.beginPath(); context.arc(point.x, point.y, 4, 0, Math.PI * 2); context.fill();
            if (!values[index].coverageStatus) return;
            context.strokeStyle = chartCoverageColor(values[index]); context.lineWidth = 2; context.beginPath(); context.arc(point.x, point.y, 6, 0, Math.PI * 2); context.stroke();
        });
    } else {
        points.forEach((point, index) => {
            const gradient = context.createLinearGradient(0, point.y, 0, top + plotHeight);
            gradient.addColorStop(0, '#83d9ff'); gradient.addColorStop(1, '#4e6bff'); context.fillStyle = gradient;
            const barHeight = Math.max(2, top + plotHeight - point.y);
            context.beginPath(); context.roundRect(point.x - barWidth / 2, point.y, barWidth, barHeight, 4); context.fill();
            const row = values[index];
            if (!row.coverageStatus) return;
            if (row.coverageStatus !== 'complete') {
                context.save(); context.beginPath(); context.roundRect(point.x - barWidth / 2, point.y, barWidth, barHeight, 4); context.clip();
                context.strokeStyle = chartCoverageColor(row); context.globalAlpha = .72; context.lineWidth = 1;
                for (let offset = -barHeight; offset < barWidth + barHeight; offset += 6) {
                    context.beginPath(); context.moveTo(point.x - barWidth / 2 + offset, point.y + barHeight); context.lineTo(point.x - barWidth / 2 + offset + barHeight, point.y); context.stroke();
                }
                context.restore();
            }
            context.fillStyle = chartCoverageColor(row); context.beginPath(); context.arc(point.x, Math.max(5, point.y - 7), 3, 0, Math.PI * 2); context.fill();
        });
    }
    canvas.addEventListener('pointermove', event => {
        const bounds = canvas.getBoundingClientRect();
        const relativeX = event.clientX - bounds.left;
        const index = values.length === 1 ? 0 : Math.max(0, Math.min(values.length - 1, Math.round((relativeX - left - horizontalInset) / Math.max(1, pointWidth) * (values.length - 1))));
        showChartTooltip(event, values[index], metricLabel);
    });
    canvas.addEventListener('pointerleave', hideChartTooltip);
}

function renderChartAnnotations(containerId, annotations = []) {
    const container = document.getElementById(containerId);
    container.querySelector('.analytics-annotations')?.remove();
    container.classList.toggle('has-annotations', Boolean(annotations.length));
    if (!annotations.length) return;
    const list = document.createElement('div');
    list.className = 'analytics-annotations';
    list.setAttribute('aria-label', 'Events affecting this graph');
    list.innerHTML = annotations.slice(0, 8).map(row => `<span title="${escapeHtml(`${row.label}${Number(row.count) > 1 ? ` (${row.count} events)` : ''}`)}"><i></i>${escapeHtml(new Date(row.at).toLocaleDateString(uiLocale(), { day: 'numeric', month: 'short' }))} · ${escapeHtml(row.label)}${Number(row.count) > 1 ? `<b>${escapeHtml(String(row.count))}×</b>` : ''}</span>`).join('');
    container.append(list);
}

function renderHeatmap(containerId, rows) {
    const container = document.getElementById(containerId);
    const values = Array.isArray(rows) ? rows : Array.from({ length: 7 }, () => Array(24).fill(0));
    const maximum = Math.max(1, ...values.flat().map(Number));
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const heatmapRows = values.map((day, dayIndex) => `<span class="heatmap-label">${days[dayIndex]}</span>${day.map((count, hour) => `<span class="heatmap-cell" title="${days[dayIndex]} ${String(hour).padStart(2, '0')}:00 UTC: ${Number(count) || 0}" style="background:rgba(117,207,255,${0.08 + (Number(count) || 0) / maximum * .88})"></span>`).join('')}`).join('');
    const hours = `<span></span>${Array.from({ length: 24 }, (_, hour) => `<span class="heatmap-hour">${String(hour).padStart(2, '0')}</span>`).join('')}`;
    container.innerHTML = `${heatmapRows}${hours}`;
}

const heatmapWeekOffsets = { message: 0, voice: 0 };

function utcWeekRange(offset = 0) {
    const today = new Date();
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7) + offset * 7);
    const end = new Date(start.getTime() + 7 * 86400000);
    return { start, end };
}

function formatHeatmapWeek(start, end) {
    const format = date => date.toLocaleDateString(uiLocale(), { day: 'numeric', month: 'short', timeZone: 'UTC' });
    return `${format(start)} – ${format(new Date(end.getTime() - 1))} ${start.getUTCFullYear()}`;
}

async function loadActivityHeatmap(kind) {
    const isMessage = kind === 'message';
    const mode = document.getElementById(`${kind}HeatmapMode`).value;
    const weekControls = document.getElementById(`${kind}HeatmapWeekControls`);
    const nextButton = document.getElementById(`${kind}HeatmapNextWeek`);
    const params = new URLSearchParams({ activity: isMessage ? 'messages' : 'voice' });
    const channelId = document.getElementById(isMessage ? 'analyticsChannel' : 'voiceGraphChannel').value;
    if (channelId) params.set('channelId', channelId);
    if (isMessage) {
        const userId = document.getElementById('analyticsMember').value;
        if (userId) params.set('userId', userId);
    }

    weekControls.hidden = mode !== 'weekly';
    if (mode === 'weekly') {
        const { start, end } = utcWeekRange(heatmapWeekOffsets[kind]);
        params.set('from', start.toISOString());
        params.set('to', new Date(end.getTime() - 1).toISOString());
        document.getElementById(`${kind}HeatmapWeekLabel`).textContent = formatHeatmapWeek(start, end);
        nextButton.disabled = heatmapWeekOffsets[kind] >= 0;
    }

    const data = await api(withGuild(`/api/activity-heatmap?${params.toString()}`));
    renderHeatmap(`${kind}Heatmap`, data.heatmap);
}

function installHeatmapControls(kind) {
    document.getElementById(`${kind}HeatmapMode`).addEventListener('change', () => {
        heatmapWeekOffsets[kind] = 0;
        loadActivityHeatmap(kind).catch(error => console.error(error));
    });
    document.getElementById(`${kind}HeatmapPreviousWeek`).addEventListener('click', () => {
        heatmapWeekOffsets[kind]--;
        loadActivityHeatmap(kind).catch(error => console.error(error));
    });
    document.getElementById(`${kind}HeatmapNextWeek`).addEventListener('click', () => {
        if (heatmapWeekOffsets[kind] >= 0) return;
        heatmapWeekOffsets[kind]++;
        loadActivityHeatmap(kind).catch(error => console.error(error));
    });
}

installHeatmapControls('message');
installHeatmapControls('voice');

async function loadOverview() {
    if (!state.guildId) return;
    const data = await api(withGuild('/api/overview'));
    const banner = document.getElementById('overviewBanner');

    renderGuildHeader('guildHeader', data.guildInfo);
    renderOverviewCards('overviewCards', data.guildInfo, data);
    renderOverviewDetails('overviewDetails', data.guildInfo);
    if (['developer', 'admin'].includes(state.role)) {
        renderOverviewHealth(data.health);
        renderOverviewChanges(data.recentChanges || []);
        renderModuleInsights(data.moduleInsights || []);
        await loadAttentionCentre();
    }
    const localFeatures = data.settings?.features || {};
    state.globalFeatures = data.globalFeatures || state.globalFeatures || {};
    applyGlobalFeatureNavigation();
    const featureRows = [
        ['Bot', data.settings?.botEnabled, null], ['Triggers', data.settings?.triggersEnabled, 'triggersEnabled'],
        ['AI conversations', localFeatures.aiConversationsEnabled, 'aiConversationsEnabled'], ['AI attachments', localFeatures.aiAttachmentsEnabled, 'aiAttachmentsEnabled'],
        ['Image search', localFeatures.aiImageSearchEnabled, 'aiImageSearchEnabled'], ['Ping responses', localFeatures.pingResponsesEnabled, 'pingResponsesEnabled'],
        ['Save pings', localFeatures.pingRequestSaveEnabled, 'pingRequestSaveEnabled']
    ];
    document.getElementById('overviewFeatures').innerHTML = featureRows.map(([label, enabled, globalKey]) => {
        const globallyDisabled = globalKey && state.globalFeatures?.[globalKey] === false;
        return globallyDisabled
            ? statCard(label, 'Off', 'This feature is temporarily turned off globally.', '!')
            : statCard(label, enabled === false ? 'Off' : 'On');
    }).join('');

    if (data.missingPermissions && data.missingPermissions.length > 0) {
        banner.innerHTML = `<div class="banner warn">Bot is missing permissions in this server: <strong>${escapeHtml(data.missingPermissions.join(', '))}</strong>. <a href="${escapeHtml(data.inviteUrl)}" target="_blank" rel="noopener">Click here to reinvite with the correct permissions</a>.</div>`;
    } else {
        banner.innerHTML = '<div class="banner ok">The bot has all required permissions in this server.</div>';
    }

    renderTable(document.getElementById('overviewChannels'),
        [
            { label: 'Channel', render: r => `#${escapeHtml(r.name)}`, sortValue: r => r.name },
            { label: 'Messages', key: 'count' }
        ],
        data.topChannels, 'No messages tracked yet.');

    renderTable(document.getElementById('overviewVoiceChannels'),
        [
            { label: 'Channel', render: r => escapeHtml(r.channelName || r.channelId || 'Unknown channel'), sortValue: r => r.channelName || r.channelId || '' },
            { label: 'Voice Time', render: r => formatDuration(r.totalMs), sortValue: r => r.totalMs },
            { label: 'Sessions', key: 'sessions' }
        ],
        data.topVoiceChannels, 'No voice activity tracked yet.');
}

document.getElementById('openServerDoctor').addEventListener('click', () => {
    tabButtons.find(button => button.dataset.tab === 'management-server-doctor')?.click();
});

document.getElementById('openAuditLog').addEventListener('click', () => {
    tabButtons.find(button => button.dataset.tab === 'audit')?.click();
});

// ---------- Messenger ----------
const channelSelect = document.getElementById('channel');
const messageField = document.getElementById('message');
const sendStatusField = document.getElementById('sendStatus');
const counterField = document.getElementById('counter');
const imageUrlsField = document.getElementById('imageUrls');
const allowEveryoneField = document.getElementById('allowEveryone');
const pingUserIdField = document.getElementById('pingUserId');

function setStatus(field, text, kind) {
    field.textContent = text || '';
    field.className = 'status';
    if (kind) field.classList.add(kind);
    if (kind === 'error' && /Refresh your Discord sign-in/i.test(String(text || ''))) {
        const button = document.createElement('button');
        button.className = 'status-refresh-button';
        button.type = 'button';
        button.textContent = 'Refresh Discord sign-in';
        button.addEventListener('click', refreshDiscordSignIn);
        field.appendChild(button);
    }
    field.hidden = !field.textContent.trim();
}

function updateCounter() {
    counterField.textContent = `${messageField.value.length} / 2000`;
}

messageField.addEventListener('input', updateCounter);
updateCounter();

async function loadMessengerChannels() {
    if (!state.guildId) return;
    setStatus(sendStatusField, 'Loading channels...');
    const data = await api(withGuild('/api/channels'));
    channelSelect.innerHTML = '';

    if (!data.channels || data.channels.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No sendable channels found';
        channelSelect.appendChild(option);
        channelSelect.disabled = true;
    } else {
        channelSelect.disabled = false;
        for (const row of data.channels) {
            const option = document.createElement('option');
            option.value = row.id;
            option.textContent = `#${row.name}`;
            channelSelect.appendChild(option);
        }
    }

    setStatus(sendStatusField, 'Channels loaded.', 'ok');
}

document.getElementById('send').addEventListener('click', () => {
    sendMessage().catch(error => setStatus(sendStatusField, error.message, 'error'));
});

async function sendMessage() {
    const channelId = channelSelect.value;
    const content = messageField.value;
    const imageUrls = imageUrlsField.value.split('\n').map(l => l.trim()).filter(Boolean);
    const allowEveryoneMentions = allowEveryoneField.checked;
    const pingUserId = pingUserIdField.value.trim();

    if (pingUserId && !/^\d{15,21}$/.test(pingUserId)) {
        setStatus(sendStatusField, 'Choose an available server member to mention.', 'error');
        return;
    }

    const composedContent = `${pingUserId ? `<@${pingUserId}> ` : ''}${content}`;

    if (!state.guildId || !channelId) {
        setStatus(sendStatusField, 'Select a guild and channel first.', 'error');
        return;
    }

    if (!composedContent.trim() && imageUrls.length === 0) {
        setStatus(sendStatusField, 'Message cannot be empty unless you add image URLs.', 'error');
        return;
    }

    setStatus(sendStatusField, 'Sending...');

    try {
        const data = await api('/api/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                guildId: state.guildId,
                channelId,
                content: composedContent,
                imageUrls,
                allowEveryoneMentions
            })
        });

        messageField.value = '';
        imageUrlsField.value = '';
        updateCounter();
        setStatus(sendStatusField, `Sent. Message link: ${data.message.url}`, 'ok');
    } catch (error) {
        setStatus(sendStatusField, error.message, 'error');
    }
}

// ---------- Triggers ----------
async function loadTriggers() {
    if (!state.guildId) return;
    const data = await api(withGuild('/api/triggers'));
    const triggers = Array.isArray(data?.triggers) ? data.triggers : [];
    const canManageTriggers = ['developer', 'admin'].includes(state.role);

    document.getElementById('triggerCards').innerHTML = [
        statCard('Triggers', `${triggers.length} / ${data?.limit ?? 0}`),
        statCard('Total Uses Tracked', triggers.reduce((sum, t) => sum + (t.uses || 0), 0))
    ].join('');

    const triggerColumns = [
        { label: 'Phrase', key: 'trigger', render: r => `<strong>${escapeHtml(r.trigger)}</strong>` },
        { label: 'Response', key: 'response', render: r => r.response ? escapeHtml(r.response).slice(0, 120) : '<span class="muted">None</span>' },
        { label: 'Image', sortValue: r => r.image ? 1 : 0, render: r => r.image ? `<a href="${escapeHtml(r.image)}" target="_blank" rel="noopener">View</a>` : '<span class="muted">None</span>' },
        { label: 'Status', key: 'enabled', render: r => r.enabled === false ? '<span class="badge off">Disabled</span>' : '<span class="badge on">Enabled</span>' },
        { label: 'Uses', key: 'uses' }
    ];
    if (canManageTriggers) {
        triggerColumns.push({ label: 'Manage', sortable: false, render: r => `<button class="secondary" type="button" data-trigger-manage="${escapeHtml(r.trigger)}">Manage</button>` });
    }
    triggerColumns.push(
        { label: 'Added By', key: 'addedByLabel', render: r => withNicknameTitle(r.addedByLabel, r.addedByNickname) },
        { label: 'Added At', key: 'addedAt', render: r => escapeHtml(formatDateTime(r.addedAt)) }
    );
    renderTable(document.getElementById('triggerTable'), triggerColumns, triggers, 'No triggers configured yet.');

    renderTable(document.getElementById('triggerAudit'),
        [
            { label: 'When', key: 'at', render: r => escapeHtml(formatDateTime(r.at)) },
            { label: 'Action', key: 'action', render: r => escapeHtml(r.action) },
            { label: 'Trigger', key: 'trigger', render: r => escapeHtml(r.trigger) },
            { label: 'By', sortValue: r => r.byTag || r.byId, render: r => withNicknameTitle(r.byTag || r.byId, r.byNickname) }
        ],
        data.audit, 'No audit entries yet.');
}

async function saveTrigger(method) {
    const editing = method === 'PATCH';
    const phrase = document.getElementById(editing ? 'editTriggerPhrase' : 'triggerPhrase').value.trim();
    const response = document.getElementById(editing ? 'editTriggerResponse' : 'triggerResponse').value.trim();
    const image = document.getElementById(editing ? 'editTriggerImage' : 'triggerImage').value.trim();
    const enabled = editing ? document.getElementById('editTriggerEnabled').checked : true;

    if (!state.guildId || !phrase || (!response && !image)) {
        setStatus(document.getElementById('triggerStatus'), 'Enter a phrase and text response or image URL.', 'error');
        return;
    }

    try {
        await api(withGuild('/api/triggers'), {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phrase, response, image, enabled })
        });
        setStatus(document.getElementById('triggerStatus'), editing ? 'Trigger updated.' : 'Trigger added.', 'ok');
        await loadTriggers();
    } catch (error) {
        setStatus(document.getElementById('triggerStatus'), error.message, 'error');
    }
}

document.getElementById('addTrigger').addEventListener('click', () => saveTrigger('POST'));
document.getElementById('editTrigger').addEventListener('click', () => saveTrigger('PATCH'));
document.getElementById('deleteTrigger').addEventListener('click', async () => {
    const phrase = document.getElementById('editTriggerPhrase').value.trim();

    if (!state.guildId || !phrase) {
        setStatus(document.getElementById('triggerStatus'), 'Enter the existing trigger phrase to delete.', 'error');
        return;
    }

    if (!await confirmAction({ title: 'Delete trigger?', message: `Delete trigger "${phrase}"? This cannot be undone.`, confirmLabel: 'Delete trigger' })) {
        return;
    }

    try {
        await api(withGuild(`/api/triggers?phrase=${encodeURIComponent(phrase)}`), { method: 'DELETE' });
        setStatus(document.getElementById('triggerStatus'), 'Trigger deleted.', 'ok');
        document.getElementById('editTriggerPhrase').value = '';
        document.getElementById('editTriggerResponse').value = '';
        document.getElementById('editTriggerImage').value = '';
        await loadTriggers();
    } catch (error) {
        setStatus(document.getElementById('triggerStatus'), error.message, 'error');
    }
});

document.getElementById('triggerTable').addEventListener('click', event => {
    const phrase = event.target.dataset.triggerManage;
    if (!phrase) return;
    const row = (tableStates.get(document.getElementById('triggerTable'))?.allRows || []).find(item => item.trigger === phrase);
    if (!row) return;
    document.getElementById('editTriggerPhrase').value = row.trigger;
    document.getElementById('editTriggerResponse').value = row.response || '';
    document.getElementById('editTriggerImage').value = row.image || '';
    document.getElementById('editTriggerEnabled').checked = row.enabled !== false;
    document.getElementById('editTriggerPhrase').scrollIntoView({ behavior: 'smooth', block: 'center' });
});
document.getElementById('exportTriggers').addEventListener('click', async () => {
    const status = document.getElementById('triggerExportStatus');
    if (!state.guildId) {
        setStatus(status, 'Select a server first.', 'error');
        return;
    }
    try {
        const data = await api(withGuild('/api/triggers'));
        const exported = (data.triggers || []).map(({ trigger, response, image, enabled }) => ({ trigger, response, image, enabled }));
        const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' });
        const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `triggers-${state.guildId}.json` });
        link.click();
        URL.revokeObjectURL(link.href);
        setStatus(status, `Exported ${exported.length} triggers.`, 'ok');
    } catch (error) {
        setStatus(status, error.message, 'error');
    }
});
document.getElementById('importTriggers').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file || !state.guildId) return;
    try {
        const triggers = JSON.parse(await file.text()); if (!Array.isArray(triggers)) throw new Error('Expected a JSON array.');
        for (const trigger of triggers) await api(withGuild('/api/triggers'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phrase: trigger.trigger, response: trigger.response, image: trigger.image }) });
        await loadTriggers(); setStatus(document.getElementById('triggerExportStatus'), 'Triggers imported.', 'ok');
    } catch (error) { setStatus(document.getElementById('triggerExportStatus'), error.message, 'error'); }
    event.target.value = '';
});

// ---------- Voice ----------
const analyticsDateControls = {
    analyticsSummaryRange: ['analyticsSummaryFrom', 'analyticsSummaryTo'],
    voiceGraphRange: ['voiceGraphFrom', 'voiceGraphTo'],
    analyticsDays: ['analyticsFrom', 'analyticsTo'],
    mediaRange: ['mediaFrom', 'mediaTo']
};

function utcDateInputValue(date = new Date()) {
    return date.toISOString().slice(0, 10);
}

function shiftUtcDate(value, days) {
    const date = new Date(`${value}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return utcDateInputValue(date);
}

function renderAnalyticsCalendar(rangeId) {
    const [fromId, toId] = analyticsDateControls[rangeId];
    const fromValue = document.getElementById(fromId).value;
    const toValue = document.getElementById(toId).value;
    const wrapper = document.querySelector(`[data-range-dates="${rangeId}"]`);
    const editor = wrapper.querySelector('[data-range-editor]');
    if (!fromValue || !toValue || document.getElementById(rangeId).value === 'all') return;
    const monthValue = wrapper.dataset.calendarMonth || toValue.slice(0, 7);
    const month = new Date(`${monthValue}-01T00:00:00.000Z`);
    const firstGridDay = new Date(month);
    firstGridDay.setUTCDate(1 - ((month.getUTCDay() + 6) % 7));
    const today = utcDateInputValue();
    const locale = uiLocale();
    const title = month.toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const nextMonthDisabled = monthValue >= today.slice(0, 7);
    const days = Array.from({ length: 42 }, (_, index) => {
        const date = new Date(firstGridDay.getTime() + index * 86400000);
        const value = utcDateInputValue(date);
        const outside = date.getUTCMonth() !== month.getUTCMonth();
        const inRange = value >= fromValue && value <= toValue;
        const classes = ['analytics-calendar-day'];
        if (outside) classes.push('outside');
        if (inRange) classes.push('in-range');
        if (value === fromValue) classes.push('range-start');
        if (value === toValue) classes.push('range-end');
        if (value === today) classes.push('today');
        return `<button type="button" class="${classes.join(' ')}" data-calendar-date="${value}"${value > today ? ' disabled' : ''} aria-label="${escapeHtml(date.toLocaleDateString(locale, { dateStyle: 'full', timeZone: 'UTC' }))}">${date.getUTCDate()}</button>`;
    }).join('');
    const weekdays = Array.from({ length: 7 }, (_, index) => new Date(Date.UTC(2026, 7, 24 + index))
        .toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' }));
    editor.innerHTML = `<div class="analytics-calendar"><div class="analytics-calendar-header"><button type="button" data-calendar-month="-1" aria-label="${escapeHtml(uiText('Previous month'))}">&#8592;</button><strong>${escapeHtml(title)}</strong><button type="button" data-calendar-month="1" aria-label="${escapeHtml(uiText('Next month'))}"${nextMonthDisabled ? ' disabled' : ''}>&#8594;</button></div><div class="analytics-calendar-weekdays">${weekdays.map(day => `<span>${escapeHtml(day)}</span>`).join('')}</div><div class="analytics-calendar-grid">${days}</div><p>${escapeHtml(analyticsDateSelection(rangeId).label)}</p></div>`;
}

function syncAnalyticsDateRange(rangeId, changed = 'range') {
    const select = document.getElementById(rangeId);
    const [fromId, toId] = analyticsDateControls[rangeId];
    const from = document.getElementById(fromId);
    const to = document.getElementById(toId);
    const wrapper = document.querySelector(`[data-range-dates="${rangeId}"]`);
    const display = wrapper.querySelector('[data-range-display]');
    const previous = wrapper.querySelector('[data-range-previous]');
    const next = wrapper.querySelector('[data-range-next]');
    const editor = wrapper.querySelector('[data-range-editor]');
    const allTime = select.value === 'all';
    wrapper.classList.toggle('is-disabled', allTime);
    wrapper.setAttribute('aria-disabled', String(allTime));
    from.disabled = allTime;
    to.disabled = allTime;
    display.disabled = allTime;
    previous.disabled = allTime;
    next.disabled = allTime;
    if (allTime) {
        display.textContent = uiText('All dates');
        display.setAttribute('aria-expanded', 'false');
        editor.hidden = true;
        return;
    }
    const days = Math.max(1, Number(select.value) || 30);
    const today = utcDateInputValue();
    from.max = shiftUtcDate(today, 1 - days);
    to.max = today;
    if (!to.value) to.value = today;
    if (!from.value) from.value = shiftUtcDate(to.value, 1 - days);
    if (changed === 'from') {
        to.value = shiftUtcDate(from.value, days - 1);
        if (to.value > today) {
            to.value = today;
            from.value = shiftUtcDate(today, 1 - days);
        }
    }
    else from.value = shiftUtcDate(to.value, 1 - days);
    display.textContent = analyticsDateSelection(rangeId).label;
    next.disabled = to.value >= today;
    if (!editor.hidden) renderAnalyticsCalendar(rangeId);
}

function analyticsDateSelection(rangeId) {
    const value = document.getElementById(rangeId).value;
    if (value === 'all') return { value, query: 'days=all', label: uiText('All time').toLocaleLowerCase(uiLocale()) };
    const [fromId, toId] = analyticsDateControls[rangeId];
    const from = document.getElementById(fromId).value;
    const to = document.getElementById(toId).value;
    const format = raw => new Date(`${raw}T00:00:00.000Z`).toLocaleDateString(uiLocale(), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    return {
        value,
        from,
        to,
        query: `days=${encodeURIComponent(value)}&from=${encodeURIComponent(`${from}T00:00:00.000Z`)}&to=${encodeURIComponent(`${to}T23:59:59.999Z`)}`,
        label: from === to ? format(from) : `${format(from)} – ${format(to)}`
    };
}

function analyticsRangeLabel(value, rangeId = null) {
    if (rangeId) return analyticsDateSelection(rangeId).label;
    if (String(value).toLowerCase() === 'all') return 'all time';
    const days = Math.max(1, Number(value) || 30);
    return `${days} ${days === 1 ? 'day' : 'days'}`;
}

function periodComparison(current, previous, comparable = true) {
    if (!comparable || previous === null || previous === undefined) return 'No comparison';
    const currentValue = Number(current) || 0;
    const previousValue = Number(previous) || 0;
    if (!previousValue) return currentValue ? 'New' : '0%';
    const percent = Math.round((currentValue - previousValue) / previousValue * 100);
    return `${percent > 0 ? '+' : ''}${percent}%`;
}

async function loadVoice() {
    if (!state.guildId) return;
    await ensureAnalyticsChannelFilter('voiceGraphChannel', '/api/voice-channels');
    const data = await api(withGuild('/api/voice'));
    const activeSessions = Array.isArray(data?.activeSessions) ? data.activeSessions : [];
    const leaderboard = Array.isArray(data?.leaderboard) ? data.leaderboard : [];
    const recentHistory = (Array.isArray(data?.recentHistory) ? data.recentHistory : []).map(row => ({
        ...row,
        withLabels: Array.isArray(row?.withLabels) ? row.withLabels : [],
        withNicknames: Array.isArray(row?.withNicknames) ? row.withNicknames : []
    }));
    const voiceRange = document.getElementById('voiceGraphRange').value;
    const voiceChannelId = document.getElementById('voiceGraphChannel').value;
    const selection = analyticsDateSelection('voiceGraphRange');
    const rangeLabel = selection.label;
    const filters = [selection.query];
    if (voiceChannelId) filters.push(`channelId=${encodeURIComponent(voiceChannelId)}`);
    const analyticsResponse = await api(withGuild(`/api/voice-analytics?${filters.join('&')}`));
    const analytics = {
        ...(analyticsResponse || {}),
        activeOverTime: Array.isArray(analyticsResponse?.activeOverTime) ? analyticsResponse.activeOverTime : [],
        minutesOverTime: Array.isArray(analyticsResponse?.minutesOverTime) ? analyticsResponse.minutesOverTime : [],
        topChannels: Array.isArray(analyticsResponse?.topChannels) ? analyticsResponse.topChannels : [],
        userTotals: Array.isArray(analyticsResponse?.userTotals) ? analyticsResponse.userTotals : [],
        groupSessions: (Array.isArray(analyticsResponse?.groupSessions) ? analyticsResponse.groupSessions : []).map(row => ({ ...row, labels: Array.isArray(row?.labels) ? row.labels : [] }))
    };
    const fallbackTotalVoiceMs = leaderboard.reduce((total, row) => total + (Number(row?.totalMs) || 0), 0);

    document.getElementById('voiceRangeLabel').textContent = rangeLabel;
    document.getElementById('voiceMinutesRangeLabel').textContent = rangeLabel;

    document.getElementById('voiceCards').innerHTML = [
        statCard('Total voice time', formatDuration(analytics.totalAllTimeMs ?? fallbackTotalVoiceMs), 'All tracked voice time, including the current duration of active sessions.'),
        statCard(`Voice time · ${rangeLabel}`, formatDuration(Number(analytics.totalMs) || 0), 'Time with at least one member in voice inside the selected period. Overlapping members never make one day exceed 24 hours.'),
        statCard('Vs previous period', periodComparison(analytics.totalMs, analytics.previousTotalMs, voiceRange !== 'all'), 'Compares voice time with the immediately preceding period of equal length. All time has no previous-period comparison.'),
        statCard('In Voice Now', activeSessions.length),
        statCard('Tracked Users', leaderboard.length),
        statCard('Average Session', formatDuration(Number(analytics.averageSessionMs) || 0), 'Average tracked session duration within the selected period, including active sessions so far.'),
        statCard('Busiest hour', Number.isInteger(analytics.busiestHour) ? `${String(analytics.busiestHour).padStart(2, '0')}:00 UTC` : '-', 'The UTC hour with the most voice sessions starting in the selected period.')
    ].join('');
    renderActivityChart('voiceActivityChart', analytics.activeOverTime, 'No voice sessions in this range.', document.getElementById('voiceGraphType').value, 'Voice sessions');
    renderActivityChart('voiceMinutesChart', analytics.minutesOverTime, 'No voice time in this range.', document.getElementById('voiceGraphType').value, 'Voice minutes');
    renderChartAnnotations('voiceActivityChart', analytics.annotations || []);
    await loadActivityHeatmap('voice');

    renderTable(document.getElementById('voiceActive'),
        [
            { label: 'Member', key: 'label', render: r => withNicknameTitle(r.label, r.nickname) },
            { label: 'Channel', key: 'channelName', render: r => escapeHtml(r.channelName) },
            { label: 'Since', key: 'startedAt', render: r => escapeHtml(formatDateTime(r.startedAt)) },
            { label: 'Duration', key: 'durationMs', render: r => `<span data-live-duration="${escapeHtml(r.startedAt)}"></span>` }
        ],
        activeSessions, 'Nobody is in voice right now.');

    renderTable(document.getElementById('voiceLeaderboard'),
        [
            { label: 'Member', key: 'label', render: r => withNicknameTitle(r.label, r.nickname) },
            { label: 'Total Time', key: 'totalMs', render: r => escapeHtml(r.totalFormatted) },
            { label: 'In Voice', key: 'inVoice', render: r => r.inVoice ? '<span class="badge on">Now</span>' : '' }
        ],
        leaderboard, 'No voice activity tracked yet.');

    renderTable(document.getElementById('voiceHistory'),
        [
            { label: 'Member', key: 'label', render: r => withNicknameTitle(r.label, r.nickname) },
            { label: 'Channel', key: 'channelName', render: r => escapeHtml(r.channelName) },
            { label: 'Started', key: 'startedAt', render: r => escapeHtml(formatDateTime(r.startedAt)) },
            { label: 'Duration', key: 'durationMs', render: r => escapeHtml(r.durationFormatted) },
            { label: 'With', sortable: false, render: r => r.withLabels.length ? r.withLabels.map((label, i) => withNicknameTitle(label, r.withNicknames?.[i])).join(', ') : '<span class="muted">Alone</span>' }
        ],
        recentHistory, 'No voice sessions recorded yet.');

    renderTable(document.getElementById('voiceTopChannels'), [{ label: 'Channel', key: 'channelName' }, { label: 'Total', key: 'totalMs', render: r => formatDuration(r.totalMs) }, { label: 'Sessions', key: 'sessions' }], analytics.topChannels, 'No channel activity in this range.');
    renderTable(document.getElementById('voiceUserTotals'), [{ label: 'Member', key: 'label', render: r => withNicknameTitle(r.label, r.nickname) }, { label: 'Week', key: 'weeklyMs', render: r => formatDuration(r.weeklyMs) }, { label: 'Month', key: 'monthlyMs', render: r => formatDuration(r.monthlyMs) }], analytics.userTotals, 'No member activity in this range.');
    renderTable(document.getElementById('voiceGroupSessions'), [{ label: 'Channel', key: 'channelName' }, { label: 'Started', key: 'startedAt', render: r => formatDateTime(r.startedAt) }, { label: 'Duration', key: 'durationMs', render: r => r.active ? `<span data-live-duration="${escapeHtml(r.startedAt)}"></span>` : formatDuration(r.durationMs) }, { label: 'Participants', key: 'labels', render: r => r.labels.map(escapeHtml).join(', ') }, { label: 'Active', key: 'active', render: r => r.active ? '<span class="badge on">Now</span>' : '' }], analytics.groupSessions, 'No grouped sessions recorded yet.');

    await loadVoiceChannelOptions();
}


const voiceChannelSelect = document.getElementById('voiceChannelSelect');

async function loadVoiceChannelOptions() {
    const previousValue = voiceChannelSelect.value;
    const data = await api(withGuild('/api/voice-channels'));

    voiceChannelSelect.innerHTML = '';

    if (!data.channels || data.channels.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No voice channels found';
        voiceChannelSelect.appendChild(option);
        voiceChannelSelect.disabled = true;
        document.getElementById('voiceChannelActive').innerHTML = '<div class="empty">No voice channels found.</div>';
        document.getElementById('voiceChannelPast').innerHTML = '<div class="empty">No voice channels found.</div>';
        return;
    }

    voiceChannelSelect.disabled = false;
    for (const channel of data.channels) {
        const option = document.createElement('option');
        option.value = channel.id;
        option.textContent = `#${channel.name}`;
        voiceChannelSelect.appendChild(option);
    }

    if (previousValue && data.channels.some(channel => channel.id === previousValue)) {
        voiceChannelSelect.value = previousValue;
    }

    await loadVoiceChannelMembers();
}

async function loadVoiceChannelMembers() {
    const channelId = voiceChannelSelect.value;
    const activeContainer = document.getElementById('voiceChannelActive');
    const pastContainer = document.getElementById('voiceChannelPast');

    if (!state.guildId || !channelId) {
        activeContainer.innerHTML = '<div class="empty">Select a channel above.</div>';
        pastContainer.innerHTML = '<div class="empty">Select a channel above.</div>';
        return;
    }

    const data = await api(withGuild(`/api/voice-channel-members?channelId=${encodeURIComponent(channelId)}`));
    const members = Array.isArray(data?.members) ? data.members : [];
    const activeMembers = members.filter(member => member.inVoice);
    const pastMembers = members.filter(member => !member.inVoice);

    renderTable(activeContainer,
        [
            { label: 'Member', key: 'label', render: r => withNicknameTitle(r.label, r.nickname) },
            { label: 'Joined', key: 'lastJoinedAt', render: r => `${escapeHtml(formatDateTime(r.lastJoinedAt))} (${escapeHtml(formatAgo(r.lastJoinedAt))})` },
            {
                label: 'Duration',
                key: 'lastSessionDurationMs',
                render: r => `<span data-live-duration="${escapeHtml(r.lastJoinedAt)}"></span>`
            }
        ],
        activeMembers, 'Nobody is currently in this channel.');

    renderTable(pastContainer,
        [
            { label: 'Member', key: 'label', render: r => withNicknameTitle(r.label, r.nickname) },
            { label: 'Last Joined', key: 'lastJoinedAt', render: r => `${escapeHtml(formatDateTime(r.lastJoinedAt))} (${escapeHtml(formatAgo(r.lastJoinedAt))})` },
            { label: 'Last Left', key: 'lastLeftAt', render: r => r.lastLeftAt ? `${escapeHtml(formatDateTime(r.lastLeftAt))} (${escapeHtml(formatAgo(r.lastLeftAt))})` : '<span class="muted">-</span>' },
            { label: 'Last Duration', key: 'lastSessionDurationMs', render: r => escapeHtml(formatDuration(r.lastSessionDurationMs || 0)) }
        ],
        pastMembers, 'Nobody has previously left this channel.');
}

voiceChannelSelect.addEventListener('change', () => {
    loadVoiceChannelMembers().catch(error => console.error(error));
});

// ---------- Server stats ----------
async function loadStats() {
    if (!state.guildId) return;
    await ensureAnalyticsChannelFilter('analyticsChannel', '/api/channels');
    const days = document.getElementById('analyticsDays').value;
    const selection = analyticsDateSelection('analyticsDays');
    const rangeLabel = selection.label;
    const channelId = document.getElementById('analyticsChannel').value;
    const memberId = document.getElementById('analyticsMember').value;
    const filters = `${channelId ? `&channelId=${encodeURIComponent(channelId)}` : ''}${memberId ? `&userId=${encodeURIComponent(memberId)}` : ''}`;
    const analyticsResponse = await api(withGuild(`/api/analytics?${selection.query}${filters}`));
    const data = {
        ...(analyticsResponse || {}),
        topUsers: Array.isArray(analyticsResponse?.topUsers) ? analyticsResponse.topUsers : [],
        topChannels: Array.isArray(analyticsResponse?.topChannels) ? analyticsResponse.topChannels : [],
        dailyMessages: Array.isArray(analyticsResponse?.dailyMessages) ? analyticsResponse.dailyMessages : [],
        heatmap: Array.isArray(analyticsResponse?.heatmap) ? analyticsResponse.heatmap : []
    };
    const memberSelect = document.getElementById('analyticsMember');
    const previousMember = memberSelect.value;
    memberSelect.innerHTML = '<option value="">All members</option>';
    for (const user of data.topUsers) {
        const option = document.createElement('option'); option.value = user.id; option.textContent = user.name; memberSelect.appendChild(option);
    }
    if (previousMember && data.topUsers.some(user => user.id === previousMember)) memberSelect.value = previousMember;
    const comparison = data.comparison || {};
    const busiestHour = Number.isInteger(comparison.busiestHour) ? `${String(comparison.busiestHour).padStart(2, '0')}:00 UTC` : '-';
    document.getElementById('messageRangeLabel').textContent = rangeLabel;
    document.getElementById('analyticsCards').innerHTML = [
        statCard('Total messages', data.totalMessageCount ?? data.messageCount ?? 0, 'All tracked message events matching the selected channel and member filters.'),
        statCard(`Messages · ${rangeLabel}`, data.messageCount ?? 0, 'Tracked message events inside the selected period and active filters.'),
        statCard('Vs previous period', periodComparison(data.messageCount, comparison.previousMessageCount, days !== 'all'), 'Compares messages with the immediately preceding period of equal length. All time has no previous-period comparison.'),
        statCard('Unique Authors', data.uniqueAuthors ?? 0, 'Distinct members who sent at least one tracked message inside the selected period.'),
        statCard('Attachments', data.engagement?.attachments || 0),
        statCard('GIFs', data.engagement?.gifs || 0, 'GIF files and recognized GIF links or embeds inside the selected period. A link and its Discord preview count once.'),
        statCard('Replies', data.engagement?.replies || 0),
        statCard('Busiest hour', busiestHour, 'The UTC hour with the most tracked messages in the selected period.')
    ].join('');
    renderActivityChart('analyticsChart', data.dailyMessages, 'No events in this period yet.', document.getElementById('analyticsGraphType').value, 'Messages');
    renderChartAnnotations('analyticsChart', data.annotations || []);
    await loadActivityHeatmap('message');
    renderTable(document.getElementById('analyticsChannels'), [{ label: 'Channel', key: 'name', render: r => `#${escapeHtml(r.name)}` }, { label: 'Messages', key: 'count' }], data.topChannels, 'No channel activity yet.');
    renderTable(document.getElementById('analyticsUsers'), [{ label: 'Member', key: 'name', render: r => escapeHtml(r.name) }, { label: 'Messages', key: 'count' }], data.topUsers, 'No member activity yet.');
}

// ---------- Analytics ----------
async function loadAnalytics() {
    if (!state.guildId) return;
    const selection = analyticsDateSelection('analyticsSummaryRange');
    const data = await api(withGuild(`/api/analytics-summary?${selection.query}`));
    document.getElementById('analyticsSummaryMessages').innerHTML = [
        statCard('Messages', data.messages.count), statCard('Active Authors', data.messages.uniqueAuthors),
        statCard('Change', data.messages.changePercent === null ? 'New' : `${data.messages.changePercent > 0 ? '+' : ''}${data.messages.changePercent}%`),
        statCard('Busiest hour', Number.isInteger(data.messages.busiestHour) ? `${String(data.messages.busiestHour).padStart(2, '0')}:00 UTC` : '-')
    ].join('');
    document.getElementById('analyticsSummaryVoice').innerHTML = [
        statCard('Voice Time', formatDuration(data.voice.totalMs)), statCard('Sessions', data.voice.sessions),
        statCard('Active Members', data.voice.activeMembers),
        statCard('Average session', formatDuration(data.voice.averageSessionMs))
    ].join('');
    document.getElementById('analyticsSummaryMedia').innerHTML = [
        statCard('Sound Plays', data.media.soundPlays), statCard('Emoji Uses', data.media.emojiUses),
        statCard('Sticker Uses', data.media.stickerUses)
    ].join('');
    const moderation = data.events || {};
    document.getElementById('moderationCards').innerHTML = [
        statCard('Member Joins', moderation.joins || 0), statCard('Member Leaves', moderation.leaves || 0),
        statCard('Deleted Messages', moderation.deletedMessages || 0), statCard('Role Changes', moderation.roleChanges || 0),
        statCard('Invite Uses', moderation.inviteUses || 0)
    ].join('');
    const graphType = document.getElementById('analyticsSummaryGraphType').value;
    renderActivityChart('analyticsSummaryMessageChart', data.messages.activity || [], 'No messages in this period.', graphType, 'Messages');
    renderActivityChart('analyticsSummaryVoiceChart', data.voice.activity || [], 'No voice sessions in this period.', graphType, 'Voice sessions');
}

for (const rangeId of Object.keys(analyticsDateControls)) syncAnalyticsDateRange(rangeId);

function bindAnalyticsDateControls(rangeId, load) {
    const [fromId, toId] = analyticsDateControls[rangeId];
    const wrapper = document.querySelector(`[data-range-dates="${rangeId}"]`);
    const display = wrapper.querySelector('[data-range-display]');
    const editor = wrapper.querySelector('[data-range-editor]');
    const movePeriod = direction => {
        const days = Math.max(1, Number(document.getElementById(rangeId).value) || 30);
        const from = document.getElementById(fromId);
        const to = document.getElementById(toId);
        from.value = shiftUtcDate(from.value, direction * days);
        to.value = shiftUtcDate(to.value, direction * days);
        syncAnalyticsDateRange(rangeId, 'navigation');
        load().catch(error => console.error(error));
    };
    document.getElementById(rangeId).addEventListener('change', () => {
        syncAnalyticsDateRange(rangeId);
        load().catch(error => console.error(error));
    });
    wrapper.querySelector('[data-range-previous]').addEventListener('click', () => movePeriod(-1));
    wrapper.querySelector('[data-range-next]').addEventListener('click', () => movePeriod(1));
    display.addEventListener('click', () => {
        editor.hidden = !editor.hidden;
        display.setAttribute('aria-expanded', String(!editor.hidden));
        if (!editor.hidden) {
            wrapper.dataset.calendarMonth = document.getElementById(toId).value.slice(0, 7);
            renderAnalyticsCalendar(rangeId);
        }
    });
    editor.addEventListener('click', event => {
        const monthButton = event.target.closest('[data-calendar-month]');
        if (monthButton) {
            const month = new Date(`${wrapper.dataset.calendarMonth}-01T00:00:00.000Z`);
            month.setUTCMonth(month.getUTCMonth() + Number(monthButton.dataset.calendarMonth));
            wrapper.dataset.calendarMonth = month.toISOString().slice(0, 7);
            renderAnalyticsCalendar(rangeId);
            return;
        }
        const dayButton = event.target.closest('[data-calendar-date]');
        if (!dayButton || dayButton.disabled) return;
        wrapper.dataset.calendarMonth = dayButton.dataset.calendarDate.slice(0, 7);
        document.getElementById(toId).value = dayButton.dataset.calendarDate;
        syncAnalyticsDateRange(rangeId, 'to');
        load().catch(error => console.error(error));
    });
    document.getElementById(fromId).addEventListener('change', () => {
        syncAnalyticsDateRange(rangeId, 'from');
        load().catch(error => console.error(error));
    });
    document.getElementById(toId).addEventListener('change', () => {
        syncAnalyticsDateRange(rangeId, 'to');
        load().catch(error => console.error(error));
    });
}

document.addEventListener('click', event => {
    document.querySelectorAll('[data-range-editor]:not([hidden])').forEach(editor => {
        if (editor.closest('.analytics-date-range').contains(event.target)) return;
        editor.hidden = true;
        editor.closest('.analytics-date-range').querySelector('[data-range-display]').setAttribute('aria-expanded', 'false');
    });
});

bindAnalyticsDateControls('analyticsSummaryRange', loadAnalytics);
document.getElementById('analyticsSummaryGraphType').addEventListener('change', () => loadAnalytics().catch(error => console.error(error)));

bindAnalyticsDateControls('analyticsDays', loadStats);
document.getElementById('analyticsChannel').addEventListener('change', () => loadStats().catch(error => console.error(error)));
document.getElementById('analyticsMember').addEventListener('change', () => loadStats().catch(error => console.error(error)));
document.getElementById('analyticsGraphType').addEventListener('change', () => loadStats().catch(error => console.error(error)));
bindAnalyticsDateControls('voiceGraphRange', loadVoice);
document.getElementById('voiceGraphChannel').addEventListener('change', () => loadVoice().catch(error => console.error(error)));
document.getElementById('voiceGraphType').addEventListener('change', () => loadVoice().catch(error => console.error(error)));

// ---------- Members & permissions ----------
const memberActionStatusField = document.getElementById('memberActionStatus');
const serverMembersContainer = document.getElementById('serverMembersTable');

function renderMemberRoleCell(member) {
    if (member.isDeveloper) {
        return `<span class="badge dev">Developer</span> <span class="badge ${member.isAdministrator ? 'admin' : 'member'}">${member.isAdministrator ? 'Admin' : 'Member'}</span>`;
    }
    if (member.isOwner) {
        return '<span class="badge owner">Owner</span>';
    }
    return member.role === 'admin'
        ? '<span class="badge admin">Admin</span>'
        : '<span class="badge member">Member</span>';
}

function renderMemberActionsCell(member) {
    if (member.isDeveloper) {
        return '<span class="muted">-</span>';
    }

    const canEditMember = state.role === 'developer'
        || (state.role === 'admin' && (member.role === 'member' || String(member.id) === String(state.accountUserId)));
    if (!canEditMember) {
        return '<span class="muted">Read-only</span>';
    }

    return `<div class="row">` +
        `<button type="button" class="secondary" data-manage-user="${escapeHtml(member.id)}">Manage</button>` +
        `<button type="button" class="secondary" data-reset-user="${escapeHtml(member.id)}">Reset to default</button>` +
        `</div>`;
}

async function loadServerMembers() {
    if (!state.guildId) return;

    let data;

    try {
        data = await api(withGuild('/api/members'));
    } catch (error) {
        serverMembersContainer.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
        return;
    }

    renderTable(serverMembersContainer,
        [
            { label: 'Member', key: 'tag', render: r => withNicknameTitle(r.tag, r.nickname) },
            { label: 'Nickname', key: 'nickname', render: r => r.nickname ? escapeHtml(r.nickname) : '<span class="muted">-</span>' },
            { label: 'Role', sortValue: r => r.isDeveloper ? 2 : (r.role === 'admin' ? 1 : 0), render: renderMemberRoleCell },
            { label: 'AI consent', sortValue: r => r.aiConsent?.status === 'granted' ? 1 : 0, render: r => r.aiConsent?.status === 'granted' ? `<span class="badge ok" title="Agreed ${escapeHtml(formatDateTime(r.aiConsent.updatedAt))}">Agreed</span>` : r.aiConsent?.status === 'withdrawn' ? '<span class="badge">Withdrawn</span>' : '<span class="muted">Not asked</span>' },
            { label: 'Custom Permissions', sortValue: r => r.nonDefaultFeatureCount, render: r => r.nonDefaultFeatureCount > 0 ? `<span class="badge accent">${r.nonDefaultFeatureCount} custom</span>` : '<span class="muted">Default</span>' },
            { label: '', sortable: false, render: renderMemberActionsCell }
        ],
        data.members, 'No members found.');
}

serverMembersContainer.addEventListener('click', async event => {
    const manageButton = event.target.closest('[data-manage-user]');

    if (manageButton) {
        const userId = manageButton.dataset.manageUser;
        document.getElementById('memberPermissionsSection').hidden = false;
        loadPermissionsEditor(userId).catch(error => console.error(error));
        document.getElementById('permissionsEditor').scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }

    const button = event.target.closest('[data-reset-user]');
    if (!button) return;

    const userId = button.dataset.resetUser;
    const confirmed = await confirmAction({ title: 'Reset member permissions?', message: `Reset every custom Flummi permission for ${userId}?`, confirmLabel: 'Reset permissions' });
    if (!confirmed) return;

    api(withGuild('/api/members/reset'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
    }).then(() => {
        setStatus(memberActionStatusField, `Reset ${userId} to default permissions.`, 'ok');
        loadServerMembers().catch(error => console.error(error));
    }).catch(error => {
        setStatus(memberActionStatusField, error.message, 'error');
    });
});

async function loadUsers() {
    if (!state.guildId) return;
    await populateGuildUserSelects();
    await loadServerMembers();
    document.getElementById('memberPermissionsSection').hidden = true;
}

function renderCommandPermissions(configData) {
    const rows = Object.entries(configData.commandPermissions || {}).map(([path, role]) => ({ path, role }));
    renderTable(document.getElementById('commandPermissionsTable'), [
        { label: 'Command', key: 'path', render: row => `<code>/${escapeHtml(row.path.replace(/\./g, ' '))}</code>` },
        { label: 'Required Role', key: 'role', render: row => `<select data-command-role="${escapeHtml(row.path)}"><option value="member" ${row.role === 'member' ? 'selected' : ''}>member</option><option value="admin" ${row.role === 'admin' ? 'selected' : ''}>admin</option><option value="developer" ${row.role === 'developer' ? 'selected' : ''}>developer</option></select>` }
    ], rows, 'No configured command permissions.');
}

document.getElementById('commandPermissionsTable').addEventListener('change', async event => {
    const path = event.target.dataset.commandRole; if (!path) return;
    try {
        const current = await api('/api/config');
        const result = await api('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commandPermissions: { ...current.commandPermissions, [path]: event.target.value } }) });
        renderCommandPermissions(result.config);
        state.publicCommands = [];
        await loadPublicCommands();
    } catch (error) { console.error(error); }
});

const FEATURE_DEFINITIONS = [
    { key: 'useTriggers', label: 'Use triggers' },
    { key: 'addTriggers', label: 'Add triggers' },
    { key: 'useAiChat', label: 'AI chat' },
    { key: 'useBotMentions', label: '@bot responses' },
    { key: 'savePingRequests', label: 'Ping-save' }
];
const permissionsEditor = document.getElementById('permissionsEditor');
const permissionsStatusField = document.getElementById('permissionsStatus');

function memberIdentityCard(userId) {
    const member = state.guildMembers.get(String(userId));
    const displayName = member?.nickname || member?.displayName || member?.globalName || member?.username || 'Unknown member';
    const username = member?.username ? `@${member.username}` : (member?.tag || 'No Discord profile available');
    const bannerUrl = member?.serverBannerUrl || member?.globalBannerUrl || member?.bannerUrl;
    const bannerStyle = bannerUrl ? ` style="background-image:url('${escapeHtml(bannerUrl)}')"` : ` style="background:${escapeHtml(member?.bannerColor || '#5865f2')}"`;
    const avatarUrl = member?.serverAvatarUrl || member?.globalAvatarUrl || member?.avatarUrl;
    const avatar = avatarUrl ? `<img class="member-identity-avatar" src="${escapeHtml(avatarUrl)}" alt="">` : '<div class="member-identity-avatar"></div>';
    return `<div class="member-identity"><div class="member-identity-banner"${bannerStyle}></div><div class="member-identity-content">${avatar}<div class="member-identity-name"><strong>${escapeHtml(displayName)}</strong><span>${escapeHtml(username)}</span></div></div></div>`;
}

function renderPermissionsEditor(userId, data) {
    const perms = data.permissions;
    const readOnly = data.canEdit !== true;

    const featureRows = FEATURE_DEFINITIONS.map(feature => {
        const availability = data.featureAvailability?.[feature.key];
        const unavailable = availability?.enabled === false;
        const reason = unavailable ? availability.reason : '';
        return `
        <div class="checkbox-row" ${reason ? `data-tooltip="${escapeHtml(reason)}"` : ''} style="${unavailable ? 'opacity:.55' : ''}">
            <input type="checkbox" data-feature-toggle data-feature-key="${escapeHtml(feature.key)}" ${perms[feature.key] ? 'checked' : ''} ${readOnly || unavailable ? 'disabled' : ''}>
            <label style="margin:0;">${escapeHtml(feature.label)}</label>
            ${reason ? `<small class="muted">${escapeHtml(reason)}</small>` : ''}
        </div>
    `;
    }).join('');

    permissionsEditor.dataset.userId = userId;
    permissionsEditor.innerHTML = `
        ${memberIdentityCard(userId)}
        <p class="sub">
            <span class="badge ${data.role === 'developer' ? 'dev' : data.role === 'owner' ? 'owner' : data.role === 'admin' ? 'admin' : 'member'}">${escapeHtml(data.role)}</span>
            ${readOnly ? '<span class="sub">You can view these permissions, but your role cannot edit this member.</span>' : ''}
        </p>
        <div class="two-col">${featureRows}</div>
    `;
    const simulation = data.simulation || {};
    const allowed = (simulation.commands || []).filter(command => command.allowed);
    const blocked = (simulation.commands || []).filter(command => !command.allowed);
    document.getElementById('permissionSimulator').innerHTML = `<div class="section-title-row"><div><h3>Effective access preview</h3><p class="sub">Exactly what this member can see and use with their current Discord role and Flummi settings.</p></div><span class="badge ${blocked.length ? 'warn' : 'ok'}">${Number(simulation.allowedCommands || 0)} commands available</span></div><div class="permission-simulator-grid"><article><strong>Dashboard pages</strong><div class="command-chip-list">${(simulation.dashboardTabs || []).map(tab => `<span>${escapeHtml(tab.replace(/^management-/, '').replaceAll('-', ' '))}</span>`).join('')}</div></article><article><strong>Personal feature access</strong>${Object.entries(simulation.features || {}).map(([key, value]) => `<p><span>${escapeHtml(key.replace(/([A-Z])/g, ' $1'))}</span><span class="badge ${value ? 'ok' : 'off'}">${value ? 'Allowed' : 'Blocked'}</span></p>`).join('')}</article></div><details><summary>Command access · ${allowed.length} allowed, ${blocked.length} blocked</summary><div class="permission-command-list">${(simulation.commands || []).map(command => `<div><code>${escapeHtml(command.path)}</code><span class="badge ${command.allowed ? 'ok' : 'off'}">${command.allowed ? 'Available' : `Needs ${escapeHtml(command.requiredRole)}`}</span></div>`).join('')}</div></details>`;
}

async function loadPermissionsEditor(userId) {
    if (!state.guildId || !userId) {
        setStatus(permissionsStatusField, 'Select a server member first.', 'error');
        return;
    }

    try {
        const data = await api(withGuild(`/api/permissions?userId=${encodeURIComponent(userId)}`));
        if (data.member) state.guildMembers.set(String(userId), { ...(state.guildMembers.get(String(userId)) || {}), ...data.member });
        renderPermissionsEditor(userId, data);
        setStatus(permissionsStatusField, '');
    } catch (error) {
        setStatus(permissionsStatusField, error.message, 'error');
    }
}

permissionsEditor.addEventListener('change', async event => {
    const toggle = event.target.closest('[data-feature-toggle]');
    if (!toggle) return;

    const userId = permissionsEditor.dataset.userId;
    const key = toggle.dataset.featureKey;
    const confirmed = await confirmAction({ title: 'Change feature permission?', message: `${toggle.checked ? 'Allow' : 'Block'} ${key} for ${resourceDisplay(userId)}?`, confirmLabel: 'Change permission' });
    if (!confirmed) { await loadPermissionsEditor(userId); return; }

    api(withGuild('/api/permissions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, [key]: toggle.checked })
    }).then(async () => {
        setStatus(permissionsStatusField, `Updated ${key} for ${resourceDisplay(userId)}.`, 'ok');
        await loadPermissionsEditor(userId);
    }).catch(error => {
        setStatus(permissionsStatusField, error.message, 'error');
    });
});

// ---------- Profiles ----------
const profileEditor = document.getElementById('profileEditor');
const profileStatusField = document.getElementById('profileStatus');
const profileUserSelect = document.getElementById('profileUserSelect');

function renderProfilePreview(data) {
    const profile = data.profile;
    const displayName = profile.nickname || data.user.nickname || data.user.tag;
    const fields = [
        ['About', [profile.pronouns, profile.birthday, profile.timezone, (profile.languages || []).map(item => item.label).join(', ')].filter(Boolean).join('\n') || 'No about fields set yet.'],
        ['Style', `Color: #${Number(profile.color).toString(16).padStart(6, '0').toUpperCase()}`],
        ['Socials', Object.entries(profile.socials || {}).map(([name, handle]) => `${name}: ${handle}`).join('\n') || 'No socials set.']
    ];
    const bannerStyle = backgroundUrlStyle(profile.bannerUrl || data.user.bannerUrl || '/assets/branding/flummi-banner-color.jpg');
    const avatar = data.user.avatarUrl ? `<img class="discord-preview-avatar" src="${escapeHtml(data.user.avatarUrl)}" alt="">` : '';

    document.getElementById('profilePreview').innerHTML = `
        <div class="discord-preview" style="border-left-color:#${Number(profile.color).toString(16).padStart(6, '0')}">
            <div class="discord-preview-banner" style="${bannerStyle}"></div>
            <div class="discord-preview-body">
                ${avatar}
                <h3 class="discord-preview-title">${escapeHtml(displayName)}</h3>
                <p class="sub">${escapeHtml(data.user.tag)}</p>
                <div class="discord-preview-description">${escapeHtml(profile.bio || 'No bio set yet.')}</div>
                <div class="discord-preview-fields">${fields.map(([label, value]) => `<div class="discord-preview-field"><strong>${escapeHtml(label)}</strong>${escapeHtml(value)}</div>`).join('')}</div>
            </div>
        </div>`;
}

function profileField(label, id, value, type = 'text') {
    const safeValue = escapeHtml(value ?? '');

    if (type === 'textarea') {
        return `<div class="field"><label for="${id}">${label}</label><textarea id="${id}">${safeValue}</textarea></div>`;
    }

    return `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="${type}" value="${safeValue}"></div>`;
}

function renderProfileEditor(data) {
    const profile = data.profile;
    const userLabel = data.user.nickname
        ? `${data.user.tag} (${data.user.nickname})`
        : data.user.tag;

    profileEditor.dataset.userId = data.user.id;
    profileEditor.innerHTML = `
        <div class="section">
            <h2>${escapeHtml(userLabel)}</h2>
            <p class="sub">Selected Discord member</p>
                <div class="card-grid">${statCard('Messages', data.statistics?.messages || 0)}${statCard('Voice', formatDuration(data.statistics?.voiceMs || 0))}${statCard('Role', data.statistics?.role || 'member')}</div>
            <div class="two-col">
                ${profileField('Profile nickname', 'profileNickname', profile.nickname)}
                ${profileField('Pronouns', 'profilePronouns', profile.pronouns)}
                ${profileField('Birthday', 'profileBirthday', profile.birthday)}
                ${profileField('Timezone', 'profileTimezone', profile.timezone)}
                ${profileField('Languages (comma separated)', 'profileLanguages', (profile.languages || []).map(language => language.label).join(', '))}
                ${profileField('Color', 'profileColor', profile.color ? `#${Number(profile.color).toString(16).padStart(6, '0')}` : '', 'color')}
                ${profileField('Website URL', 'profileWebsite', profile.website)}
                ${profileField('Banner URL', 'profileBannerUrl', profile.bannerUrl)}
            </div>
            <div style="margin-top:12px;">
                ${profileField('Bio', 'profileBio', profile.bio, 'textarea')}
            </div>
            <div style="margin-top:12px;">
                ${profileField('Socials (JSON, e.g. {"discord":"flummi"})', 'profileSocials', JSON.stringify(profile.socials || {}, null, 2), 'textarea')}
            </div>
            <div class="actions">
                <span class="sub">Profile updated: ${escapeHtml(profile.updatedAt ? formatDateTime(profile.updatedAt) : 'Never')}</span>
                <button id="refreshProfile" class="secondary" type="button">Refresh Discord avatar/banner</button><button id="saveProfile" class="primary" type="button">Save profile</button>
            </div>
        </div>
        <div class="section">
            <h2>AI conversation memory</h2>
            <p class="sub">Read-only compact summary of earlier conversation turns. Last updated: ${escapeHtml(data.aiMemory.updatedAt ? formatDateTime(data.aiMemory.updatedAt) : 'Never')}</p>
            <label>Conversation summary</label>
            <textarea readonly>${escapeHtml(data.aiMemory.summary || 'No saved AI summary yet.')}</textarea>
        </div>
    `;
    renderProfileSocialsBuilder(profile.socials || {});
}

function renderProfileSocialsBuilder(socials = {}) {
    const source = document.getElementById('profileSocials');
    if (!source) return;
    source.hidden = true;
    const label = source.closest('.field')?.querySelector('label');
    if (label) label.textContent = 'Social links';
    let builder = document.getElementById('profileSocialsBuilder');
    if (!builder) {
        builder = document.createElement('div');
        builder.id = 'profileSocialsBuilder';
        builder.className = 'structured-builder';
        source.after(builder);
    }
    const entries = Object.entries(socials || {});
    builder.innerHTML = `<datalist id="profileSocialPlatforms"><option value="discord"><option value="github"><option value="website"><option value="youtube"><option value="twitch"></datalist><div class="structured-builder-list">${entries.map(([platform, value], index) => `<div class="structured-builder-row profile-social-row" data-profile-social="${index}"><div class="field"><label>Platform</label><input data-social-platform list="profileSocialPlatforms" value="${escapeHtml(platform)}" placeholder="Choose or type a platform"></div><div class="field"><label>Handle or URL</label><input data-social-value value="${escapeHtml(value)}" placeholder="https://… or @handle"></div><button class="danger compact" type="button" data-social-remove="${index}">Remove</button></div>`).join('')}</div><button class="secondary" type="button" data-social-add>Add social link</button>`;
}

function syncProfileSocials() {
    const source = document.getElementById('profileSocials');
    if (!source) return;
    const socials = {};
    for (const row of document.querySelectorAll('[data-profile-social]')) {
        const platform = row.querySelector('[data-social-platform]').value;
        const value = row.querySelector('[data-social-value]').value.trim();
        if (platform && value) socials[platform] = value;
    }
    source.value = JSON.stringify(socials, null, 2);
}

async function loadProfiles(userId = document.getElementById('profileUserId').value.trim()) {
    if (!userId) {
        setStatus(profileStatusField, 'Select a server member first.', 'error');
        return;
    }

    try {
        const data = await api(withGuild(`/api/profile?userId=${encodeURIComponent(userId)}`));
        document.getElementById('profileUserId').value = userId;
        renderProfileEditor(data);
        renderProfilePreview(data);
        setStatus(profileStatusField, 'Profile loaded.', 'ok');
    } catch (error) {
        setStatus(profileStatusField, error.message, 'error');
    }
}

document.getElementById('loadProfile').addEventListener('click', () => {
    loadProfiles().catch(error => console.error(error));
});

async function loadProfilesTab() {
    if (!state.guildId) {
        return;
    }

    try {
        const data = await api(withGuild('/api/members'));
        const members = Array.isArray(data?.members) ? data.members : [];
        await populateGuildUserSelects();
        const selectedUserId = profileUserSelect.value;
        profileUserSelect.innerHTML = '<option value="">Select a server member</option>';

        for (const member of members) {
            const option = document.createElement('option');
            option.value = member.id;
            option.textContent = member.nickname
                ? `${member.tag} (${member.nickname})`
                : member.tag;
            profileUserSelect.appendChild(option);
        }

        if (selectedUserId && members.some(member => member.id === selectedUserId)) {
            profileUserSelect.value = selectedUserId;
        }
    } catch (error) {
        setStatus(profileStatusField, error.message, 'error');
    }
}

profileUserSelect.addEventListener('change', () => {
    if (!profileUserSelect.value) {
        return;
    }

    document.getElementById('profileUserId').value = profileUserSelect.value;
    loadProfiles(profileUserSelect.value).catch(error => console.error(error));
});

async function populateGuildUserSelects() {
    if (!state.guildId) return;

    try {
        const data = await api(withGuild('/api/members'));
        const members = Array.isArray(data?.members) ? data.members : [];
        state.guildMembers = new Map(members.map(member => [String(member.id), member]));
        const selects = Array.from(document.querySelectorAll('.guild-user-select'));

        for (const select of selects) {
            const previous = select.value;
            select.innerHTML = '<option value="">Select a server member</option>';
            for (const member of members) {
                const option = document.createElement('option');
                option.value = member.id;
                option.textContent = member.nickname ? `${member.tag} (${member.nickname})` : member.tag;
                select.appendChild(option);
            }
            if (previous && members.some(member => member.id === previous)) select.value = previous;
        }
    } catch (error) {
        console.warn('Could not populate guild user selectors:', error.message);
    }
}

const guildUserSelectTargets = {
    permUserSelect: 'permUserId',
    aiMemoryUserSelect: 'aiMemoryUserId'
};

for (const [selectId, inputId] of Object.entries(guildUserSelectTargets)) {
    const select = document.getElementById(selectId);
    const input = document.getElementById(inputId);
    if (!select || !input) continue;
    select.addEventListener('change', event => {
        if (event.target.value) input.value = event.target.value;
    });
}

profileEditor.addEventListener('click', event => {
    if (event.target.closest('[data-social-add]')) {
        syncProfileSocials();
        const socials = JSON.parse(document.getElementById('profileSocials').value || '{}');
        let key = 'website';
        while (Object.hasOwn(socials, key)) key = `other${Object.keys(socials).length + 1}`;
        socials[key] = '';
        renderProfileSocialsBuilder(socials);
        return;
    }
    const socialRemove = event.target.closest('[data-social-remove]');
    if (socialRemove) {
        const rows = [...profileEditor.querySelectorAll('[data-profile-social]')];
        rows[Number(socialRemove.dataset.socialRemove)]?.remove();
        syncProfileSocials();
        return;
    }
    if (event.target.id === 'refreshProfile') { loadProfiles(profileEditor.dataset.userId).catch(error => console.error(error)); return; }
    if (event.target.id !== 'saveProfile') {
        return;
    }

    const userId = profileEditor.dataset.userId;

    if (!userId) {
        return;
    }

    let socials;

    try {
        socials = JSON.parse(document.getElementById('profileSocials').value || '{}');
    } catch {
        setStatus(profileStatusField, 'Socials must be valid JSON.', 'error');
        return;
    }

    const fields = {
        nickname: document.getElementById('profileNickname').value,
        bio: document.getElementById('profileBio').value,
        pronouns: document.getElementById('profilePronouns').value,
        birthday: document.getElementById('profileBirthday').value,
        timezone: document.getElementById('profileTimezone').value,
        languages: document.getElementById('profileLanguages').value,
        website: document.getElementById('profileWebsite').value,
        bannerUrl: document.getElementById('profileBannerUrl').value,
        color: document.getElementById('profileColor').value,
        socials
    };

    api(withGuild('/api/profile'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, ...fields })
    }).then(() => {
        setStatus(profileStatusField, 'Profile saved.', 'ok');
        loadProfiles(userId).catch(error => console.error(error));
    }).catch(error => {
        setStatus(profileStatusField, error.message, 'error');
    });
});
profileEditor.addEventListener('input', event => { if (event.target.closest('#profileSocialsBuilder')) syncProfileSocials(); });
profileEditor.addEventListener('change', event => { if (event.target.closest('#profileSocialsBuilder')) syncProfileSocials(); });

// ---------- Settings ----------
let editableTabOrder = [];
let editableDeveloperTabOrder = [...defaultDeveloperTabOrder];
let editableTabNames = {};

function tabLabel(tabId) {
    return tabButtons.find(button => button.dataset.tab === tabId)?.textContent.trim() || tabId;
}

function normalizeEditableTabOrder(order) {
    const normalized = [...order].filter(entry => !nestedChildTabIds.has(entry));
    for (const group of nestedTabGroups) {
        if (!normalized.includes(group.parent)) {
            const settingsIndex = normalized.indexOf('settings');
            normalized.splice(settingsIndex < 0 ? normalized.length : settingsIndex, 0, group.parent);
        }
    }
    return normalized;
}

function moveEditableTab(index, direction) {
    editableTabOrder = normalizeEditableTabOrder(editableTabOrder);
    const entry = editableTabOrder[index];
    const units = [];
    for (let cursor = 0; cursor < editableTabOrder.length;) {
        units.push([editableTabOrder[cursor++]]);
    }
    const unitIndex = units.findIndex(unit => unit.includes(entry));
    const targetIndex = unitIndex + direction;
    if (unitIndex < 0 || targetIndex < 0 || targetIndex >= units.length) return;
    [units[unitIndex], units[targetIndex]] = [units[targetIndex], units[unitIndex]];
    editableTabOrder = units.flat();
}

function renderTabOrderEditor() {
    editableTabOrder = normalizeEditableTabOrder(editableTabOrder);
    const container = document.getElementById('tabOrderEditor');
    container.innerHTML = editableTabOrder.length ? `<table><tbody>${editableTabOrder.map((entry, index) => {
        const divider = isDividerToken(entry);
        const title = isTitleToken(entry);
        const parentGroup = nestedTabGroups.find(group => group.parent === entry);
        const content = divider
            ? '<span class="muted">──── Divider ────</span>'
            : title
                ? `<div class="row"><span class="badge accent">Category</span><input data-tab-title-index="${index}" maxlength="60" value="${escapeHtml(titleFromToken(entry))}" aria-label="Category title" style="flex:1"></div>`
                : `<div class="row">${parentGroup ? '<span class="badge accent">Group</span>' : ''}<input data-tab-name="${escapeHtml(entry)}" value="${escapeHtml(editableTabNames[entry] || defaultTabLabels[entry] || entry)}" aria-label="Tab name" style="flex:1"></div>`;
        const requiredGroupTab = Boolean(parentGroup);
        const movementControls = `<button class="secondary" type="button" data-tab-order="up" data-index="${index}" ${index === 0 ? 'disabled' : ''}>↑</button> <button class="secondary" type="button" data-tab-order="down" data-index="${index}" ${index === editableTabOrder.length - 1 ? 'disabled' : ''}>↓</button>`;
        return `<tr data-tab-order-entry="${escapeHtml(entry)}"><td>${content}</td><td style="width:1%;white-space:nowrap">${movementControls} ${requiredGroupTab ? '' : `<button class="danger" type="button" data-tab-order="remove" data-index="${index}">Remove</button>`}</td></tr>`;
    }).join('')}</tbody></table>` : '<div class="empty">No tabs configured.</div>';
    container.querySelectorAll('[data-tab-order]').forEach(button => button.addEventListener('click', () => {
        const index = Number(button.dataset.index); const action = button.dataset.tabOrder;
        if (action === 'remove') editableTabOrder.splice(index, 1);
        if (action === 'up') moveEditableTab(index, -1);
        if (action === 'down') moveEditableTab(index, 1);
        renderTabOrderEditor();
    }));
    container.querySelectorAll('[data-tab-name]').forEach(input => input.addEventListener('input', () => { editableTabNames[input.dataset.tabName] = input.value; }));
    container.querySelectorAll('[data-tab-title-index]').forEach(input => input.addEventListener('input', () => {
        editableTabOrder[Number(input.dataset.tabTitleIndex)] = `title:${input.value.slice(0, 60)}`;
    }));
}

function renderDeveloperTabOrderEditor() {
    const container = document.getElementById('developerTabOrderEditor');
    container.innerHTML = `<table><tbody>${editableDeveloperTabOrder.map((tabId, index) => `
        <tr>
            <td><div class="row"><span class="badge dev">Developer</span><input data-developer-tab-name="${escapeHtml(tabId)}" maxlength="60" value="${escapeHtml(editableTabNames[tabId] || defaultTabLabels[tabId] || tabLabel(tabId))}" aria-label="Developer tab name" style="flex:1"></div></td>
            <td style="width:1%;white-space:nowrap">
                <button class="secondary" type="button" data-developer-tab-order="up" data-index="${index}" ${index === 0 ? 'disabled' : ''}>↑</button>
                <button class="secondary" type="button" data-developer-tab-order="down" data-index="${index}" ${index === editableDeveloperTabOrder.length - 1 ? 'disabled' : ''}>↓</button>
            </td>
        </tr>`).join('')}</tbody></table>`;
    container.querySelectorAll('[data-developer-tab-order]').forEach(button => button.addEventListener('click', () => {
        const index = Number(button.dataset.index);
        const target = button.dataset.developerTabOrder === 'up' ? index - 1 : index + 1;
        if (target < 0 || target >= editableDeveloperTabOrder.length) return;
        [editableDeveloperTabOrder[index], editableDeveloperTabOrder[target]] = [editableDeveloperTabOrder[target], editableDeveloperTabOrder[index]];
        renderDeveloperTabOrderEditor();
    }));
    container.querySelectorAll('[data-developer-tab-name]').forEach(input => input.addEventListener('input', () => {
        editableTabNames[input.dataset.developerTabName] = input.value.slice(0, 60);
    }));
}

let managementChannelsGuildId = null;
let managementChannels = [];
let managementRoles = [];
let managementMembers = [];

function setAnalyticsExpanded(expanded) {
    const toggle = document.getElementById('analyticsNavToggle');
    const subnav = document.getElementById('analyticsSubnav');
    const open = Boolean(expanded);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', uiText(`${open ? 'Collapse' : 'Expand'} Analytics tabs`));
    subnav.hidden = !open;
}

function setManagementExpanded(expanded) {
    const toggle = document.getElementById('managementNavToggle');
    const subnav = document.getElementById('managementSubnav');
    const open = Boolean(expanded);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', uiText(`${open ? 'Collapse' : 'Expand'} Management tabs`));
    subnav.hidden = !open;
}

function applyManagementNavigation() {
    const subnav = document.getElementById('managementSubnav');

    const buttons = Array.from(
        subnav.querySelectorAll('[data-management-module][data-tab]')
    );

    for (const button of buttons) {
        button.hidden = false;

        button.dataset.moduleEnabled = String(
            state.management?.modules?.[button.dataset.managementModule] === true
        );
    }

    const enabledButtons = buttons
        .filter(button => button.dataset.moduleEnabled === 'true')
        .sort((a, b) =>
            a.textContent.trim().localeCompare(
                b.textContent.trim(),
                undefined,
                { sensitivity: 'base' }
            )
        );

    const disabledButtons = buttons
        .filter(button => button.dataset.moduleEnabled !== 'true')
        .sort((a, b) =>
            a.textContent.trim().localeCompare(
                b.textContent.trim(),
                undefined,
                { sensitivity: 'base' }
            )
        );

    // Remove previously generated section labels/divider.
    subnav.querySelectorAll('[data-management-section]').forEach(element => {
        element.remove();
    });

    if (enabledButtons.length > 0) {
        const enabledLabel = document.createElement('div');
        enabledLabel.className = 'management-module-section-label';
        enabledLabel.dataset.managementSection = 'enabled';
        enabledLabel.textContent = 'On';

        subnav.appendChild(enabledLabel);

        enabledButtons.forEach(button => {
            subnav.appendChild(button);
        });
    }

    if (enabledButtons.length > 0 && disabledButtons.length > 0) {
        const divider = document.createElement('div');
        divider.className = 'management-module-divider';
        divider.dataset.managementSection = 'divider';

        subnav.appendChild(divider);
    }

    if (disabledButtons.length > 0) {
        const disabledLabel = document.createElement('div');
        disabledLabel.className = 'management-module-section-label';
        disabledLabel.dataset.managementSection = 'disabled';
        disabledLabel.textContent = 'Off';

        subnav.appendChild(disabledLabel);

        disabledButtons.forEach(button => {
            subnav.appendChild(button);
        });
    }

    const activeManagementChild = document.querySelector(
        '.management-subnav .tab-btn.active:not([hidden])'
    );

    const rememberedOpen =
        document.getElementById('managementNavToggle')
            .getAttribute('aria-expanded') === 'true';

    setManagementExpanded(
        Boolean(activeManagementChild) || rememberedOpen
    );

    updateTabNavigationStructure();
}

function renderManagementCards() {
    const container = document.getElementById('managementModuleCards');
    const modules = state.management?.modules || {};
    const entries = Object.entries(managementModuleDefinitions)
        .sort(([, left], [, right]) => left.title.localeCompare(right.title, undefined, { sensitivity: 'base' }));

    const renderCard = ([key, definition]) => {
        const enabled = modules[key] === true;
        return `<article class="management-module-card" data-enabled="${enabled}" data-management-card="${escapeHtml(key)}">
            <div class="management-module-meta"><span>${escapeHtml(uiText(managementModuleCategories[key] || 'Module'))}</span><span class="module-card-state">${escapeHtml(uiText(enabled ? 'Running' : 'Paused'))}</span></div>
            <div class="management-module-heading"><h3>${escapeHtml(definition.title)}</h3><button class="module-toggle" type="button" data-toggle-management="${escapeHtml(key)}" aria-pressed="${enabled}">${enabled ? 'On' : 'Off'}</button></div>
            <p class="sub">${escapeHtml(definition.description)}</p>
            <div class="actions"><button class="secondary module-open-button" type="button" data-open-management="${escapeHtml(key)}">${escapeHtml(uiText('Open settings'))} <span aria-hidden="true">→</span></button></div>
        </article>`;
    };

    const enabledEntries = entries.filter(([key]) => modules[key] === true);
    const disabledEntries = entries.filter(([key]) => modules[key] !== true);
    const sections = [];

    if (enabledEntries.length > 0) {
        sections.push('<div class="management-module-section-label" data-management-card-section="enabled" style="grid-column:1/-1">On</div>');
        sections.push(...enabledEntries.map(renderCard));
    }

    if (enabledEntries.length > 0 && disabledEntries.length > 0) {
        sections.push('<div class="management-module-divider" data-management-card-section="divider" style="grid-column:1/-1;margin-left:0;margin-right:0"></div>');
    }

    if (disabledEntries.length > 0) {
        sections.push('<div class="management-module-section-label" data-management-card-section="disabled" style="grid-column:1/-1">Off</div>');
        sections.push(...disabledEntries.map(renderCard));
    }

    container.innerHTML = sections.join('');

    for (const page of document.querySelectorAll('[data-module-page-switch]')) {
        const key = page.dataset.modulePageSwitch;
        const enabled = modules[key] === true;
        page.dataset.enabled = String(enabled);
        const toggle = page.querySelector('[data-page-module-toggle]');
        toggle.disabled = false;
        toggle.setAttribute('aria-pressed', String(enabled));
        toggle.textContent = enabled ? 'On' : 'Off';
    }
    for (const stateLabel of document.querySelectorAll('[data-module-runtime-state]')) {
        const enabled = modules[stateLabel.dataset.moduleRuntimeState] === true;
        stateLabel.dataset.enabled = String(enabled);
        stateLabel.innerHTML = `<span aria-hidden="true"></span>${escapeHtml(uiText(enabled ? 'Enabled and running' : 'Paused — saved settings are kept'))}`;
    }
    filterManagementModules();
}

let managementModuleFilter = 'all';

function filterManagementModules() {
    const query = document.getElementById('managementModuleSearch').value.trim().toLocaleLowerCase();
    const cards = [...document.querySelectorAll('[data-management-card]')];
    let visible = 0;
    let visibleEnabled = 0;
    let visibleDisabled = 0;

    for (const card of cards) {
        const definition = managementModuleDefinitions[card.dataset.managementCard];
        const searchableText = `${definition?.title || ''} ${definition?.description || ''} ${card.dataset.managementCard}`.toLocaleLowerCase();
        const matchesSearch = !query || searchableText.includes(query);
        const matchesState = managementModuleFilter === 'all'
            || (managementModuleFilter === 'enabled' && card.dataset.enabled === 'true')
            || (managementModuleFilter === 'disabled' && card.dataset.enabled !== 'true');
        card.hidden = !(matchesSearch && matchesState);

        if (!card.hidden) {
            visible += 1;
            if (card.dataset.enabled === 'true') visibleEnabled += 1;
            else visibleDisabled += 1;
        }
    }

    const enabledLabel = document.querySelector('[data-management-card-section="enabled"]');
    const disabledLabel = document.querySelector('[data-management-card-section="disabled"]');
    const divider = document.querySelector('[data-management-card-section="divider"]');

    if (enabledLabel) enabledLabel.hidden = visibleEnabled === 0;
    if (disabledLabel) disabledLabel.hidden = visibleDisabled === 0;
    if (divider) divider.hidden = !(visibleEnabled > 0 && visibleDisabled > 0);

    document.getElementById('managementModuleSearchSummary').textContent = query
        ? `${visible} of ${cards.length} modules found`
        : `${cards.length} management modules`;
    document.getElementById('managementModuleEmpty').hidden = visible !== 0;
}

document.getElementById('managementModuleSearch').addEventListener('input', filterManagementModules);
document.getElementById('managementModuleSearch').addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !event.currentTarget.value) return;
    event.currentTarget.value = '';
    filterManagementModules();
});
document.querySelectorAll('[data-management-filter]').forEach(button => button.addEventListener('click', () => {
    managementModuleFilter = button.dataset.managementFilter;
    document.querySelectorAll('[data-management-filter]').forEach(filter => {
        const active = filter === button;
        filter.classList.toggle('active', active);
        filter.setAttribute('aria-pressed', String(active));
    });
    filterManagementModules();
}));

function setSelectedValues(select, values) {
    const selected = new Set((Array.isArray(values) ? values : [values]).filter(Boolean).map(String));
    for (const option of select.options) option.selected = selected.has(option.value);
}

function selectedValues(id) {
    return [...document.getElementById(id).selectedOptions].map(option => option.value).filter(Boolean);
}

function setManagementResourceOptions({ channels = [], roles = [], members = [], bans = [] }) {
    managementChannels = channels || [];
    managementRoles = roles || [];
    managementMembers = members || [];
    const fill = (select, available, emptyLabel, renderLabel) => {
        const previous = [...select.selectedOptions].map(option => option.value);
        select.innerHTML = `${select.multiple ? '' : `<option value="">${emptyLabel}</option>`}${available.map(item => `<option value="${escapeHtml(item.id)}">${renderLabel(item)}</option>`).join('')}`;
        setSelectedValues(select, previous);
    };
    for (const select of document.querySelectorAll('[data-management-channel]')) {
        fill(select, channels.filter(channel => channel.kind !== 'category'), 'No channel selected', channel => `#${escapeHtml(channel.name)}`);
    }
    for (const select of document.querySelectorAll('[data-management-category]')) {
        fill(select, channels.filter(channel => channel.kind === 'category'), 'No category selected', channel => escapeHtml(channel.name));
    }
    for (const select of document.querySelectorAll('[data-management-role]')) {
        fill(select, roles, 'No role selected', role => `@${escapeHtml(role.name)}${role.managed ? ' (managed)' : ''}`);
    }
    for (const select of document.querySelectorAll('[data-management-member]')) {
        fill(select, members, 'All members', member => escapeHtml(member.nickname ? `${member.displayName} (${member.tag})` : member.tag));
    }
    for (const select of document.querySelectorAll('[data-management-target]')) {
        fill(select, [...members, ...bans], 'Choose a member', member => escapeHtml(`${member.banned ? '[Banned] ' : ''}${member.nickname ? `${member.displayName} (${member.tag})` : member.tag}`));
    }
    for (const select of document.querySelectorAll('[data-management-guild]')) {
        fill(select, state.guilds, 'No server selected', guild => escapeHtml(guild.name));
    }
}

async function ensureManagementResources() {
    if (!state.guildId || state.role === 'member' || managementChannelsGuildId === state.guildId) return;
    const resources = await api(withGuild('/api/management/channels'));
    setManagementResourceOptions(resources);
    state.guildMembers = new Map((resources.members || []).map(member => [String(member.id), member]));
    managementChannelsGuildId = state.guildId;
}

function managementChannelOptions(selected = '') {
    return '<option value="">Choose a channel</option>' + managementChannels.filter(channel => channel.kind !== 'category').map(channel => `<option value="${escapeHtml(channel.id)}" ${channel.id === selected ? 'selected' : ''}>#${escapeHtml(channel.name)}</option>`).join('');
}

function managementMultiOptions(items, selectedValues, label) {
    const selected = new Set((selectedValues || []).map(String));
    return items.map(item => `<option value="${escapeHtml(item.id)}" ${selected.has(String(item.id)) ? 'selected' : ''}>${label(item)}</option>`).join('');
}

function resourceDisplay(id, kind = 'member') {
    if (!id) return 'Not selected';
    const source = kind === 'channel' ? managementChannels : kind === 'role' ? managementRoles : managementMembers;
    const item = source.find(entry => String(entry.id) === String(id)) || state.guildMembers.get(String(id));
    if (!item) return `Unknown ${kind}`;
    const name = item.displayName || item.nickname || item.name || item.tag || item.username || String(id);
    return `${kind === 'channel' ? '#' : kind === 'role' ? '@' : ''}${name}`;
}

function renderAutomationRules() {
    const schedules = state.management?.automation?.schedules || [];
    const purges = state.management?.automation?.purgeRules || [];
    document.getElementById('managementSchedules').innerHTML = schedules.length ? schedules.map((rule, index) => `<div class="automation-rule" data-schedule-row><div class="two-col"><div class="field"><label>Name</label><input data-rule-id value="${escapeHtml(rule.id)}" maxlength="80"></div><div class="field"><label>Channel</label><select data-rule-channel>${managementChannelOptions(rule.channelId)}</select></div><div class="field"><label>Schedule type</label><select data-rule-type><option value="interval" ${rule.scheduleType === 'interval' ? 'selected' : ''}>Interval</option><option value="once" ${rule.scheduleType === 'once' ? 'selected' : ''}>One-time</option><option value="weekly" ${rule.scheduleType === 'weekly' ? 'selected' : ''}>Weekdays</option><option value="cron" ${rule.scheduleType === 'cron' ? 'selected' : ''}>Cron</option></select></div><div class="field"><label>Every (minutes)</label><input data-rule-interval type="number" min="5" max="43200" value="${Number(rule.intervalMinutes) || 1440}"></div><div class="field"><label>Date/time (one-time)</label><input data-rule-run-at type="datetime-local" value="${escapeHtml(rule.runAt || '')}"></div><div class="field"><label>Time (weekly)</label><input data-rule-time type="time" value="${escapeHtml(rule.time || '09:00')}"></div><div class="field"><label>Weekdays (0=Sun … 6=Sat)</label><input data-rule-weekdays value="${escapeHtml((rule.weekdays || []).join(','))}" placeholder="1,3,5"></div><div class="field"><label>Cron (min hour day month weekday)</label><input data-rule-cron value="${escapeHtml(rule.cron || '')}" placeholder="0 20 * * 5"></div><div class="field"><label>Timezone</label><input data-rule-timezone value="${escapeHtml(rule.timezone || 'UTC')}" placeholder="Europe/Amsterdam"></div><div class="field"><label>Start date (optional)</label><input data-rule-start type="datetime-local" value="${escapeHtml(rule.startAt || '')}"></div><div class="field"><label>End date (optional)</label><input data-rule-end type="datetime-local" value="${escapeHtml(rule.endAt || '')}"></div><div class="checkbox-row"><input data-rule-enabled type="checkbox" ${rule.enabled !== false ? 'checked' : ''}><label style="margin:0">Enabled</label></div></div><div class="field"><label>Message</label><textarea data-rule-message rows="3" maxlength="1800">${escapeHtml(rule.message)}</textarea></div><div class="actions"><button class="danger" type="button" data-remove-schedule="${index}">Remove</button></div></div>`).join('') : '<div class="empty">No scheduled messages yet.</div>';
    document.getElementById('managementPurgeRules').innerHTML = purges.length ? purges.map((rule, index) => `<div class="automation-rule" data-purge-row><div class="two-col"><div class="field"><label>Name</label><input data-rule-id value="${escapeHtml(rule.id)}" maxlength="80"></div><div class="field"><label>Channel</label><select data-rule-channel>${managementChannelOptions(rule.channelId)}</select></div><div class="field"><label>Keep newest messages</label><input data-rule-keep type="number" min="0" max="100" value="${Number(rule.keepMessages) || 0}"></div><div class="field"><label>Every (minutes)</label><input data-rule-interval type="number" min="10" max="43200" value="${Number(rule.intervalMinutes) || 1440}"></div><div class="checkbox-row"><input data-rule-enabled type="checkbox" ${rule.enabled !== false ? 'checked' : ''}><label style="margin:0">Enabled</label></div></div><div class="actions"><button class="danger" type="button" data-remove-purge="${index}">Remove</button></div></div>`).join('') : '<div class="empty">No auto-purge rules yet.</div>';
    enhanceAutomationSchedules();
}

function enhanceAutomationSchedules() {
    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (const row of document.querySelectorAll('[data-schedule-row]')) {
        const weekdayInput = row.querySelector('[data-rule-weekdays]');
        if (weekdayInput && !row.querySelector('[data-weekday-picker]')) {
            weekdayInput.closest('.field').hidden = true;
            const selected = new Set(weekdayInput.value.split(',').filter(value => value !== '').map(Number));
            const picker = document.createElement('div');
            picker.className = 'field schedule-weekday-field';
            picker.dataset.weekdayPicker = 'true';
            picker.innerHTML = `<label>Weekdays</label><div class="weekday-picker">${dayLabels.map((label, day) => `<button type="button" data-weekday="${day}" aria-pressed="${selected.has(day)}">${label}</button>`).join('')}</div>`;
            weekdayInput.closest('.field').after(picker);
        }
        const timezone = row.querySelector('[data-rule-timezone]');
        if (timezone) {
            timezone.setAttribute('list', 'commonTimezones');
            if (!document.getElementById('commonTimezones')) document.body.insertAdjacentHTML('beforeend', '<datalist id="commonTimezones"><option value="UTC"><option value="Europe/Amsterdam"><option value="Europe/Berlin"><option value="Europe/London"><option value="America/New_York"><option value="America/Los_Angeles"><option value="Asia/Tokyo"><option value="Australia/Sydney"></datalist>');
        }
        const actions = row.querySelector('.actions');
        if (actions && !actions.querySelector('[data-preview-schedule]')) actions.insertAdjacentHTML('afterbegin', '<button class="secondary" type="button" data-preview-schedule>Preview next runs</button>');
        updateScheduleFields(row);
    }
}

function updateScheduleFields(row) {
    const type = row.querySelector('[data-rule-type]')?.value || 'interval';
    const visibility = { interval: ['[data-rule-interval]'], once: ['[data-rule-run-at]'], weekly: ['[data-rule-time]', '[data-weekday-picker]'], cron: ['[data-rule-cron]'] };
    for (const selector of ['[data-rule-interval]', '[data-rule-run-at]', '[data-rule-time]', '[data-rule-cron]']) row.querySelector(selector)?.closest('.field')?.toggleAttribute('hidden', !(visibility[type] || []).includes(selector));
    row.querySelector('[data-weekday-picker]')?.toggleAttribute('hidden', type !== 'weekly');
}

function renderAutomodRules() {
    const rules = state.management?.automod?.rules || {};
    document.getElementById('managementAutomodRules').innerHTML = Object.entries(automodRuleDefinitions).map(([key, definition]) => {
        const rule = rules[key] || { enabled: false, action: 'inherit', limit: 1, windowSeconds: 8, ignoredChannelIds: [], ignoredRoleIds: [] };
        return `<article class="automod-rule-card" data-automod-rule="${escapeHtml(key)}" data-enabled="${rule.enabled === true}">
            <div class="management-module-heading"><h3>${escapeHtml(definition.title)}</h3><button class="module-toggle" type="button" data-automod-toggle aria-pressed="${rule.enabled === true}">${rule.enabled ? 'On' : 'Off'}</button></div>
            <p class="sub">${escapeHtml(definition.description)}</p>
            <div class="field"><label>Action</label><select data-automod-action><option value="inherit" ${rule.action === 'inherit' ? 'selected' : ''}>Use default action</option><option value="delete" ${rule.action === 'delete' ? 'selected' : ''}>Delete message</option><option value="warn" ${rule.action === 'warn' ? 'selected' : ''}>Delete + warn</option><option value="timeout" ${rule.action === 'timeout' ? 'selected' : ''}>Delete + timeout</option></select></div>
            ${definition.fixedLimit ? '' : `<div class="two-col"><div class="field"><label>${escapeHtml(definition.limit)}</label><input data-automod-limit type="number" min="${definition.min || 1}" max="100" value="${Number(rule.limit) || 1}"></div>${definition.window ? `<div class="field"><label>Window (seconds)</label><input data-automod-window type="number" min="2" max="300" value="${Number(rule.windowSeconds) || 8}"></div>` : ''}</div>`}
            <details><summary>Filter exceptions</summary><div class="field"><label>Ignored channels</label><select data-automod-channels multiple>${managementMultiOptions(managementChannels.filter(channel => channel.kind !== 'category'), rule.ignoredChannelIds, channel => `#${escapeHtml(channel.name)}`)}</select></div><div class="field"><label>Ignored roles</label><select data-automod-roles multiple>${managementMultiOptions(managementRoles, rule.ignoredRoleIds, role => `@${escapeHtml(role.name)}`)}</select></div></details>
        </article>`;
    }).join('');
}

function renderSupportTeams() {
    const source = document.getElementById('managementTicketTeams');
    if (!source) return;
    source.hidden = true;
    const field = source.closest('.field');
    const label = field?.querySelector('label');
    if (label) label.textContent = 'Support teams';
    let editor = document.getElementById('managementTicketTeamsEditor');
    if (!editor) {
        editor = document.createElement('div');
        editor.id = 'managementTicketTeamsEditor';
        source.insertAdjacentElement('afterend', editor);
    }
    const teams = state.management?.tickets?.supportTeams || [];
    editor.innerHTML = `${teams.map((team, index) => `<div class="automation-rule" data-support-team="${index}"><div class="two-col"><div class="field"><label>Key</label><input data-team-id value="${escapeHtml(team.id || '')}" placeholder="billing"></div><div class="field"><label>Name</label><input data-team-name value="${escapeHtml(team.name || '')}" placeholder="Billing"></div><div class="field"><label>Role</label><select data-team-role><option value="">Use default support role</option>${managementMultiOptions(managementRoles, [team.roleId], role => `@${escapeHtml(role.name)}`)}</select></div><div class="field"><label>Category</label><select data-team-category><option value="">Use default ticket category</option>${managementMultiOptions(managementChannels.filter(channel => channel.kind === 'category'), [team.categoryId], channel => escapeHtml(channel.name))}</select></div></div><button class="danger" type="button" data-remove-support-team="${index}">Remove team</button></div>`).join('')}<button class="secondary" type="button" id="managementAddSupportTeam">Add support team</button>`;
}

function renderWorkflowResourcePicker() {
    const source = document.getElementById('workflowRulesJson');
    if (!source) return;
    let picker = document.getElementById('workflowResourcePicker');
    if (!picker) {
        picker = document.createElement('div');
        picker.id = 'workflowResourcePicker';
        picker.className = 'row';
        source.insertAdjacentElement('beforebegin', picker);
    }
    picker.innerHTML = `<select id="workflowRolePicker"><option value="">Choose an available role</option>${managementRoles.map(role => `<option value="${escapeHtml(role.id)}">@${escapeHtml(role.name)}</option>`).join('')}</select><button class="secondary" type="button" data-insert-workflow-resource="roleId">Insert role</button><select id="workflowChannelPicker"><option value="">Choose an available channel</option>${managementChannels.filter(channel => channel.kind !== 'category').map(channel => `<option value="${escapeHtml(channel.id)}">#${escapeHtml(channel.name)}</option>`).join('')}</select><button class="secondary" type="button" data-insert-workflow-resource="channelId">Insert channel</button>`;
}

function renderFormQuestionBuilder() {
    const source = document.getElementById('managementFormsQuestions');
    if (!source) return;
    source.hidden = true;
    let builder = document.getElementById('formQuestionBuilder');
    if (!builder) {
        builder = document.createElement('div');
        builder.id = 'formQuestionBuilder';
        builder.className = 'structured-builder';
        source.after(builder);
    }
    const questions = source.value.split('\n').map(value => value.trim()).filter(Boolean);
    builder.innerHTML = `<div class="structured-builder-list">${questions.map((question, index) => `<div class="question-builder-row" data-question-row="${index}"><span>${index + 1}</span><input value="${escapeHtml(question)}" maxlength="200" aria-label="Question ${index + 1}"><button class="secondary compact" type="button" data-question-up="${index}" ${index === 0 ? 'disabled' : ''}>↑</button><button class="secondary compact" type="button" data-question-down="${index}" ${index === questions.length - 1 ? 'disabled' : ''}>↓</button><button class="danger compact" type="button" data-question-remove="${index}">Remove</button></div>`).join('')}</div><button class="secondary" type="button" data-question-add ${questions.length >= 5 ? 'disabled' : ''}>Add question</button><small>${questions.length}/5 questions · members answer these in a Discord modal.</small>`;
}

function syncFormQuestions() {
    const source = document.getElementById('managementFormsQuestions');
    source.value = [...document.querySelectorAll('[data-question-row] input')].map(input => input.value.trim()).filter(Boolean).join('\n');
    source.dispatchEvent(new Event('input', { bubbles: true }));
}

function workflowResourceOptions(type, selected) {
    const items = type === 'role' ? managementRoles : managementChannels.filter(channel => channel.kind !== 'category');
    return `<option value="">No ${type} selected</option>${items.map(item => `<option value="${escapeHtml(item.id)}" ${String(item.id) === String(selected || '') ? 'selected' : ''}>${type === 'role' ? '@' : '#'}${escapeHtml(item.name)}</option>`).join('')}`;
}

const workflowEventOptions = [
    ['member.join', 'A member joins'], ['warning.created', 'A warning is created'], ['ticket.closed', 'A ticket closes'],
    ['ticket.rating', 'A ticket receives a rating'], ['message.created', 'A message is sent']
];
const workflowConditionFields = {
    'member.join': [['accountAgeDays', 'Account age (days)'], ['member.roleCount', 'Number of roles']],
    'warning.created': [['warningCount', 'Warning count'], ['reason', 'Warning reason']],
    'ticket.closed': [['ticket.priority', 'Ticket priority'], ['ticket.status', 'Ticket status']],
    'ticket.rating': [['rating', 'Rating'], ['ticket.priority', 'Ticket priority']],
    'message.created': [['message.content', 'Message text'], ['message.mentionCount', 'Mention count'], ['channelId', 'Channel']]
};
const workflowActionOptions = [
    ['add-role', 'Add a role'], ['timeout', 'Timeout member'], ['staff-alert', 'Alert staff'],
    ['send-message', 'Send a message'], ['notification', 'Create notification'], ['create-case', 'Create moderation case']
];

function workflowConditionOptions(event, selected) {
    const options = workflowConditionFields[event] || [];
    const known = options.some(([value]) => value === selected);
    return `<option value="">Choose available data</option>${!known && selected ? `<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)} (existing custom field)</option>` : ''}${options.map(([value, label]) => `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}`;
}

function renderWorkflowBuilder() {
    const source = document.getElementById('workflowRulesJson');
    if (!source) return;
    source.hidden = true;
    const field = source.closest('.field');
    const label = field?.querySelector('label');
    if (label) label.textContent = 'Workflow rules';
    const sectionDescription = field?.closest('.section')?.querySelector(':scope > .sub');
    if (sectionDescription) sectionDescription.textContent = 'Build each automation as a clear WHEN event, optional IF conditions, and ordered THEN actions.';
    const sectionGuideDescription = document.querySelector(`[data-module-section-target="${field?.closest('.section')?.id}"] span`);
    if (sectionGuideDescription) sectionGuideDescription.textContent = sectionDescription.textContent;
    document.getElementById('workflowResourcePicker')?.toggleAttribute('hidden', true);
    let builder = document.getElementById('workflowVisualBuilder');
    if (!builder) {
        builder = document.createElement('div');
        builder.id = 'workflowVisualBuilder';
        builder.className = 'workflow-builder';
        source.after(builder);
    }
    const rules = readJsonArray(source);
    const operators = ['equals', 'not-equals', 'greater-than', 'less-than', 'contains'];
    builder.innerHTML = `<div class="workflow-rule-list">${rules.map((rule, ruleIndex) => `<article class="workflow-rule-card" data-workflow-rule="${ruleIndex}"><div class="section-title-row"><div><h3>Rule ${ruleIndex + 1}</h3><p class="sub">WHEN an event occurs, IF every condition matches, THEN actions run in order.</p></div><button class="danger compact" type="button" data-workflow-remove-rule="${ruleIndex}">Remove rule</button></div><div class="two-col"><div class="field"><label>Name</label><input data-workflow-name value="${escapeHtml(rule.name || '')}"></div><div class="field"><label>When</label><select data-workflow-event>${workflowEventOptions.map(([value, label]) => `<option value="${value}" ${rule.event === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select></div></div><h4>IF conditions</h4><div data-workflow-conditions>${(rule.conditions || []).map((condition, index) => `<div class="workflow-builder-row" data-workflow-condition="${index}"><select data-condition-field>${workflowConditionOptions(rule.event, condition.field)}</select><select data-condition-operator>${operators.map(value => `<option value="${value}" ${condition.operator === value ? 'selected' : ''}>${value.replaceAll('-', ' ')}</option>`).join('')}</select><input data-condition-value value="${escapeHtml(condition.value ?? '')}" placeholder="Comparison value"><button class="danger compact" type="button" data-remove-condition>×</button></div>`).join('')}</div><button class="secondary compact" type="button" data-add-condition>Add condition</button><h4>THEN actions</h4><div data-workflow-actions>${(rule.actions || []).map((action, index) => `<div class="workflow-action-row" data-workflow-action="${index}"><select data-action-type>${workflowActionOptions.map(([value, label]) => `<option value="${value}" ${action.type === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select><select data-action-role>${workflowResourceOptions('role', action.roleId)}</select><select data-action-channel>${workflowResourceOptions('channel', action.channelId)}</select><input data-action-value value="${escapeHtml(action.message || action.duration || '')}" placeholder="Message or duration"><button class="danger compact" type="button" data-remove-action>×</button></div>`).join('')}</div><button class="secondary compact" type="button" data-add-action>Add action</button></article>`).join('')}</div><button class="secondary" type="button" data-workflow-add-rule>Add workflow rule</button>`;
    for (const row of builder.querySelectorAll('[data-workflow-action]')) updateWorkflowActionFields(row);
}

function updateWorkflowActionFields(row) {
    const type = row.querySelector('[data-action-type]')?.value;
    const role = row.querySelector('[data-action-role]');
    const channel = row.querySelector('[data-action-channel]');
    const detail = row.querySelector('[data-action-value]');
    if (role) role.hidden = type !== 'add-role';
    if (channel) channel.hidden = !['send-message', 'staff-alert', 'notification'].includes(type);
    if (detail) {
        detail.hidden = !['timeout', 'send-message', 'staff-alert', 'notification'].includes(type);
        detail.placeholder = type === 'timeout' ? 'Duration, e.g. 10m' : 'Message';
    }
}

function syncWorkflowBuilder() {
    const source = document.getElementById('workflowRulesJson');
    const previous = readJsonArray(source);
    const rules = [...document.querySelectorAll('[data-workflow-rule]')].map((card, ruleIndex) => ({
        ...(previous[ruleIndex] || {}), name: card.querySelector('[data-workflow-name]').value.trim(), event: card.querySelector('[data-workflow-event]').value,
        conditions: [...card.querySelectorAll('[data-workflow-condition]')].map(row => ({ field: row.querySelector('[data-condition-field]').value.trim(), operator: row.querySelector('[data-condition-operator]').value, value: row.querySelector('[data-condition-value]').value.trim() })),
        actions: [...card.querySelectorAll('[data-workflow-action]')].map(row => { const type = row.querySelector('[data-action-type]').value, roleId = row.querySelector('[data-action-role]').value, channelId = row.querySelector('[data-action-channel]').value, detail = row.querySelector('[data-action-value]').value.trim(); return { type, ...(roleId ? { roleId } : {}), ...(channelId ? { channelId } : {}), ...(detail ? (type === 'timeout' ? { duration: detail } : { message: detail }) : {}) }; })
    }));
    source.value = JSON.stringify(rules, null, 2);
    source.dispatchEvent(new Event('input', { bubbles: true }));
}

function renderModulePreviews() {
    const previews = [
        ['managementOnboardingMessage', 'roles', 'Role-menu preview', () => `<strong>${escapeHtml(document.getElementById('managementOnboardingTitle').value || 'Choose your roles')}</strong><p>${escapeHtml(document.getElementById('managementOnboardingMessage').value || 'Members will see this message above the role menu.')}</p>`],
        ['managementWelcomeMessage', 'welcome', 'Welcome message preview', () => `<strong>Welcome, @new-member!</strong><p>${escapeHtml((document.getElementById('managementWelcomeMessage').value || 'Welcome {user} to {server}!').replaceAll('{user}', '@new-member').replaceAll('{server}', state.guildName || 'your server'))}</p>`],
        ['managementGoodbyeMessage', 'goodbye', 'Goodbye message preview', () => `<strong>Member left</strong><p>${escapeHtml((document.getElementById('managementGoodbyeMessage').value || '{user} left {server}.').replaceAll('{user}', '@member').replaceAll('{server}', state.guildName || 'your server'))}</p>`],
        ['managementStarboardEmoji', 'starboard', 'Starboard preview', () => `<strong>${escapeHtml(document.getElementById('managementStarboardEmoji').value || '⭐')} ${escapeHtml(document.getElementById('managementStarboardThreshold').value || '3')}</strong><p>A highlighted message will appear in ${escapeHtml(resourceDisplay(document.getElementById('managementStarboardChannel').value, 'channel'))}.</p>`],
        ['managementFormsTitle', 'forms', 'Form preview', () => `<strong>${escapeHtml(document.getElementById('managementFormsTitle').value || 'Application')}</strong><p>${document.getElementById('managementFormsQuestions').value.split('\n').filter(Boolean).map((question, index) => `${index + 1}. ${escapeHtml(question)}`).join('<br>') || 'Add questions to preview the Discord modal.'}</p>`]
    ];
    for (const [anchorId, key, title, render] of previews) {
        const anchor = document.getElementById(anchorId);
        const section = anchor?.closest('.section');
        if (!section) continue;
        let preview = section.querySelector(`[data-module-preview="${key}"]`);
        if (!preview) { preview = document.createElement('div'); preview.className = 'module-live-preview'; preview.dataset.modulePreview = key; section.querySelector('.actions')?.before(preview); }
        preview.innerHTML = `<span>${title}</span>${render()}`;
    }
}

function hydrateManagementEditors() {
    const management = state.management;
    if (!management) return;
    document.getElementById('managementRequireReason').checked = management.moderation.requireReason;
    document.getElementById('managementNotifyMember').checked = management.moderation.notifyMember;
    document.getElementById('managementDefaultTimeout').value = management.moderation.defaultTimeoutMinutes;
    document.getElementById('managementAutomodPreset').value = management.automod.preset;
    document.getElementById('managementAutomodMode').value = management.automod.mode;
    document.getElementById('managementAutomodEscalation').checked = management.automod.escalationEnabled;
    document.getElementById('managementAutomodLogChannel').value = management.automod.logChannelId || '';
    document.getElementById('managementAutomodAction').value = management.automod.action || 'delete';
    document.getElementById('managementAutomodTimeout').value = management.automod.timeoutMinutes || 10;
    document.getElementById('managementBlockedTerms').value = (management.automod.blockedTerms || []).join('\n');
    document.getElementById('managementAllowedDomains').value = (management.automod.allowedDomains || []).join('\n');
    document.getElementById('managementAllowedInvites').value = (management.automod.allowedInviteCodes || []).join('\n');
    setSelectedValues(document.getElementById('managementIgnoredChannels'), management.automod.ignoredChannelIds || []);
    setSelectedValues(document.getElementById('managementIgnoredRoles'), management.automod.ignoredRoleIds || []);
    renderAutomodRules();
    document.getElementById('managementCaseLogChannel').value = management.cases.logChannelId || '';
    document.getElementById('managementCaseRetention').value = management.cases.retentionDays;
    document.getElementById('managementLogMessageChanges').checked = management.cases.logMessageChanges;
    document.getElementById('managementLogMemberChanges').checked = management.cases.logMemberChanges;
    document.getElementById('managementAutoroleId').value = management.roles.autoroleId || '';
    document.getElementById('managementAutoroleDelay').value = management.roles.autoroleDelayMinutes;
    document.getElementById('managementPersistRoles').checked = management.roles.persistRoles;
    document.getElementById('managementInteractiveRoles').checked = management.roles.interactiveRoles;
    setSelectedValues(document.getElementById('managementSelfRoles'), management.roles.selfAssignableRoleIds || []);
    document.getElementById('managementOnboardingChannel').value = management.roles.onboardingChannelId || '';
    document.getElementById('managementOnboardingTitle').value = management.roles.onboardingTitle || '';
    document.getElementById('managementOnboardingMessage').value = management.roles.onboardingMessage || '';
    document.getElementById('managementWelcomeEnabled').checked = management.automation.welcomeEnabled;
    document.getElementById('managementGoodbyeEnabled').checked = management.automation.goodbyeEnabled;
    document.getElementById('managementScheduledMessages').checked = management.automation.scheduledMessagesEnabled;
    document.getElementById('managementAutoPurge').checked = management.automation.autoPurgeEnabled;
    document.getElementById('managementWelcomeChannel').value = management.automation.welcomeChannelId || '';
    document.getElementById('managementWelcomeMessage').value = management.automation.welcomeMessage || '';
    document.getElementById('managementGoodbyeChannel').value = management.automation.goodbyeChannelId || '';
    document.getElementById('managementGoodbyeMessage').value = management.automation.goodbyeMessage || '';
    renderAutomationRules();
    document.getElementById('managementTicketCategory').value = management.tickets.categoryId || '';
    document.getElementById('managementTicketSupportRole').value = management.tickets.supportRoleId || '';
    document.getElementById('managementTicketLog').value = management.tickets.logChannelId || '';
    document.getElementById('managementTicketLimit').value = management.tickets.maxOpenPerMember;
    document.getElementById('managementTicketWelcome').value = management.tickets.welcomeMessage || '';
    document.getElementById('managementTicketRetention').value = management.tickets.retentionDays;
    document.getElementById('managementTicketAutoClose').value = management.tickets.autoCloseInactiveDays;
    document.getElementById('managementTicketDeleteDelay').value = management.tickets.deleteDelayMinutes;
    document.getElementById('managementTicketDmTranscript').checked = management.tickets.dmTranscript;
    document.getElementById('managementTicketDelete').checked = management.tickets.deleteClosedChannels;
    for (const option of document.getElementById('managementTicketFormats').options) option.selected = (management.tickets.transcriptFormats || []).includes(option.value);
    renderSupportTeams();
    document.getElementById('managementSuggestionChannel').value = management.suggestions.channelId || '';
    document.getElementById('managementSuggestionReview').value = management.suggestions.reviewChannelId || '';
    document.getElementById('managementSuggestionAnonymous').checked = management.suggestions.anonymous;
    document.getElementById('managementSuggestionVotes').value = management.suggestions.minimumApprovalVotes;
    document.getElementById('managementSecurityLog').value = management.joinSecurity.logChannelId || '';
    document.getElementById('managementSecurityRole').value = management.joinSecurity.quarantineRoleId || '';
    document.getElementById('managementSecurityAccountAge').value = management.joinSecurity.minimumAccountAgeDays;
    document.getElementById('managementSecurityBurstLimit').value = management.joinSecurity.joinBurstLimit;
    document.getElementById('managementSecurityBurstWindow').value = management.joinSecurity.joinBurstWindowSeconds;
    document.getElementById('managementSecurityAction').value = management.joinSecurity.action;
    document.getElementById('managementStarboardChannel').value = management.starboard.channelId || '';
    document.getElementById('managementStarboardEmoji').value = management.starboard.emoji || '⭐';
    document.getElementById('managementStarboardThreshold').value = management.starboard.threshold;
    document.getElementById('managementStarboardSelfStars').checked = management.starboard.allowSelfStars;
    document.getElementById('managementFormsChannel').value = management.forms.submissionChannelId || '';
    document.getElementById('managementFormsReview').value = management.forms.reviewChannelId || '';
    document.getElementById('managementFormsAppeals').checked = management.forms.appealsEnabled;
    document.getElementById('managementFormsTitle').value = management.forms.applicationTitle || '';
    document.getElementById('managementFormsQuestions').value = (management.forms.applicationQuestions || []).join('\n');
    document.getElementById('managementChannelsLog').value = management.channels.logChannelId || '';
    document.getElementById('managementChannelsSlowmode').value = management.channels.defaultSlowmodeSeconds;
    document.getElementById('managementChannelsStickyChannel').value = management.channels.stickyChannelId || '';
    document.getElementById('managementChannelsSticky').value = management.channels.stickyMessage || '';
    document.getElementById('managementChannelsVoiceCategory').value = management.channels.temporaryVoiceCategoryId || '';
    document.getElementById('managementIntegrationsAutomod').checked = management.integrations.nativeAutomodEnabled;
    document.getElementById('managementIntegrationsEvents').checked = management.integrations.scheduledEventsEnabled;
    document.getElementById('managementIntegrationsAnnouncements').value = management.integrations.announcementChannelId || '';
    for (const field of document.querySelectorAll('[data-advanced-field]')) {
        const [section, key] = field.dataset.advancedField.split('.');
        const value = management[section]?.[key];
        if (field.dataset.jsonField !== undefined) field.value = JSON.stringify(value || [], null, 2);
        else if (field.type === 'checkbox') field.checked = value === true;
        else field.value = value ?? '';
    }
    renderWorkflowResourcePicker();
    for (const sourceId of Object.keys(structuredBuilderConfigs)) renderStructuredBuilder(sourceId);
    renderFormQuestionBuilder();
    renderWorkflowBuilder();
    renderModulePreviews();
    for (const key of Object.keys(managementModuleDefinitions)) updateModuleReadiness(key);
}

function collectAdvancedManagement(section) {
    const current = { ...(state.management[section] || {}) };
    for (const field of document.querySelectorAll(`[data-advanced-field^="${section}."]`)) {
        const key = field.dataset.advancedField.split('.')[1];
        if (field.dataset.jsonField !== undefined) {
            try { current[key] = JSON.parse(field.value || '[]'); } catch { throw new Error(`${field.labels?.[0]?.textContent || key} must contain valid JSON.`); }
        } else if (field.type === 'checkbox') current[key] = field.checked;
        else if (field.type === 'number') {
            if (!field.checkValidity()) throw new Error(`${field.labels?.[0]?.textContent || key} is outside the allowed range.`);
            current[key] = Number(field.value);
        } else current[key] = field.value;
    }
    state.management[section] = current;
}

function operationTable(rows, columns, emptyMessage) {
    if (!rows.length) return `<div class="empty">${escapeHtml(emptyMessage)}</div>`;
    return `<table><thead><tr>${columns.map(column => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${columns.map(column => `<td>${column.render ? column.render(row) : escapeHtml(row[column.key] ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function installOperationFilter(containerId, placeholder = 'Search this list') {
    const container = document.getElementById(containerId);
    if (!container) return;
    const existing = container.previousElementSibling?.dataset.operationFilter === containerId ? container.previousElementSibling : null;
    if (existing) {
        existing.querySelector('input')?.dispatchEvent(new Event('input'));
        return;
    }
    const toolbar = document.createElement('div');
    toolbar.className = 'operation-toolbar';
    toolbar.dataset.operationFilter = containerId;
    toolbar.innerHTML = `<label><span class="sr-only">${escapeHtml(placeholder)}</span><input type="search" placeholder="${escapeHtml(placeholder)}" autocomplete="off"></label><span class="sub" data-operation-count></span>`;
    container.before(toolbar);
    const input = toolbar.querySelector('input');
    input.addEventListener('input', () => {
        const query = input.value.trim().toLocaleLowerCase();
        const rows = [...container.querySelectorAll('tbody tr')];
        let visible = 0;
        for (const row of rows) {
            const show = !query || row.textContent.toLocaleLowerCase().includes(query);
            row.hidden = !show;
            if (show) visible += 1;
        }
        toolbar.querySelector('[data-operation-count]').textContent = `${visible} of ${rows.length}`;
    });
    input.dispatchEvent(new Event('input'));
}

function renderOperationalExperience(data) {
    const queues = [
        ['incidentCenterTable', 'Search incidents'], ['reportsOperationsTable', 'Search reports'],
        ['managementTicketsTable', 'Search tickets'], ['managementSuggestionsRoadmap', 'Search suggestions'],
        ['serverSnapshotsTable', 'Search snapshots'], ['engagementLevelsTable', 'Search members']
    ];
    for (const [id, placeholder] of queues) installOperationFilter(id, placeholder);

    const staffPanel = document.getElementById('tab-management-staff-operations');
    let staffQueue = document.getElementById('staffOperationsQueue');
    if (staffPanel && !staffQueue) {
        const section = document.createElement('div');
        section.className = 'section';
        section.innerHTML = '<div class="section-title-row"><div><h2>Work queue</h2><p class="sub">Open reports, incidents, and tickets in one place.</p></div><span class="badge accent">Live</span></div><div id="staffOperationsQueue" class="table-wrap"></div>';
        staffPanel.append(section);
        staffQueue = section.querySelector('#staffOperationsQueue');
    }
    const work = [
        ...(data.incidents || []).filter(item => item.status !== 'resolved').map(item => ({ type: 'Incident', subject: item.summary, owner: resourceDisplay(item.actorId), status: item.status, createdAt: item.createdAt })),
        ...(data.reports || []).filter(item => !['resolved', 'dismissed'].includes(item.status)).map(item => ({ type: 'Report', subject: item.reason, owner: resourceDisplay(item.userId || item.authorId), status: item.status, createdAt: item.createdAt })),
        ...(data.tickets || []).filter(item => item.status !== 'closed').map(item => ({ type: 'Ticket', subject: item.topic, owner: resourceDisplay(item.ownerId), status: item.claimedBy ? `Claimed by ${resourceDisplay(item.claimedBy)}` : 'Unclaimed', createdAt: item.createdAt }))
    ];
    if (staffQueue) {
        staffQueue.innerHTML = operationTable(work, [
            { label: 'Type', key: 'type' }, { label: 'Subject', key: 'subject' }, { label: 'Member', key: 'owner' },
            { label: 'Status', key: 'status' }, { label: 'Received', render: row => escapeHtml(row.createdAt ? formatDateTime(row.createdAt) : 'Unknown') }
        ], 'No staff work is waiting.');
        installOperationFilter('staffOperationsQueue', 'Search the staff queue');
    }

    const ensureSection = (key, id, title, description) => {
        let container = document.getElementById(id);
        if (container) return container;
        const panel = document.getElementById(`tab-${managementModuleDefinitions[key]?.tab}`);
        if (!panel) return null;
        const section = document.createElement('div');
        section.className = 'section';
        section.innerHTML = `<div class="section-title-row"><div><h2>${escapeHtml(title)}</h2><p class="sub">${escapeHtml(description)}</p></div><span class="badge accent">Live</span></div><div id="${escapeHtml(id)}" class="table-wrap"></div>`;
        panel.append(section);
        return section.querySelector(`#${id}`);
    };

    const submissions = ensureSection('forms', 'managementFormsSubmissions', 'Recent submissions', 'Review form and appeal activity without exposing answers outside the private staff workflow.');
    if (submissions) {
        submissions.innerHTML = operationTable(data.submissions || [], [
            { label: 'Submission', key: 'id' }, { label: 'Type', key: 'type' }, { label: 'Member', render: row => escapeHtml(resourceDisplay(row.authorId)) },
            { label: 'Status', render: row => `<select data-submission-status="${escapeHtml(row.id)}"><option value="open" ${row.status === 'open' ? 'selected' : ''}>Open</option><option value="reviewing" ${row.status === 'reviewing' ? 'selected' : ''}>Reviewing</option><option value="accepted" ${row.status === 'accepted' ? 'selected' : ''}>Accepted</option><option value="rejected" ${row.status === 'rejected' ? 'selected' : ''}>Rejected</option></select>` }, { label: 'Received', render: row => escapeHtml(formatDateTime(row.createdAt)) }
        ], 'No form submissions yet.');
        installOperationFilter('managementFormsSubmissions', 'Search submissions');
    }

    const integrationActivity = ensureSection('integrations', 'managementIntegrationActivity', 'Discord activity', 'Native AutoMod rules and scheduled events currently available in this server.');
    if (integrationActivity) {
        const integrations = [
            ...(data.integrations?.nativeAutomodRules || []).map(item => ({ type: 'AutoMod rule', name: item.name, status: item.enabled ? 'Enabled' : 'Disabled', next: '—' })),
            ...(data.integrations?.scheduledEvents || []).map(item => ({ type: 'Scheduled event', name: item.name, status: item.status, next: item.scheduledStartAt ? formatDateTime(item.scheduledStartAt) : '—' }))
        ];
        integrationActivity.innerHTML = operationTable(integrations, [
            { label: 'Type', key: 'type' }, { label: 'Name', key: 'name' }, { label: 'Status', key: 'status' }, { label: 'Starts', key: 'next' }
        ], 'No native AutoMod rules or scheduled events found.');
        installOperationFilter('managementIntegrationActivity', 'Search Discord integrations');
    }

    const copilotRecords = ensureSection('copilot', 'managementCopilotRecords', 'Available records', 'Choose a real report or incident before using /server copilot in Discord.');
    if (copilotRecords) {
        const records = [
            ...(data.reports || []).map(item => ({ id: item.id, type: 'Report', summary: item.reason, status: item.status })),
            ...(data.incidents || []).map(item => ({ id: item.id, type: 'Incident', summary: item.summary, status: item.status }))
        ];
        copilotRecords.classList.remove('table-wrap');
        copilotRecords.innerHTML = records.length ? `<div class="field"><label for="copilotRecordSelect">Report or incident</label><select id="copilotRecordSelect"><option value="">Choose an available record</option>${records.map((record, index) => `<option value="${index}">${escapeHtml(record.type)} · ${escapeHtml(record.summary).slice(0, 100)}</option>`).join('')}</select></div><div class="module-live-preview" data-copilot-record-preview><span>Selected record</span><p>Choose a record to see what Copilot will receive.</p></div>` : '<div class="empty">No reports or incidents are available for Copilot.</div>';
        copilotRecords.querySelector('select')?.addEventListener('change', event => {
            const record = event.target.value === '' ? null : records[Number(event.target.value)];
            const preview = copilotRecords.querySelector('[data-copilot-record-preview]');
            preview.innerHTML = record ? `<span>${escapeHtml(record.type)} · ${escapeHtml(record.status)}</span><strong>${escapeHtml(record.summary)}</strong><div class="row"><code>/server copilot record:${escapeHtml(record.id)}</code><button class="secondary compact" type="button" data-copy-copilot-command="${escapeHtml(record.id)}">Copy command</button></div>` : '<span>Selected record</span><p>Choose a record to see what Copilot will receive.</p>';
        });
        copilotRecords.onclick = event => {
            const button = event.target.closest('[data-copy-copilot-command]');
            if (!button) return;
            navigator.clipboard?.writeText(`/server copilot record:${button.dataset.copyCopilotCommand}`).then(() => { button.textContent = 'Copied'; }).catch(() => {});
        };
    }

    const starboardActivity = ensureSection('starboard', 'managementStarboardActivity', 'Recent activity', 'Messages that have been copied to the Starboard.');
    if (starboardActivity) {
        const count = (data.starboardPosts || []).length;
        starboardActivity.classList.remove('table-wrap');
        starboardActivity.innerHTML = `<div class="card-grid"><article class="card"><span>Starboard posts</span><strong>${count}</strong><small>Use /starboard status for the same live count in Discord.</small></article></div>`;
    }

    const activity = {
        incidentCenter: `${(data.incidents || []).filter(item => item.status !== 'resolved').length} open`,
        reports: `${(data.reports || []).filter(item => !['resolved', 'dismissed'].includes(item.status)).length} open`,
        tickets: `${data.ticketStats?.open || 0} open`, suggestions: `${(data.suggestions || []).length} total`,
        backups: `${(data.snapshots || []).length} snapshots`, engagement: `${(data.levels || []).length} ranked members`,
        forms: `${(data.submissions || []).length} submissions`, starboard: `${(data.starboardPosts || []).length} posts`,
        integrations: `${(data.integrations?.nativeAutomodRules || []).length} rules · ${(data.integrations?.scheduledEvents || []).length} events`,
        staffOperations: `${work.length} waiting`, communityHealth: `${data.health?.activeMembers30d || 0} active members (30d)`
    };
    for (const [key, value] of Object.entries(activity)) {
        const panel = document.getElementById(`tab-${managementModuleDefinitions[key]?.tab}`);
        const runtime = panel?.querySelector('[data-module-runtime-state]');
        if (runtime) runtime.textContent = `${state.management?.modules?.[key] ? 'Running' : 'Paused'} · ${value}`;
    }
}

function renderServerDoctor(result) {
    const container = document.getElementById('serverDoctorResults');
    if (!result) return;
    const tone = result.critical ? 'error' : result.warnings ? 'warn' : 'ok';
    container.innerHTML = `<div class="section-title-row"><div><h2>Health score: ${result.score}/100</h2><p class="sub">${result.critical} critical · ${result.warnings} warnings${result.info ? ` · ${result.info} informational` : ''} · checked ${escapeHtml(formatDateTime(result.checkedAt))}</p></div><span class="badge ${tone}">${result.critical ? 'Action needed' : result.warnings ? 'Review' : 'Healthy'}</span></div>${result.checks.length ? `<div class="doctor-check-list">${result.checks.map(check => `<article class="doctor-check ${escapeHtml(check.severity)}"><strong>${escapeHtml(check.title)}</strong><span>${escapeHtml(check.detail)}</span>${check.fix ? `<small>${escapeHtml(check.fix)}</small>` : ''}</article>`).join('')}</div>` : '<div class="empty">No problems found.</div>'}`;
}

let staffInboxFilter = 'all';
let latestAdvancedOperations = null;
const staffInboxTable = document.getElementById('reportsOperationsTable');
staffInboxTable.closest('.section').insertAdjacentHTML('beforebegin', '<div class="section"><h2>Scheduled reports</h2><p class="sub">Send a privacy-safe summary to a Discord channel on a daily or weekly schedule.</p><div class="two-col"><div class="field"><label for="scheduledReportFrequency">Frequency</label><select id="scheduledReportFrequency" data-advanced-field="reports.digestFrequency"><option value="off">Off</option><option value="daily">Daily</option><option value="weekly">Weekly</option></select></div><div class="field"><label for="scheduledReportType">Report type</label><select id="scheduledReportType" data-advanced-field="reports.digestType"><option value="server">Server overview</option><option value="moderation">Moderation</option><option value="community">Community health</option></select></div><div class="field"><label for="scheduledReportChannel">Destination channel</label><select id="scheduledReportChannel" data-management-channel data-advanced-field="reports.digestChannelId"><option value="">Choose a channel</option></select></div></div><div class="actions"><span class="status" id="scheduledReportStatus"></span><button class="primary" data-save-advanced="reports" type="button">Save report schedule</button></div></div>');
staffInboxTable.insertAdjacentHTML('beforebegin', '<p class="sub">Reports, modmail, tickets and appeals in one queue.</p><div class="management-filter-bar" id="staffInboxFilters" role="group" aria-label="Filter staff inbox"><button class="management-filter active" type="button" data-staff-inbox-filter="all">All</button><button class="management-filter" type="button" data-staff-inbox-filter="report">Reports</button><button class="management-filter" type="button" data-staff-inbox-filter="modmail">Modmail</button><button class="management-filter" type="button" data-staff-inbox-filter="ticket">Tickets</button><button class="management-filter" type="button" data-staff-inbox-filter="appeal">Appeals</button></div>');

function renderStaffInbox(data) {
    const rows = [
        ...(data.reports || []).map(row => ({ ...row, kind: 'report', summary: row.reason || row.message, ownerId: row.reporterId || row.userId })),
        ...(data.modmail || []).map(row => ({ ...row, kind: 'modmail', summary: row.category || 'Direct message conversation', ownerId: row.userId })),
        ...(data.tickets || []).map(row => ({ ...row, kind: 'ticket', summary: row.topic || 'Support ticket', ownerId: row.ownerId })),
        ...(data.submissions || []).filter(row => /appeal/i.test(`${row.type || ''} ${row.title || ''}`)).map(row => ({ ...row, kind: 'appeal', summary: row.title || 'Moderation appeal', ownerId: row.userId || row.authorId }))
    ].filter(row => staffInboxFilter === 'all' || row.kind === staffInboxFilter).sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
    staffInboxTable.innerHTML = operationTable(rows, [
        { label: 'Type', render: row => `<span class="badge accent">${escapeHtml(row.kind)}</span>` },
        { label: 'Request', render: row => `<strong>${escapeHtml(row.summary || row.id)}</strong><small>${escapeHtml(row.id)}</small>` },
        { label: 'Member', render: row => escapeHtml(row.ownerId ? resourceDisplay(row.ownerId) : 'Anonymous') },
        { label: 'Updated', render: row => escapeHtml(formatDateTime(row.updatedAt || row.createdAt)) },
        { label: 'Status', render: row => row.kind === 'report' ? `<select data-report-status="${escapeHtml(row.id)}"><option value="open" ${row.status === 'open' ? 'selected' : ''}>Open</option><option value="claimed" ${row.status === 'claimed' ? 'selected' : ''}>Claimed</option><option value="resolved" ${row.status === 'resolved' ? 'selected' : ''}>Resolved</option><option value="dismissed" ${row.status === 'dismissed' ? 'selected' : ''}>Dismissed</option></select>` : escapeHtml(row.status || 'open') }
    ], `No ${staffInboxFilter === 'all' ? 'staff requests' : `${staffInboxFilter} requests`} found.`);
}

document.getElementById('staffInboxFilters').addEventListener('click', event => {
    const button = event.target.closest('[data-staff-inbox-filter]'); if (!button) return;
    staffInboxFilter = button.dataset.staffInboxFilter;
    document.querySelectorAll('[data-staff-inbox-filter]').forEach(item => item.classList.toggle('active', item === button));
    if (latestAdvancedOperations) renderStaffInbox(latestAdvancedOperations);
});

function renderAdvancedOperations(data) {
    latestAdvancedOperations = data;
    renderServerDoctor(data.doctor);
    document.getElementById('incidentCenterTable').innerHTML = operationTable(data.incidents || [], [
        { label: 'Incident', key: 'id' }, { label: 'Summary', key: 'summary' }, { label: 'Actor', render: row => escapeHtml(resourceDisplay(row.actorId)) },
        { label: 'Status', render: row => `<select data-incident-status="${escapeHtml(row.id)}"><option value="open" ${row.status === 'open' ? 'selected' : ''}>Open</option><option value="investigating" ${row.status === 'investigating' ? 'selected' : ''}>Investigating</option><option value="resolved" ${row.status === 'resolved' ? 'selected' : ''}>Resolved</option></select>` }
    ], 'No security incidents recorded.');
    renderStaffInbox(data);
    document.getElementById('serverSnapshotsTable').innerHTML = operationTable(data.snapshots || [], [
        { label: 'Snapshot', key: 'id' }, { label: 'Created', render: row => escapeHtml(formatDateTime(row.createdAt)) }, { label: 'Reason', key: 'reason' }, { label: 'Roles', key: 'roleCount' }, { label: 'Channels', key: 'channelCount' },
        { label: 'Recovery', render: row => `<div class="row"><button class="secondary" type="button" data-snapshot-preview="${escapeHtml(row.id)}">Preview</button><button class="secondary" type="button" data-snapshot-restore="${escapeHtml(row.id)}">Restore missing</button></div>` }
    ], 'No snapshots created yet.');
    document.getElementById('engagementLevelsTable').innerHTML = operationTable(data.levels || [], [
        { label: 'Member', render: row => escapeHtml(resourceDisplay(row.userId)) }, { label: 'Level', key: 'level' }, { label: 'XP', key: 'xp' }, { label: 'Messages', key: 'messages' }
    ], 'No XP has been recorded yet.');
    const utilities = [
        ...(data.feeds || []).map(row => ({ type: 'Creator feed', name: row.name, destination: resourceDisplay(row.channelId, 'channel'), status: row.lastError ? `Error: ${row.lastError}` : row.lastCheckedAt ? 'Active' : 'Waiting for first check' })),
        ...(data.voiceRoleLinks || []).map(row => ({ type: 'Voice role', name: resourceDisplay(row.roleId, 'role'), destination: resourceDisplay(row.channelId, 'channel'), status: 'Active' })),
        ...(data.temporaryRoles || []).map(row => ({ type: 'Temporary role', name: resourceDisplay(row.roleId, 'role'), destination: resourceDisplay(row.userId), status: `Expires ${formatDateTime(row.removeAt)}` }))
    ];
    document.getElementById('engagementUtilitiesTable').innerHTML = operationTable(utilities, [
        { label: 'Type', key: 'type' }, { label: 'Feed / role', key: 'name' }, { label: 'Channel / member', key: 'destination' }, { label: 'Status', key: 'status' }
    ], 'No feeds, voice roles, or temporary roles configured.');
    document.getElementById('managementActivePunishments').innerHTML = operationTable(data.activePunishments || [], [
        { label: 'Action', key: 'action' }, { label: 'Member', render: row => escapeHtml(resourceDisplay(row.targetId)) }, { label: 'Moderator', render: row => escapeHtml(resourceDisplay(row.moderatorId)) },
        { label: 'Reason', key: 'reason' }, { label: 'Remaining', render: row => escapeHtml(formatDuration(row.remainingMs)) },
        { label: '', render: row => `<button class="secondary" type="button" data-cancel-punishment="${escapeHtml(row.id)}">Cancel</button>` }
    ], 'No active temporary punishments.');

    const ticketStats = data.ticketStats || {};
    document.getElementById('ticketSlaCards').innerHTML = [
        ['Open / closed', `${ticketStats.open || 0} / ${ticketStats.closed || 0}`],
        ['Average first response', ticketStats.averageFirstResponseMs == null ? '—' : formatDuration(ticketStats.averageFirstResponseMs)],
        ['Average resolution', ticketStats.averageResolutionMs == null ? '—' : formatDuration(ticketStats.averageResolutionMs)],
        ['Oldest unanswered', ticketStats.oldestUnanswered ? formatDuration(ticketStats.oldestUnanswered.waitingMs) : 'None']
    ].map(([label, value]) => `<article class="card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`).join('');
    document.getElementById('managementTicketsTable').innerHTML = operationTable(data.tickets || [], [
        { label: 'Ticket', key: 'id' }, { label: 'Owner', render: row => escapeHtml(resourceDisplay(row.ownerId)) }, { label: 'Topic', key: 'topic' },
        { label: 'Status', key: 'status' }, { label: 'Claimed by', render: row => escapeHtml(row.claimedBy ? resourceDisplay(row.claimedBy) : 'Unclaimed') }, { label: 'Created', render: row => escapeHtml(formatDateTime(row.createdAt)) }
    ], 'No tickets recorded.');

    const suggestionStatuses = [['submitted', 'Submitted'], ['under-review', 'Under Review'], ['planned', 'Planned'], ['in-progress', 'In Progress'], ['implemented', 'Implemented'], ['rejected', 'Rejected']];
    document.getElementById('managementSuggestionsRoadmap').innerHTML = operationTable(data.suggestions || [], [
        { label: 'Suggestion', key: 'id' }, { label: 'Idea', key: 'idea' }, { label: 'Author', render: row => escapeHtml(resourceDisplay(row.authorId)) },
        { label: 'Roadmap status', render: row => `<select data-suggestion-status="${escapeHtml(row.id)}">${suggestionStatuses.map(([value, label]) => `<option value="${value}" ${row.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select>` },
        { label: 'Staff response', render: row => escapeHtml(row.staffResponse || row.note || '—') }
    ], 'No suggestions recorded.');

    const threat = data.threat || { level: 'Low', score: 0, signals: [] };
    const threatTone = threat.level === 'Raid' ? 'error' : threat.level === 'Elevated' ? 'warn' : 'ok';
    document.getElementById('managementThreatLevel').innerHTML = `<div class="section-title-row"><div><h2>Server threat level: ${escapeHtml(threat.level)}</h2><p class="sub">Risk score ${Number(threat.score) || 0}/100 · assessed ${escapeHtml(formatDateTime(threat.assessedAt))}</p></div><span class="badge ${threatTone}">${escapeHtml(threat.level)}</span></div>`;
    document.getElementById('managementThreatSignals').innerHTML = (threat.signals || []).map(signal => `<article class="card"><span>${escapeHtml(signal.label)}</span><strong>${Number(signal.value) || 0}</strong><small>${escapeHtml(signal.detail)}</small></article>`).join('');

    const health = data.health || {};
    document.getElementById('communityHealthCards').innerHTML = [
        ['Messages (30d)', health.messages30d || 0], ['Active members (30d)', health.activeMembers30d || 0],
        ['Joins (30d)', health.joins30d || 0], ['Leaves (30d)', health.leaves30d || 0],
        ['Pulse score (30d)', health.pulseAverage30d == null ? '—' : `${health.pulseAverage30d}/5`], ['Pulse responses', health.pulseResponses30d || 0]
    ].map(([label, value]) => `<article class="card"><span>${escapeHtml(label)}</span><strong>${typeof value === 'number' ? value.toLocaleString() : escapeHtml(value)}</strong></article>`).join('');
    const intelligence = data.communityIntelligence || { score: 0, factors: [], onboarding: [] };
    const healthTone = intelligence.score >= 75 ? 'ok' : intelligence.score >= 50 ? 'warn' : 'error';
    document.getElementById('communityHealthScore').innerHTML = `<div class="section-title-row"><div><h2>Community Health: ${Number(intelligence.score) || 0}/100</h2><p class="sub">Activity, retention, safety, and support quality over the last 30 days.</p></div><span class="badge ${healthTone}">${intelligence.score >= 75 ? 'Healthy' : intelligence.score >= 50 ? 'Watch' : 'Needs attention'}</span></div>`;
    document.getElementById('communityHealthFactors').innerHTML = operationTable(intelligence.factors || [], [
        { label: 'Factor', key: 'label' }, { label: 'Current', render: row => escapeHtml(row.unit === 'ms' ? formatDuration(row.current) : row.current) },
        { label: 'Previous', render: row => escapeHtml(row.previous == null ? '—' : row.unit === 'ms' ? formatDuration(row.previous) : row.previous) },
        { label: 'Trend', render: row => escapeHtml(row.changePercent == null ? '—' : `${row.changePercent >= 0 ? '↑' : '↓'} ${Math.abs(row.changePercent)}%`) }
    ], 'Not enough activity for a health trend yet.');
    document.getElementById('communityOnboardingTable').innerHTML = operationTable(intelligence.onboarding || [], [
        { label: 'Invite', key: 'invite' }, { label: 'Joins', key: 'joins' },
        { label: '1-day active', render: row => escapeHtml(row.active1d == null ? '—' : `${row.active1d}%`) },
        { label: '7-day active', render: row => escapeHtml(row.active7d == null ? '—' : `${row.active7d}%`) },
        { label: '30-day active', render: row => escapeHtml(row.active30d == null ? '—' : `${row.active30d}%`) }
    ], 'No invite retention data yet.');
    renderOperationalExperience(data);
}

async function loadAdvancedManagement() {
    await loadManagement();
    await refreshAdvancedOperations();
    if (document.getElementById('tab-management-backups').classList.contains('active')) await loadRecoveryCentre();
    if (document.getElementById('tab-management-workflows').classList.contains('active')) await loadCustomCommands();
}

async function refreshAdvancedOperations() {
    const data = await api(withGuild('/api/management/operations'));
    renderAdvancedOperations(data);
}

async function loadRecoveryCentre() {
    const container = document.getElementById('recoverySettingsHistory');
    if (!container) return;
    const data = await api(withGuild('/api/management/recovery'));
    container.innerHTML = (data.changes || []).length ? data.changes.map(change => `<article class="recovery-item"><div><strong>${escapeHtml(change.summary || 'Dashboard configuration changed')}</strong><p>${escapeHtml(change.actorName || 'Unknown administrator')} · ${escapeHtml(formatDateTime(change.at))}</p><small>${change.undoable ? `Recoverable until ${escapeHtml(formatDateTime(change.expiresAt))}` : `Restored ${escapeHtml(formatDateTime(change.undoneAt))}`}</small></div><button class="secondary compact" type="button" data-recover-settings="${escapeHtml(change.id)}" ${change.undoable ? '' : 'disabled'}>${change.undoable ? 'Restore version' : 'Restored'}</button></article>`).join('') : `<div class="empty">No recoverable dashboard changes from the last ${Number(data.retentionDays) || 30} days.</div>`;
}

document.getElementById('recoverySettingsHistory').addEventListener('click', async event => {
    const button = event.target.closest('[data-recover-settings]');
    if (!button) return;
    const confirmed = await confirmAction({ title: 'Restore this dashboard configuration?', message: 'Flummi will restore the complete server settings from before this change. Discord roles and channels are not deleted.', confirmLabel: 'Restore configuration', danger: false });
    if (!confirmed) return;
    button.disabled = true;
    try {
        const result = await api(withGuild('/api/settings/undo'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: button.dataset.recoverSettings }) });
        state.management = result.settings.management; state.settingsRevision = result.revision; savedManagementSnapshot = structuredClone(state.management);
        hydrateManagementEditors(); renderManagementCards(); applyManagementNavigation();
        await loadRecoveryCentre();
        setStatus(document.getElementById('managementBackupsStatus'), 'Dashboard configuration restored.', 'ok');
    } catch (error) { setStatus(document.getElementById('managementBackupsStatus'), error.message, 'error'); button.disabled = false; }
});

async function loadCustomCommands() {
    if (!state.guildId || state.role === 'member') return;
    const data = await api(withGuild('/api/management/custom-commands'));
    const rows = data.commands || [];
    document.getElementById('customCommandsTable').innerHTML = operationTable(rows, [
        { label: 'Command', render: row => `<code>/${escapeHtml(row.name)}</code>` },
        { label: 'Description', key: 'description' }, { label: 'Type', key: 'responseType' },
        { label: 'Visibility', render: row => row.ephemeral ? 'Ephemeral' : 'Public' },
        { label: '', render: row => `<button class="danger" type="button" data-remove-custom-command="${escapeHtml(row.name)}">Remove</button>` }
    ], 'No custom commands configured.');
}

function renderCustomCommandPreview() {
    const anchor = document.getElementById('customCommandContent');
    const section = anchor?.closest('.section');
    if (!section) return;
    let preview = document.getElementById('customCommandPreview');
    if (!preview) {
        preview = document.createElement('div');
        preview.id = 'customCommandPreview';
        preview.className = 'module-live-preview discord-output-preview';
        section.querySelector('.actions')?.before(preview);
    }
    const name = document.getElementById('customCommandName').value.trim() || 'command';
    const content = document.getElementById('customCommandContent').value.trim() || 'Your command response will appear here.';
    const image = document.getElementById('customCommandImage').value.trim();
    const type = document.getElementById('customCommandType').value;
    const buttons = readJsonArray(document.getElementById('customCommandButtons'));
    preview.innerHTML = `<span>Discord preview · /${escapeHtml(name)}</span><div class="${type === 'embed' ? 'discord-preview-embed' : ''}"><p>${escapeHtml(content).replace(/\n/g, '<br>')}</p>${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy">` : ''}</div>${buttons.length ? `<div class="command-chip-list">${buttons.map(button => `<button class="secondary compact" type="button" disabled>${escapeHtml(button.label || 'Link')}</button>`).join('')}</div>` : ''}`;
}

for (const id of ['customCommandName', 'customCommandType', 'customCommandContent', 'customCommandImage', 'customCommandButtons']) {
    document.getElementById(id)?.addEventListener('input', renderCustomCommandPreview);
    document.getElementById(id)?.addEventListener('change', renderCustomCommandPreview);
}
renderCustomCommandPreview();

document.getElementById('saveCustomCommand').addEventListener('click', async () => {
    const status = document.getElementById('customCommandStatus');
    let buttons;
    try { buttons = JSON.parse(document.getElementById('customCommandButtons').value || '[]'); } catch { return setStatus(status, 'Buttons must be valid JSON.', 'error'); }
    const command = { name: document.getElementById('customCommandName').value, description: document.getElementById('customCommandDescription').value, responseType: document.getElementById('customCommandType').value, content: document.getElementById('customCommandContent').value, imageUrl: document.getElementById('customCommandImage').value, buttons, requiredRoleId: document.getElementById('customCommandRole').value, allowedChannelIds: selectedValues('customCommandChannels'), cooldownSeconds: Number(document.getElementById('customCommandCooldown').value), ephemeral: document.getElementById('customCommandEphemeral').checked, enabled: document.getElementById('customCommandEnabled').checked };
    try { await api(withGuild('/api/management/custom-commands'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command }) }); setStatus(status, `/${command.name} saved.`, 'ok'); await loadCustomCommands(); } catch (error) { setStatus(status, error.message, 'error'); }
});

document.getElementById('customCommandsTable').addEventListener('click', async event => {
    const button = event.target.closest('[data-remove-custom-command]'); if (!button) return;
    if (!await confirmAction({ title: 'Remove custom command?', message: `Remove /${button.dataset.removeCustomCommand}?`, confirmLabel: 'Remove' })) return;
    await api(withGuild('/api/management/custom-commands'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'remove', name: button.dataset.removeCustomCommand }) });
    await loadCustomCommands();
});

function renderWebhookPreview() {
    const title = document.getElementById('webhookTitle').value.trim();
    const description = document.getElementById('webhookDescription').value.trim();
    const image = document.getElementById('webhookImage').value.trim();
    const thumbnail = document.getElementById('webhookThumbnail').value.trim();
    const fields = readJsonArray(document.getElementById('webhookFields'));
    const buttons = readJsonArray(document.getElementById('webhookButtons'));
    document.getElementById('webhookPreview').innerHTML = `<h3>${escapeHtml(title || 'Announcement title')}</h3><p>${escapeHtml(description || 'Announcement description').replace(/\n/g, '<br>')}</p>${thumbnail ? `<img src="${escapeHtml(thumbnail)}" alt="" style="width:64px;height:64px;object-fit:cover;border-radius:8px">` : ''}${fields.length ? `<div class="webhook-preview-fields">${fields.map(field => `<div><strong>${escapeHtml(field.name || 'Field')}</strong><span>${escapeHtml(field.value || 'Value')}</span></div>`).join('')}</div>` : ''}${image ? `<img src="${escapeHtml(image)}" alt="" style="width:100%;max-height:220px;object-fit:cover;border-radius:8px;margin-top:12px">` : ''}${buttons.length ? `<div class="command-chip-list">${buttons.map(button => `<button class="secondary compact" type="button" disabled>${escapeHtml(button.label || 'Link')}</button>`).join('')}</div>` : ''}`;
}
for (const id of ['webhookTitle', 'webhookDescription', 'webhookImage', 'webhookThumbnail', 'webhookFields', 'webhookButtons']) document.getElementById(id).addEventListener('input', renderWebhookPreview);
document.getElementById('publishWebhook').addEventListener('click', async () => {
    const status = document.getElementById('webhookStatus');
    let fields, buttons;
    try { fields = JSON.parse(document.getElementById('webhookFields').value || '[]'); buttons = JSON.parse(document.getElementById('webhookButtons').value || '[]'); } catch { return setStatus(status, 'Fields and buttons must be valid JSON.', 'error'); }
    const payload = { channelId: document.getElementById('webhookChannel').value, username: document.getElementById('webhookUsername').value, avatarUrl: document.getElementById('webhookAvatar').value, title: document.getElementById('webhookTitle').value, description: document.getElementById('webhookDescription').value, imageUrl: document.getElementById('webhookImage').value, thumbnailUrl: document.getElementById('webhookThumbnail').value, roleId: document.getElementById('webhookRole').value, fields, buttons, timestamp: true };
    try { await api(withGuild('/api/management/webhook-publish'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); setStatus(status, 'Announcement published.', 'ok'); } catch (error) { setStatus(status, error.message, 'error'); }
});

async function persistManagement(statusField) {
    const validation = await api(withGuild('/api/management/validate'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ management: state.management }) });
    latestManagementValidation = validation;
    if (!validation.ok) throw new Error(validation.errors.map(item => item.message).join(' '));
    if (validation.warnings.length) {
        const warningText = validation.warnings.slice(0, 6).map(item => `• ${item.message}`).join('\n');
        const confirmed = await confirmAction({ title: `Save with ${validation.warnings.length} warning${validation.warnings.length === 1 ? '' : 's'}?`, message: `${warningText}${validation.warnings.length > 6 ? `\n• …and ${validation.warnings.length - 6} more` : ''}`, confirmLabel: 'Save anyway', danger: false });
        if (!confirmed) throw new Error('Save cancelled so you can review the configuration warnings.');
    }
    const result = await api(withGuild('/api/settings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Flummi-Settings-Revision': String(state.settingsRevision ?? '') },
        body: JSON.stringify({ management: state.management })
    });
    state.management = result.settings.management;
    savedManagementSnapshot = structuredClone(state.management);
    state.settingsRevision = result.revision;
    renderManagementCards();
    applyManagementNavigation();
    hydrateManagementEditors();
    clearManagementDirty();
    Object.keys(managementModuleDefinitions).forEach(key => renderModuleOnboarding(key));
    if (statusField) setStatus(statusField, 'Saved.', 'ok');
}

async function loadManagement() {
    if (!state.guildId || state.role === 'member') return;
    const settingsData = await api(withGuild('/api/settings'));
    state.management = settingsData.settings.management;
    savedManagementSnapshot = structuredClone(state.management);
    state.settingsRevision = settingsData.revision;
    await ensureManagementResources();
    hydrateManagementEditors();
    renderManagementCards();
    applyManagementNavigation();
    await loadManagementTemplates();
    await refreshModuleOnboarding();
}

let pendingManagementTemplate = null;
async function loadManagementTemplates() {
    const data = await api(withGuild('/api/management/templates'));
    document.getElementById('managementTemplatePreset').innerHTML = '<option value="">Choose a preset</option>' + (data.templates || []).map(row => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.label)} — ${escapeHtml(row.description)}</option>`).join('');
    document.getElementById('managementTemplateSource').innerHTML = '<option value="">Choose a server</option>' + (data.sources || []).map(row => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.name)}</option>`).join('');
    pendingManagementTemplate = null;
    document.getElementById('applyManagementTemplate').disabled = true;
}

function selectedManagementTemplate() {
    const templateId = document.getElementById('managementTemplatePreset').value;
    const sourceGuildId = document.getElementById('managementTemplateSource').value;
    if (!templateId && !sourceGuildId) throw new Error('Choose a preset or source server.');
    return templateId ? { templateId } : { sourceGuildId };
}

for (const id of ['managementTemplatePreset', 'managementTemplateSource']) document.getElementById(id).addEventListener('change', event => {
    const other = document.getElementById(id === 'managementTemplatePreset' ? 'managementTemplateSource' : 'managementTemplatePreset');
    if (event.target.value) other.value = '';
    pendingManagementTemplate = null;
    document.getElementById('applyManagementTemplate').disabled = true;
    document.getElementById('managementTemplatePreview').innerHTML = '';
});
document.getElementById('previewManagementTemplate').addEventListener('click', async () => {
    const status = document.getElementById('managementTemplateStatus');
    try {
        const selection = selectedManagementTemplate();
        const data = await api(withGuild('/api/management/templates'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(selection) });
        pendingManagementTemplate = selection;
        const changes = data.preview || [];
        document.getElementById('managementTemplatePreview').innerHTML = changes.length ? changes.slice(0, 50).map(change => `<article><strong>${escapeHtml(change.label || change.field || 'Setting')}</strong><span>${escapeHtml(String(change.before ?? 'empty'))} → ${escapeHtml(String(change.after ?? 'empty'))}</span></article>`).join('') : '<div class="empty">This template would not change any settings.</div>';
        document.getElementById('applyManagementTemplate').disabled = !changes.length;
        setStatus(status, `${changes.length} change${changes.length === 1 ? '' : 's'} ready to apply.`, 'ok');
    } catch (error) { setStatus(status, error.message, 'error'); }
});
document.getElementById('applyManagementTemplate').addEventListener('click', async () => {
    if (!pendingManagementTemplate) return;
    const status = document.getElementById('managementTemplateStatus');
    const confirmed = await confirmAction({ title: 'Apply this configuration template?', message: 'Only non-resource settings are copied. Existing channel, role and member selections remain unchanged.', confirmLabel: 'Apply template', danger: false });
    if (!confirmed) return;
    try {
        const data = await api(withGuild('/api/management/templates'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...pendingManagementTemplate, apply: true }) });
        state.management = data.settings.management;
        state.settingsRevision = data.revision;
        savedManagementSnapshot = structuredClone(state.management);
        hydrateManagementEditors(); renderManagementCards(); applyManagementNavigation();
        document.getElementById('applyManagementTemplate').disabled = true;
        setStatus(status, `${data.label} applied. Choose channels and roles where required.`, 'ok');
    } catch (error) { setStatus(status, error.message, 'error'); }
});

document.getElementById('runWorkflowDebugger').addEventListener('click', async () => {
    const status = document.getElementById('workflowDebugStatus');
    try {
        const context = JSON.parse(document.getElementById('workflowDebugContext').value || '{}');
        const data = await api(withGuild('/api/management/workflows/debug'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: document.getElementById('workflowDebugEvent').value, context }) });
        document.getElementById('workflowDebugTrace').innerHTML = data.trace.length ? data.trace.map(rule => `<article class="workflow-debug-rule ${rule.matched ? 'matched' : 'skipped'}"><header><strong>${escapeHtml(rule.name)}</strong><span class="badge ${rule.matched ? 'ok' : ''}">${rule.matched ? 'Would run' : 'Skipped'}</span></header>${rule.conditions.map(condition => `<p><span>${escapeHtml(condition.field)} ${escapeHtml(condition.operator)} ${escapeHtml(String(condition.value))}</span><strong>${condition.matched ? 'Matched' : `Actual: ${escapeHtml(String(condition.actual ?? 'empty'))}`}</strong></p>`).join('')}${rule.actions.map(action => `<small>${escapeHtml(action.summary)}</small>`).join('')}</article>`).join('') : '<div class="empty">No enabled saved workflows listen for this event.</div>';
        setStatus(status, `${data.trace.filter(rule => rule.matched).length} workflow${data.trace.filter(rule => rule.matched).length === 1 ? '' : 's'} would run.`, 'ok');
    } catch (error) { setStatus(status, error.message, 'error'); }
});

async function toggleManagementModule(moduleKey, statusField) {
    const definition = managementModuleDefinitions[moduleKey];
    if (!definition || !state.management) return;
    const nextEnabled = state.management.modules[moduleKey] !== true;
    const dependencies = { staffOperations: ['cases'], copilot: ['tickets', 'reports'], workflows: ['automation'], communityHealth: ['serverDoctor'] };
    const missingDependencies = nextEnabled ? (dependencies[moduleKey] || []).filter(key => !state.management.modules[key]) : [];
    if (missingDependencies.length) {
        const names = missingDependencies.map(key => managementModuleDefinitions[key]?.title || key).join(' and ');
        const confirmed = await confirmAction({ title: `Also enable ${names}?`, message: `${definition.title} uses ${names} for its complete workflow. Nothing else will be changed.`, confirmLabel: 'Enable dependencies', danger: false });
        if (!confirmed) { renderManagementCards(); applyManagementNavigation(); return; }
        missingDependencies.forEach(key => { state.management.modules[key] = true; });
    }
    state.management.modules[moduleKey] = nextEnabled;
    try {
        await persistManagement(statusField);
        setManagementExpanded(true);
        if (statusField) setStatus(statusField, `${definition.title} turned ${nextEnabled ? 'on' : 'off'}.`, 'ok');
    } catch (error) {
        state.management.modules[moduleKey] = !nextEnabled;
        missingDependencies.forEach(key => { state.management.modules[key] = false; });
        renderManagementCards();
        if (statusField) setStatus(statusField, error.message, 'error');
    }
}

document.getElementById('managementModuleCards').addEventListener('click', async event => {
    const toggle = event.target.closest('[data-toggle-management]');
    const open = event.target.closest('[data-open-management]');
    if (open) {
        const definition = managementModuleDefinitions[open.dataset.openManagement];
        tabButtons.find(button => button.dataset.tab === definition?.tab && !button.hidden)?.click();
        return;
    }
    if (!toggle) return;
    toggle.disabled = true;
    await toggleManagementModule(toggle.dataset.toggleManagement, document.getElementById('managementModuleStatus'));
});

document.querySelectorAll('[data-page-module-toggle]').forEach(button => button.addEventListener('click', async () => {
    button.disabled = true;
    await toggleManagementModule(button.dataset.pageModuleToggle, document.getElementById(managementStatusIds?.[button.dataset.pageModuleToggle] || 'managementModuleStatus'));
}));

function collectManagementSection(section) {
    const requireOptionalSnowflake = (id, label) => {
        const value = document.getElementById(id).value.trim();
        if (value && !/^\d{16,22}$/.test(value)) throw new Error(`${label} must be a valid Discord ID.`);
        return value;
    };
    if (section === 'moderation') {
        const timeout = document.getElementById('managementDefaultTimeout');
        if (!timeout.checkValidity()) throw new Error('Default timeout must be between 1 and 40320 minutes.');
        state.management.moderation = { requireReason: document.getElementById('managementRequireReason').checked, notifyMember: document.getElementById('managementNotifyMember').checked, defaultTimeoutMinutes: Number(timeout.value) };
    } else if (section === 'automod') {
        const rules = Object.fromEntries([...document.querySelectorAll('[data-automod-rule]')].map(card => {
            const key = card.dataset.automodRule;
            const oldRule = state.management.automod.rules[key];
            return [key, { enabled: card.querySelector('[data-automod-toggle]').getAttribute('aria-pressed') === 'true', action: card.querySelector('[data-automod-action]').value, limit: Number(card.querySelector('[data-automod-limit]')?.value || oldRule.limit), windowSeconds: Number(card.querySelector('[data-automod-window]')?.value || oldRule.windowSeconds), ignoredChannelIds: [...card.querySelector('[data-automod-channels]').selectedOptions].map(option => option.value), ignoredRoleIds: [...card.querySelector('[data-automod-roles]').selectedOptions].map(option => option.value) }];
        }));
        state.management.automod = { preset: document.getElementById('managementAutomodPreset').value, mode: document.getElementById('managementAutomodMode').value, escalationEnabled: document.getElementById('managementAutomodEscalation').checked, logChannelId: document.getElementById('managementAutomodLogChannel').value, action: document.getElementById('managementAutomodAction').value, timeoutMinutes: Number(document.getElementById('managementAutomodTimeout').value), blockedTerms: textLines('managementBlockedTerms'), allowedDomains: textLines('managementAllowedDomains'), allowedInviteCodes: textLines('managementAllowedInvites'), ignoredChannelIds: selectedValues('managementIgnoredChannels'), ignoredRoleIds: selectedValues('managementIgnoredRoles'), rules };
    } else if (section === 'cases') {
        const retention = document.getElementById('managementCaseRetention');
        if (!retention.checkValidity()) throw new Error('Retention must be between 1 and 3650 days.');
        state.management.cases = { logChannelId: document.getElementById('managementCaseLogChannel').value, retentionDays: Number(retention.value), logMessageChanges: document.getElementById('managementLogMessageChanges').checked, logMemberChanges: document.getElementById('managementLogMemberChanges').checked };
    } else if (section === 'roles') {
        const roleId = document.getElementById('managementAutoroleId').value.trim();
        const delay = document.getElementById('managementAutoroleDelay');
        if (roleId && !/^\d{16,22}$/.test(roleId)) throw new Error('Choose an available autorole.');
        if (!delay.checkValidity()) throw new Error('Autorole delay must be between 0 and 10080 minutes.');
        state.management.roles = { autoroleId: roleId, autoroleDelayMinutes: Number(delay.value), persistRoles: document.getElementById('managementPersistRoles').checked, interactiveRoles: document.getElementById('managementInteractiveRoles').checked, selfAssignableRoleIds: selectedValues('managementSelfRoles'), onboardingChannelId: document.getElementById('managementOnboardingChannel').value, onboardingTitle: document.getElementById('managementOnboardingTitle').value, onboardingMessage: document.getElementById('managementOnboardingMessage').value };
    } else if (section === 'automation') {
        const schedules = [...document.querySelectorAll('[data-schedule-row]')].map((row, index) => ({ id: row.querySelector('[data-rule-id]').value.trim() || `schedule-${index + 1}`, enabled: row.querySelector('[data-rule-enabled]').checked, channelId: row.querySelector('[data-rule-channel]').value, message: row.querySelector('[data-rule-message]').value.trim(), intervalMinutes: Number(row.querySelector('[data-rule-interval]').value), scheduleType: row.querySelector('[data-rule-type]').value, runAt: row.querySelector('[data-rule-run-at]').value, time: row.querySelector('[data-rule-time]').value, weekdays: row.querySelector('[data-rule-weekdays]').value.split(',').map(Number).filter(Number.isInteger), cron: row.querySelector('[data-rule-cron]').value, timezone: row.querySelector('[data-rule-timezone]').value, startAt: row.querySelector('[data-rule-start]').value, endAt: row.querySelector('[data-rule-end]').value }));
        const purgeRules = [...document.querySelectorAll('[data-purge-row]')].map((row, index) => ({ id: row.querySelector('[data-rule-id]').value.trim() || `purge-${index + 1}`, enabled: row.querySelector('[data-rule-enabled]').checked, channelId: row.querySelector('[data-rule-channel]').value, keepMessages: Number(row.querySelector('[data-rule-keep]').value), intervalMinutes: Number(row.querySelector('[data-rule-interval]').value) }));
        state.management.automation = { welcomeEnabled: document.getElementById('managementWelcomeEnabled').checked, goodbyeEnabled: document.getElementById('managementGoodbyeEnabled').checked, scheduledMessagesEnabled: document.getElementById('managementScheduledMessages').checked, autoPurgeEnabled: document.getElementById('managementAutoPurge').checked, welcomeChannelId: document.getElementById('managementWelcomeChannel').value, welcomeMessage: document.getElementById('managementWelcomeMessage').value, goodbyeChannelId: document.getElementById('managementGoodbyeChannel').value, goodbyeMessage: document.getElementById('managementGoodbyeMessage').value, schedules, purgeRules };
    } else if (section === 'tickets') {
        const supportTeams = [...document.querySelectorAll('[data-support-team]')].map(row => ({
            id: row.querySelector('[data-team-id]').value.trim(),
            name: row.querySelector('[data-team-name]').value.trim(),
            roleId: row.querySelector('[data-team-role]').value,
            categoryId: row.querySelector('[data-team-category]').value
        })).filter(team => team.id || team.name);
        state.management.tickets = { categoryId: document.getElementById('managementTicketCategory').value, supportRoleId: requireOptionalSnowflake('managementTicketSupportRole', 'Support role ID'), logChannelId: document.getElementById('managementTicketLog').value, maxOpenPerMember: Number(document.getElementById('managementTicketLimit').value), welcomeMessage: document.getElementById('managementTicketWelcome').value, transcriptFormats: [...document.getElementById('managementTicketFormats').selectedOptions].map(option => option.value), dmTranscript: document.getElementById('managementTicketDmTranscript').checked, retentionDays: Number(document.getElementById('managementTicketRetention').value), deleteClosedChannels: document.getElementById('managementTicketDelete').checked, deleteDelayMinutes: Number(document.getElementById('managementTicketDeleteDelay').value), autoCloseInactiveDays: Number(document.getElementById('managementTicketAutoClose').value), supportTeams };
    } else if (section === 'suggestions') {
        state.management.suggestions = { channelId: document.getElementById('managementSuggestionChannel').value, reviewChannelId: document.getElementById('managementSuggestionReview').value, anonymous: document.getElementById('managementSuggestionAnonymous').checked, minimumApprovalVotes: Number(document.getElementById('managementSuggestionVotes').value) };
    } else if (section === 'joinSecurity') {
        state.management.joinSecurity = { logChannelId: document.getElementById('managementSecurityLog').value, quarantineRoleId: requireOptionalSnowflake('managementSecurityRole', 'Quarantine role ID'), minimumAccountAgeDays: Number(document.getElementById('managementSecurityAccountAge').value), joinBurstLimit: Number(document.getElementById('managementSecurityBurstLimit').value), joinBurstWindowSeconds: Number(document.getElementById('managementSecurityBurstWindow').value), action: document.getElementById('managementSecurityAction').value };
    } else if (section === 'starboard') {
        state.management.starboard = { channelId: document.getElementById('managementStarboardChannel').value, emoji: document.getElementById('managementStarboardEmoji').value.trim(), threshold: Number(document.getElementById('managementStarboardThreshold').value), allowSelfStars: document.getElementById('managementStarboardSelfStars').checked };
    } else if (section === 'forms') {
        state.management.forms = { submissionChannelId: document.getElementById('managementFormsChannel').value, reviewChannelId: document.getElementById('managementFormsReview').value, appealsEnabled: document.getElementById('managementFormsAppeals').checked, applicationTitle: document.getElementById('managementFormsTitle').value, applicationQuestions: textLines('managementFormsQuestions').slice(0, 5) };
    } else if (section === 'channels') {
        state.management.channels = { logChannelId: document.getElementById('managementChannelsLog').value, defaultSlowmodeSeconds: Number(document.getElementById('managementChannelsSlowmode').value), stickyChannelId: document.getElementById('managementChannelsStickyChannel').value, stickyMessage: document.getElementById('managementChannelsSticky').value, temporaryVoiceCategoryId: requireOptionalSnowflake('managementChannelsVoiceCategory', 'Temporary voice category ID') };
    } else if (section === 'integrations') {
        state.management.integrations = { nativeAutomodEnabled: document.getElementById('managementIntegrationsAutomod').checked, scheduledEventsEnabled: document.getElementById('managementIntegrationsEvents').checked, announcementChannelId: document.getElementById('managementIntegrationsAnnouncements').value };
    }
}

document.addEventListener('click', event => {
    const insertResource = event.target.closest('[data-insert-workflow-resource]');
    if (insertResource) {
        const key = insertResource.dataset.insertWorkflowResource;
        const picker = document.getElementById(key === 'roleId' ? 'workflowRolePicker' : 'workflowChannelPicker');
        const source = document.getElementById('workflowRulesJson');
        if (!picker?.value || !source) return;
        const reference = `"${key}":"${picker.value}"`;
        const start = Number.isInteger(source.selectionStart) ? source.selectionStart : source.value.length;
        source.setRangeText(reference, start, source.selectionEnd ?? start, 'end');
        source.focus();
        source.dispatchEvent(new Event('input', { bubbles: true }));
        return;
    }
    if (event.target.id === 'managementAddSupportTeam') {
        state.management.tickets.supportTeams = [...document.querySelectorAll('[data-support-team]')].map(row => ({
            id: row.querySelector('[data-team-id]').value.trim(), name: row.querySelector('[data-team-name]').value.trim(),
            roleId: row.querySelector('[data-team-role]').value, categoryId: row.querySelector('[data-team-category]').value
        })).concat({ id: '', name: '', roleId: '', categoryId: '' });
        renderSupportTeams();
        return;
    }
    const remove = event.target.closest('[data-remove-support-team]');
    if (!remove || !state.management?.tickets) return;
    const teams = [...document.querySelectorAll('[data-support-team]')].map(row => ({
        id: row.querySelector('[data-team-id]').value.trim(), name: row.querySelector('[data-team-name]').value.trim(),
        roleId: row.querySelector('[data-team-role]').value, categoryId: row.querySelector('[data-team-category]').value
    }));
    teams.splice(Number(remove.dataset.removeSupportTeam), 1);
    state.management.tickets.supportTeams = teams;
    renderSupportTeams();
});

function textLines(id) {
    return document.getElementById(id).value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
}

document.getElementById('managementAutomodRules').addEventListener('click', event => {
    const button = event.target.closest('[data-automod-toggle]');
    if (!button) return;
    const enabled = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(enabled));
    button.textContent = enabled ? 'On' : 'Off';
    button.closest('[data-automod-rule]').dataset.enabled = String(enabled);
});

document.getElementById('managementAutomodPreset').addEventListener('change', event => {
    const limits = automodPresetLimits[event.target.value];
    for (const [key, limit] of Object.entries(limits || {})) {
        const input = document.querySelector(`[data-automod-rule="${key}"] [data-automod-limit]`);
        if (input) input.value = limit;
    }
});

document.getElementById('managementAddSchedule').addEventListener('click', () => { state.management.automation.schedules.push({ id: `schedule-${Date.now()}`, enabled: true, channelId: '', message: '', intervalMinutes: 1440, scheduleType: 'interval', timezone: 'UTC', weekdays: [], time: '09:00' }); renderAutomationRules(); });
document.getElementById('managementAddPurgeRule').addEventListener('click', () => { state.management.automation.purgeRules.push({ id: `purge-${Date.now()}`, enabled: true, channelId: '', keepMessages: 20, intervalMinutes: 1440 }); renderAutomationRules(); });
document.getElementById('managementSchedules').addEventListener('click', event => { const button = event.target.closest('[data-remove-schedule]'); if (!button) return; state.management.automation.schedules.splice(Number(button.dataset.removeSchedule), 1); renderAutomationRules(); });
document.getElementById('managementSchedules').addEventListener('change', event => {
    const row = event.target.closest('[data-schedule-row]');
    if (row && event.target.matches('[data-rule-type]')) updateScheduleFields(row);
});
document.getElementById('managementSchedules').addEventListener('click', event => {
    const day = event.target.closest('[data-weekday]');
    const preview = event.target.closest('[data-preview-schedule]');
    const row = event.target.closest('[data-schedule-row]');
    if (day && row) {
        day.setAttribute('aria-pressed', String(day.getAttribute('aria-pressed') !== 'true'));
        row.querySelector('[data-rule-weekdays]').value = [...row.querySelectorAll('[data-weekday][aria-pressed="true"]')].map(button => button.dataset.weekday).join(',');
        markManagementDirty(row.closest('.tab-panel'), row);
    }
    if (preview && row) row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
});
document.getElementById('managementSchedules').addEventListener('dblclick', async event => {
    const row = event.target.closest('[data-schedule-row]'); if (!row) return;
    const schedule = { enabled: true, scheduleType: row.querySelector('[data-rule-type]').value, intervalMinutes: Number(row.querySelector('[data-rule-interval]').value), runAt: row.querySelector('[data-rule-run-at]').value, time: row.querySelector('[data-rule-time]').value, weekdays: row.querySelector('[data-rule-weekdays]').value.split(',').map(Number).filter(Number.isInteger), cron: row.querySelector('[data-rule-cron]').value, timezone: row.querySelector('[data-rule-timezone]').value, startAt: row.querySelector('[data-rule-start]').value, endAt: row.querySelector('[data-rule-end]').value };
    const result = await api(withGuild('/api/management/schedule-preview'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schedule }) });
    await alertDialog({ title: 'Next executions', message: result.next.length ? result.next.map(formatDateTime).join('\n') : 'No execution falls within the next year.' });
});
document.getElementById('managementPurgeRules').addEventListener('click', event => { const button = event.target.closest('[data-remove-purge]'); if (!button) return; state.management.automation.purgeRules.splice(Number(button.dataset.removePurge), 1); renderAutomationRules(); });

document.addEventListener('input', event => { if (event.target.closest('#formQuestionBuilder')) syncFormQuestions(); });
document.addEventListener('click', event => {
    if (!event.target.closest('#formQuestionBuilder')) return;
    const source = document.getElementById('managementFormsQuestions');
    const questions = source.value.split('\n').map(value => value.trim()).filter(Boolean);
    const add = event.target.closest('[data-question-add]');
    const remove = event.target.closest('[data-question-remove]');
    const up = event.target.closest('[data-question-up]');
    const down = event.target.closest('[data-question-down]');
    if (add && questions.length < 5) questions.push('New question');
    if (remove) questions.splice(Number(remove.dataset.questionRemove), 1);
    if (up) { const index = Number(up.dataset.questionUp); [questions[index - 1], questions[index]] = [questions[index], questions[index - 1]]; }
    if (down) { const index = Number(down.dataset.questionDown); [questions[index + 1], questions[index]] = [questions[index], questions[index + 1]]; }
    if (add || remove || up || down) { source.value = questions.join('\n'); renderFormQuestionBuilder(); renderModulePreviews(); markManagementDirty(source.closest('.tab-panel'), source); }
});

document.addEventListener('input', event => { if (event.target.closest('#workflowVisualBuilder')) syncWorkflowBuilder(); });
document.addEventListener('change', event => {
    if (!event.target.closest('#workflowVisualBuilder')) return;
    if (event.target.matches('[data-workflow-event]')) {
        syncWorkflowBuilder();
        renderWorkflowBuilder();
        return;
    }
    if (event.target.matches('[data-action-type]')) updateWorkflowActionFields(event.target.closest('[data-workflow-action]'));
    syncWorkflowBuilder();
});
document.addEventListener('click', event => {
    if (!event.target.closest('#workflowVisualBuilder')) return;
    const source = document.getElementById('workflowRulesJson');
    const rules = readJsonArray(source);
    const card = event.target.closest('[data-workflow-rule]');
    const ruleIndex = Number(card?.dataset.workflowRule);
    if (event.target.closest('[data-workflow-add-rule]')) rules.push({ name: '', event: 'member.join', conditions: [], actions: [] });
    else if (event.target.closest('[data-workflow-remove-rule]')) rules.splice(Number(event.target.closest('[data-workflow-remove-rule]').dataset.workflowRemoveRule), 1);
    else if (event.target.closest('[data-add-condition]')) (rules[ruleIndex].conditions ||= []).push({ field: '', operator: 'equals', value: '' });
    else if (event.target.closest('[data-remove-condition]')) rules[ruleIndex].conditions.splice(Number(event.target.closest('[data-workflow-condition]').dataset.workflowCondition), 1);
    else if (event.target.closest('[data-add-action]')) (rules[ruleIndex].actions ||= []).push({ type: 'notification' });
    else if (event.target.closest('[data-remove-action]')) rules[ruleIndex].actions.splice(Number(event.target.closest('[data-workflow-action]').dataset.workflowAction), 1);
    else return;
    source.value = JSON.stringify(rules, null, 2);
    renderWorkflowBuilder();
    markManagementDirty(source.closest('.tab-panel'), source);
});

window.addEventListener('beforeunload', event => {
    if (!dirtyManagementPanel) return;
    event.preventDefault();
    event.returnValue = '';
});

for (const id of ['managementOnboardingTitle', 'managementOnboardingMessage', 'managementWelcomeMessage', 'managementGoodbyeMessage', 'managementStarboardEmoji', 'managementStarboardThreshold', 'managementStarboardChannel', 'managementFormsTitle']) {
    document.getElementById(id)?.addEventListener('input', renderModulePreviews);
    document.getElementById(id)?.addEventListener('change', renderModulePreviews);
}

const managementStatusIds = { moderation: 'managementModerationStatus', automod: 'managementAutomodStatus', cases: 'managementCasesStatus', roles: 'managementRolesStatus', automation: 'managementAutomationStatus', tickets: 'managementTicketsStatus', suggestions: 'managementSuggestionsStatus', joinSecurity: 'managementJoinSecurityStatus', starboard: 'managementStarboardStatus', forms: 'managementFormsStatus', channels: 'managementChannelsStatus', integrations: 'managementIntegrationsStatus', serverDoctor: 'managementServerDoctorStatus', incidentCenter: 'managementIncidentCenterStatus', reports: 'managementReportsStatus', workflows: 'managementWorkflowsStatus', staffOperations: 'managementStaffOperationsStatus', communityHealth: 'managementCommunityHealthStatus', backups: 'managementBackupsStatus', copilot: 'managementCopilotStatus', engagement: 'managementEngagementStatus' };
document.querySelectorAll('[data-save-management]').forEach(button => button.addEventListener('click', async () => {
    const section = button.dataset.saveManagement;
    const status = document.getElementById(managementStatusIds[section]);
    try {
        collectManagementSection(section);
        await persistManagement(status);
    } catch (error) {
        setStatus(status, error.message, 'error');
    }
}));

document.querySelectorAll('[data-save-advanced]').forEach(button => button.addEventListener('click', async () => {
    const section = button.dataset.saveAdvanced;
    const status = document.getElementById(managementStatusIds[section]);
    button.disabled = true;
    try {
        collectAdvancedManagement(section);
        await persistManagement(status);
    } catch (error) {
        setStatus(status, error.message, 'error');
    } finally {
        button.disabled = false;
    }
}));

async function updateOperationStatus(action, id, status) {
    await api(withGuild('/api/management/operations'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, id, status }) });
    await refreshAdvancedOperations();
}

document.getElementById('reportsOperationsTable').addEventListener('change', event => {
    if (event.target.matches('[data-report-status]')) updateOperationStatus('report-status', event.target.dataset.reportStatus, event.target.value).catch(handleUiError);
});
document.getElementById('incidentCenterTable').addEventListener('change', event => {
    if (event.target.matches('[data-incident-status]')) updateOperationStatus('incident-status', event.target.dataset.incidentStatus, event.target.value).catch(handleUiError);
});
document.getElementById('managementSuggestionsRoadmap').addEventListener('change', event => {
    if (event.target.matches('[data-suggestion-status]')) updateOperationStatus('suggestion-status', event.target.dataset.suggestionStatus, event.target.value).catch(handleUiError);
});
document.addEventListener('change', event => {
    if (event.target.matches('[data-submission-status]')) updateOperationStatus('submission-status', event.target.dataset.submissionStatus, event.target.value).catch(handleUiError);
});
document.getElementById('managementActivePunishments').addEventListener('click', async event => {
    const button = event.target.closest('[data-cancel-punishment]');
    if (!button) return;
    const confirmed = await confirmAction({ title: 'Cancel this punishment?', message: 'The timeout, ban, or temporary role will be reversed immediately.', confirmLabel: 'Cancel punishment' });
    if (!confirmed) return;
    button.disabled = true;
    try {
        await api(withGuild('/api/management/operations'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel-punishment', id: button.dataset.cancelPunishment }) });
        await refreshAdvancedOperations();
    } catch (error) { handleUiError(error); }
    finally { button.disabled = false; }
});
document.getElementById('runServerDoctor').addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    try { renderAdvancedOperations(await api(withGuild('/api/management/operations'))); }
    catch (error) { setStatus(document.getElementById('managementServerDoctorStatus'), error.message, 'error'); }
    finally { event.currentTarget.disabled = false; }
});
document.getElementById('createServerSnapshot').addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    const status = document.getElementById('managementBackupsStatus');
    try {
        await api(withGuild('/api/management/operations'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'snapshot' }) });
        setStatus(status, 'Snapshot created.', 'ok');
        await refreshAdvancedOperations();
    } catch (error) { setStatus(status, error.message, 'error'); }
    finally { event.currentTarget.disabled = false; }
});
document.getElementById('serverSnapshotsTable').addEventListener('click', async event => {
    const previewButton = event.target.closest('[data-snapshot-preview]');
    const restoreButton = event.target.closest('[data-snapshot-restore]');
    const id = previewButton?.dataset.snapshotPreview || restoreButton?.dataset.snapshotRestore;
    if (!id) return;
    const status = document.getElementById('managementBackupsStatus');
    if (previewButton) {
        const result = await api(withGuild('/api/management/operations'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'snapshot-preview', id }) });
        setStatus(status, `${result.missingRoles} missing roles and ${result.missingChannels} missing channels can be recreated. Existing items stay untouched.`, 'ok');
        return;
    }
    const confirmed = await confirmAction({ title: 'Restore missing server configuration?', message: `Flummi will recreate roles and channels missing from ${id}. Existing roles and channels will not be overwritten or deleted.`, confirmLabel: 'Restore missing items' });
    if (!confirmed) return;
    restoreButton.disabled = true;
    try {
        const result = await api(withGuild('/api/management/operations'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'snapshot-restore', id, confirmation: 'RESTORE' }) });
        setStatus(status, `Restored ${result.restoredRoles} roles and ${result.restoredChannels} channels.`, 'ok');
        await refreshAdvancedOperations();
    } catch (error) { setStatus(status, error.message, 'error'); }
    finally { restoreButton.disabled = false; }
});

async function loadManagementTimeline() {
    if (!state.guildId || state.role === 'member') return;
    const filterIds = { userId: 'managementCaseUserFilter', moderatorId: 'managementAuditModeratorFilter', action: 'managementAuditActionFilter', channelId: 'managementAuditChannelFilter', from: 'managementAuditFrom', to: 'managementAuditTo' };
    const parameters = new URLSearchParams();
    for (const [key, id] of Object.entries(filterIds)) {
        const value = document.getElementById(id).value.trim();
        if (value) parameters.set(key, value);
    }
    const suffix = parameters.size ? `&${parameters}` : '';
    const data = await api(`${withGuild('/api/management/cases')}${suffix}`);
    document.getElementById('managementCasesTable').innerHTML = data.cases.length ? `<table><thead><tr><th>Case</th><th>Action</th><th>Target</th><th>Reason</th><th>Status</th><th>Created</th></tr></thead><tbody>${data.cases.map(entry => `<tr><td><code>${escapeHtml(entry.id)}</code></td><td>${escapeHtml(entry.action)}</td><td>${escapeHtml(entry.targetLabel || (entry.targetId ? resourceDisplay(entry.targetId) : '—'))}</td><td>${escapeHtml(entry.reason)}</td><td>${escapeHtml(entry.status)}</td><td>${escapeHtml(formatDate(entry.createdAt))}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No cases found.</div>';
    document.getElementById('managementEventsTable').innerHTML = data.events.length ? `<table><thead><tr><th>Event</th><th>Member</th><th>Summary</th><th>Created</th></tr></thead><tbody>${data.events.map(entry => `<tr><td>${escapeHtml(entry.type)}</td><td>${escapeHtml(entry.userId ? resourceDisplay(entry.userId) : '—')}</td><td>${escapeHtml(entry.summary)}</td><td>${escapeHtml(formatDate(entry.createdAt))}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No events found.</div>';
    document.getElementById('managementAuditTable').innerHTML = operationTable(data.audit || [], [
        { label: 'Time', render: row => escapeHtml(formatDateTime(row.at)) }, { label: 'Source', key: 'source' },
        { label: 'Action', key: 'action' }, { label: 'Member', render: row => row.memberId ? `<button class="secondary" type="button" data-dossier-member="${escapeHtml(row.memberId)}">${escapeHtml(resourceDisplay(row.memberId))}</button>` : '—' }, { label: 'Moderator', render: row => escapeHtml(row.moderatorId ? resourceDisplay(row.moderatorId) : '—') },
        { label: 'Channel', render: row => escapeHtml(row.channelId ? resourceDisplay(row.channelId, 'channel') : '—') }, { label: 'Summary', key: 'summary' }
    ], 'No audit records match these filters.');
    const dossier = data.dossier;
    document.getElementById('managementMemberDossier').innerHTML = dossier ? `<div class="card-grid">
        <article class="card"><span>Moderation cases</span><strong>${dossier.cases.length}</strong><small>Factual records only; no derived member scoring</small></article>
        <article class="card"><span>Timeline records</span><strong>${dossier.timeline.length}</strong><small>Necessary moderation and support metadata</small></article>
    </div>${operationTable(dossier.timeline || [], [
        { label: 'Time', render: row => escapeHtml(formatDateTime(row.at)) }, { label: 'Type', key: 'type' }, { label: 'Event', key: 'label' }, { label: 'Channel', render: row => escapeHtml(row.channelId ? resourceDisplay(row.channelId, 'channel') : '—') }, { label: 'Status', key: 'status' }
    ], 'No timeline entries for this member.')}` : '<div class="empty">Choose a member to load factual moderation and support records.</div>';
}

document.getElementById('managementRefreshCases').addEventListener('click', () => loadManagementTimeline().catch(error => setStatus(document.getElementById('managementCasesStatus'), error.message, 'error')));
['managementCaseUserFilter', 'managementAuditModeratorFilter', 'managementAuditActionFilter', 'managementAuditChannelFilter', 'managementAuditFrom', 'managementAuditTo'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => loadManagementTimeline().catch(() => { }));
});
document.getElementById('managementAuditTable').addEventListener('click', event => {
    const button = event.target.closest('[data-dossier-member]');
    if (!button) return;
    document.getElementById('managementCaseUserFilter').value = button.dataset.dossierMember;
    loadManagementTimeline().catch(handleUiError);
});

document.getElementById('managementRunAction').addEventListener('click', async () => {
    const status = document.getElementById('managementActionStatus');
    const action = document.getElementById('managementAction').value;
    const targetId = document.getElementById('managementActionTarget').value.trim();
    const memberActions = action !== 'purge';
    if (memberActions && !/^\d{16,22}$/.test(targetId)) return setStatus(status, 'Choose an available server member.', 'error');
    try {
        const number = Number(document.getElementById('managementActionNumber').value);
        const result = await api(withGuild('/api/management/action'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, targetId: memberActions ? targetId : null, channelId: document.getElementById('managementActionChannel').value, duration: document.getElementById('managementActionDuration').value.trim(), reason: document.getElementById('managementActionReason').value.trim(), count: number, seconds: number }) });
        setStatus(status, `Done. Case ${result.case.id} created.`, 'ok');
        await loadManagementTimeline();
    } catch (error) { setStatus(status, error.message, 'error'); }
});

document.getElementById('managementPublishRoles').addEventListener('click', async () => {
    const status = document.getElementById('managementRolesStatus');
    try {
        collectManagementSection('roles');
        await persistManagement();
        const result = await api(withGuild('/api/management/roles/publish'), { method: 'POST' });
        setStatus(status, `Role menu published in channel ${result.channelId}.`, 'ok');
    } catch (error) { setStatus(status, error.message, 'error'); }
});

async function loadSettings() {
    if (!state.guildId) return;
    const data = await api(withGuild('/api/settings'));
    const s = data.settings;

    document.getElementById('setBotEnabled').checked = s.botEnabled;
    document.getElementById('setTriggersEnabled').checked = s.triggersEnabled;
    document.getElementById('setCooldownEnabled').checked = s.triggerActionCooldownEnabled;
    document.getElementById('setCooldownSeconds').value = s.triggerActionCooldownSeconds;
    document.getElementById('setExactMatch').checked = s.exactTriggerMatch;
    document.getElementById('setMaxTriggerLength').value = s.maxTriggerLength;
    const f = data.globalFeatures || {};
    document.getElementById('featureTriggers').checked = f.triggersEnabled !== false;
    document.getElementById('featureAiConversations').checked = f.aiConversationsEnabled !== false;
    document.getElementById('featureAiAttachments').checked = f.aiAttachmentsEnabled !== false;
    document.getElementById('featureAiImageSearch').checked = f.aiImageSearchEnabled !== false;
    document.getElementById('featurePingResponses').checked = f.pingResponsesEnabled !== false;
    document.getElementById('featurePingSave').checked = f.pingRequestSaveEnabled !== false;
    const gf = s.features || {};
    document.getElementById('guildFeatureAiConversations').checked = gf.aiConversationsEnabled !== false;
    document.getElementById('guildFeatureAiAttachments').checked = gf.aiAttachmentsEnabled !== false;
    document.getElementById('guildFeatureAiImageSearch').checked = gf.aiImageSearchEnabled !== false;
    document.getElementById('guildFeaturePingResponses').checked = gf.pingResponsesEnabled !== false;
    document.getElementById('guildFeaturePingSave').checked = gf.pingRequestSaveEnabled !== false;
    syncGlobalFeatureState();
}

async function loadGlobalSettings() {
    const [configData, complianceData, incidentData] = await Promise.all([api('/api/config'), api('/api/developer/compliance'), api('/api/public/incidents')]);
    document.getElementById('publicPanelEnabled').checked = configData.panel?.publicAccessEnabled !== false;
    applyDeveloperSettings(configData);
    renderCommandPermissions(configData);
    syncGlobalFeatureState();
    renderComplianceOperations(complianceData);
    renderDeveloperPublicIncidents(incidentData.incidents || []);
}

function renderDeveloperPublicIncidents(entries) {
    document.getElementById('developerPublicIncidents').innerHTML = entries.length ? entries.slice(0, 8).map(entry => `<article class="notification-item"><span class="badge ${entry.status === 'resolved' ? 'ok' : 'warn'}">${escapeHtml(entry.status)}</span><div><strong>${escapeHtml(entry.title)}</strong><p>${escapeHtml(entry.message || '')}</p><small>${escapeHtml(formatDateTime(entry.createdAt))}</small></div></article>`).join('') : '<div class="empty">No public incidents yet.</div>';
}

document.getElementById('publishPublicIncident').addEventListener('click', async () => {
    const status = document.getElementById('publicIncidentStatus');
    try {
        const data = await api('/api/public/incidents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: document.getElementById('publicIncidentTitle').value, message: document.getElementById('publicIncidentMessage').value, status: document.getElementById('publicIncidentState').value }) });
        renderDeveloperPublicIncidents(data.incidents || []); document.getElementById('publicIncidentTitle').value = ''; document.getElementById('publicIncidentMessage').value = ''; setStatus(status, 'Public status update published.', 'ok');
    } catch (error) { setStatus(status, error.message, 'error'); }
});

function renderComplianceTable(rows) {
    return `<table><thead><tr><th>Stage</th><th>Target</th><th>Required action</th></tr></thead><tbody>${(rows || []).map(row => `<tr><td>${escapeHtml(row.stage)}</td><td>${escapeHtml(row.target)}</td><td>${escapeHtml(row.action)}</td></tr>`).join('')}</tbody></table>`;
}

function renderComplianceOperations(data) {
    const procedures = data.procedures || {};
    const agreement = data.openRouter || {};
    document.getElementById('complianceOwner').textContent = procedures.owner || 'Configured Flummi developers';
    document.getElementById('complianceAbuseTable').innerHTML = renderComplianceTable(procedures.abuse);
    document.getElementById('complianceCorrectionTable').innerHTML = renderComplianceTable(procedures.correction);
    document.getElementById('complianceIncidentTable').innerHTML = renderComplianceTable(procedures.incident);
    document.getElementById('openRouterAgreementStatus').value = agreement.status || 'pending';
    document.getElementById('openRouterAgreementEffective').value = agreement.effectiveAt ? agreement.effectiveAt.slice(0, 10) : '';
    document.getElementById('openRouterAgreementReference').value = agreement.reference || '';
    const details = agreement.updatedAt
        ? `Last recorded ${formatDateTime(agreement.updatedAt)}${agreement.reviewedBy ? ` by developer ${agreement.reviewedBy}` : ''}.`
        : 'No provider review has been recorded yet.';
    setStatus(document.getElementById('openRouterAgreementStatusText'), details, agreement.status === 'dpa-executed' ? 'ok' : '');
}

function applyDeveloperSettings(configData) {
    const f = configData.features || {};
    document.getElementById('analyticsRetentionDays').value = configData.analytics?.retentionDays || 365;
    document.getElementById('featureTriggers').checked = f.triggersEnabled !== false;
    document.getElementById('featureAiConversations').checked = f.aiConversationsEnabled !== false;
    document.getElementById('featureAiAttachments').checked = f.aiAttachmentsEnabled !== false;
    document.getElementById('featureAiImageSearch').checked = f.aiImageSearchEnabled !== false;
    document.getElementById('featurePingResponses').checked = f.pingResponsesEnabled !== false;
    document.getElementById('featurePingSave').checked = f.pingRequestSaveEnabled !== false;
    const disabledModules = new Set(Array.isArray(f.disabledModules) ? f.disabledModules : []);
    document.getElementById('globalModuleSwitches').innerHTML = Object.entries(managementModuleDefinitions).map(([key, definition]) => `<div class="checkbox-row"><input id="global-module-${escapeHtml(key)}" data-global-module="${escapeHtml(key)}" type="checkbox" ${disabledModules.has(key) ? 'checked' : ''}><label for="global-module-${escapeHtml(key)}">Disable ${escapeHtml(definition.title)}</label></div>`).join('');
    const configuredTabOrder = Array.isArray(configData.panel?.tabOrder) && configData.panel.tabOrder.length
        ? [...configData.panel.tabOrder]
        : [];
    const configuredDeveloperOrder = configuredTabOrder.filter(entry => fixedDeveloperTabIds.has(entry));
    editableDeveloperTabOrder = [
        ...new Set(configuredDeveloperOrder),
        ...defaultDeveloperTabOrder.filter(tabId => !configuredDeveloperOrder.includes(tabId))
    ];
    const sharedConfiguredOrder = configuredTabOrder.filter(entry => !fixedDeveloperTabIds.has(entry));
    const configuredTabs = new Set(sharedConfiguredOrder.filter(tabId => !isDividerToken(tabId) && !isTitleToken(tabId)));
    // Older saved configurations predate newer tabs. Keep their custom order and dividers,
    // then append every newly available tab so it can be positioned and renamed normally.
    editableTabOrder = normalizeEditableTabOrder([
        ...sharedConfiguredOrder,
        ...tabButtons
            .map(button => button.dataset.tab)
            .filter(tabId => !fixedDeveloperTabIds.has(tabId) && !configuredTabs.has(tabId))
    ]);
    editableTabNames = { ...(configData.panel?.tabNames || {}) };
    renderTabOrderEditor();
    renderDeveloperTabOrderEditor();
}

function syncGlobalFeatureState() {
    state.globalFeatures = {
        ...state.globalFeatures,
        triggersEnabled: document.getElementById('featureTriggers').checked,
        aiConversationsEnabled: document.getElementById('featureAiConversations').checked,
        aiAttachmentsEnabled: document.getElementById('featureAiAttachments').checked,
        aiImageSearchEnabled: document.getElementById('featureAiImageSearch').checked,
        pingResponsesEnabled: document.getElementById('featurePingResponses').checked,
        pingRequestSaveEnabled: document.getElementById('featurePingSave').checked
    };
    applyGlobalFeatureNavigation();
    const pairs = [
        ['featureTriggers', 'setTriggersEnabled'],
        ['featureAiConversations', 'guildFeatureAiConversations'], ['featureAiAttachments', 'guildFeatureAiAttachments'],
        ['featureAiImageSearch', 'guildFeatureAiImageSearch'], ['featurePingResponses', 'guildFeaturePingResponses'],
        ['featurePingSave', 'guildFeaturePingSave']
    ];
    for (const [globalId, guildId] of pairs) {
        const globalInput = document.getElementById(globalId);
        const input = document.getElementById(guildId);
        const on = globalInput.checked;
        const surface = input.closest('.checkbox-row');
        const label = document.querySelector(`label[for="${globalId}"]`)?.textContent.replace(/\?\s*$/, '').trim() || 'this feature';
        const baseTooltip = surface.dataset.baseTooltip || featureTooltipDefinitions[guildId] || '';
        const tooltip = on
            ? baseTooltip
            : `Temporarily disabled because “${label}” is turned off in Global Feature Settings. ${baseTooltip}`;
        input.disabled = !on;
        surface.style.opacity = on ? '1' : '.55';
        surface.dataset.disabledByGlobal = String(!on);
        surface.setAttribute('aria-disabled', String(!on));
        const help = surface.querySelector('[data-feature-help]');
        if (help) help.dataset.tooltip = tooltip;
    }
}

['featureTriggers', 'featureAiConversations', 'featureAiAttachments', 'featureAiImageSearch', 'featurePingResponses', 'featurePingSave'].forEach(id => document.getElementById(id).addEventListener('change', syncGlobalFeatureState));

document.getElementById('addTabDivider').addEventListener('click', () => { editableTabOrder.push('---'); renderTabOrderEditor(); });
document.getElementById('addTabTitle').addEventListener('click', () => {
    const input = document.getElementById('tabTitleInput');
    const title = input.value.trim();
    if (!title) {
        setStatus(document.getElementById('tabOrderStatus'), 'Enter a category title first.', 'error');
        input.focus();
        return;
    }
    editableTabOrder.push(`title:${title.slice(0, 60)}`);
    input.value = '';
    renderTabOrderEditor();
    setStatus(document.getElementById('tabOrderStatus'), 'Category title added. Move it with the arrows, then save.', 'ok');
});
document.getElementById('tabTitleInput').addEventListener('keydown', event => {
    if (event.key === 'Enter') {
        event.preventDefault();
        document.getElementById('addTabTitle').click();
    }
});
document.getElementById('saveTabOrder').addEventListener('click', async () => {
    const status = document.getElementById('tabOrderStatus');
    if (!await confirmAction({ title: 'Save panel navigation?', message: 'This changes tab names and ordering for every panel member.', confirmLabel: 'Save navigation', danger: false })) return;
    try {
        editableTabOrder = editableTabOrder.filter(entry => !isTitleToken(entry) || Boolean(titleFromToken(entry)));
        const tabNames = Object.fromEntries(Object.entries(editableTabNames).map(([id, name]) => [id, String(name).trim()]).filter(([, name]) => name));
        const completeTabOrder = [...editableTabOrder, ...editableDeveloperTabOrder];
        const result = await api('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ panel: { tabOrder: completeTabOrder, tabNames } }) });
        applyTabOrder(result.config?.panel?.tabOrder || completeTabOrder);
        applyTabNames(result.config?.panel?.tabNames || tabNames);
        setStatus(status, 'Tab order saved.', 'ok');
    } catch (error) { setStatus(status, error.message, 'error'); }
});

async function saveSettings() {
    const statusField = document.getElementById('settingsStatus');

    if (!state.guildId) {
        setStatus(statusField, 'Select a guild first.', 'error');
        return;
    }

    const cooldownInput = document.getElementById('setCooldownSeconds');
    const triggerLengthInput = document.getElementById('setMaxTriggerLength');
    if (!cooldownInput.checkValidity()) {
        setStatus(statusField, 'Cooldown seconds must be between 0 and 3600.', 'error');
        cooldownInput.reportValidity();
        return;
    }
    if (!triggerLengthInput.checkValidity()) {
        setStatus(statusField, 'Max trigger length must be between 1 and 200.', 'error');
        triggerLengthInput.reportValidity();
        return;
    }

    const payload = {
        botEnabled: document.getElementById('setBotEnabled').checked,
        triggersEnabled: document.getElementById('setTriggersEnabled').checked,
        triggerActionCooldownEnabled: document.getElementById('setCooldownEnabled').checked,
        triggerActionCooldownSeconds: Number(document.getElementById('setCooldownSeconds').value) || 0,
        exactTriggerMatch: document.getElementById('setExactMatch').checked,
        maxTriggerLength: Number(document.getElementById('setMaxTriggerLength').value) || 200,
        features: {
            aiConversationsEnabled: document.getElementById('guildFeatureAiConversations').checked,
            aiAttachmentsEnabled: document.getElementById('guildFeatureAiAttachments').checked,
            aiImageSearchEnabled: document.getElementById('guildFeatureAiImageSearch').checked,
            pingResponsesEnabled: document.getElementById('guildFeaturePingResponses').checked,
            pingRequestSaveEnabled: document.getElementById('guildFeaturePingSave').checked
        }
    };

    await api(withGuild('/api/settings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    setStatus(statusField, 'Saved.', 'ok');
}

const instantSettingIds = ['setBotEnabled', 'setTriggersEnabled', 'setCooldownEnabled', 'setExactMatch', 'guildFeatureAiConversations', 'guildFeatureAiAttachments', 'guildFeatureAiImageSearch', 'guildFeaturePingResponses', 'guildFeaturePingSave'];
instantSettingIds.forEach(id => document.getElementById(id).addEventListener('change', () => saveSettings().catch(error => setStatus(document.getElementById('settingsStatus'), error.message, 'error'))));
['setCooldownSeconds', 'setMaxTriggerLength'].forEach(id => document.getElementById(id).addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    saveSettings().catch(error => setStatus(document.getElementById('settingsStatus'), error.message, 'error'));
}));

document.getElementById('saveGlobalFeatures').addEventListener('click', async () => {
    const statusField = document.getElementById('globalFeatureStatus');
    if (!await confirmAction({ title: 'Save global features?', message: 'These switches affect every server connected to Flummi.', confirmLabel: 'Save global features' })) return;
    try {
        await api('/api/config', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
                features: {
                    triggersEnabled: document.getElementById('featureTriggers').checked,
                    aiConversationsEnabled: document.getElementById('featureAiConversations').checked,
                    aiAttachmentsEnabled: document.getElementById('featureAiAttachments').checked,
                    aiImageSearchEnabled: document.getElementById('featureAiImageSearch').checked,
                    pingResponsesEnabled: document.getElementById('featurePingResponses').checked,
                    pingRequestSaveEnabled: document.getElementById('featurePingSave').checked
                }, analytics: { retentionDays: Math.max(1, Math.min(3650, Number(document.getElementById('analyticsRetentionDays').value) || 365)) }
            })
        });
        syncGlobalFeatureState();
        setStatus(statusField, 'Global features saved.', 'ok');
    } catch (error) {
        setStatus(statusField, error.message, 'error');
    }
});

document.getElementById('savePublicPanelAccess').addEventListener('click', async () => {
    const enabled = document.getElementById('publicPanelEnabled').checked;
    const status = document.getElementById('publicPanelAccessStatus');
    const confirmed = await confirmAction({
        title: enabled ? 'Enable the public site?' : 'Pause the public site?',
        message: enabled
            ? 'The Cloudflare hostname will become available to visitors and Discord OAuth again.'
            : 'Public visitors will receive a maintenance page. The direct Tailscale panel remains available.',
        confirmLabel: enabled ? 'Enable public site' : 'Pause public site',
        danger: !enabled
    });
    if (!confirmed) return;
    try {
        const result = await api('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ panel: { publicAccessEnabled: enabled } })
        });
        document.getElementById('publicPanelEnabled').checked = result.config?.panel?.publicAccessEnabled !== false;
        setStatus(status, enabled
            ? 'Public Cloudflare access is enabled.'
            : 'Public Cloudflare access is paused. Keep this Tailscale page open to re-enable it.', 'ok');
    } catch (error) {
        setStatus(status, error.message, 'error');
    }
});

document.getElementById('downloadBackup').addEventListener('click', () => { if (state.guildId) window.location.href = withGuild('/api/backup'); });
document.getElementById('loadStorage').addEventListener('click', async () => { try { const data = await api(withGuild('/api/data-tools')); renderTable(document.getElementById('storageDetails'), [{ label: 'File', key: 'name' }, { label: 'Bytes', key: 'size' }, { label: 'Modified', key: 'modifiedAt', render: r => formatDateTime(r.modifiedAt) }], data.guildFiles, 'No guild storage files.'); } catch (error) { setStatus(document.getElementById('settingsStatus'), error.message, 'error'); } });
document.getElementById('resetUserData').addEventListener('click', async () => { const userId = document.getElementById('resetDataUser').value.trim(), store = document.getElementById('resetDataStore').value; if (!userId || !state.guildId) return; if (!await confirmAction({ title: 'Permanently reset user data?', message: `Reset ${store} for ${userId}? This cannot be undone.`, confirmLabel: 'Reset data' })) return; try { await api(withGuild('/api/data-tools/reset'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, store, confirmation: 'RESET' }) }); setStatus(document.getElementById('settingsStatus'), `Reset ${store} for ${userId}.`, 'ok'); } catch (error) { setStatus(document.getElementById('settingsStatus'), error.message, 'error'); } });

// ---------- Ping requests ----------
async function loadPingRequests() {
    if (!state.guildId) return;
    const data = await api(withGuild('/api/pingrequests'));

    const rows = data.entries.flatMap(entry => (entry.content || []).map(item => ({
        requestedBy: entry.byLabel,
        requestedByNickname: entry.byNickname,
        requestedAt: entry.at,
        message: item.message,
        attachments: item.attachments
    })));

    renderTable(document.getElementById('pingRequestsTable'),
        [
            { label: 'Requested By', key: 'requestedBy', render: r => withNicknameTitle(r.requestedBy, r.requestedByNickname) },
            { label: 'Requested At', key: 'requestedAt', render: r => escapeHtml(formatDateTime(r.requestedAt)) },
            { label: 'Message', key: 'message', render: r => escapeHtml((r.message || '').slice(0, 160)) },
            { label: 'Attachments', sortValue: r => r.attachments ? 1 : 0, render: r => r.attachments ? `<a href="${escapeHtml(r.attachments)}" target="_blank" rel="noopener">View</a>` : '' }
        ],
        rows, 'No saved ping requests yet.');
}

// ---------- AI & system ----------
document.getElementById('lookupAiMemory').addEventListener('click', () => {
    lookupAiMemory().catch(error => console.error(error));
});

async function lookupAiMemory() {
    const userId = document.getElementById('aiMemoryUserId').value.trim();
    const resultBox = document.getElementById('aiMemoryResult');

    if (!userId) {
        resultBox.innerHTML = '<p class="status error">Select a server member.</p>';
        return;
    }

    const data = await api(`/api/ai-memory?userId=${encodeURIComponent(userId)}`);
    resultBox.innerHTML = `
        <ul>
            <li>Turns saved: ${escapeHtml(data.turns)}</li>
            <li>Older context: ${escapeHtml(data.summaryChars)} chars</li>
            <li>User profile: ${escapeHtml(data.profileChars)} chars</li>
            <li>Last updated: ${escapeHtml(data.updatedAt ? formatDateTime(data.updatedAt) : 'Never')}</li>
        </ul>
    `;
}

function formatAudioTime(seconds) {
    const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    return `${Math.floor(safe / 60)}:${String(Math.floor(safe % 60)).padStart(2, '0')}`;
}

let activeLottieAnimation = null;
const mediaViewModes = { emoji: 'table', sticker: 'table' };

function trendHtml(trend) {
    const status = trend?.status || 'unavailable';
    const label = status === 'new' ? 'New' : status === 'unavailable' ? 'No comparison' : `${Number(trend?.percent || 0) > 0 ? '+' : ''}${Number(trend?.percent || 0)}%`;
    const arrow = status === 'up' ? '↑ ' : status === 'down' ? '↓ ' : '';
    return `<span class="trend ${escapeHtml(status)}" title="Compared with the previous equal period">${arrow}${escapeHtml(label)}</span>`;
}

function topMembersHtml(members) {
    if (!members?.length) return '<span class="muted">No usage</span>';
    return members.slice(0, 3).map(member => `${withNicknameTitle(member.label, member.nickname)} <span class="muted">(${escapeHtml(member.count)})</span>`).join('<br>');
}

function applyMediaView(kind, mode) {
    mediaViewModes[kind] = mode;
    document.getElementById(`${kind}Table`).hidden = mode !== 'table';
    document.getElementById(`${kind}Gallery`).hidden = mode !== 'gallery';
    document.querySelectorAll(`[data-media-view="${kind}"]`).forEach(button => button.classList.toggle('active', button.dataset.viewMode === mode));
}

function renderMediaGallery(containerId, rows, kind, mediaPreview) {
    const container = document.getElementById(containerId);
    if (!rows?.length) { container.innerHTML = `<div class="empty">No ${escapeHtml(kind)}s found.</div>`; return; }
    container.innerHTML = rows.map(row => `<article class="media-gallery-card">
        ${mediaPreview(row.previewUrl || row.url, row.name, row.lottieUrl)}
        <strong>${escapeHtml(row.name)}</strong>
        <small>${escapeHtml(row.uses)} uses · ${escapeHtml(row.averagePerDay)} / day</small>
        <small>${trendHtml(row.trend)}</small>
    </article>`).join('');
}

function updateSoundPlayer(audio) {
    const player = audio.closest('.sound-player');
    if (!player) return;
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const progress = player.querySelector('.sound-progress');
    const percentage = duration ? Math.max(0, Math.min(100, audio.currentTime / duration * 100)) : 0;
    progress.value = String(percentage);
    progress.style.setProperty('--sound-progress', `${percentage}%`);
    player.querySelector('.sound-player-time').textContent = `${formatAudioTime(audio.currentTime)} / ${formatAudioTime(duration)}`;
    const button = player.querySelector('.sound-play-toggle');
    button.textContent = audio.paused ? '▶' : '❚❚';
    button.setAttribute('aria-label', audio.paused ? 'Play sound' : 'Pause sound');
}

document.addEventListener('click', event => {
    const preview = event.target.closest('[data-media-preview]');
    if (preview) {
        const dialog = document.getElementById('mediaLightbox');
        const image = document.getElementById('mediaLightboxImage');
        const lottieContainer = document.getElementById('mediaLightboxLottie');
        document.getElementById('mediaLightboxError').hidden = true;
        if (activeLottieAnimation) { activeLottieAnimation.destroy(); activeLottieAnimation = null; }
        image.hidden = Boolean(preview.dataset.lottieUrl);
        lottieContainer.hidden = !preview.dataset.lottieUrl;
        if (preview.dataset.lottieUrl && window.lottie) {
            lottieContainer.replaceChildren();
            activeLottieAnimation = window.lottie.loadAnimation({ container: lottieContainer, renderer: 'svg', loop: true, autoplay: true, path: preview.dataset.lottieUrl });
            activeLottieAnimation.addEventListener('data_failed', () => {
                lottieContainer.hidden = true;
                document.getElementById('mediaLightboxError').hidden = false;
            });
        } else {
            image.hidden = false;
            lottieContainer.hidden = true;
            image.src = preview.dataset.mediaPreview;
            image.alt = preview.dataset.mediaName || 'Media preview';
        }
        document.getElementById('mediaLightboxName').textContent = preview.dataset.mediaName || '';
        dialog.showModal();
        return;
    }
    if (event.target.id === 'mediaLightbox') {
        event.target.close();
        return;
    }
    const viewButton = event.target.closest('[data-media-view]');
    if (viewButton) {
        applyMediaView(viewButton.dataset.mediaView, viewButton.dataset.viewMode);
        return;
    }
    const playButton = event.target.closest('.sound-play-toggle');
    if (!playButton) return;
    const audio = playButton.closest('.sound-player')?.querySelector('audio');
    if (!audio) return;
    document.querySelectorAll('.sound-player audio').forEach(other => { if (other !== audio) other.pause(); });
    if (audio.paused) audio.play().catch(() => { }); else audio.pause();
    updateSoundPlayer(audio);
});

document.addEventListener('input', event => {
    if (!event.target.matches('.sound-progress')) return;
    const audio = event.target.closest('.sound-player')?.querySelector('audio');
    if (audio && Number.isFinite(audio.duration)) {
        audio.currentTime = Number(event.target.value) / 100 * audio.duration;
        updateSoundPlayer(audio);
    }
});

for (const audioEvent of ['loadedmetadata', 'timeupdate', 'play', 'pause', 'ended']) {
    document.addEventListener(audioEvent, event => {
        if (event.target.matches('.sound-player audio')) updateSoundPlayer(event.target);
    }, true);
}

document.addEventListener('error', event => {
    if (event.target.matches('.media-thumb')) {
        const button = event.target.closest('.media-preview-button');
        event.target.hidden = true;
        button.disabled = true;
        button.insertAdjacentHTML('beforeend', '<span class="media-preview-error">Preview unavailable</span>');
    } else if (event.target.id === 'mediaLightboxImage') {
        event.target.hidden = true;
        document.getElementById('mediaLightboxError').hidden = false;
    } else if (event.target.matches('.sound-player audio')) {
        const player = event.target.closest('.sound-player');
        player.querySelector('button').disabled = true;
        player.querySelector('.sound-player-time').textContent = 'Unavailable';
    }
}, true);

document.addEventListener('close', event => {
    if (event.target.id === 'mediaLightbox' && activeLottieAnimation) {
        activeLottieAnimation.destroy();
        activeLottieAnimation = null;
    }
}, true);

function renderMediaUsageChart(containerId, rows, emptyMessage) {
    const container = document.getElementById(containerId);
    const values = [...(rows || [])].filter(row => row.uses > 0).sort((a, b) => b.uses - a.uses).slice(0, 10);
    if (!values.length) {
        container.innerHTML = `<div class="empty">${escapeHtml(emptyMessage)}</div>`;
        return;
    }
    const maximum = Math.max(1, ...values.map(row => row.uses));
    container.innerHTML = values.map(row => `
        <div class="category-chart-row" title="${escapeHtml(row.name)}: ${escapeHtml(row.uses)} uses">
            <strong>${escapeHtml(row.name)}</strong>
            <div class="category-chart-track" role="img" aria-label="${escapeHtml(row.name)}: ${escapeHtml(row.uses)} uses">
                <div class="category-chart-fill" style="width:${Math.max(3, row.uses / maximum * 100)}%"></div>
            </div>
            <span class="category-chart-value">${escapeHtml(row.uses)}</span>
        </div>`).join('');
}

async function loadSoundboard() {
    if (!state.guildId) return;
    const range = document.getElementById('mediaRange').value || '30';
    const selection = analyticsDateSelection('mediaRange');
    const rangeLabel = selection.label;
    const data = await api(withGuild(`/api/media?${selection.query}`));
    const soundsById = new Map((data.sounds || []).map(sound => [sound.id, sound.name]));
    const mediaPreview = (url, name, lottieUrl = '') => `<button class="media-preview-button" type="button" data-media-preview="${escapeHtml(url)}" data-media-name="${escapeHtml(name)}"${lottieUrl ? ` data-lottie-url="${escapeHtml(lottieUrl)}"` : ''} aria-label="Enlarge ${escapeHtml(name)}"><img class="media-thumb" src="${escapeHtml(url)}" alt="${escapeHtml(name)}" loading="lazy"></button>`;
    const soundPlayer = url => `<div class="sound-player"><button class="sound-play-toggle" type="button" aria-label="Play sound">▶</button><input class="sound-progress" type="range" min="0" max="100" step="0.1" value="0" aria-label="Sound position"><span class="sound-player-time">0:00 / 0:00</span><audio preload="metadata" src="${escapeHtml(url)}"></audio></div>`;
    const created = value => value ? escapeHtml(formatDateTime(value)) : '<span class="muted">Unknown</span>';
    const capacity = value => `${Number(value?.used) || 0} / ${Number(value?.total) || 0}`;
    const totalMediaUses = (Number(data.summary?.totalPlays) || 0) + (Number(data.mediaUsage?.totalEmojiUses) || 0) + (Number(data.mediaUsage?.totalStickerUses) || 0);
    const rangeMediaUses = (Number(data.summary?.plays) || 0) + (Number(data.mediaUsage?.emojiUses) || 0) + (Number(data.mediaUsage?.stickerUses) || 0);
    const previousMediaUses = (Number(data.summary?.previousPlays) || 0) + (Number(data.mediaUsage?.previousEmojiUses) || 0) + (Number(data.mediaUsage?.previousStickerUses) || 0);
    document.getElementById('soundboardRangeLabel').textContent = rangeLabel;
    document.getElementById('soundboardCards').innerHTML = [
        statCard('Total media uses', totalMediaUses, 'All tracked soundboard plays, custom emoji uses, and sticker uses combined.'),
        statCard(`Media uses · ${rangeLabel}`, rangeMediaUses, 'Tracked soundboard plays, custom emoji uses, and sticker uses inside the selected period.'),
        statCard('Vs previous period', periodComparison(rangeMediaUses, previousMediaUses, range !== 'all'), 'Compares combined media usage with the immediately preceding period of equal length. All time has no comparison.'),
        statCard('Soundboard sounds', data.sounds?.length || 0),
        statCard('Static emoji slots', capacity(data.capacity?.staticEmojis), 'Used versus available static emoji slots for the server’s current boost tier.'),
        statCard('Animated emoji slots', capacity(data.capacity?.animatedEmojis), 'Used versus available animated emoji slots for the server’s current boost tier.'),
        statCard('Sticker slots', capacity(data.capacity?.stickers), 'Used versus available sticker slots for the server’s current boost tier and features.')
    ].join('');
    renderActivityChart('soundboardActivityChart', data.summary?.byDay || [], `No soundboard plays recorded for ${rangeLabel}.`, document.getElementById('mediaGraphType').value, 'Sound plays');
    renderTable(document.getElementById('soundboardTable'), [
        { label: 'Sound', key: 'name', render: r => `<div class="media-name">${r.emojiUrl ? mediaPreview(r.emojiUrl, r.emoji || r.name) : `<span style="font-size:24px">${escapeHtml(r.emoji || '🔊')}</span>`}<strong>${escapeHtml(r.name)}</strong></div>` },
        { label: 'Preview', sortable: false, render: r => soundPlayer(r.url) },
        { label: 'Volume', key: 'volume', render: r => `${Math.round((r.volume ?? 1) * 100)}%` },
        { label: 'Plays', key: 'uses' },
        { label: 'Trend', sortValue: r => r.trend?.percent, render: r => trendHtml(r.trend) },
        { label: 'First used', key: 'firstUsed', render: r => created(r.firstUsed) },
        { label: 'Last used', key: 'lastUsed', render: r => created(r.lastUsed) },
        { label: 'Avg/day', key: 'averagePerDay' },
        { label: 'Creator', key: 'creator', render: r => escapeHtml(r.creator || 'Unknown') },
        { label: 'Created', key: 'createdAt', render: r => created(r.createdAt) }
    ], data.sounds, 'No guild soundboard sounds found.');
    renderTable(document.getElementById('soundboardTopSounds'), [{ label: 'Sound', key: 'soundId', render: r => escapeHtml(soundsById.get(r.soundId) || 'Unknown sound') }, { label: 'Plays', key: 'count' }], data.summary?.topSounds || [], 'No plays recorded yet.');
    renderTable(document.getElementById('soundboardTopChannels'), [{ label: 'Channel', key: 'name', render: r => escapeHtml(r.name) }, { label: 'Plays', key: 'count' }], data.summary?.topChannels || [], 'No plays recorded yet.');
    renderTable(document.getElementById('soundboardTopUsers'), [{ label: 'Member', key: 'label', render: r => withNicknameTitle(r.label, r.nickname) }, { label: 'Plays', key: 'count' }], data.summary?.topUsers || [], 'No plays recorded yet.');
    renderTable(document.getElementById('emojiTable'), [
        { label: 'Emoji', key: 'name', render: r => `<div class="media-name">${mediaPreview(r.url, `:${r.name}:`)}<strong>:${escapeHtml(r.name)}:</strong></div>` },
        { label: 'Type', key: 'animated', render: r => r.animated ? '<span class="badge accent">Animated</span>' : 'Static' },
        { label: 'Uses', key: 'uses' },
        { label: 'Trend', sortValue: r => r.trend?.percent, render: r => trendHtml(r.trend) },
        { label: 'First used', key: 'firstUsed', render: r => created(r.firstUsed) },
        { label: 'Last used', key: 'lastUsed', render: r => created(r.lastUsed) },
        { label: 'Avg/day', key: 'averagePerDay' },
        { label: 'Top members', sortable: false, render: r => topMembersHtml(r.topMembers) },
        { label: 'Creator', key: 'creator', render: r => escapeHtml(r.creator || 'Unknown') },
        { label: 'Created', key: 'createdAt', render: r => created(r.createdAt) }
    ], data.emojis || [], 'No custom emojis found.');
    renderMediaUsageChart('emojiUsageChart', data.emojis, 'No emoji usage recorded yet.');
    renderMediaGallery('emojiGallery', data.emojis, 'emoji', mediaPreview);
    applyMediaView('emoji', mediaViewModes.emoji);
    renderTable(document.getElementById('stickerTable'), [
        { label: 'Sticker', key: 'name', render: r => `<div class="media-name">${mediaPreview(r.previewUrl, r.name, r.lottieUrl)}<strong>${escapeHtml(r.name)}</strong></div>` },
        { label: 'Format', key: 'formatName' },
        { label: 'Related emoji', key: 'tags', render: r => escapeHtml(r.tags || '—') },
        { label: 'Uses', key: 'uses' },
        { label: 'Trend', sortValue: r => r.trend?.percent, render: r => trendHtml(r.trend) },
        { label: 'First used', key: 'firstUsed', render: r => created(r.firstUsed) },
        { label: 'Last used', key: 'lastUsed', render: r => created(r.lastUsed) },
        { label: 'Avg/day', key: 'averagePerDay' },
        { label: 'Top members', sortable: false, render: r => topMembersHtml(r.topMembers) },
        { label: 'Creator', key: 'creator', render: r => escapeHtml(r.creator || 'Unknown') },
        { label: 'Created', key: 'createdAt', render: r => created(r.createdAt) }
    ], data.stickers || [], 'No guild stickers found.');
    renderMediaUsageChart('stickerUsageChart', data.stickers, 'No sticker usage recorded yet.');
    renderMediaGallery('stickerGallery', data.stickers, 'sticker', mediaPreview);
    applyMediaView('sticker', mediaViewModes.sticker);
}

bindAnalyticsDateControls('mediaRange', loadSoundboard);
document.getElementById('mediaGraphType').addEventListener('change', () => {
    loadSoundboard().catch(error => handleUiError(error, () => loadSoundboard().catch(handleUiError)));
});

async function loadDeveloperStats() {
    const data = await api('/api/developer/stats');
    const totals = data.totals || {};
    document.getElementById('developerStatsChecked').textContent = `Updated ${formatDateTime(data.checkedAt)}`;
    document.getElementById('developerStatsCards').innerHTML = [
        ['Installed servers', totals.installedServers || 0], ['Active servers', totals.activeServers || 0],
        ['Members reached', totals.membersReached || 0], ['Commands (30d)', totals.commands30d || 0]
    ].map(([label, value]) => `<article class="card"><span>${escapeHtml(label)}</span><strong>${Number(value).toLocaleString()}</strong></article>`).join('');
    document.getElementById('developerActivitySummary').innerHTML = [
        ['Used this week', totals.recentlyUsedServers || 0], ['Commands (7d)', totals.commands7d || 0],
        ['Disabled servers', totals.disabledServers || 0]
    ].map(([label, value]) => `<article class="card"><span>${escapeHtml(label)}</span><strong>${Number(value).toLocaleString()}</strong></article>`).join('');
    document.getElementById('developerModuleAdoption').innerHTML = operationTable(data.moduleAdoption || [], [
        { label: 'Module', render: row => escapeHtml(managementModuleDefinitions[row.module]?.title || row.module) },
        { label: 'Servers', key: 'servers' }, { label: 'Adoption', render: row => `${Number(row.percentage) || 0}%` }
    ], 'No management modules are enabled yet.');
    document.getElementById('developerServersTable').innerHTML = operationTable(data.servers || [], [
        { label: 'Server', render: row => `<div class="server-stat-name">${row.iconUrl ? `<img src="${escapeHtml(row.iconUrl)}" alt="">` : ''}<div><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.id)}</small></div></div>` },
        { label: 'Status', render: row => `<span class="badge ${row.botEnabled ? 'ok' : 'warn'}">${row.botEnabled ? 'Active' : 'Disabled'}</span>` },
        { label: 'Members', render: row => Number(row.memberCount || 0).toLocaleString() },
        { label: 'Modules', render: row => `${row.enabledModules.length} enabled` },
        { label: 'Commands 7d', key: 'commands7d' }, { label: 'Commands 30d', key: 'commands30d' },
        { label: 'Last activity', render: row => row.lastActivity ? escapeHtml(formatDateTime(row.lastActivity)) : 'No recorded activity' }
    ], 'Flummi is not installed in any servers.');
}

document.getElementById('refreshDeveloperStats').addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    try { await loadDeveloperStats(); } finally { event.currentTarget.disabled = false; }
});

async function loadReliability() {
    if (!state.guildId) return;
    const data = await api(withGuild('/api/reliability'));
    const storage = data.storage || {};
    const ping = data.ping || {};
    const metric = value => Number.isFinite(value) ? `${Math.round(value)}ms` : 'Not measured';
    const megabytes = bytes => `${(Number(bytes || 0) / 1024 / 1024).toFixed(2)} MB`;
    document.getElementById('reliabilityCards').innerHTML = [
        statCard('Guild storage', megabytes(storage.bytes)), statCard('30-day forecast', megabytes(storage.forecast30DaysBytes)),
        statCard('Last backup', data.lastBackup ? formatDateTime(data.lastBackup.createdAt) : 'Never'),
        statCard('Handlers loaded', Object.keys(data.handlerHealth || {}).length),
        statCard('Last /ping → Flummi', metric(ping.latest?.commandLatency), 'Time from Discord creating your developer /ping command until Flummi receives it. This includes Discord routing and the network path to the bot.'),
        statCard('Last bot gateway', metric(ping.latest?.gatewayLatency), 'Gateway is Flummi’s always-open real-time connection to Discord. Lower milliseconds means Discord events reach the bot more quickly.'),
        statCard('Last Discord acknowledgement', metric(ping.latest?.acknowledgementLatency), 'How long Flummi’s first response to Discord took after receiving /ping. This mainly measures the outgoing Discord API acknowledgement.'),
        statCard('Auto bot gateway', metric(ping.system?.gatewayLatency), 'The bot gateway latency measured automatically every 30 seconds. Unlike the last /ping value, this does not need someone to run a command.'),
        statCard('Auto Discord API check', metric(ping.system?.apiLatency), 'Time for a lightweight automated request from the bot server to Discord’s API. It refreshes every 30 seconds.'),
        statCard('Live panel gateway', metric(ping.panelGatewayMs), 'The panel’s own live Discord gateway connection. It is separate from the main bot connection, so a small difference is normal.')
    ].join('');
    const retention = data.retention || { categories: [] };
    document.getElementById('retentionCards').innerHTML = [statCard('Retained storage', megabytes(retention.totalBytes)), statCard('30-day forecast', megabytes(retention.forecast30DaysBytes))].join('');
    renderTable(document.getElementById('retentionTable'), [{ label: 'Category', key: 'name' }, { label: 'Stored', key: 'bytes', render: row => megabytes(row.bytes) }, { label: '30-day forecast', key: 'forecast30DaysBytes', render: row => megabytes(row.forecast30DaysBytes) }], retention.categories, 'No retained data yet.');
    renderTable(document.getElementById('permissionAudit'), [{ label: 'Channel', key: 'name', render: row => `#${escapeHtml(row.name)}` }, { label: 'Type', key: 'type' }, { label: 'Missing permissions', key: 'missing', render: row => escapeHtml(row.missing.join(', ')) }], data.permissionAudit || [], 'No missing permissions found.');
    renderTable(document.getElementById('handlerHealth'), [{ label: 'Handler', key: 'name' }, { label: 'Status', key: 'status', render: r => '<span class="badge on">Loaded</span>' }], Object.entries(data.handlerHealth || {}).map(([name, status]) => ({ name, status })), 'No event handlers found.');
}

document.getElementById('createBackup').addEventListener('click', async () => { try { const result = await api(withGuild('/api/reliability/backup'), { method: 'POST' }); setStatus(document.getElementById('reliabilityStatus'), `Backup created: ${result.backup}`, 'ok'); await loadReliability(); } catch (error) { setStatus(document.getElementById('reliabilityStatus'), error.message, 'error'); } });
document.getElementById('downloadReliabilityExport').addEventListener('click', () => { if (state.guildId) window.location.href = withGuild('/api/backup'); });
document.getElementById('reconcileVoice').addEventListener('click', async () => { try { await api(withGuild('/api/reliability/reconcile-voice'), { method: 'POST' }); setStatus(document.getElementById('reliabilityStatus'), 'Voice sessions reconciled with Discord.', 'ok'); } catch (error) { setStatus(document.getElementById('reliabilityStatus'), error.message, 'error'); } });
document.getElementById('reliabilityRestart').addEventListener('click', async event => {
    if (!await confirmAction({ title: 'Restart Flummi?', message: 'The bot and panel will disconnect briefly while the Discord connections are rebuilt.', confirmLabel: 'Restart Flummi' })) return;
    event.currentTarget.disabled = true;
    try {
        const result = await fileMutation('restart', { confirmation: 'RESTART' });
        setStatus(document.getElementById('reliabilityStatus'), `${result.message} Reconnect in a few seconds.`, 'ok');
    } catch (error) {
        setStatus(document.getElementById('reliabilityStatus'), error.message, 'error');
        event.currentTarget.disabled = false;
    }
});

// ---------- Developer files ----------
const developerFiles = {
    initialized: false,
    directory: '',
    selected: null,
    originalContent: '',
    hash: null,
    git: { status: '', diff: '' },
    writeAccess: { privateConnection: false, recentAuthentication: false, canWrite: false }
};

const fileEditor = document.getElementById('fileEditor');

function fileIsDirty() {
    return Boolean(developerFiles.selected?.editable) && fileEditor.value !== developerFiles.originalContent;
}

function formatFileSize(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function updateFileWriteAccess() {
    const access = developerFiles.writeAccess;
    const banner = document.getElementById('fileManagerAccess');
    const message = document.getElementById('fileManagerAccessMessage');
    const refreshButton = document.getElementById('fileRefreshAuthentication');
    banner.className = 'banner banner-with-action';
    refreshButton.hidden = true;
    if (access.canWrite) {
        banner.classList.add('ok');
        message.textContent = 'Write access active through the private Tailscale/localhost route. Recent Discord authentication expires after 30 minutes.';
    } else if (!access.privateConnection) {
        banner.classList.add('warn');
        message.innerHTML = 'Read-only source access on the public Cloudflare route. Runtime <code>data/</code>, logs, search, and all changes require <code>http://100.111.62.126:3789</code>.';
    } else {
        banner.classList.add('warn');
        message.textContent = 'Private connection confirmed. Refresh your Discord sign-in to enable file changes for 30 minutes.';
        refreshButton.hidden = false;
    }
    for (const id of ['fileNew', 'fileNewFolder', 'fileUploadButton', 'fileRunTests', 'fileRestart']) {
        document.getElementById(id).disabled = !access.canWrite;
    }
    updateFileEditorControls();
}

document.getElementById('fileRefreshAuthentication').addEventListener('click', refreshDiscordSignIn);

function updateFileEditorControls() {
    const selected = developerFiles.selected;
    const editable = Boolean(selected?.editable);
    const canWrite = developerFiles.writeAccess.canWrite;
    fileEditor.disabled = !editable;
    document.getElementById('fileReload').disabled = !editable;
    document.getElementById('filePreviewDiff').disabled = !editable;
    document.getElementById('fileDownload').disabled = !selected;
    document.getElementById('fileRename').disabled = !selected || !canWrite;
    document.getElementById('fileTrash').disabled = !selected || !canWrite;
    document.getElementById('fileSave').disabled = !editable || !canWrite || !fileIsDirty();
    const dirty = document.getElementById('fileDirtyState');
    dirty.textContent = !selected ? 'No file' : fileIsDirty() ? 'Unsaved changes' : editable ? 'Saved snapshot' : 'Binary / read-only';
    dirty.className = `badge ${fileIsDirty() ? 'accent' : ''}`;
}

function syntaxHighlighted(content, relativePath) {
    const extension = String(relativePath || '').split('.').pop().toLowerCase();
    let tokenPattern;
    if (['html', 'svg'].includes(extension)) {
        tokenPattern = /<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g;
    } else {
        tokenPattern = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:async|await|break|case|catch|class|const|continue|default|delete|else|export|extends|false|finally|for|function|if|import|in|instanceof|let|new|null|return|static|switch|throw|true|try|typeof|undefined|var|while|yield)\b|\b\d+(?:\.\d+)?\b/g;
    }
    let output = '';
    let cursor = 0;
    for (const match of content.matchAll(tokenPattern)) {
        output += escapeHtml(content.slice(cursor, match.index));
        const token = match[0];
        let className = 'syntax-keyword';
        if (/^(?:\/\/|\/\*|#|<!--)/.test(token)) className = 'syntax-comment';
        else if (/^["'`]/.test(token)) className = 'syntax-string';
        else if (/^\d/.test(token)) className = 'syntax-number';
        else if (/^</.test(token)) className = 'syntax-tag';
        output += `<span class="${className}">${escapeHtml(token)}</span>`;
        cursor = match.index + token.length;
    }
    return output + escapeHtml(content.slice(cursor));
}

function diffHtml(text) {
    return String(text || '').split('\n').map(line => {
        const className = line.startsWith('+') && !line.startsWith('+++') ? 'added'
            : line.startsWith('-') && !line.startsWith('---') ? 'removed' : '';
        return `<span class="${className}">${escapeHtml(line)}</span>`;
    }).join('\n');
}

function renderFilePreviews() {
    if (!developerFiles.selected?.editable) {
        document.getElementById('fileSyntaxPreview').textContent = developerFiles.selected ? 'Binary files are download-only.' : 'No file selected.';
        document.getElementById('fileDiff').textContent = 'No editable file selected.';
        return;
    }
    document.getElementById('fileSyntaxPreview').innerHTML = syntaxHighlighted(fileEditor.value, developerFiles.selected.path);
    const original = developerFiles.originalContent.split('\n');
    const draft = fileEditor.value.split('\n');
    const draftLines = [];
    const limit = Math.min(500, Math.max(original.length, draft.length));
    for (let index = 0; index < limit; index += 1) {
        if (original[index] === draft[index]) continue;
        if (original[index] !== undefined) draftLines.push(`-${index + 1}: ${original[index]}`);
        if (draft[index] !== undefined) draftLines.push(`+${index + 1}: ${draft[index]}`);
    }
    if (Math.max(original.length, draft.length) > limit) draftLines.push('... draft diff truncated ...');
    const gitDiff = developerFiles.git?.diff || '';
    const content = [
        developerFiles.git?.status ? `Git status: ${developerFiles.git.status}` : 'Git status: clean or unavailable',
        '',
        'Draft versus opened snapshot:',
        draftLines.join('\n') || 'No draft changes.',
        '',
        'Current working tree versus Git:',
        gitDiff || 'No tracked Git diff.'
    ].join('\n');
    document.getElementById('fileDiff').innerHTML = diffHtml(content);
}

async function loadFileDirectory(relativePath = developerFiles.directory) {
    const data = await api(`/api/developer/files/list?path=${encodeURIComponent(relativePath || '')}`);
    const entries = Array.isArray(data?.entries) ? data.entries : [];
    developerFiles.directory = data.path || '';
    developerFiles.writeAccess = data.writeAccess || developerFiles.writeAccess;
    document.getElementById('fileBrowserPath').textContent = `/${developerFiles.directory}`;
    document.getElementById('fileUp').disabled = !developerFiles.directory;
    const container = document.getElementById('fileBrowserList');
    container.innerHTML = entries.length ? entries.map(entry => `
        <button class="file-entry ${developerFiles.selected?.path === entry.path ? 'active' : ''}" type="button"
            data-file-path="${escapeHtml(entry.path)}" data-file-type="${entry.type}" data-file-editable="${entry.editable}" ${entry.privateOnly ? 'data-tailscale-required' : ''}>
            <span>${entry.type === 'directory' ? '📁' : entry.editable ? '📄' : '📦'}</span>
            <span>${escapeHtml(entry.name)}</span>
            <span class="file-entry-meta">${entry.type === 'file' ? escapeHtml(formatFileSize(entry.size)) : ''}</span>
        </button>`).join('') : '<div class="empty">This folder is empty.</div>';
    applyTailscaleAvailability(container);
    container.querySelectorAll('[data-file-path]').forEach(button => button.addEventListener('click', () => {
        if (button.dataset.fileType === 'directory') {
            loadFileDirectory(button.dataset.filePath).catch(error => setStatus(document.getElementById('fileEditorStatus'), error.message, 'error'));
        } else {
            openDeveloperFile(button.dataset.filePath, button.dataset.fileEditable === 'true').catch(error => setStatus(document.getElementById('fileEditorStatus'), error.message, 'error'));
        }
    }));
    updateFileWriteAccess();
}

async function openDeveloperFile(relativePath, editable = true, { confirmDiscard = true } = {}) {
    if (confirmDiscard && fileIsDirty() && !await confirmAction({
        title: 'Discard unsaved changes?',
        message: 'Your current draft has not been saved. Discard it and open the selected file?',
        confirmLabel: 'Discard changes'
    })) return;
    developerFiles.selected = { path: relativePath, editable };
    document.getElementById('fileEditorName').textContent = relativePath.split('/').pop();
    document.getElementById('fileEditorPath').textContent = relativePath;
    document.getElementById('fileEditorStatus').textContent = '';
    if (!editable) {
        developerFiles.originalContent = '';
        developerFiles.hash = null;
        developerFiles.git = { status: '', diff: '' };
        fileEditor.value = '';
        document.getElementById('fileEditorMeta').textContent = 'Binary asset — viewing does not open or lock the file.';
        renderFilePreviews();
        updateFileEditorControls();
        await loadFileDirectory();
        return;
    }
    const data = await api(`/api/developer/files/read?path=${encodeURIComponent(relativePath)}`);
    developerFiles.originalContent = data.content;
    developerFiles.hash = data.hash;
    developerFiles.git = data.git || { status: '', diff: '' };
    fileEditor.value = data.content;
    document.getElementById('fileEditorMeta').textContent = `${formatFileSize(data.size)} · modified ${formatDateTime(data.modifiedAt)} · snapshot ${data.hash.slice(0, 10)}`;
    document.getElementById('fileEditorBadges').innerHTML = data.git?.status ? '<span class="badge accent">Git changes</span>' : '<span class="badge on">Git clean</span>';
    renderFilePreviews();
    updateFileEditorControls();
    await loadFileDirectory();
}

async function loadDeveloperFiles() {
    if (!developerFiles.initialized) {
        developerFiles.initialized = true;
        await loadFileDirectory('');
    } else {
        await loadFileDirectory(developerFiles.directory);
    }
}

async function fileMutation(action, payload) {
    try {
        return await api(`/api/developer/files/${action}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (error) {
        if (error.code === 'REAUTH_REQUIRED') {
            developerFiles.writeAccess.recentAuthentication = false;
            developerFiles.writeAccess.canWrite = false;
            updateFileWriteAccess();
        }
        throw error;
    }
}

fileEditor.addEventListener('input', () => {
    updateFileEditorControls();
    renderFilePreviews();
});
fileEditor.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const start = fileEditor.selectionStart;
    fileEditor.setRangeText('    ', start, fileEditor.selectionEnd, 'end');
    fileEditor.dispatchEvent(new Event('input'));
});
window.addEventListener('beforeunload', event => {
    if (!fileIsDirty()) return;
    event.preventDefault();
    event.returnValue = '';
});

document.getElementById('fileRoot').addEventListener('click', () => loadFileDirectory('').catch(error => setStatus(document.getElementById('fileEditorStatus'), error.message, 'error')));
document.getElementById('fileUp').addEventListener('click', () => {
    const parent = developerFiles.directory.split('/').slice(0, -1).join('/');
    loadFileDirectory(parent).catch(error => setStatus(document.getElementById('fileEditorStatus'), error.message, 'error'));
});
document.getElementById('fileReload').addEventListener('click', async () => {
    if (!developerFiles.selected?.editable) return;
    if (fileIsDirty() && !await confirmAction({
        title: 'Reload the saved version?',
        message: 'Your unsaved draft will be discarded and replaced with the latest version from the server.',
        confirmLabel: 'Discard and reload'
    })) return;
    openDeveloperFile(developerFiles.selected.path, true, { confirmDiscard: false }).catch(error => setStatus(document.getElementById('fileEditorStatus'), error.message, 'error'));
});
document.getElementById('filePreviewDiff').addEventListener('click', () => {
    renderFilePreviews();
    document.getElementById('fileDiffDetails').open = true;
});
document.getElementById('fileDownload').addEventListener('click', () => {
    if (developerFiles.selected) window.location.href = `/api/developer/files/download?path=${encodeURIComponent(developerFiles.selected.path)}`;
});
document.getElementById('fileSave').addEventListener('click', async () => {
    const status = document.getElementById('fileEditorStatus');
    if (!developerFiles.selected?.editable || !fileIsDirty()) return;
    renderFilePreviews();
    document.getElementById('fileDiffDetails').open = true;
    if (!await confirmAction({ title: 'Save repository file?', message: `Save ${developerFiles.selected.path}? A timestamped backup will be created first.`, confirmLabel: 'Save file' })) return;
    const save = async force => fileMutation('save', { path: developerFiles.selected.path, content: fileEditor.value, expectedHash: developerFiles.hash, force });
    try {
        let result;
        try {
            result = await save(false);
        } catch (error) {
            if (error.code !== 'FILE_CHANGED') throw error;
            const overwrite = await confirmAction({ title: 'File changed on the server', message: `${developerFiles.selected.path} changed after you opened it. Overwrite the newer version anyway? Its current content will be backed up.`, confirmLabel: 'Overwrite newer file' });
            if (!overwrite) return;
            result = await save(true);
        }
        developerFiles.originalContent = fileEditor.value;
        developerFiles.hash = result.hash;
        developerFiles.git = result.git || developerFiles.git;
        setStatus(status, `Saved ${result.path}. Backup: ${result.backup || 'not needed'}.`, 'ok');
        updateFileEditorControls();
        renderFilePreviews();
        await loadFileDirectory();
    } catch (error) { setStatus(status, error.message, 'error'); }
});

async function createDeveloperPath(type) {
    const isDirectory = type === 'directory';
    const name = await requestTextInput({
        title: isDirectory ? 'Create a new folder' : 'Create a new file',
        message: developerFiles.directory ? `It will be created inside ${developerFiles.directory}.` : 'It will be created in the repository root.',
        label: isDirectory ? 'Folder name' : 'File name',
        placeholder: isDirectory ? 'example-folder' : 'example.js',
        hint: 'Enter a name only. You can move or rename it afterwards.',
        confirmLabel: isDirectory ? 'Create folder' : 'Create file',
        validate: value => value === '.' || value === '..'
            ? 'Choose a regular name instead of . or ..'
            : /[\\/]/.test(value) ? 'Enter a name without slashes.' : ''
    });
    if (!name) return;
    const relativePath = developerFiles.directory ? `${developerFiles.directory}/${name}` : name;
    try {
        await fileMutation('create', { path: relativePath, type });
        await loadFileDirectory();
        if (type === 'file') await openDeveloperFile(relativePath, true);
    } catch (error) { setStatus(document.getElementById('fileEditorStatus'), error.message, 'error'); }
}
document.getElementById('fileNew').addEventListener('click', () => createDeveloperPath('file'));
document.getElementById('fileNewFolder').addEventListener('click', () => createDeveloperPath('directory'));
document.getElementById('fileRename').addEventListener('click', async () => {
    if (!developerFiles.selected) return;
    const destination = await requestTextInput({
        title: 'Rename or move item',
        message: 'Change the name, or enter another folder to move this item within the repository.',
        label: 'New repository path',
        value: developerFiles.selected.path,
        placeholder: 'folder/example.js',
        hint: 'Use a path relative to the repository root, without a leading slash.',
        confirmLabel: 'Rename item',
        validate: value => value.startsWith('/') || value.startsWith('\\')
            ? 'Use a relative path without a leading slash.'
            : value.includes('\\') ? 'Use forward slashes (/) between folders.' : ''
    });
    if (!destination || destination === developerFiles.selected.path) return;
    try {
        const result = await fileMutation('rename', { path: developerFiles.selected.path, destination });
        developerFiles.selected = null;
        fileEditor.value = '';
        await loadFileDirectory(developerFiles.directory);
        setStatus(document.getElementById('fileEditorStatus'), `Renamed to ${result.path}.`, 'ok');
        updateFileEditorControls();
    } catch (error) { setStatus(document.getElementById('fileEditorStatus'), error.message, 'error'); }
});
document.getElementById('fileTrash').addEventListener('click', async () => {
    if (!developerFiles.selected) return;
    if (!await confirmAction({ title: 'Move to recoverable trash?', message: `${developerFiles.selected.path} will leave the repository but remain recoverable in runtime trash.`, confirmLabel: 'Move to trash' })) return;
    try {
        const result = await fileMutation('trash', { path: developerFiles.selected.path, confirmation: 'TRASH' });
        developerFiles.selected = null;
        developerFiles.originalContent = '';
        fileEditor.value = '';
        setStatus(document.getElementById('fileEditorStatus'), `Moved to ${result.trashPath}.`, 'ok');
        updateFileEditorControls();
        renderFilePreviews();
        await loadFileDirectory();
    } catch (error) { setStatus(document.getElementById('fileEditorStatus'), error.message, 'error'); }
});
document.getElementById('fileUploadButton').addEventListener('click', async () => {
    const input = document.getElementById('fileUpload');
    const file = input.files[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
        setStatus(document.getElementById('fileEditorStatus'), 'Uploads are limited to 8 MB.', 'error');
        return;
    }
    const relativePath = developerFiles.directory ? `${developerFiles.directory}/${file.name}` : file.name;
    const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read the upload.'));
        reader.readAsDataURL(file);
    });
    try {
        await fileMutation('upload', { path: relativePath, base64: String(dataUrl).split(',')[1] || '' });
        input.value = '';
        await loadFileDirectory();
        setStatus(document.getElementById('fileEditorStatus'), `Uploaded ${relativePath}.`, 'ok');
    } catch (error) { setStatus(document.getElementById('fileEditorStatus'), error.message, 'error'); }
});
document.getElementById('fileSearchButton').addEventListener('click', async () => {
    const query = document.getElementById('fileSearch').value.trim();
    if (!query) return;
    try {
        const data = await api(`/api/developer/files/search?q=${encodeURIComponent(query)}`);
        const results = Array.isArray(data?.results) ? data.results : [];
        const container = document.getElementById('fileBrowserList');
        container.innerHTML = results.length ? results.map(result => `<button class="file-entry" type="button" data-search-path="${escapeHtml(result.path)}" data-search-editable="${result.editable}"><span>🔎</span><span>${escapeHtml(result.path)}</span></button>`).join('') : '<div class="empty">No matching files.</div>';
        container.querySelectorAll('[data-search-path]').forEach(button => button.addEventListener('click', () => openDeveloperFile(button.dataset.searchPath, button.dataset.searchEditable === 'true').catch(error => setStatus(document.getElementById('fileEditorStatus'), error.message, 'error'))));
    } catch (error) { setStatus(document.getElementById('fileEditorStatus'), error.message, 'error'); }
});
document.getElementById('fileSearch').addEventListener('keydown', event => { if (event.key === 'Enter') document.getElementById('fileSearchButton').click(); });
document.getElementById('fileRunTests').addEventListener('click', async () => {
    const output = document.getElementById('fileRuntimeOutput');
    output.textContent = 'Running tests...';
    try {
        const result = await fileMutation('test', {});
        output.textContent = result.output || 'Tests passed.';
    } catch (error) { output.textContent = error.data?.output || error.message; }
});
document.getElementById('fileRestart').addEventListener('click', async () => {
    if (!await confirmAction({ title: 'Restart Flummi?', message: 'The bot and panel will disconnect briefly. Unsaved editor text will not be applied.', confirmLabel: 'Restart Flummi' })) return;
    try {
        const result = await fileMutation('restart', { confirmation: 'RESTART' });
        document.getElementById('fileRuntimeOutput').textContent = `${result.message} Reconnect in a few seconds.`;
    } catch (error) { document.getElementById('fileRuntimeOutput').textContent = error.message; }
});

async function readImageUpload(inputId, clearId) {
    if (document.getElementById(clearId).checked) return null;
    const file = document.getElementById(inputId).files[0];
    if (!file) return undefined;
    if (!file.type.startsWith('image/') || file.size > 5 * 1024 * 1024) throw new Error('Choose an image under 5 MB.');
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Could not read image file.'));
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(file);
    });
}

async function loadBotProfiles() {
    const data = await api(withGuild('/api/bot-profile'));
    document.getElementById('appProfileDescription').value = data.application?.description || '';
    document.getElementById('appProfileTags').value = (data.application?.tags || []).join(', ');
    document.getElementById('guildBotNick').value = data.guildProfile?.nick || '';
    document.getElementById('guildBotBio').value = data.guildProfile?.bio || '';
}

function renderReleaseCenterSummary(release = {}) {
    const count = document.getElementById('releaseCenterCommitCount');
    const names = document.getElementById('releaseCenterCommitNames');
    if (!count || !names) return;

    if (!release.available) {
        count.textContent = 'Unavailable';
        count.className = 'badge off';
        names.innerHTML = `<span class="sub">${escapeHtml(release.reason || 'Git comparison is unavailable.')}</span>`;
        return;
    }

    const commits = release.stagedCommits || [];
    const pending = Number(release.pendingCommitCount) || 0;
    count.textContent = `${pending} commit${pending === 1 ? '' : 's'}`;
    count.className = `badge ${pending ? 'accent' : 'on'}`;
    names.innerHTML = commits.length
        ? commits.map(commit => `<div class="release-center-commit"><code title="${escapeHtml(commit.hash)}">${escapeHtml(commit.shortHash)}</code><span title="${escapeHtml(commit.subject || 'Untitled commit')}">${escapeHtml(commit.subject || 'Untitled commit')}</span></div>`).join('')
        : `<span class="sub">${escapeHtml(release.relation === 'behind' ? 'Staging is behind live.' : 'Staging and live match.')}</span>`;
}

async function loadReleaseCenterSummary() {
    try {
        const updateStatus = await api('/api/update-status');
        renderReleaseCenterSummary(updateStatus.release || {});
    } catch (error) {
        renderReleaseCenterSummary({ available: false, reason: error.message });
    }
}

async function loadAi() {
    await populateGuildUserSelects();
    const configData = await api('/api/config'); const ai = configData.ai || {};
    document.getElementById('aiTextModel').value = ai.model || '';
    document.getElementById('aiBaseUrl').value = ai.baseUrl || '';
    document.getElementById('aiVisionModels').value = (ai.visionModels || []).join('\n');
    document.getElementById('aiFallbackModels').value = (ai.fallbackModels || []).join('\n');
    document.getElementById('aiTimeout').value = ai.requestTimeoutMs || '';
    document.getElementById('aiMaxOutput').value = ai.maxOutputTokens || '';
    document.getElementById('aiMaxHistoryTurns').value = ai.maxHistoryTurns || '';
    document.getElementById('aiImageProviders').value = (ai.imageSearch?.providers || []).join('\n');
    const presence = configData.presence || {};
    document.getElementById('presenceStatus').value = presence.status || 'online';
    document.getElementById('presenceActivityType').value = presence.activityType || 'Playing';
    document.getElementById('presenceActivityText').value = presence.activityText || '';
    document.getElementById('presenceActivityEnabled').checked = presence.activityEnabled !== false;
    document.getElementById('deployCommandsOnStart').checked = configData.deployCommandsOnStart !== false;
    document.getElementById('panelEnabledOnStart').checked = configData.panel?.enabledOnStart !== false;
    document.getElementById('panelOpenBrowserOnStart').checked = configData.panel?.openBrowserOnStart === true;
    await loadBotProfiles();
    const health = await api('/api/health');
    document.getElementById('healthCards').innerHTML = [
        statCard('Discord', health.discord),
        statCard('OpenRouter', health.openRouter),
        statCard('Text Models', health.textModels),
        statCard('Vision Models', health.visionModels),
        statCard('Image Search', health.imageSearch)
    ].join('');
    const usage = await api('/api/serper-usage');

    renderTable(document.getElementById('serperUsage'),
        [
            { label: 'Metric', key: 'metric' },
            { label: 'Value', key: 'value' }
        ],
        [
            { metric: 'Total requests', value: usage.requests.total },
            { metric: 'Successful', value: usage.requests.successful },
            { metric: 'Failed', value: usage.requests.failed },
            { metric: 'Last request', value: usage.lastRequestAt ? formatDateTime(usage.lastRequestAt) : 'Never' },
            { metric: 'Last status code', value: usage.lastStatusCode ?? 'N/A' }
        ], 'No usage data yet.');

    const runtime = await api('/api/runtime');
    const updateStatus = await api('/api/update-status');
    const aiHealth = await api('/api/ai-health');
    document.getElementById('aiHealthCards').innerHTML = [statCard('Current model', aiHealth.currentModel || 'Not configured'), statCard('Last reply', aiHealth.lastReply?.latencyMs ? `${aiHealth.lastReply.latencyMs}ms` : 'No data yet'), statCard('Success rate', aiHealth.successRate === null ? 'No data yet' : `${aiHealth.successRate}%`), statCard('Timeouts', aiHealth.timeouts || 0), statCard('Rate limits', aiHealth.rateLimits || 0), statCard('Failures', aiHealth.failures || 0)].join('');
    const release = updateStatus.release || {};
    renderReleaseCenterSummary(release);
    const liveCommitId = updateStatus.lastPromotedShortCommit || release.live?.shortHash || 'Unavailable';
    const liveCommitTimestamp = updateStatus.lastPromotedAt || release.live?.promotedAt;
    document.getElementById('updateStatusCards').innerHTML = [
        statCard('Last update check', updateStatus.lastCheckedAt ? formatDateTime(updateStatus.lastCheckedAt) : 'Never'),
        statCard('Last GitHub pull', updateStatus.lastUpdatedAt ? formatDateTime(updateStatus.lastUpdatedAt) : 'Never'),
        statCard('Staged, not live', release.available ? release.pendingCommitCount : 'Unavailable'),
        statCard('Staging head', release.staging?.shortHash || updateStatus.lastUpdatedCommit || 'Unavailable', release.staging?.hash || ''),
        statCard('Last pushed live', liveCommitId, updateStatus.lastPromotedCommit || release.live?.hash || ''),
        statCard('Live push date', liveCommitTimestamp ? formatDateTime(liveCommitTimestamp) : 'Not recorded yet')
    ].join('');

    const comparisonStatus = document.getElementById('releaseComparisonStatus');
    const comparisonLabels = { 'in-sync': 'Staging and live match', ahead: 'Ready to promote', behind: 'Staging is behind live', diverged: 'History diverged' };
    comparisonStatus.textContent = release.available ? (comparisonLabels[release.relation] || 'Status unknown') : 'Git comparison unavailable';
    comparisonStatus.className = `badge ${release.relation === 'in-sync' ? 'on' : release.relation === 'ahead' ? 'accent' : 'off'}`;
    renderTable(document.getElementById('stagedCommitList'), [
        { label: 'Commit', key: 'shortHash', render: row => `<code title="${escapeHtml(row.hash)}">${escapeHtml(row.shortHash)}</code>` },
        { label: 'Change', key: 'subject' },
        { label: 'Committed', key: 'committedAt', render: row => formatDateTime(row.committedAt) }
    ], release.stagedCommits || [], release.available
        ? release.relation === 'behind'
            ? 'Staging is behind the live checkout; there are no staged commits to promote.'
            : 'Staging and live currently use the same commit.'
        : (release.reason || 'Git comparison is unavailable.'));

    renderTable(document.getElementById('runtimeTable'),
        [
            { label: 'Entry Point', key: 'entry' },
            { label: 'PID', key: 'pid' },
            { label: 'Status', key: 'status', render: r => `<span class="badge ${r.status === 'running' ? 'on' : 'off'}">${escapeHtml(r.status)}</span>` },
            { label: 'Started', key: 'startedAt', render: r => escapeHtml(formatDateTime(r.startedAt)) },
            { label: 'Stopped', key: 'stoppedAt', render: r => escapeHtml(r.stoppedAt ? formatDateTime(r.stoppedAt) : '') }
        ],
        runtime.instances, 'No runtime history recorded yet.', { index: 3, dir: -1 });
    await loadActivity();
}

async function loadActivity() { const data = await api(withGuild('/api/activity')); renderTable(document.getElementById('activityFeed'), [{ label: 'When', key: 'at', render: r => formatDateTime(r.at) }, { label: 'Type', key: 'type' }, { label: 'What happened', key: 'message' }], data.entries, 'No activity recorded yet.'); }
async function loadLogs() { const level = document.getElementById('logLevel').value; const data = await api(`/api/logs?level=${encodeURIComponent(level)}`); renderTable(document.getElementById('logViewer'), [{ label: 'When', key: 'at', render: r => formatDateTime(r.at) }, { label: 'Level', key: 'level' }, { label: 'Message', key: 'message', render: r => escapeHtml(r.message) }], data.logs, 'No runtime logs yet.'); }
document.getElementById('refreshLogs').addEventListener('click', () => loadLogs().catch(error => console.error(error)));
document.getElementById('logLevel').addEventListener('change', () => loadLogs().catch(error => console.error(error)));
document.getElementById('saveAiConfig').addEventListener('click', async () => {
    try { await api('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ai: { model: document.getElementById('aiTextModel').value.trim(), baseUrl: document.getElementById('aiBaseUrl').value.trim(), visionModels: document.getElementById('aiVisionModels').value.split('\n').map(x => x.trim()).filter(Boolean), fallbackModels: document.getElementById('aiFallbackModels').value.split('\n').map(x => x.trim()).filter(Boolean), requestTimeoutMs: Number(document.getElementById('aiTimeout').value), maxOutputTokens: Number(document.getElementById('aiMaxOutput').value), maxHistoryTurns: Number(document.getElementById('aiMaxHistoryTurns').value), imageSearch: { providers: document.getElementById('aiImageProviders').value.split('\n').map(x => x.trim()).filter(Boolean) } } }) }); setStatus(document.getElementById('aiConfigStatus'), 'AI controls saved and will be used for new AI replies.', 'ok'); } catch (error) { setStatus(document.getElementById('aiConfigStatus'), error.message, 'error'); }
});
document.getElementById('savePresenceConfig').addEventListener('click', async () => {
    try {
        await api('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ presence: { status: document.getElementById('presenceStatus').value, activityType: document.getElementById('presenceActivityType').value, activityText: document.getElementById('presenceActivityText').value.trim(), activityEnabled: document.getElementById('presenceActivityEnabled').checked } }) });
        setStatus(document.getElementById('presenceConfigStatus'), 'Presence saved and applied live.', 'ok');
    } catch (error) { setStatus(document.getElementById('presenceConfigStatus'), error.message, 'error'); }
});
document.getElementById('saveStartupConfig').addEventListener('click', async () => {
    try {
        await api('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deployCommandsOnStart: document.getElementById('deployCommandsOnStart').checked, panel: { enabledOnStart: document.getElementById('panelEnabledOnStart').checked, openBrowserOnStart: document.getElementById('panelOpenBrowserOnStart').checked } }) });
        setStatus(document.getElementById('startupConfigStatus'), 'Start-up settings saved for the next restart.', 'ok');
    } catch (error) { setStatus(document.getElementById('startupConfigStatus'), error.message, 'error'); }
});
document.getElementById('saveAppProfile').addEventListener('click', async () => {
    try {
        await api('/api/bot-profile/application', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: document.getElementById('appProfileDescription').value, tags: document.getElementById('appProfileTags').value.split(',').map(tag => tag.trim()).filter(Boolean), icon: await readImageUpload('appProfileIcon', 'clearAppProfileIcon'), coverImage: await readImageUpload('appProfileCover', 'clearAppProfileCover') }) });
        setStatus(document.getElementById('appProfileStatus'), 'Global Discord app profile saved.', 'ok');
        await loadBotProfiles();
    } catch (error) { setStatus(document.getElementById('appProfileStatus'), error.message, 'error'); }
});
document.getElementById('saveGuildBotProfile').addEventListener('click', async () => {
    try {
        if (!state.guildId) throw new Error('Select a server first.');
        await api('/api/bot-profile/guild', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ guildId: state.guildId, nick: document.getElementById('guildBotNick').value, bio: document.getElementById('guildBotBio').value, avatar: await readImageUpload('guildBotAvatar', 'clearGuildBotAvatar'), banner: await readImageUpload('guildBotBanner', 'clearGuildBotBanner') }) });
        setStatus(document.getElementById('guildBotProfileStatus'), 'Selected-server bot profile saved.', 'ok');
        await loadBotProfiles();
    } catch (error) { setStatus(document.getElementById('guildBotProfileStatus'), error.message, 'error'); }
});

async function loadAudit() {
    if (!state.guildId) {
        document.getElementById('auditTable').innerHTML = '<div class="empty">Select a server to view its audit log.</div>';
        return;
    }
    const data = await api(withGuild('/api/audit'));
    renderTable(document.getElementById('auditTable'), [
        { label: 'When', key: 'at', render: row => escapeHtml(formatDateTime(row.at)) },
        { label: 'Who', key: 'actorName', render: row => escapeHtml(row.actorName || row.actorId || 'Unknown') },
        { label: 'Action', key: 'type', render: row => escapeHtml(humanizeAuditType(row.type)) },
        { label: 'Details', key: 'message' },
        { label: 'Changes', key: 'changes', sortable: false, render: row => renderAuditChanges(row.changes) }
    ], data.entries || [], 'No confirmed panel changes have been recorded for this server yet.', { index: 0, dir: -1 });
}

function humanizeAuditType(value) {
    const known = { 'settings-update': 'Server settings updated', 'settings-undo': 'Settings change undone', 'module-test': 'Module configuration tested', 'member-reset': 'Member permissions reset', 'permissions-update': 'Member permissions updated', 'moderation-action': 'Moderation action performed', 'role-menu-publish': 'Role menu published', 'server-snapshot': 'Server snapshot created', 'server-restore': 'Server snapshot restored' };
    if (known[value]) return known[value];
    const text = String(value || 'server action').replace(/[-_.]+/g, ' ');
    return text[0].toUpperCase() + text.slice(1);
}

function formatAuditValue(value) {
    if (value === null || value === undefined || value === '') return 'Not set';
    if (typeof value === 'boolean') return value ? 'Enabled' : 'Disabled';
    if (Array.isArray(value)) return value.length ? value.join(', ') : 'None';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

function friendlyAuditField(change) {
    const value = String(change?.label || change?.field || 'Setting');
    if (!/[._-]/.test(value) && !/[a-z][A-Z]/.test(value)) return value;
    const leaf = value.split('.').pop().replace(/Ids?$/i, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
    return leaf ? leaf[0].toUpperCase() + leaf.slice(1).toLowerCase() : 'Setting';
}

function renderAuditChanges(changes) {
    if (!Array.isArray(changes) || !changes.length) return '<span class="muted">—</span>';
    return `<div class="audit-change-list">${changes.map(change => `<div class="audit-change"><strong>${escapeHtml(friendlyAuditField(change))}</strong><span class="audit-change-values">${escapeHtml(formatAuditValue(change.before))} → ${escapeHtml(formatAuditValue(change.after))}</span></div>`).join('')}</div>`;
}

async function loadExperiments() {
    const data = await api('/api/experiments');
    document.getElementById('experimentAdminView').checked = data.previewAdminView === true;
    document.getElementById('experimentPanelRole').value = data.previewPanelRole || 'admin';
    document.getElementById('experimentPanelRole').disabled = data.previewAdminView !== true;
    document.getElementById('experimentDiscordRole').value = data.discordRole || 'developer';
    document.getElementById('experimentExpiry').textContent = data.expiresAt
        ? `Automatically resets to Developer at ${formatDateTime(data.expiresAt)}.`
        : 'No Discord role simulation is active.';
    await loadOverwatchHistory();
}

function overwatchCountdown(value) {
    if (!value) return 'Not scheduled';
    const milliseconds = new Date(value).getTime() - Date.now();
    if (!Number.isFinite(milliseconds)) return 'Unknown';
    if (milliseconds <= 0) return 'Due now';
    const minutes = Math.floor(milliseconds / 60000);
    const seconds = Math.ceil((milliseconds % 60000) / 1000);
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function overwatchHeroName(key) {
    const special = { dva: 'D.Va', lucio: 'Lúcio', torbjorn: 'Torbjörn', 'soldier-76': 'Soldier: 76' };
    if (special[key]) return special[key];
    return String(key || '').split('-').map(part => part ? `${part[0].toUpperCase()}${part.slice(1)}` : '').join(' ');
}

function renderOverwatchMatch(match) {
    const grouped = match.kind === 'group' || Number(match.games) > 1;
    const result = grouped ? `${Number(match.games) || 0} MATCHES DETECTED` : (match.result || 'UNKNOWN');
    const outcomeParts = [];
    if (Number.isFinite(match.wins)) outcomeParts.push(`${match.wins} win${match.wins === 1 ? '' : 's'}`);
    if (Number.isFinite(match.losses)) outcomeParts.push(`${match.losses} loss${match.losses === 1 ? '' : 'es'}`);
    const heroes = Array.isArray(match.heroes) && match.heroes.length
        ? match.heroes.map(overwatchHeroName).join(', ')
        : 'Unknown';
    const statChanges = Array.isArray(match.statChanges) && match.statChanges.length
        ? `<div class="overwatch-match-detail"><span>Stat changes</span><strong>${match.statChanges.map(change => `+${escapeHtml(change.change)} ${escapeHtml(change.label)}`).join(' • ')}</strong></div>`
        : '';
    const groupedNote = grouped ? '<p class="overwatch-reconstruction-note">Exact individual match order unavailable</p>' : '';
    return `<article class="overwatch-match-card ${escapeHtml(String(match.result || 'unknown').toLowerCase())}">
        <div class="overwatch-match-result"><strong>${escapeHtml(result)}</strong><time title="${escapeHtml(formatDateTime(match.detectedAt))}">${escapeHtml(formatAgo(match.detectedAt))}</time></div>
        ${outcomeParts.length ? `<p class="overwatch-match-outcomes">${escapeHtml(outcomeParts.join(' • '))}</p>` : ''}
        <p class="overwatch-match-mode">${escapeHtml(match.mode || 'Unknown')}</p>
        <div class="overwatch-match-detail"><span>Games change</span><strong>+${escapeHtml(match.games || 0)}</strong></div>
        <div class="overwatch-match-detail"><span>Heroes detected</span><strong>${escapeHtml(heroes)}</strong></div>
        ${statChanges}
        ${groupedNote}
        <p class="overwatch-reconstruction-note">Detected from a career-stat snapshot change</p>
    </article>`;
}

function renderOverwatchHistory(data) {
    const statusLabels = { tracking: 'Tracking', waiting: 'Waiting for baseline', error: 'Error' };
    const status = statusLabels[data.status] || 'Waiting for baseline';
    const badge = document.getElementById('overwatchTrackingStatus');
    document.getElementById('overwatchPlayerId').textContent = data.playerId || '';
    badge.textContent = status;
    badge.className = `overwatch-status ${escapeHtml(data.status || 'waiting')}`;
    document.getElementById('overwatchHistoryStats').innerHTML = [
        statCard('Status', status),
        statCard('Last checked', formatAgo(data.lastCheckedAt)),
        statCard('Last stats change', formatAgo(data.lastUpdatedAt)),
        statCard('Next automatic check', overwatchCountdown(data.nextAutomaticCheckAt))
    ].join('');

    document.getElementById('overwatchBaselineNote').textContent = data.trackingStartedAt
        ? `Tracking started ${formatDateTime(data.trackingStartedAt)}. Matches before this point are unavailable.`
        : 'The first successful lookup creates a baseline; existing career totals will not become fake matches.';
    setStatus(document.getElementById('overwatchHistoryError'), data.error || '', data.error ? 'error' : '');
    const candidates = Array.isArray(data.candidates) ? data.candidates : [];
    document.getElementById('overwatchCandidates').innerHTML = candidates.map((candidate, index) => `<article class="overwatch-match-card"><div class="overwatch-match-result"><strong>Candidate ${index + 1}: ${escapeHtml(candidate.name)}</strong><span>${escapeHtml(candidate.platform || 'unknown')}</span></div>${candidate.namecard ? `<img src="${escapeHtml(candidate.namecard)}" alt="" style="width:100%;max-height:110px;object-fit:cover;border-radius:8px">` : ''}<div class="row">${candidate.avatar ? `<img src="${escapeHtml(candidate.avatar)}" alt="" style="width:48px;height:48px;border-radius:50%">` : ''}<div><div>${escapeHtml(candidate.title || 'No player title')}</div><small>Endorsement ${escapeHtml(candidate.endorsementLevel ?? '?')} • ${escapeHtml(formatDateTime(candidate.lastUpdatedAt))}</small></div></div><code>${escapeHtml(candidate.playerId)}</code></article>`).join('');
    const matches = Array.isArray(data.matches) ? data.matches.slice(0, 3) : [];
    document.getElementById('overwatchMatches').innerHTML = matches.length
        ? matches.map(renderOverwatchMatch).join('')
        : '<div class="empty">No matches detected since tracking started.</div>';
    const refreshButton = document.getElementById('refreshOverwatchHistory');
    refreshButton.disabled = data.refreshing === true;
    refreshButton.textContent = data.refreshing ? 'Refreshing...' : 'Refresh now';
}

async function loadOverwatchHistory() {
    try {
        const data = await api('/api/experiments/overwatch-history');
        renderOverwatchHistory(data);
    } catch (error) {
        setStatus(document.getElementById('overwatchHistoryError'), `Overwatch tracker unavailable: ${error.message}`, 'error');
    }
}

document.getElementById('refreshOverwatchHistory').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Refreshing...';
    try {
        const data = await api('/api/experiments/overwatch-history/refresh', { method: 'POST' });
        renderOverwatchHistory(data);
    } catch (error) {
        if (error.data?.account) renderOverwatchHistory(error.data);
        setStatus(document.getElementById('overwatchHistoryError'), error.status === 429
            ? `Refresh is rate-limited. Try again ${overwatchCountdown(error.data?.retryAt)}.`
            : error.message, 'error');
        button.disabled = false;
        button.textContent = 'Refresh now';
    }
});

document.getElementById('saveGlobalModuleSwitches').addEventListener('click', async () => {
    const status = document.getElementById('globalModuleSwitchStatus');
    const disabledModules = [...document.querySelectorAll('[data-global-module]:checked')].map(input => input.dataset.globalModule);
    if (!await confirmAction({ title: 'Save temporary module switches?', message: `${disabledModules.length} module(s) will be disabled platform-wide.`, confirmLabel: 'Save switches' })) return;
    try {
        await api('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ features: { disabledModules } }) });
        setStatus(status, 'Temporary module switches saved.', 'ok');
    } catch (error) { setStatus(status, error.message, 'error'); }
});

window.setInterval(() => {
    if (state.actualRole === 'developer' && isDashboardVisible() && activeTab() === 'experiments' && document.visibilityState === 'visible') {
        loadOverwatchHistory();
    }
}, 30 * 1000);

document.getElementById('saveExperiments').addEventListener('click', async () => {
    const previewAdminView = document.getElementById('experimentAdminView').checked;
    const previewPanelRole = document.getElementById('experimentPanelRole').value;
    const discordRole = document.getElementById('experimentDiscordRole').value;
    const confirmed = await confirmAction({
        title: 'Apply developer experiment?',
        message: `Panel view: ${previewAdminView ? previewPanelRole : 'developer'}. Discord bot role: ${discordRole}. The Discord simulation affects your real bot interactions until reset or expiry.`,
        confirmLabel: 'Apply experiment'
    });
    if (!confirmed) return;
    const status = document.getElementById('experimentsStatus');
    try {
        await api('/api/experiments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ previewAdminView, previewPanelRole, discordRole })
        });
        setStatus(status, 'Experiment applied.', 'ok');
        await loadPanelAccount();
        await loadGuilds();
        await loadExperiments();
    } catch (error) {
        setStatus(status, error.message, 'error');
    }
});

document.getElementById('experimentAdminView').addEventListener('change', event => {
    document.getElementById('experimentPanelRole').disabled = !event.target.checked;
});

let feedbackCooldownTimer = null;

function formatFeedbackWait(totalSeconds) {
    const seconds = Math.max(0, Math.ceil(totalSeconds));
    if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return remainder ? `${minutes}:${String(remainder).padStart(2, '0')}` : `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

function startFeedbackCooldown(seconds, { message, type = 'ok', readyMessage = 'You can send feedback again.' }) {
    const button = document.getElementById('submitHomeFeedback');
    const status = document.getElementById('homeFeedbackStatus');
    const endsAt = Date.now() + Math.max(1, Number(seconds) || 1) * 1000;
    clearInterval(feedbackCooldownTimer);

    const update = () => {
        const remaining = Math.ceil((endsAt - Date.now()) / 1000);
        if (remaining <= 0) {
            clearInterval(feedbackCooldownTimer);
            feedbackCooldownTimer = null;
            button.disabled = false;
            setStatus(status, readyMessage, 'ok');
            return;
        }
        button.disabled = true;
        setStatus(status, `${message} ${formatFeedbackWait(remaining)}.`, type);
    };

    update();
    feedbackCooldownTimer = window.setInterval(update, 1000);
}

document.getElementById('submitHomeFeedback').addEventListener('click', async () => {
    const field = document.getElementById('homeFeedbackMessage');
    const status = document.getElementById('homeFeedbackStatus');
    const button = document.getElementById('submitHomeFeedback');
    if (button.disabled) return;
    button.disabled = true;
    try {
        const result = await api('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: field.value }) });
        field.value = '';
        const remaining = Number(result.rateLimit?.remainingThisHour);
        startFeedbackCooldown(result.rateLimit?.cooldownSeconds || 60, {
            message: `Thanks — your feedback was sent.${Number.isFinite(remaining) ? ` ${remaining} of 5 messages remaining this hour.` : ''} You can send another in`,
            readyMessage: Number.isFinite(remaining) ? `Ready for another message. ${remaining} of 5 messages remaining this hour.` : 'You can send feedback again.'
        });
    } catch (error) {
        if (error?.code === 'FEEDBACK_RATE_LIMITED') {
            startFeedbackCooldown(error.data?.retryAfterSeconds || 60, {
                message: 'Feedback is rate limited. Try again in',
                type: 'error',
                readyMessage: 'You can try sending feedback again.'
            });
        } else {
            button.disabled = false;
            setStatus(status, error.message, 'error');
        }
    }
});

let supportCooldownTimer = null;
document.getElementById('submitHomeSupport').addEventListener('click', async () => {
    const field = document.getElementById('homeSupportMessage');
    const status = document.getElementById('homeSupportStatus');
    const button = document.getElementById('submitHomeSupport');
    if (button.disabled) return;
    button.disabled = true;
    try {
        const result = await api('/api/support', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: field.value }) });
        field.value = '';
        const seconds = result.rateLimit?.cooldownSeconds || 60;
        const endsAt = Date.now() + seconds * 1000;
        clearInterval(supportCooldownTimer);
        const update = () => {
            const remaining = Math.ceil((endsAt - Date.now()) / 1000);
            if (remaining <= 0) {
                clearInterval(supportCooldownTimer);
                supportCooldownTimer = null;
                button.disabled = false;
                setStatus(status, 'You can send another support message.', 'ok');
                return;
            }
            button.disabled = true;
            setStatus(status, `Your support message was sent. You can send another in ${formatFeedbackWait(remaining)}.`, 'ok');
        };
        update();
        supportCooldownTimer = window.setInterval(update, 1000);
    } catch (error) {
        button.disabled = false;
        setStatus(status, error.message, 'error');
    }
});

async function loadMailCollection() {
    const container = document.getElementById('mailCollection');
    try {
        const data = await api('/api/feedback');
        const rows = data.feedback || [];
        container.innerHTML = rows.map(row => {
            const messages = Array.isArray(row.messages) ? row.messages : [{ direction: 'in', content: row.message, at: row.createdAt }];
            return `<article class="mail-thread"><header><span class="badge accent">${escapeHtml(row.type || 'feedback')}</span><strong>${escapeHtml(row.username)}</strong><span class="sub">${formatDateTime(row.updatedAt || row.createdAt)}</span></header><div class="mail-messages">${messages.map(entry => `<p class="mail-message ${entry.direction === 'out' ? 'out' : 'in'}"><span>${entry.direction === 'out' ? 'Flummi' : escapeHtml(row.username)}</span>${escapeHtml(entry.content)}</p>`).join('')}</div><label for="mail-reply-${escapeHtml(row.id)}">Reply by Discord DM</label><textarea id="mail-reply-${escapeHtml(row.id)}" data-mail-reply-field="${escapeHtml(row.id)}" maxlength="2000" placeholder="Write a reply..."></textarea><div class="actions"><button class="primary" type="button" data-mail-reply="${escapeHtml(row.id)}">Send DM</button><button class="danger" type="button" data-feedback-delete="${escapeHtml(row.id)}">Delete</button></div></article>`;
        }).join('') || '<div class="empty">No support or feedback mail yet.</div>';
    } catch (error) { container.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`; }
}

document.getElementById('loadMailCollection').addEventListener('click', () => loadMailCollection());
document.getElementById('mailCollection').addEventListener('click', async event => {
    const replyButton = event.target.closest('[data-mail-reply]');
    if (replyButton) {
        const id = replyButton.dataset.mailReply;
        const field = document.querySelector(`[data-mail-reply-field="${CSS.escape(id)}"]`);
        const status = document.getElementById('mailCollectionStatus');
        replyButton.disabled = true;
        try {
            await api('/api/mail/reply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, message: field.value }) });
            setStatus(status, 'Reply delivered by Discord DM.', 'ok');
            await loadMailCollection();
        } catch (error) {
            replyButton.disabled = false;
            setStatus(status, error.message, 'error');
        }
        return;
    }
    const button = event.target.closest('[data-feedback-delete]');
    if (!button) return;
    const feedbackId = button.dataset.feedbackDelete;
    const confirmed = await confirmAction({
        title: 'Delete this feedback?',
        message: 'This permanently removes the feedback message from the inbox.',
        confirmLabel: 'Delete feedback'
    });
    if (!confirmed) return;

    const status = document.getElementById('mailCollectionStatus');
    button.disabled = true;
    try {
        await api(`/api/feedback?id=${encodeURIComponent(feedbackId)}`, { method: 'DELETE' });
        setStatus(status, 'Feedback deleted.', 'ok');
        await loadMailCollection();
    } catch (error) {
        button.disabled = false;
        setStatus(status, error.message, 'error');
    }
});

document.getElementById('promoteLiveRelease').addEventListener('click', async () => {
    const status = document.getElementById('releaseStatus');
    if (!await confirmAction({ title: 'Promote tested release?', message: 'This copies the Tailscale staging release to production and restarts the live Flummi service.', confirmLabel: 'Promote to live' })) return;
    try {
        const result = await api('/api/release/promote', { method: 'POST' });
        setStatus(status, result.message || 'Promotion started.', 'ok');
    } catch (error) { setStatus(status, error.message, 'error'); }
});

async function logoutToHome() {
    await fetch('/auth/logout', { method: 'POST' });
    window.location.assign('/');
}
document.querySelectorAll('[data-account-logout]').forEach(button => button.addEventListener('click', logoutToHome));
document.querySelectorAll('[data-account-destination]').forEach(button => button.addEventListener('click', () => {
    button.closest('.account-menu')?.removeAttribute('open');
    openAccountArea(button.dataset.accountDestination).catch(handleUiError);
}));
document.querySelectorAll('[data-account-tab]').forEach(button => button.addEventListener('click', () => {
    openAccountArea(button.dataset.accountTab).catch(handleUiError);
}));
document.addEventListener('click', event => {
    for (const menu of document.querySelectorAll('.account-menu[open]')) {
        if (!menu.contains(event.target)) menu.removeAttribute('open');
    }
});
document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    for (const menu of document.querySelectorAll('.account-menu[open]')) menu.removeAttribute('open');
});

document.getElementById('saveOpenRouterAgreement').addEventListener('click', async () => {
    const statusElement = document.getElementById('openRouterAgreementStatusText');
    const status = document.getElementById('openRouterAgreementStatus').value;
    const effectiveAt = document.getElementById('openRouterAgreementEffective').value;
    const reference = document.getElementById('openRouterAgreementReference').value.trim();
    if (status !== 'pending' && !effectiveAt) {
        setStatus(statusElement, 'An effective date is required after the terms or DPA have been reviewed.', 'error');
        return;
    }
    const confirmation = await requestTextInput({
        title: 'Record provider review?',
        message: 'Only confirm after you completed the selected OpenRouter agreement step outside Flummi and verified the downstream provider privacy settings.',
        label: 'Type CONFIRM PROVIDER REVIEW',
        placeholder: 'CONFIRM PROVIDER REVIEW',
        confirmLabel: 'Record review',
        validate: value => value === 'CONFIRM PROVIDER REVIEW' ? null : 'The confirmation text does not match.'
    });
    if (!confirmation) return;
    try {
        const data = await api('/api/developer/compliance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status, effectiveAt, reference, confirmation })
        });
        renderComplianceOperations(data);
        setStatus(statusElement, 'Provider review record saved.', 'ok');
    } catch (error) { setStatus(statusElement, error.message, 'error'); }
});

// ---------- Analytics corrections ----------
let analyticsCorrectionPreview = null;

function localDateTimeInputValue(value) {
    const date = new Date(value);
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function initializeAnalyticsCorrectionRange() {
    const from = document.getElementById('analyticsCorrectionFrom');
    const to = document.getElementById('analyticsCorrectionTo');
    if (!to.value) to.value = localDateTimeInputValue(Date.now());
    if (!from.value) from.value = localDateTimeInputValue(Date.now() - 7 * 86400000);
}

initializeAnalyticsCorrectionRange();

function analyticsCorrectionPayload() {
    const fromValue = document.getElementById('analyticsCorrectionFrom').value;
    const toValue = document.getElementById('analyticsCorrectionTo').value;
    const reason = document.getElementById('analyticsCorrectionReason').value.trim();
    if (!fromValue || !toValue) throw new Error('Choose both a start and end time.');
    if (!reason) throw new Error('An audit reason is required.');
    if (new Date(fromValue).getTime() > new Date(toValue).getTime()) throw new Error('The start time must be before the end time.');
    const payload = {
        category: document.getElementById('analyticsCorrectionCategory').value,
        from: new Date(fromValue).toISOString(),
        to: new Date(toValue).toISOString(),
        userId: document.getElementById('analyticsCorrectionUser').value.trim(),
        channelId: document.getElementById('analyticsCorrectionChannel').value.trim(),
        includeAnonymous: document.getElementById('analyticsCorrectionAnonymous').checked,
        reason
    };
    if (payload.includeAnonymous && (payload.userId || payload.channelId)) throw new Error('Anonymous history can only be removed for complete server-wide UTC days; clear the member and channel filters.');
    return payload;
}

function renderAnalyticsCorrectionPreview(result) {
    const files = result.raw?.files || [];
    const days = result.anonymous?.dates || [];
    document.getElementById('analyticsCorrectionPreview').innerHTML = `<table><thead><tr><th>Source</th><th>Matches</th></tr></thead><tbody>
        ${files.map(row => `<tr><td>${escapeHtml(row.file)}</td><td>${Number(row.records) || 0} raw records</td></tr>`).join('')}
        ${days.map(date => `<tr><td>Anonymous UTC day ${escapeHtml(date)}</td><td>Complete daily bucket</td></tr>`).join('')}
        ${!files.length && !days.length ? '<tr><td colspan="2">No matching analytics data.</td></tr>' : ''}
    </tbody></table>`;
}

document.getElementById('developerAnalyticsCorrection').addEventListener('input', () => {
    analyticsCorrectionPreview = null;
    document.getElementById('deleteAnalyticsCorrection').disabled = true;
});

document.getElementById('previewAnalyticsCorrection').addEventListener('click', async () => {
    const status = document.getElementById('analyticsCorrectionStatus');
    try {
        const payload = analyticsCorrectionPayload();
        const result = await api(withGuild('/api/developer/analytics-correction'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, action: 'preview' }) });
        analyticsCorrectionPreview = { payload, result };
        renderAnalyticsCorrectionPreview(result);
        const total = Number(result.raw?.matched) + Number(result.anonymous?.matchedDays);
        document.getElementById('deleteAnalyticsCorrection').disabled = total === 0;
        setStatus(status, total ? `Preview ready: ${result.raw.matched} raw record(s), ${result.anonymous.matchedDays} anonymous day(s).` : 'No matching data found.', total ? 'ok' : '');
    } catch (error) { setStatus(status, error.message, 'error'); }
});

document.getElementById('deleteAnalyticsCorrection').addEventListener('click', async () => {
    if (!analyticsCorrectionPreview) return;
    const confirmation = await requestTextInput({
        title: 'Delete false analytics?',
        message: 'This permanently changes the selected server visualizations and totals.',
        label: 'Type DELETE FALSE ANALYTICS',
        placeholder: 'DELETE FALSE ANALYTICS',
        confirmLabel: 'Delete analytics',
        validate: value => value === 'DELETE FALSE ANALYTICS' ? null : 'The confirmation text does not match.'
    });
    if (!confirmation) return;
    const status = document.getElementById('analyticsCorrectionStatus');
    try {
        const result = await api(withGuild('/api/developer/analytics-correction'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...analyticsCorrectionPreview.payload, action: 'delete', confirmation }) });
        renderAnalyticsCorrectionPreview(result);
        analyticsCorrectionPreview = null;
        document.getElementById('deleteAnalyticsCorrection').disabled = true;
        setStatus(status, `Removed ${result.raw.matched} raw record(s) and ${result.anonymous.matchedDays} anonymous day(s).`, 'ok');
    } catch (error) { setStatus(status, error.message, 'error'); }
});

// ---------- Init ----------
const commandPalette = document.getElementById('commandPalette');
const commandPaletteSearch = document.getElementById('commandPaletteSearch');
const commandPaletteResults = document.getElementById('commandPaletteResults');
let commandPaletteEntries = [];
let commandPaletteVisibleEntries = [];
let commandPaletteIndex = 0;

function buildCommandPaletteEntries() {
    const entries = [];
    const seen = new Set();
    const add = entry => { const key = entry.id || `${entry.type}:${entry.label}`; if (!seen.has(key)) { seen.add(key); entries.push(entry); } };
    const pageLabels = { servers: 'Home', account: 'Profile & account', commands: 'Commands', status: 'Status', support: 'Support', feedback: 'Feedback', terms: 'Terms of Service', privacy: 'Privacy Policy', licenses: 'Licenses', archive: 'Policy Archive', credits: 'Acknowledgements', developer: 'Developer Tools' };
    for (const button of document.querySelectorAll('[data-home-view]')) {
        const view = button.dataset.homeView;
        const label = pageLabels[view] || button.querySelector('strong')?.textContent.trim() || button.textContent.trim();
        if (label && view) add({ id: `page:${view}`, type: 'Page', label, detail: 'Flummi website', action: () => showHomeView(view) });
    }
    if (!document.getElementById('dashboardLayout').hidden) {
        for (const button of tabButtons.filter(item => !item.hidden)) {
            const label = button.textContent.trim().replace(/\s+/g, ' ');
            if (label) add({ type: 'Dashboard', label, detail: 'Open dashboard section', action: () => button.click() });
        }
        for (const [key, definition] of Object.entries(managementModuleDefinitions)) if (state.management?.modules?.[key]) add({ type: 'Module', label: definition.title, detail: definition.description, action: () => document.querySelector(`.tab-btn[data-tab="${definition.tab}"]`)?.click() });
        for (const [userId, member] of state.guildMembers) {
            const label = member.nickname || member.displayName || member.username;
            if (label) add({ type: 'Member', label, detail: member.username ? `@${member.username}` : 'Server member', action: () => { document.querySelector('.tab-btn[data-tab="users"]')?.click(); window.setTimeout(() => { document.getElementById('memberPermissionsSection').hidden = false; loadPermissionsEditor(userId).catch(handleUiError); }, 250); } });
        }
    }
    for (const command of state.publicCommands) add({ type: 'Command', label: command.path, detail: command.description, action: () => { showHomeView('commands'); const search = document.getElementById('homeCommandSearch'); search.value = command.path; renderPublicCommands(command.path); } });
    return entries;
}

function renderCommandPalette(query = '') {
    const normalized = String(query).trim().toLowerCase();
    commandPaletteVisibleEntries = commandPaletteEntries.filter(entry => !normalized || `${entry.label} ${entry.detail} ${entry.type}`.toLowerCase().includes(normalized)).slice(0, 12);
    commandPaletteIndex = Math.min(commandPaletteIndex, Math.max(0, commandPaletteVisibleEntries.length - 1));
    commandPaletteResults.innerHTML = commandPaletteVisibleEntries.length ? commandPaletteVisibleEntries.map((entry, index) => `<button type="button" role="option" data-palette-index="${index}" aria-selected="${index === commandPaletteIndex}"><span><small>${escapeHtml(entry.type)}</small><strong>${escapeHtml(entry.label)}</strong><em>${escapeHtml(entry.detail || '')}</em></span><kbd>↵</kbd></button>`).join('') : '<div class="empty">No matching page, module, member, or command.</div>';
}

async function openCommandPalette() {
    if (!state.publicCommands.length) { try { state.publicCommands = (await api('/api/public/commands')).commands || []; } catch { /* navigation still works */ } }
    commandPaletteEntries = buildCommandPaletteEntries(); commandPaletteIndex = 0; commandPaletteSearch.value = ''; renderCommandPalette();
    commandPalette.showModal(); commandPaletteSearch.focus();
}

function activateCommandPaletteEntry(index = commandPaletteIndex) {
    const entry = commandPaletteVisibleEntries[index]; if (!entry) return;
    commandPalette.close(); entry.action();
}

document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openCommandPalette().catch(handleUiError); return; }
    if (!commandPalette.open) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); commandPaletteIndex = (commandPaletteIndex + (event.key === 'ArrowDown' ? 1 : -1) + commandPaletteVisibleEntries.length) % Math.max(1, commandPaletteVisibleEntries.length); renderCommandPalette(commandPaletteSearch.value); }
    if (event.key === 'Enter') { event.preventDefault(); activateCommandPaletteEntry(); }
});
document.querySelectorAll('[data-open-command-palette]').forEach(button => button.addEventListener('click', () => openCommandPalette().catch(handleUiError)));
commandPaletteSearch.addEventListener('input', () => { commandPaletteIndex = 0; renderCommandPalette(commandPaletteSearch.value); });
commandPaletteResults.addEventListener('click', event => { const button = event.target.closest('[data-palette-index]'); if (button) activateCommandPaletteEntry(Number(button.dataset.paletteIndex)); });
commandPalette.addEventListener('click', event => { if (event.target === commandPalette) commandPalette.close(); });

const rememberedTab = localStorage.getItem('flummi.activeTab');
const rememberedButton = tabButtons.find(button => button.dataset.tab === rememberedTab);
if (rememberedButton) {
    tabButtons.forEach(button => button.classList.toggle('active', button === rememberedButton));
    tabPanels.forEach(panel => panel.classList.toggle('active', panel.id === `tab-${rememberedTab}`));
}

async function initializePanel() {
    const reauthReturn = sessionStorage.getItem(reauthReturnKey);
    sessionStorage.removeItem(reauthReturnKey);
    if (reauthReturn?.startsWith('/?') && window.location.pathname === '/' && !window.location.search) {
        history.replaceState(null, '', reauthReturn);
    }
    const requestedParams = new URLSearchParams(window.location.search);
    const pathViews = Object.fromEntries(Object.entries(homeViewPaths).map(([view, route]) => [route, view]));
    const requestedView = pathViews[window.location.pathname] || requestedParams.get('view');
    const publicViews = new Set(homeViewNames.filter(view => view !== 'account'));
    const initialView = publicViews.has(requestedView) ? requestedView : 'servers';
    loadInviteLink().catch(error => console.error(error));
    const authenticated = await loadPanelAccount();
    showHomeView(initialView);
    if (!authenticated) return;
    try { applyAccountPreferences((await api('/api/account/preferences')).preferences); } catch (error) { console.error(error); }
    const data = await api('/api/guilds');
    renderHomeGuilds(data.guilds || []);
    const requestedGuild = requestedParams.get('guildId');
    const requestedTab = requestedParams.get('tab');
    const requestedAccount = requestedParams.get('account');
    if (requestedGuild && state.guilds.some(guild => guild.id === requestedGuild)) {
        await openDashboard(requestedGuild, requestedTab);
    } else if (requestedView === 'account') {
        await openAccountArea(requestedParams.get('tab') || 'profile');
    } else if (requestedAccount === 'profile' || requestedAccount === 'notifications') {
        await openAccountArea(requestedAccount === 'notifications' ? 'notifications' : 'account-profile');
    } else if (requestedView === 'developer' && state.actualRole === 'developer') {
        showHomeView(requestedView, requestedParams.get('tool'));
    }
}

initializePanel().catch(error => handleUiError(error, () => initializePanel().catch(handleUiError)));
