const { readConfig } = require('./config');

function publicSiteUrl() {
    const configured = process.env.PANEL_PUBLIC_URL || readConfig().panel?.publicUrl || 'https://flummi.liliananuzohra.com';
    return String(configured).replace(/\/+$/, '');
}

function publicPageUrl(pathname = '/') {
    return `${publicSiteUrl()}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

module.exports = {
    dashboardUrl: () => publicPageUrl('/'),
    privacyUrl: () => publicPageUrl('/privacy'),
    publicPageUrl,
    publicSiteUrl,
    termsUrl: () => publicPageUrl('/terms')
};
