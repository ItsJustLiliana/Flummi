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
    guildRoles: new Map()
};

const guildSelect = document.getElementById('guild');
const tableStates = new WeakMap();

function uiText(source) {
    return window.FlummiI18n?.t(String(source)) || String(source);
}

function uiValue(source) {
    return window.FlummiI18n?.tExact(String(source)) || String(source);
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

    if (diffMs < 0) {
        return 'Just now';
    }

    const totalSeconds = Math.floor(diffMs / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    if (days > 0) {
        return `${days}d ${hours}h ago`;
    }

    if (hours > 0) {
        return `${hours}h ${minutes}m ago`;
    }

    if (minutes > 0) {
        return `${minutes}m ago`;
    }

    return 'Just now';
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

    return date.toLocaleString(undefined, {
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
    guildFeatureShots: 'Enables the server shot counter, leaderboard and related commands.',
    featureTriggers: 'Global master switch for text triggers across every server.',
    featureAiConversations: 'Global master switch for AI conversations across every server.',
    featureAiAttachments: 'Global master switch for AI attachment analysis across every server.',
    featureAiImageSearch: 'Global master switch for AI image search across every server.',
    featurePingResponses: 'Global master switch for bot mention and ping responses across every server.',
    featurePingSave: 'Global master switch for saving ping requests across every server.',
    featureShots: 'Global master switch for the shot system across every server.'
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
const defaultTabLabels = Object.fromEntries(tabButtons.map(button => [button.dataset.tab, button.textContent.trim()]));
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
    messenger: loadMessengerChannels,
    triggers: loadTriggers,
    shots: loadShots,
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
    btn.addEventListener('click', () => {
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
    return active ? active.dataset.tab : 'overview';
}

async function refreshActiveTab() {
    const loader = tabLoaders[activeTab()];
    if (loader) {
        await loader();
        updateLiveDurations();
    }
}

// Server tabs stay in the dashboard sidebar. Developer tools have their own top-level workspace.
const defaultDeveloperTabOrder = ['global', 'messenger', 'profiles', 'ai', 'adoption', 'reliability', 'logs', 'files', 'experiments'];
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
    shots: 'shots drinks counter leaderboard gamble',
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
    applyAccessVisibility();
    document.getElementById('homeSignedOut').hidden = true;
    document.getElementById('homeSignedIn').hidden = false;
    document.getElementById('homeAvatar').src = data.user.avatarUrl;
    document.getElementById('homeUsername').textContent = data.user.username;
    document.getElementById('homeFeedbackNav').hidden = false;
    document.getElementById('feedbackSignedOut').hidden = true;
    document.getElementById('feedbackSignedIn').hidden = false;
    document.getElementById('homeDeveloperNav').hidden = state.actualRole !== 'developer';
    document.getElementById('homeLoginCta').hidden = true;
    applyTailscaleAvailability();
    return true;
}

const globalFeatureTabs = {
    triggers: 'triggersEnabled',
    shots: 'shotsEnabled',
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
    const developerTabs = ['messenger', 'profiles', 'ai', 'global', 'reliability', 'adoption', 'files', 'logs'];
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

document.getElementById('logoutPanel').addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST' });
    window.location.assign('/');
});

document.getElementById('refreshDiscordAccess').addEventListener('click', () => {
    refreshDiscordSignIn();
});

function applyTabNames(names) {
    for (const button of tabButtons) {
        const name = typeof names?.[button.dataset.tab] === 'string' ? names[button.dataset.tab].trim() : '';
        button.textContent = name || defaultTabLabels[button.dataset.tab];
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
    commands: 'Commands - Flummi',
    status: 'Status - Flummi',
    feedback: 'Feedback - Flummi',
    developer: 'Developer Tools - Flummi'
};

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
            <article class="public-command-row"><code>${escapeHtml(row.path)}</code><p>${escapeHtml(row.description)}${row.restricted ? ' · Selected servers only' : ''}</p><span class="command-role-badge ${escapeHtml(role)}">${escapeHtml(role)}</span></article>
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
    const services = data.services || [];
    const hasDegraded = services.some(service => service.status === 'degraded');
    const hasMaintenance = services.some(service => service.status === 'maintenance');
    document.getElementById('publicStatusSummary').textContent = hasDegraded
        ? 'Some systems are experiencing issues'
        : hasMaintenance
            ? 'Some features are temporarily turned off'
            : 'All systems operational';
    document.getElementById('publicStatusList').innerHTML = services.map(service => `
        <article class="public-status-row ${escapeHtml(service.status)}"><span class="public-status-dot" aria-hidden="true"></span><strong>${escapeHtml(service.name)}</strong><span class="public-status-detail">${escapeHtml(service.detail)}</span></article>
    `).join('') || '<div class="home-panel empty">Status is currently unavailable.</div>';
    document.getElementById('publicStatusChecked').textContent = data.checkedAt ? `Last checked ${formatDateTime(data.checkedAt)}` : '';
}

function showHomeView(name = 'servers', developerTool = null) {
    document.getElementById('homeShell').hidden = false;
    document.getElementById('dashboardLayout').hidden = true;
    setHomePageTitle(name);
    history.replaceState(null, '', name === 'servers' ? '/' : `/?view=${encodeURIComponent(name)}`);
    for (const button of document.querySelectorAll('[data-home-view]')) button.classList.toggle('active', button.dataset.homeView === name);
    for (const view of ['servers', 'commands', 'status', 'feedback', 'developer']) document.getElementById(`homeView${view[0].toUpperCase()}${view.slice(1)}`).hidden = view !== name;
    if (name === 'commands') loadPublicCommands().catch(handleUiError);
    if (name === 'status') loadPublicStatus().catch(handleUiError);
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
    container.hidden = false;
    const groups = [
        { title: 'Admin access', rows: rows.filter(row => row.displayRole === 'admin') },
        { title: 'Member access', rows: rows.filter(row => row.displayRole === 'member') },
        { title: 'Developer-only access', rows: rows.filter(row => row.displayRole === 'not a member') }
    ].filter(group => group.rows.length);
    const summary = document.getElementById('homeServerSummary');
    summary.hidden = false;
    summary.textContent = `${rows.length} ${rows.length === 1 ? 'server' : 'servers'} available`;
    container.innerHTML = groups.map(group => `<section class="guild-group"><div class="guild-group-heading"><h2>${escapeHtml(group.title)}</h2><span class="guild-count">${group.rows.length} ${group.rows.length === 1 ? 'server' : 'servers'}</span></div><div class="home-guild-grid">${group.rows.map(guildCard).join('')}</div></section>`).join('') || '<div class="home-panel empty">No servers shared with Flummi were found.</div>';

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

    const requestedTool = preferredTab || new URLSearchParams(window.location.search).get('tool') || localStorage.getItem('flummi.developerTab') || 'global';
    const button = tabButtons.find(candidate => candidate.dataset.tab === requestedTool && fixedDeveloperTabIds.has(candidate.dataset.tab) && !candidate.hidden)
        || tabButtons.find(candidate => candidate.dataset.tab === 'global');
    if (button) button.click();
}

async function openDashboard(guildId, tab = null) {
    fillGuildSelect(state.guilds);
    guildSelect.value = String(guildId || state.guilds[0]?.id || '');
    state.guildId = guildSelect.value || null;
    if (!state.guildId) return;
    setServerPageTitle(state.guildId);
    state.role = state.guildRoles.get(String(state.guildId)) || state.role;
    localStorage.setItem('flummi.guildId', state.guildId);
    applyAccessVisibility();
    if (state.role !== 'member') await loadManagement();
    document.getElementById('homeShell').hidden = true;
    document.getElementById('dashboardLayout').hidden = false;
    const rememberedDashboardTab = localStorage.getItem('flummi.activeTab');
    const selectedTab = [tab, rememberedDashboardTab, 'overview'].find(candidate => candidate && !fixedDeveloperTabIds.has(candidate) && tabButtons.some(button => button.dataset.tab === candidate && !button.hidden)) || 'overview';
    const button = tabButtons.find(candidate => candidate.dataset.tab === selectedTab);
    if (button) button.click();
    history.replaceState(null, '', `/?guildId=${encodeURIComponent(state.guildId)}&tab=${encodeURIComponent(selectedTab)}`);
    await refreshActiveTab();
}

document.querySelector('.home-brand')?.addEventListener('click', () => {
    showHomeView('servers');
});

document.querySelector('#dashboardLayout .brand')?.addEventListener('click', event => {
    // Do not hijack the existing Home/Menu buttons inside the brand area.
    if (event.target.closest('button')) return;

    showHomeView('servers');
});

document.querySelectorAll('[data-home-view]').forEach(button => button.addEventListener('click', () => showHomeView(button.dataset.homeView)));
document.getElementById('homeCommandSearch').addEventListener('input', event => renderPublicCommands(event.target.value));
document.getElementById('refreshPublicStatus').addEventListener('click', () => loadPublicStatus().catch(handleUiError));
document.getElementById('homeGuilds').addEventListener('click', event => {
    const card = event.target.closest('[data-open-guild]');
    if (card) openDashboard(card.dataset.openGuild).catch(handleUiError);
});
document.getElementById('dashboardHome').addEventListener('click', () => showHomeView('servers'));
document.getElementById('homeDeveloperGuild').addEventListener('change', event => {
    const guildId = event.target.value;
    guildSelect.value = guildId;
    state.guildId = guildId || null;
    if (state.guildId) {
        state.role = state.guildRoles.get(String(state.guildId)) || state.role;
        localStorage.setItem('flummi.guildId', state.guildId);
    }
    applyAccessVisibility();
    refreshActiveTab().then(clearPageNotice).catch(error => handleUiError(error, () => refreshActiveTab().catch(handleUiError)));
});
document.getElementById('refreshDeveloperTool').addEventListener('click', () => {
    refreshActiveTab().then(clearPageNotice).catch(error => handleUiError(error, () => refreshActiveTab().catch(handleUiError)));
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
    if (state.guildId && state.role !== 'member') await loadManagement();
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
    if (autoRefreshBusy || !state.guildId || document.visibilityState !== 'visible') {
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

function showChartTooltip(event, row, metricLabel) {
    const tooltip = document.getElementById('chartTooltip');
    tooltip.innerHTML = `<strong>${escapeHtml(formatDateTime(row.date))}</strong><br>${escapeHtml(metricLabel)}: ${escapeHtml(String(Number(row.count) || 0))}`;
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
    const maxPoints = Math.max(compact ? 6 : 7, Math.floor(width / (compact ? 34 : 68)));
    const values = [];
    for (let index = 0; index < sourceValues.length; index += Math.ceil(sourceValues.length / maxPoints)) {
        const group = sourceValues.slice(index, index + Math.ceil(sourceValues.length / maxPoints));
        values.push({
            date: group.length === 1 ? group[0].date : `${group[0].date} – ${group[group.length - 1].date}`,
            count: group.reduce((total, row) => total + (Number(row.count) || 0), 0)
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
    const points = values.map((row, index) => {
        const x = values.length === 1 ? left + plotWidth / 2 : left + index * (plotWidth / (values.length - 1));
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
    canvas.setAttribute('aria-label', `${metricLabel} over time`);
    container.replaceChildren(canvas);
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
        points.forEach((point, index) => context.fillText(String(values[index].date).slice(5, 10), point.x, height - 7));
    }
    if (chartType === 'line') {
        context.strokeStyle = '#75cfff'; context.lineWidth = 3; context.lineJoin = 'round'; context.lineCap = 'round'; context.beginPath();
        points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)); context.stroke();
        context.fillStyle = '#8be0ff';
        points.forEach(point => { context.beginPath(); context.arc(point.x, point.y, 4, 0, Math.PI * 2); context.fill(); });
    } else {
        const barWidth = Math.min(34, Math.max(5, plotWidth / values.length * .62));
        points.forEach(point => {
            const gradient = context.createLinearGradient(0, point.y, 0, top + plotHeight);
            gradient.addColorStop(0, '#83d9ff'); gradient.addColorStop(1, '#4e6bff'); context.fillStyle = gradient;
            context.beginPath(); context.roundRect(point.x - barWidth / 2, point.y, barWidth, Math.max(2, top + plotHeight - point.y), 4); context.fill();
        });
    }
    canvas.addEventListener('pointermove', event => {
        const bounds = canvas.getBoundingClientRect();
        const relativeX = event.clientX - bounds.left;
        const index = values.length === 1 ? 0 : Math.max(0, Math.min(values.length - 1, Math.round((relativeX - left) / plotWidth * (values.length - 1))));
        showChartTooltip(event, values[index], metricLabel);
    });
    canvas.addEventListener('pointerleave', hideChartTooltip);
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
    const format = date => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
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
    const localFeatures = data.settings?.features || {};
    state.globalFeatures = data.globalFeatures || state.globalFeatures || {};
    applyGlobalFeatureNavigation();
    const featureRows = [
        ['Bot', data.settings?.botEnabled, null], ['Triggers', data.settings?.triggersEnabled, 'triggersEnabled'],
        ['AI conversations', localFeatures.aiConversationsEnabled, 'aiConversationsEnabled'], ['AI attachments', localFeatures.aiAttachmentsEnabled, 'aiAttachmentsEnabled'],
        ['Image search', localFeatures.aiImageSearchEnabled, 'aiImageSearchEnabled'], ['Ping responses', localFeatures.pingResponsesEnabled, 'pingResponsesEnabled'],
        ['Save pings', localFeatures.pingRequestSaveEnabled, 'pingRequestSaveEnabled'], ['Shots', localFeatures.shotsEnabled, 'shotsEnabled']
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
        setStatus(sendStatusField, 'Ping member ID must be a valid Discord snowflake.', 'error');
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

// ---------- Shots ----------
const shotScopeSelect = document.getElementById('shotScope');
shotScopeSelect.addEventListener('change', () => loadShots().catch(error => console.error(error)));

async function loadShots() {
    if (!state.guildId) return;
    const data = await api(withGuild(`/api/shots?scope=${shotScopeSelect.value}`));
    const leaderboard = Array.isArray(data?.leaderboard) ? data.leaderboard : [];
    const audit = Array.isArray(data?.audit) ? data.audit : [];

    document.getElementById('shotCards').innerHTML = [
        statCard('Tracked Users', leaderboard.length),
        statCard('Highest Total', leaderboard[0] ? `${leaderboard[0].total} (${leaderboard[0].label})` : 'N/A')
    ].join('');

    renderTable(document.getElementById('shotLeaderboard'),
        [
            { label: '#', sortable: false, render: (r, i) => i + 1 },
            { label: 'Member', key: 'label', render: r => withNicknameTitle(r.label, r.nickname) },
            { label: 'Total', key: 'total' }
        ],
        leaderboard, 'No shot totals recorded yet.');

    renderTable(document.getElementById('shotAudit'),
        [
            { label: 'When', key: 'at', render: r => escapeHtml(formatDateTime(r.at)) },
            { label: 'Action', key: 'action', render: r => escapeHtml(r.action) },
            { label: 'By', key: 'byLabel', render: r => withNicknameTitle(r.byLabel, r.byNickname) },
            { label: 'Target', key: 'targetLabel', render: r => withNicknameTitle(r.targetLabel, r.targetNickname) },
            { label: 'Change', key: 'newTotal', render: r => `${escapeHtml(r.previousTotal)} \u2192 ${escapeHtml(r.newTotal)}` }
        ],
        audit, 'No shot audit entries yet.');
}

// ---------- Voice ----------
function analyticsRangeLabel(value) {
    if (String(value).toLowerCase() === 'all') return 'all time';
    const days = Math.max(1, Number(value) || 30);
    return `last ${days} ${days === 1 ? 'day' : 'days'}`;
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
    const rangeLabel = analyticsRangeLabel(voiceRange);
    const filters = [`days=${encodeURIComponent(voiceRange)}`];
    const rangeDays = voiceRange === 'all' ? null : Math.max(1, Number(voiceRange) || 30);
    const rangeNow = Date.now();
    if (rangeDays !== null) {
        filters.push(`from=${encodeURIComponent(new Date(rangeNow - rangeDays * 86400000).toISOString())}`);
        filters.push(`to=${encodeURIComponent(new Date(rangeNow).toISOString())}`);
    }
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
    if (rangeDays !== null && analytics.previousTotalMs === undefined) {
        const span = rangeDays * 86400000;
        const previousFilters = [
            `from=${encodeURIComponent(new Date(rangeNow - span * 2).toISOString())}`,
            `to=${encodeURIComponent(new Date(rangeNow - span - 1).toISOString())}`
        ];
        if (voiceChannelId) previousFilters.push(`channelId=${encodeURIComponent(voiceChannelId)}`);
        const previous = await api(withGuild(`/api/voice-analytics?${previousFilters.join('&')}`));
        analytics.previousTotalMs = Number(previous?.totalMs) || 0;
    }
    const fallbackTotalVoiceMs = leaderboard.reduce((total, row) => total + (Number(row?.totalMs) || 0), 0);

    document.getElementById('voiceRangeLabel').textContent = rangeLabel;
    document.getElementById('voiceMinutesRangeLabel').textContent = rangeLabel;

    document.getElementById('voiceCards').innerHTML = [
        statCard('Total voice time', formatDuration(analytics.totalAllTimeMs ?? fallbackTotalVoiceMs), 'All tracked voice time, including the current duration of active sessions.'),
        statCard(`Voice time · ${rangeLabel}`, formatDuration(Number(analytics.totalMs) || 0), 'Time with at least one member in voice inside the selected Period. Overlapping members never make one day exceed 24 hours.'),
        statCard('Vs previous period', periodComparison(analytics.totalMs, analytics.previousTotalMs, voiceRange !== 'all'), 'Compares voice time with the immediately preceding period of equal length. All time has no previous-period comparison.'),
        statCard('In Voice Now', activeSessions.length),
        statCard('Tracked Users', leaderboard.length),
        statCard('Average Session', formatDuration(Number(analytics.averageSessionMs) || 0), 'Average tracked session duration within the selected Period, including active sessions so far.'),
        statCard('Busiest hour', Number.isInteger(analytics.busiestHour) ? `${String(analytics.busiestHour).padStart(2, '0')}:00 UTC` : '-', 'The UTC hour with the most voice sessions starting in the selected Period.')
    ].join('');
    renderActivityChart('voiceActivityChart', analytics.activeOverTime, 'No voice sessions in this range.', document.getElementById('voiceGraphType').value, 'Voice sessions');
    renderActivityChart('voiceMinutesChart', analytics.minutesOverTime, 'No voice time in this range.', document.getElementById('voiceGraphType').value, 'Voice minutes');
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
    const rangeLabel = analyticsRangeLabel(days);
    const channelId = document.getElementById('analyticsChannel').value;
    const memberId = document.getElementById('analyticsMember').value;
    const filters = `${channelId ? `&channelId=${encodeURIComponent(channelId)}` : ''}${memberId ? `&userId=${encodeURIComponent(memberId)}` : ''}`;
    const analyticsResponse = await api(withGuild(`/api/analytics?days=${encodeURIComponent(days)}${filters}`));
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
        statCard(`Messages · ${rangeLabel}`, data.messageCount ?? 0, 'Tracked message events inside the selected Period and active filters.'),
        statCard('Vs previous period', periodComparison(data.messageCount, comparison.previousMessageCount, days !== 'all'), 'Compares messages with the immediately preceding period of equal length. All time has no previous-period comparison.'),
        statCard('Unique Authors', data.uniqueAuthors ?? 0, 'Distinct members who sent at least one tracked message inside the selected Period.'),
        statCard('Attachments', data.engagement?.attachments || 0),
        statCard('GIFs', data.engagement?.gifs || 0, 'GIF files and recognized GIF links or embeds inside the selected Period. A link and its Discord preview count once.'),
        statCard('Replies', data.engagement?.replies || 0),
        statCard('Busiest hour', busiestHour, 'The UTC hour with the most tracked messages in the selected Period.')
    ].join('');
    renderActivityChart('analyticsChart', data.dailyMessages, 'No events in this period yet.', document.getElementById('analyticsGraphType').value, 'Messages');
    await loadActivityHeatmap('message');
    renderTable(document.getElementById('analyticsChannels'), [{ label: 'Channel', key: 'name', render: r => `#${escapeHtml(r.name)}` }, { label: 'Messages', key: 'count' }], data.topChannels, 'No channel activity yet.');
    renderTable(document.getElementById('analyticsUsers'), [{ label: 'Member', key: 'name', render: r => escapeHtml(r.name) }, { label: 'Messages', key: 'count' }], data.topUsers, 'No member activity yet.');
}

// ---------- Analytics ----------
async function loadAnalytics() {
    if (!state.guildId) return;
    const days = document.getElementById('analyticsSummaryRange').value;
    const data = await api(withGuild(`/api/analytics-summary?days=${encodeURIComponent(days)}`));
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
    document.getElementById('analyticsSummaryShots').innerHTML = [
        statCard('Total Shots', data.shots.total), statCard('Tracked Members', data.shots.members),
        statCard('Highest Total', data.shots.highest)
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

document.getElementById('analyticsSummaryRange').addEventListener('change', () => loadAnalytics().catch(error => console.error(error)));
document.getElementById('analyticsSummaryGraphType').addEventListener('change', () => loadAnalytics().catch(error => console.error(error)));

document.getElementById('analyticsDays').addEventListener('change', () => loadStats().catch(error => console.error(error)));
document.getElementById('analyticsChannel').addEventListener('change', () => loadStats().catch(error => console.error(error)));
document.getElementById('analyticsMember').addEventListener('change', () => loadStats().catch(error => console.error(error)));
document.getElementById('analyticsGraphType').addEventListener('change', () => loadStats().catch(error => console.error(error)));
document.getElementById('voiceGraphRange').addEventListener('change', () => loadVoice().catch(error => console.error(error)));
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
            { label: 'ID', key: 'id', render: r => `<code>${escapeHtml(r.id)}</code>` },
            { label: 'Role', sortValue: r => r.isDeveloper ? 2 : (r.role === 'admin' ? 1 : 0), render: renderMemberRoleCell },
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
    const displayName = member?.nickname || member?.displayName || member?.globalName || member?.username || `Member ${userId}`;
    const username = member?.username ? `@${member.username}` : (member?.tag || `ID ${userId}`);
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
            Member ID: ${escapeHtml(userId)}
            <span class="badge ${data.role === 'developer' ? 'dev' : data.role === 'owner' ? 'owner' : data.role === 'admin' ? 'admin' : 'member'}">${escapeHtml(data.role)}</span>
            ${readOnly ? '<span class="sub">You can view these permissions, but your role cannot edit this member.</span>' : ''}
        </p>
        <div class="two-col">${featureRows}</div>
    `;
}

async function loadPermissionsEditor(userId) {
    if (!state.guildId || !userId) {
        setStatus(permissionsStatusField, 'Select a guild and enter a member ID.', 'error');
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
    const confirmed = await confirmAction({ title: 'Change feature permission?', message: `${toggle.checked ? 'Allow' : 'Block'} ${key} for ${userId}?`, confirmLabel: 'Change permission' });
    if (!confirmed) { await loadPermissionsEditor(userId); return; }

    api(withGuild('/api/permissions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, [key]: toggle.checked })
    }).then(data => {
        setStatus(permissionsStatusField, `Updated ${key} for ${userId}.`, 'ok');
        renderPermissionsEditor(userId, data);
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
            <p class="sub">${escapeHtml(data.user.id)}</p>
                <div class="card-grid">${statCard('Messages', data.statistics?.messages || 0)}${statCard('Voice', formatDuration(data.statistics?.voiceMs || 0))}${statCard('Shots', data.statistics?.shots || 0)}${statCard('Role', data.statistics?.role || 'member')}</div>
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
            <h2>AI Memory &amp; Personality</h2>
            <p class="sub">Read-only context inferred from this user's conversations. Last updated: ${escapeHtml(data.aiMemory.updatedAt ? formatDateTime(data.aiMemory.updatedAt) : 'Never')}</p>
            <label>Conversation summary</label>
            <textarea readonly>${escapeHtml(data.aiMemory.summary || 'No saved AI summary yet.')}</textarea>
            <label style="margin-top:12px; display:block;">Inferred personality and interests</label>
            <textarea readonly>${escapeHtml(data.aiMemory.profile || 'No inferred personality details yet.')}</textarea>
        </div>
    `;
}

async function loadProfiles(userId = document.getElementById('profileUserId').value.trim()) {
    if (!userId) {
        setStatus(profileStatusField, 'Enter a member ID first.', 'error');
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
    document.getElementById(selectId).addEventListener('change', event => {
        if (event.target.value) document.getElementById(inputId).value = event.target.value;
    });
}

profileEditor.addEventListener('click', event => {
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
            <div class="management-module-heading"><h3>${escapeHtml(definition.title)}</h3><button class="module-toggle" type="button" data-toggle-management="${escapeHtml(key)}" aria-pressed="${enabled}">${enabled ? 'On' : 'Off'}</button></div>
            <p class="sub">${escapeHtml(definition.description)}</p>
            <div class="actions"><button class="secondary" type="button" data-open-management="${escapeHtml(key)}">Open settings</button></div>
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
    filterManagementModules();
}

function filterManagementModules() {
    const query = document.getElementById('managementModuleSearch').value.trim().toLocaleLowerCase();
    const cards = [...document.querySelectorAll('[data-management-card]')];
    let visible = 0;
    let visibleEnabled = 0;
    let visibleDisabled = 0;

    for (const card of cards) {
        const definition = managementModuleDefinitions[card.dataset.managementCard];
        const searchableText = `${definition?.title || ''} ${definition?.description || ''} ${card.dataset.managementCard}`.toLocaleLowerCase();
        card.hidden = Boolean(query) && !searchableText.includes(query);

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

function setManagementChannelOptions(channels) {
    managementChannels = channels || [];
    for (const select of document.querySelectorAll('[data-management-channel]')) {
        const selected = select.value;
        const available = select.id === 'managementTicketCategory'
            ? (channels || []).filter(channel => channel.kind === 'category')
            : (channels || []).filter(channel => channel.kind !== 'category');
        const prefix = select.id === 'managementTicketCategory' ? '' : '#';
        select.innerHTML = `<option value="">No ${select.id === 'managementTicketCategory' ? 'category' : 'channel'} selected</option>` + available.map(channel => `<option value="${escapeHtml(channel.id)}">${prefix}${escapeHtml(channel.name)}</option>`).join('');
        select.value = Array.from(select.options).some(option => option.value === selected) ? selected : '';
    }
}

function managementChannelOptions(selected = '') {
    return '<option value="">Choose a channel</option>' + managementChannels.filter(channel => channel.kind !== 'category').map(channel => `<option value="${escapeHtml(channel.id)}" ${channel.id === selected ? 'selected' : ''}>#${escapeHtml(channel.name)}</option>`).join('');
}

function renderAutomationRules() {
    const schedules = state.management?.automation?.schedules || [];
    const purges = state.management?.automation?.purgeRules || [];
    document.getElementById('managementSchedules').innerHTML = schedules.length ? schedules.map((rule, index) => `<div class="automation-rule" data-schedule-row><div class="two-col"><div class="field"><label>Name</label><input data-rule-id value="${escapeHtml(rule.id)}" maxlength="80"></div><div class="field"><label>Channel</label><select data-rule-channel>${managementChannelOptions(rule.channelId)}</select></div><div class="field"><label>Schedule type</label><select data-rule-type><option value="interval" ${rule.scheduleType === 'interval' ? 'selected' : ''}>Interval</option><option value="once" ${rule.scheduleType === 'once' ? 'selected' : ''}>One-time</option><option value="weekly" ${rule.scheduleType === 'weekly' ? 'selected' : ''}>Weekdays</option><option value="cron" ${rule.scheduleType === 'cron' ? 'selected' : ''}>Cron</option></select></div><div class="field"><label>Every (minutes)</label><input data-rule-interval type="number" min="5" max="43200" value="${Number(rule.intervalMinutes) || 1440}"></div><div class="field"><label>Date/time (one-time)</label><input data-rule-run-at type="datetime-local" value="${escapeHtml(rule.runAt || '')}"></div><div class="field"><label>Time (weekly)</label><input data-rule-time type="time" value="${escapeHtml(rule.time || '09:00')}"></div><div class="field"><label>Weekdays (0=Sun â€¦ 6=Sat)</label><input data-rule-weekdays value="${escapeHtml((rule.weekdays || []).join(','))}" placeholder="1,3,5"></div><div class="field"><label>Cron (min hour day month weekday)</label><input data-rule-cron value="${escapeHtml(rule.cron || '')}" placeholder="0 20 * * 5"></div><div class="field"><label>Timezone</label><input data-rule-timezone value="${escapeHtml(rule.timezone || 'UTC')}" placeholder="Europe/Amsterdam"></div><div class="field"><label>Start date (optional)</label><input data-rule-start type="datetime-local" value="${escapeHtml(rule.startAt || '')}"></div><div class="field"><label>End date (optional)</label><input data-rule-end type="datetime-local" value="${escapeHtml(rule.endAt || '')}"></div><div class="checkbox-row"><input data-rule-enabled type="checkbox" ${rule.enabled !== false ? 'checked' : ''}><label style="margin:0">Enabled</label></div></div><div class="field"><label>Message</label><textarea data-rule-message rows="3" maxlength="1800">${escapeHtml(rule.message)}</textarea></div><div class="actions"><button class="danger" type="button" data-remove-schedule="${index}">Remove</button></div></div>`).join('') : '<div class="empty">No scheduled messages yet.</div>';
    document.getElementById('managementPurgeRules').innerHTML = purges.length ? purges.map((rule, index) => `<div class="automation-rule" data-purge-row><div class="two-col"><div class="field"><label>Name</label><input data-rule-id value="${escapeHtml(rule.id)}" maxlength="80"></div><div class="field"><label>Channel</label><select data-rule-channel>${managementChannelOptions(rule.channelId)}</select></div><div class="field"><label>Keep newest messages</label><input data-rule-keep type="number" min="0" max="100" value="${Number(rule.keepMessages) || 0}"></div><div class="field"><label>Every (minutes)</label><input data-rule-interval type="number" min="10" max="43200" value="${Number(rule.intervalMinutes) || 1440}"></div><div class="checkbox-row"><input data-rule-enabled type="checkbox" ${rule.enabled !== false ? 'checked' : ''}><label style="margin:0">Enabled</label></div></div><div class="actions"><button class="danger" type="button" data-remove-purge="${index}">Remove</button></div></div>`).join('') : '<div class="empty">No auto-purge rules yet.</div>';
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
            <details><summary>Filter exceptions</summary><div class="field"><label>Ignored channel IDs</label><textarea data-automod-channels rows="3">${escapeHtml((rule.ignoredChannelIds || []).join('\n'))}</textarea></div><div class="field"><label>Ignored role IDs</label><textarea data-automod-roles rows="3">${escapeHtml((rule.ignoredRoleIds || []).join('\n'))}</textarea></div></details>
        </article>`;
    }).join('');
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
    document.getElementById('managementIgnoredChannels').value = (management.automod.ignoredChannelIds || []).join('\n');
    document.getElementById('managementIgnoredRoles').value = (management.automod.ignoredRoleIds || []).join('\n');
    renderAutomodRules();
    document.getElementById('managementCaseLogChannel').value = management.cases.logChannelId || '';
    document.getElementById('managementCaseRetention').value = management.cases.retentionDays;
    document.getElementById('managementLogMessageChanges').checked = management.cases.logMessageChanges;
    document.getElementById('managementLogMemberChanges').checked = management.cases.logMemberChanges;
    document.getElementById('managementAutoroleId').value = management.roles.autoroleId || '';
    document.getElementById('managementAutoroleDelay').value = management.roles.autoroleDelayMinutes;
    document.getElementById('managementPersistRoles').checked = management.roles.persistRoles;
    document.getElementById('managementInteractiveRoles').checked = management.roles.interactiveRoles;
    document.getElementById('managementSelfRoles').value = (management.roles.selfAssignableRoleIds || []).join('\n');
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
    document.getElementById('managementTicketTeams').value = JSON.stringify(management.tickets.supportTeams || [], null, 2);
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

function renderServerDoctor(result) {
    const container = document.getElementById('serverDoctorResults');
    if (!result) return;
    const tone = result.critical ? 'error' : result.warnings ? 'warn' : 'ok';
    container.innerHTML = `<div class="section-title-row"><div><h2>Health score: ${result.score}/100</h2><p class="sub">${result.critical} critical · ${result.warnings} warnings · checked ${escapeHtml(formatDateTime(result.checkedAt))}</p></div><span class="badge ${tone}">${result.critical ? 'Action needed' : result.warnings ? 'Review' : 'Healthy'}</span></div>${result.checks.length ? `<div class="doctor-check-list">${result.checks.map(check => `<article class="doctor-check ${escapeHtml(check.severity)}"><strong>${escapeHtml(check.title)}</strong><span>${escapeHtml(check.detail)}</span>${check.fix ? `<small>${escapeHtml(check.fix)}</small>` : ''}</article>`).join('')}</div>` : '<div class="empty">No problems found.</div>'}`;
}

function renderAdvancedOperations(data) {
    renderServerDoctor(data.doctor);
    document.getElementById('incidentCenterTable').innerHTML = operationTable(data.incidents || [], [
        { label: 'Incident', key: 'id' }, { label: 'Summary', key: 'summary' }, { label: 'Actor', key: 'actorId' },
        { label: 'Status', render: row => `<select data-incident-status="${escapeHtml(row.id)}"><option value="open" ${row.status === 'open' ? 'selected' : ''}>Open</option><option value="investigating" ${row.status === 'investigating' ? 'selected' : ''}>Investigating</option><option value="resolved" ${row.status === 'resolved' ? 'selected' : ''}>Resolved</option></select>` }
    ], 'No security incidents recorded.');
    document.getElementById('reportsOperationsTable').innerHTML = operationTable(data.reports || [], [
        { label: 'Report', key: 'id' }, { label: 'Reason', key: 'reason' }, { label: 'Created', render: row => escapeHtml(formatDateTime(row.createdAt)) },
        { label: 'Status', render: row => `<select data-report-status="${escapeHtml(row.id)}"><option value="open" ${row.status === 'open' ? 'selected' : ''}>Open</option><option value="claimed" ${row.status === 'claimed' ? 'selected' : ''}>Claimed</option><option value="resolved" ${row.status === 'resolved' ? 'selected' : ''}>Resolved</option><option value="dismissed" ${row.status === 'dismissed' ? 'selected' : ''}>Dismissed</option></select>` }
    ], 'No member reports received.');
    document.getElementById('serverSnapshotsTable').innerHTML = operationTable(data.snapshots || [], [
        { label: 'Snapshot', key: 'id' }, { label: 'Created', render: row => escapeHtml(formatDateTime(row.createdAt)) }, { label: 'Reason', key: 'reason' }, { label: 'Roles', key: 'roleCount' }, { label: 'Channels', key: 'channelCount' },
        { label: 'Recovery', render: row => `<div class="row"><button class="secondary" type="button" data-snapshot-preview="${escapeHtml(row.id)}">Preview</button><button class="secondary" type="button" data-snapshot-restore="${escapeHtml(row.id)}">Restore missing</button></div>` }
    ], 'No snapshots created yet.');
    document.getElementById('engagementLevelsTable').innerHTML = operationTable(data.levels || [], [
        { label: 'Member ID', key: 'userId' }, { label: 'Level', key: 'level' }, { label: 'XP', key: 'xp' }, { label: 'Messages', key: 'messages' }
    ], 'No XP has been recorded yet.');
    const utilities = [
        ...(data.feeds || []).map(row => ({ type: 'Creator feed', name: row.name, destination: row.channelId, status: row.lastError ? `Error: ${row.lastError}` : row.lastCheckedAt ? 'Active' : 'Waiting for first check' })),
        ...(data.voiceRoleLinks || []).map(row => ({ type: 'Voice role', name: row.roleId, destination: row.channelId, status: 'Active' })),
        ...(data.temporaryRoles || []).map(row => ({ type: 'Temporary role', name: row.roleId, destination: row.userId, status: `Expires ${formatDateTime(row.removeAt)}` }))
    ];
    document.getElementById('engagementUtilitiesTable').innerHTML = operationTable(utilities, [
        { label: 'Type', key: 'type' }, { label: 'Feed / role', key: 'name' }, { label: 'Channel / member', key: 'destination' }, { label: 'Status', key: 'status' }
    ], 'No feeds, voice roles, or temporary roles configured.');
    document.getElementById('managementActivePunishments').innerHTML = operationTable(data.activePunishments || [], [
        { label: 'Action', key: 'action' }, { label: 'Member', key: 'targetId' }, { label: 'Moderator', key: 'moderatorId' },
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
        { label: 'Ticket', key: 'id' }, { label: 'Owner', key: 'ownerId' }, { label: 'Topic', key: 'topic' },
        { label: 'Status', key: 'status' }, { label: 'Claimed by', key: 'claimedBy' }, { label: 'Created', render: row => escapeHtml(formatDateTime(row.createdAt)) }
    ], 'No tickets recorded.');

    const suggestionStatuses = [['submitted', 'Submitted'], ['under-review', 'Under Review'], ['planned', 'Planned'], ['in-progress', 'In Progress'], ['implemented', 'Implemented'], ['rejected', 'Rejected']];
    document.getElementById('managementSuggestionsRoadmap').innerHTML = operationTable(data.suggestions || [], [
        { label: 'Suggestion', key: 'id' }, { label: 'Idea', key: 'idea' }, { label: 'Author', key: 'authorId' },
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
}

async function loadAdvancedManagement() {
    await loadManagement();
    const data = await api(withGuild('/api/management/operations'));
    renderAdvancedOperations(data);
    if (document.getElementById('tab-management-workflows').classList.contains('active')) await loadCustomCommands();
}

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

document.getElementById('saveCustomCommand').addEventListener('click', async () => {
    const status = document.getElementById('customCommandStatus');
    let buttons;
    try { buttons = JSON.parse(document.getElementById('customCommandButtons').value || '[]'); } catch { return setStatus(status, 'Buttons must be valid JSON.', 'error'); }
    const command = { name: document.getElementById('customCommandName').value, description: document.getElementById('customCommandDescription').value, responseType: document.getElementById('customCommandType').value, content: document.getElementById('customCommandContent').value, imageUrl: document.getElementById('customCommandImage').value, buttons, requiredRoleId: document.getElementById('customCommandRole').value, allowedChannelIds: document.getElementById('customCommandChannels').value.split(/\s+/).filter(Boolean), cooldownSeconds: Number(document.getElementById('customCommandCooldown').value), ephemeral: document.getElementById('customCommandEphemeral').checked, enabled: document.getElementById('customCommandEnabled').checked };
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
    document.getElementById('webhookPreview').innerHTML = `<h3>${escapeHtml(title || 'Announcement title')}</h3><p>${escapeHtml(description || 'Announcement description').replace(/\n/g, '<br>')}</p>${thumbnail ? `<img src="${escapeHtml(thumbnail)}" alt="" style="width:64px;height:64px;object-fit:cover;border-radius:8px">` : ''}${image ? `<img src="${escapeHtml(image)}" alt="" style="width:100%;max-height:220px;object-fit:cover;border-radius:8px;margin-top:12px">` : ''}`;
}
for (const id of ['webhookTitle', 'webhookDescription', 'webhookImage', 'webhookThumbnail']) document.getElementById(id).addEventListener('input', renderWebhookPreview);
document.getElementById('publishWebhook').addEventListener('click', async () => {
    const status = document.getElementById('webhookStatus');
    let fields, buttons;
    try { fields = JSON.parse(document.getElementById('webhookFields').value || '[]'); buttons = JSON.parse(document.getElementById('webhookButtons').value || '[]'); } catch { return setStatus(status, 'Fields and buttons must be valid JSON.', 'error'); }
    const payload = { channelId: document.getElementById('webhookChannel').value, username: document.getElementById('webhookUsername').value, avatarUrl: document.getElementById('webhookAvatar').value, title: document.getElementById('webhookTitle').value, description: document.getElementById('webhookDescription').value, imageUrl: document.getElementById('webhookImage').value, thumbnailUrl: document.getElementById('webhookThumbnail').value, roleId: document.getElementById('webhookRole').value, fields, buttons, timestamp: true };
    try { await api(withGuild('/api/management/webhook-publish'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); setStatus(status, 'Announcement published.', 'ok'); } catch (error) { setStatus(status, error.message, 'error'); }
});

async function persistManagement(statusField) {
    const result = await api(withGuild('/api/settings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ management: state.management })
    });
    state.management = result.settings.management;
    renderManagementCards();
    applyManagementNavigation();
    hydrateManagementEditors();
    if (statusField) setStatus(statusField, 'Saved.', 'ok');
}

async function loadManagement() {
    if (!state.guildId || state.role === 'member') return;
    const settingsData = await api(withGuild('/api/settings'));
    state.management = settingsData.settings.management;
    if (managementChannelsGuildId !== state.guildId) {
        const channelData = await api(withGuild('/api/management/channels'));
        setManagementChannelOptions(channelData.channels || []);
        managementChannelsGuildId = state.guildId;
    }
    hydrateManagementEditors();
    renderManagementCards();
    applyManagementNavigation();
}

async function toggleManagementModule(moduleKey, statusField) {
    const definition = managementModuleDefinitions[moduleKey];
    if (!definition || !state.management) return;
    const nextEnabled = state.management.modules[moduleKey] !== true;
    state.management.modules[moduleKey] = nextEnabled;
    try {
        await persistManagement(statusField);
        setManagementExpanded(true);
        if (statusField) setStatus(statusField, `${definition.title} turned ${nextEnabled ? 'on' : 'off'}.`, 'ok');
    } catch (error) {
        state.management.modules[moduleKey] = !nextEnabled;
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
            return [key, { enabled: card.querySelector('[data-automod-toggle]').getAttribute('aria-pressed') === 'true', action: card.querySelector('[data-automod-action]').value, limit: Number(card.querySelector('[data-automod-limit]')?.value || oldRule.limit), windowSeconds: Number(card.querySelector('[data-automod-window]')?.value || oldRule.windowSeconds), ignoredChannelIds: card.querySelector('[data-automod-channels]').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean), ignoredRoleIds: card.querySelector('[data-automod-roles]').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean) }];
        }));
        state.management.automod = { preset: document.getElementById('managementAutomodPreset').value, mode: document.getElementById('managementAutomodMode').value, escalationEnabled: document.getElementById('managementAutomodEscalation').checked, logChannelId: document.getElementById('managementAutomodLogChannel').value, action: document.getElementById('managementAutomodAction').value, timeoutMinutes: Number(document.getElementById('managementAutomodTimeout').value), blockedTerms: textLines('managementBlockedTerms'), allowedDomains: textLines('managementAllowedDomains'), allowedInviteCodes: textLines('managementAllowedInvites'), ignoredChannelIds: textLines('managementIgnoredChannels'), ignoredRoleIds: textLines('managementIgnoredRoles'), rules };
    } else if (section === 'cases') {
        const retention = document.getElementById('managementCaseRetention');
        if (!retention.checkValidity()) throw new Error('Retention must be between 1 and 3650 days.');
        state.management.cases = { logChannelId: document.getElementById('managementCaseLogChannel').value, retentionDays: Number(retention.value), logMessageChanges: document.getElementById('managementLogMessageChanges').checked, logMemberChanges: document.getElementById('managementLogMemberChanges').checked };
    } else if (section === 'roles') {
        const roleId = document.getElementById('managementAutoroleId').value.trim();
        const delay = document.getElementById('managementAutoroleDelay');
        if (roleId && !/^\d{16,22}$/.test(roleId)) throw new Error('Autorole ID must be a valid Discord role ID.');
        if (!delay.checkValidity()) throw new Error('Autorole delay must be between 0 and 10080 minutes.');
        state.management.roles = { autoroleId: roleId, autoroleDelayMinutes: Number(delay.value), persistRoles: document.getElementById('managementPersistRoles').checked, interactiveRoles: document.getElementById('managementInteractiveRoles').checked, selfAssignableRoleIds: textLines('managementSelfRoles'), onboardingChannelId: document.getElementById('managementOnboardingChannel').value, onboardingTitle: document.getElementById('managementOnboardingTitle').value, onboardingMessage: document.getElementById('managementOnboardingMessage').value };
    } else if (section === 'automation') {
        const schedules = [...document.querySelectorAll('[data-schedule-row]')].map((row, index) => ({ id: row.querySelector('[data-rule-id]').value.trim() || `schedule-${index + 1}`, enabled: row.querySelector('[data-rule-enabled]').checked, channelId: row.querySelector('[data-rule-channel]').value, message: row.querySelector('[data-rule-message]').value.trim(), intervalMinutes: Number(row.querySelector('[data-rule-interval]').value), scheduleType: row.querySelector('[data-rule-type]').value, runAt: row.querySelector('[data-rule-run-at]').value, time: row.querySelector('[data-rule-time]').value, weekdays: row.querySelector('[data-rule-weekdays]').value.split(',').map(Number).filter(Number.isInteger), cron: row.querySelector('[data-rule-cron]').value, timezone: row.querySelector('[data-rule-timezone]').value, startAt: row.querySelector('[data-rule-start]').value, endAt: row.querySelector('[data-rule-end]').value }));
        const purgeRules = [...document.querySelectorAll('[data-purge-row]')].map((row, index) => ({ id: row.querySelector('[data-rule-id]').value.trim() || `purge-${index + 1}`, enabled: row.querySelector('[data-rule-enabled]').checked, channelId: row.querySelector('[data-rule-channel]').value, keepMessages: Number(row.querySelector('[data-rule-keep]').value), intervalMinutes: Number(row.querySelector('[data-rule-interval]').value) }));
        state.management.automation = { welcomeEnabled: document.getElementById('managementWelcomeEnabled').checked, goodbyeEnabled: document.getElementById('managementGoodbyeEnabled').checked, scheduledMessagesEnabled: document.getElementById('managementScheduledMessages').checked, autoPurgeEnabled: document.getElementById('managementAutoPurge').checked, welcomeChannelId: document.getElementById('managementWelcomeChannel').value, welcomeMessage: document.getElementById('managementWelcomeMessage').value, goodbyeChannelId: document.getElementById('managementGoodbyeChannel').value, goodbyeMessage: document.getElementById('managementGoodbyeMessage').value, schedules, purgeRules };
    } else if (section === 'tickets') {
        let supportTeams;
        try { supportTeams = JSON.parse(document.getElementById('managementTicketTeams').value || '[]'); } catch { throw new Error('Support teams must contain valid JSON.'); }
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
document.getElementById('managementSchedules').addEventListener('dblclick', async event => {
    const row = event.target.closest('[data-schedule-row]'); if (!row) return;
    const schedule = { enabled: true, scheduleType: row.querySelector('[data-rule-type]').value, intervalMinutes: Number(row.querySelector('[data-rule-interval]').value), runAt: row.querySelector('[data-rule-run-at]').value, time: row.querySelector('[data-rule-time]').value, weekdays: row.querySelector('[data-rule-weekdays]').value.split(',').map(Number).filter(Number.isInteger), cron: row.querySelector('[data-rule-cron]').value, timezone: row.querySelector('[data-rule-timezone]').value, startAt: row.querySelector('[data-rule-start]').value, endAt: row.querySelector('[data-rule-end]').value };
    const result = await api(withGuild('/api/management/schedule-preview'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schedule }) });
    await alertDialog({ title: 'Next executions', message: result.next.length ? result.next.map(formatDateTime).join('\n') : 'No execution falls within the next year.' });
});
document.getElementById('managementPurgeRules').addEventListener('click', event => { const button = event.target.closest('[data-remove-purge]'); if (!button) return; state.management.automation.purgeRules.splice(Number(button.dataset.removePurge), 1); renderAutomationRules(); });

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
    await loadAdvancedManagement();
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
document.getElementById('managementActivePunishments').addEventListener('click', async event => {
    const button = event.target.closest('[data-cancel-punishment]');
    if (!button) return;
    const confirmed = await confirmAction({ title: 'Cancel this punishment?', message: 'The timeout, ban, or temporary role will be reversed immediately.', confirmLabel: 'Cancel punishment' });
    if (!confirmed) return;
    button.disabled = true;
    try {
        await api(withGuild('/api/management/operations'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel-punishment', id: button.dataset.cancelPunishment }) });
        await loadAdvancedManagement();
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
        await loadAdvancedManagement();
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
        await loadAdvancedManagement();
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
    document.getElementById('managementCasesTable').innerHTML = data.cases.length ? `<table><thead><tr><th>Case</th><th>Action</th><th>Target</th><th>Reason</th><th>Status</th><th>Created</th></tr></thead><tbody>${data.cases.map(entry => `<tr><td><code>${escapeHtml(entry.id)}</code></td><td>${escapeHtml(entry.action)}</td><td>${escapeHtml(entry.targetLabel || entry.targetId || '—')}</td><td>${escapeHtml(entry.reason)}</td><td>${escapeHtml(entry.status)}</td><td>${escapeHtml(formatDate(entry.createdAt))}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No cases found.</div>';
    document.getElementById('managementEventsTable').innerHTML = data.events.length ? `<table><thead><tr><th>Event</th><th>Member</th><th>Summary</th><th>Created</th></tr></thead><tbody>${data.events.map(entry => `<tr><td>${escapeHtml(entry.type)}</td><td>${escapeHtml(entry.userId || '—')}</td><td>${escapeHtml(entry.summary)}</td><td>${escapeHtml(formatDate(entry.createdAt))}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No events found.</div>';
    document.getElementById('managementAuditTable').innerHTML = operationTable(data.audit || [], [
        { label: 'Time', render: row => escapeHtml(formatDateTime(row.at)) }, { label: 'Source', key: 'source' },
        { label: 'Action', key: 'action' }, { label: 'Member', render: row => row.memberId ? `<button class="secondary" type="button" data-dossier-member="${escapeHtml(row.memberId)}">${escapeHtml(row.memberId)}</button>` : '—' }, { label: 'Moderator', key: 'moderatorId' },
        { label: 'Channel', key: 'channelId' }, { label: 'Summary', key: 'summary' }
    ], 'No audit records match these filters.');
    const dossier = data.dossier;
    document.getElementById('managementMemberDossier').innerHTML = dossier ? `<div class="card-grid">
        <article class="card"><span>Reputation</span><strong>${escapeHtml(dossier.profile.reputation)}</strong><small>${dossier.profile.activityPercentile == null ? 'No percentile yet' : `Activity percentile: ${escapeHtml(dossier.profile.activityPercentile)}%`}</small></article>
        <article class="card"><span>Messages</span><strong>${Number(dossier.profile.messages) || 0}</strong><small>${Number(dossier.profile.activeDays) || 0} active days</small></article>
        <article class="card"><span>Voice</span><strong>${Number(dossier.profile.voiceMinutes) || 0} min</strong><small>Last seen ${escapeHtml(dossier.profile.lastVoiceAt ? formatDateTime(dossier.profile.lastVoiceAt) : '—')}</small></article>
        <article class="card"><span>Cases</span><strong>${dossier.cases.length}</strong><small>Privacy-safe metadata only</small></article>
    </div>${operationTable(dossier.timeline || [], [
        { label: 'Time', render: row => escapeHtml(formatDateTime(row.at)) }, { label: 'Type', key: 'type' }, { label: 'Event', key: 'label' }, { label: 'Channel', key: 'channelId' }, { label: 'Status', key: 'status' }
    ], 'No timeline entries for this member.')}` : '<div class="empty">Enter a member ID to load their privacy-safe activity profile and timeline.</div>';
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
    if (memberActions && !/^\d{16,22}$/.test(targetId)) return setStatus(status, 'Enter a valid Discord member ID.', 'error');
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
    document.getElementById('featureShots').checked = f.shotsEnabled !== false;
    const gf = s.features || {};
    document.getElementById('guildFeatureAiConversations').checked = gf.aiConversationsEnabled !== false;
    document.getElementById('guildFeatureAiAttachments').checked = gf.aiAttachmentsEnabled !== false;
    document.getElementById('guildFeatureAiImageSearch').checked = gf.aiImageSearchEnabled !== false;
    document.getElementById('guildFeaturePingResponses').checked = gf.pingResponsesEnabled !== false;
    document.getElementById('guildFeaturePingSave').checked = gf.pingRequestSaveEnabled !== false;
    document.getElementById('guildFeatureShots').checked = gf.shotsEnabled !== false;
    syncGlobalFeatureState();
}

async function loadGlobalSettings() {
    const configData = await api('/api/config');
    document.getElementById('publicPanelEnabled').checked = configData.panel?.publicAccessEnabled !== false;
    applyDeveloperSettings(configData);
    renderCommandPermissions(configData);
    syncGlobalFeatureState();
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
    document.getElementById('featureShots').checked = f.shotsEnabled !== false;
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
        pingRequestSaveEnabled: document.getElementById('featurePingSave').checked,
        shotsEnabled: document.getElementById('featureShots').checked
    };
    applyGlobalFeatureNavigation();
    const pairs = [
        ['featureTriggers', 'setTriggersEnabled'],
        ['featureAiConversations', 'guildFeatureAiConversations'], ['featureAiAttachments', 'guildFeatureAiAttachments'],
        ['featureAiImageSearch', 'guildFeatureAiImageSearch'], ['featurePingResponses', 'guildFeaturePingResponses'],
        ['featurePingSave', 'guildFeaturePingSave'], ['featureShots', 'guildFeatureShots']
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

['featureTriggers', 'featureAiConversations', 'featureAiAttachments', 'featureAiImageSearch', 'featurePingResponses', 'featurePingSave', 'featureShots'].forEach(id => document.getElementById(id).addEventListener('change', syncGlobalFeatureState));

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
            pingRequestSaveEnabled: document.getElementById('guildFeaturePingSave').checked,
            shotsEnabled: document.getElementById('guildFeatureShots').checked
        }
    };

    await api(withGuild('/api/settings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    setStatus(statusField, 'Saved.', 'ok');
}

const instantSettingIds = ['setBotEnabled', 'setTriggersEnabled', 'setCooldownEnabled', 'setExactMatch', 'guildFeatureAiConversations', 'guildFeatureAiAttachments', 'guildFeatureAiImageSearch', 'guildFeaturePingResponses', 'guildFeaturePingSave', 'guildFeatureShots'];
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
                    pingRequestSaveEnabled: document.getElementById('featurePingSave').checked,
                    shotsEnabled: document.getElementById('featureShots').checked
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
        resultBox.innerHTML = '<p class="status error">Enter a member ID.</p>';
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
    player.querySelector('.sound-progress').value = duration ? String(audio.currentTime / duration * 100) : '0';
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
    if (audio && Number.isFinite(audio.duration)) audio.currentTime = Number(event.target.value) / 100 * audio.duration;
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
    const rangeLabel = analyticsRangeLabel(range);
    const data = await api(withGuild(`/api/media?days=${encodeURIComponent(range)}`));
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
        statCard(`Media uses · ${rangeLabel}`, rangeMediaUses, 'Tracked soundboard plays, custom emoji uses, and sticker uses inside the selected Period.'),
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
        { label: 'ID', key: 'id', render: r => `<code>${escapeHtml(r.id)}</code>` },
        { label: 'Volume', key: 'volume', render: r => `${Math.round((r.volume ?? 1) * 100)}%` },
        { label: 'Plays', key: 'uses' },
        { label: 'Trend', sortValue: r => r.trend?.percent, render: r => trendHtml(r.trend) },
        { label: 'First used', key: 'firstUsed', render: r => created(r.firstUsed) },
        { label: 'Last used', key: 'lastUsed', render: r => created(r.lastUsed) },
        { label: 'Avg/day', key: 'averagePerDay' },
        { label: 'Creator', key: 'creator', render: r => escapeHtml(r.creator || 'Unknown') },
        { label: 'Created', key: 'createdAt', render: r => created(r.createdAt) }
    ], data.sounds, 'No guild soundboard sounds found.');
    renderTable(document.getElementById('soundboardTopSounds'), [{ label: 'Sound', key: 'soundId', render: r => escapeHtml(soundsById.get(r.soundId) || r.soundId) }, { label: 'Plays', key: 'count' }], data.summary?.topSounds || [], 'No plays recorded yet.');
    renderTable(document.getElementById('soundboardTopChannels'), [{ label: 'Channel', key: 'name', render: r => escapeHtml(r.name) }, { label: 'Plays', key: 'count' }], data.summary?.topChannels || [], 'No plays recorded yet.');
    renderTable(document.getElementById('soundboardTopUsers'), [{ label: 'Member', key: 'label', render: r => withNicknameTitle(r.label, r.nickname) }, { label: 'Plays', key: 'count' }], data.summary?.topUsers || [], 'No plays recorded yet.');
    renderTable(document.getElementById('emojiTable'), [
        { label: 'Emoji', key: 'name', render: r => `<div class="media-name">${mediaPreview(r.url, `:${r.name}:`)}<strong>:${escapeHtml(r.name)}:</strong></div>` },
        { label: 'ID', key: 'id', render: r => `<code>${escapeHtml(r.id)}</code>` },
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
        { label: 'ID', key: 'id', render: r => `<code>${escapeHtml(r.id)}</code>` },
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

document.getElementById('mediaRange').addEventListener('change', () => {
    loadSoundboard().catch(error => handleUiError(error, () => loadSoundboard().catch(handleUiError)));
});
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
        { label: 'Action', key: 'type' },
        { label: 'Details', key: 'message' },
        { label: 'Changes', key: 'changes', sortable: false, render: row => renderAuditChanges(row.changes) }
    ], data.entries || [], 'No confirmed panel changes have been recorded for this server yet.', { index: 0, dir: -1 });
}

function formatAuditValue(value) {
    if (value === null || value === undefined || value === '') return 'Not set';
    if (typeof value === 'boolean') return value ? 'Enabled' : 'Disabled';
    if (Array.isArray(value)) return value.length ? value.join(', ') : 'None';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

function renderAuditChanges(changes) {
    if (!Array.isArray(changes) || !changes.length) return '<span class="muted">—</span>';
    return `<div class="audit-change-list">${changes.map(change => `<div class="audit-change"><strong>${escapeHtml(change.label || change.field || 'Setting')}</strong><span class="audit-change-values">${escapeHtml(formatAuditValue(change.before))} → ${escapeHtml(formatAuditValue(change.after))}</span></div>`).join('')}</div>`;
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
    document.getElementById('overwatchCandidates').innerHTML = candidates.map((candidate, index) => `<article class="overwatch-match-card"><div class="overwatch-match-result"><strong>Candidate ${index + 1}: ${escapeHtml(candidate.name)}</strong><span>${escapeHtml(candidate.platform || 'unknown')}</span></div>${candidate.namecard ? `<img src="${escapeHtml(candidate.namecard)}" alt="" style="width:100%;max-height:110px;object-fit:cover;border-radius:8px">` : ''}<div class="row">${candidate.avatar ? `<img src="${escapeHtml(candidate.avatar)}" alt="" style="width:48px;height:48px;border-radius:50%">` : ''}<div><div>${escapeHtml(candidate.title || 'No player title')}</div><small>Endorsement ${escapeHtml(candidate.endorsementLevel ?? '?')} â€¢ ${escapeHtml(formatDateTime(candidate.lastUpdatedAt))}</small></div></div><code>${escapeHtml(candidate.playerId)}</code></article>`).join('');
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
    if (state.actualRole === 'developer' && activeTab() === 'experiments' && document.visibilityState === 'visible') {
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

async function loadFeedbackCollection() {
    const container = document.getElementById('feedbackCollection');
    try {
        const data = await api('/api/feedback');
        renderTable(container, [
            { label: 'From', key: 'username' },
            { label: 'Feedback', key: 'message' },
            { label: 'Received', key: 'createdAt', render: row => formatDateTime(row.createdAt) },
            { label: 'Manage', sortable: false, render: row => `<button class="danger feedback-delete" type="button" data-feedback-delete="${escapeHtml(row.id)}">Delete</button>` }
        ], data.feedback || [], 'No feedback collected yet.');
    } catch (error) { container.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`; }
}

document.getElementById('loadFeedbackCollection').addEventListener('click', () => loadFeedbackCollection());
document.getElementById('feedbackCollection').addEventListener('click', async event => {
    const button = event.target.closest('[data-feedback-delete]');
    if (!button) return;
    const feedbackId = button.dataset.feedbackDelete;
    const confirmed = await confirmAction({
        title: 'Delete this feedback?',
        message: 'This permanently removes the feedback message from the inbox.',
        confirmLabel: 'Delete feedback'
    });
    if (!confirmed) return;

    const status = document.getElementById('feedbackCollectionStatus');
    button.disabled = true;
    try {
        await api(`/api/feedback?id=${encodeURIComponent(feedbackId)}`, { method: 'DELETE' });
        setStatus(status, 'Feedback deleted.', 'ok');
        await loadFeedbackCollection();
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
document.getElementById('homeLogout').addEventListener('click', logoutToHome);

// ---------- Init ----------
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
    const requestedView = requestedParams.get('view');
    const publicViews = new Set(['servers', 'commands', 'status', 'feedback']);
    const initialView = publicViews.has(requestedView) ? requestedView : 'servers';
    loadInviteLink().catch(error => console.error(error));
    const authenticated = await loadPanelAccount();
    showHomeView(initialView);
    if (!authenticated) return;
    const data = await api('/api/guilds');
    renderHomeGuilds(data.guilds || []);
    const requestedGuild = requestedParams.get('guildId');
    const requestedTab = requestedParams.get('tab');
    if (requestedGuild && state.guilds.some(guild => guild.id === requestedGuild)) {
        await openDashboard(requestedGuild, requestedTab);
    } else if (requestedView === 'developer' && state.actualRole === 'developer') {
        showHomeView(requestedView, requestedParams.get('tool'));
    }
}

initializePanel().catch(error => handleUiError(error, () => initializePanel().catch(handleUiError)));
