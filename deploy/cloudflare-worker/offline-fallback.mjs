const fallbackStatuses = new Set([502, 503, 504, 521, 522, 523, 524, 530]);

function offlineResponse(request) {
    const acceptsJson = (request.headers.get('accept') || '').includes('application/json');

    if (acceptsJson) {
        return Response.json(
            { error: 'Flummi is temporarily unavailable. Please try again shortly.' },
            {
                status: 503,
                headers: {
                    'Cache-Control': 'no-store',
                    'Retry-After': '60'
                }
            }
        );
    }

    return new Response(`<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="robots" content="noindex">
    <title>Flummi is temporarily unavailable</title>
    <style>
        :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        * { box-sizing: border-box; }
        body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; color: #f6f4ff; background: radial-gradient(circle at 20% 0%, #342d5e 0, transparent 42%), radial-gradient(circle at 100% 100%, #173c52 0, transparent 38%), #0d0c16; }
        main { width: min(100%, 560px); padding: 38px; border: 1px solid rgba(255,255,255,.12); border-radius: 24px; background: rgba(24,22,39,.86); box-shadow: 0 24px 80px rgba(0,0,0,.35); backdrop-filter: blur(18px); }
        .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 32px; font-size: 20px; font-weight: 750; }
        .mark { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 14px; background: linear-gradient(135deg, #b89cff, #69d7ff); color: #171224; box-shadow: 0 10px 30px rgba(129,191,255,.22); }
        .status { display: inline-flex; align-items: center; gap: 8px; padding: 7px 11px; border-radius: 999px; color: #ffd8a8; background: rgba(255,169,77,.1); border: 1px solid rgba(255,169,77,.2); font-size: 13px; font-weight: 700; }
        .dot { width: 8px; height: 8px; border-radius: 50%; background: #ffa94d; box-shadow: 0 0 0 5px rgba(255,169,77,.12); }
        h1 { margin: 20px 0 12px; font-size: clamp(30px, 6vw, 44px); line-height: 1.08; letter-spacing: -.035em; }
        p { margin: 0; color: #b9b5ca; font-size: 16px; line-height: 1.65; }
        button { margin-top: 28px; width: 100%; padding: 13px 18px; border: 0; border-radius: 12px; color: #171224; background: linear-gradient(135deg, #c9b6ff, #75ddff); font: inherit; font-weight: 750; cursor: pointer; }
        button:hover { filter: brightness(1.06); }
        small { display: block; margin-top: 18px; color: #777286; text-align: center; }
    </style>
</head>
<body>
    <main>
        <div class="brand"><span class="mark">F</span> Flummi</div>
        <span class="status"><span class="dot"></span> Service offline</span>
        <h1>Temporarily unavailable</h1>
        <p>Flummi's server is currently offline, restarting, or receiving an update. Please try again in a few minutes.</p>
        <button type="button" onclick="location.reload()">Try again</button>
        <small>This page will retry automatically in 30 seconds.</small>
    </main>
    <script>setTimeout(() => location.reload(), 30000);</script>
</body>
</html>`, {
        status: 503,
        headers: {
            'Content-Type': 'text/html; charset=UTF-8',
            'Cache-Control': 'no-store',
            'Retry-After': '60'
        }
    });
}

export default {
    async fetch(request) {
        try {
            const response = await fetch(request);
            if (response.headers.get('x-flummi-maintenance') === 'public-paused') return response;
            return fallbackStatuses.has(response.status) ? offlineResponse(request) : response;
        } catch {
            return offlineResponse(request);
        }
    }
};
