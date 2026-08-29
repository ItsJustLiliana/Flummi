(() => {
    if (!('EventSource' in window)) return;
    let stream = null;

    function connect() {
        stream?.close();
        stream = new EventSource('/api/events');
        for (const type of ['notification', 'dashboard-update']) {
            stream.addEventListener(type, event => {
                let detail = {};
                try { detail = JSON.parse(event.data || '{}'); } catch { /* ignore malformed event */ }
                window.dispatchEvent(new CustomEvent(`flummi:${type}`, { detail }));
            });
        }
        stream.onerror = () => {
            stream?.close();
            window.setTimeout(connect, 5000);
        };
    }

    window.addEventListener('flummi:authenticated', connect, { once: true });
    window.addEventListener('beforeunload', () => stream?.close());
})();
