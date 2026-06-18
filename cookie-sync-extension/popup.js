'use strict';

const STORAGE_KEY = 'BOT_CREDENTIALS';

function showStatus(msg, type) {
    const el = document.getElementById('status');
    el.textContent = msg;
    el.className = `status ${type}`;
    el.style.display = 'block';
}

function loadConfig() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        if (saved.url)      document.getElementById('url').value      = saved.url;
        if (saved.username) document.getElementById('username').value = saved.username;
        if (saved.password) document.getElementById('password').value = saved.password;
        if (saved.url && saved.username && saved.password) {
            document.getElementById('sync-btn').disabled = false;
        }
    } catch {}
}

function saveConfig() {
    const url      = document.getElementById('url').value.trim();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        showStatus('URL must start with http:// or https://', 'err');
        return;
    }
    if (!username.startsWith('botuser')) {
        showStatus('Username must start with "botuser"', 'err');
        return;
    }
    if (!password) {
        showStatus('Password cannot be empty.', 'err');
        return;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ url, username, password }));
    document.getElementById('sync-btn').disabled = false;
    showStatus('Credentials saved.', 'ok');
}

async function syncCookies() {
    const btn = document.getElementById('sync-btn');
    btn.disabled = true;
    showStatus('Syncing cookies and localStorage…', 'warn');

    let config;
    try {
        config = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch {
        showStatus('No credentials saved.', 'err');
        btn.disabled = false;
        return;
    }

    const { url, username, password } = config;

    // ── 1. Sync cookies ──────────────────────────────────────────────────────
    let cookieData;
    try {
        const res = await fetch(`${url}/api/v1/get-bot-browser-cookies`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        cookieData = await res.json();
    } catch (e) {
        showStatus(`Network error: ${e.message}`, 'err');
        btn.disabled = false;
        return;
    }

    if (!cookieData.success) {
        showStatus(`Cookie error: ${cookieData.error || 'unknown'}`, 'err');
        btn.disabled = false;
        return;
    }

    const cookies = cookieData.result.cookies || [];
    const domains = [...new Set(cookies.map(c => c.domain.replace(/^\./, '')))];
    for (const domain of domains) {
        const existing = await chrome.cookies.getAll({ domain });
        for (const c of existing) {
            const cookieUrl = `${c.secure ? 'https' : 'http'}://${c.domain.replace(/^\./, '')}${c.path}`;
            await chrome.cookies.remove({ url: cookieUrl, name: c.name }).catch(() => {});
        }
    }

    let set = 0, failed = 0;
    for (const cookie of cookies) {
        const domain = cookie.domain.replace(/^\./, '');
        const cookieUrl = `${cookie.secure ? 'https' : 'http'}://${domain}${cookie.path || '/'}`;
        const details = {
            url: cookieUrl,
            name: cookie.name,
            value: cookie.value,
            path: cookie.path || '/',
            secure: cookie.secure || false,
            httpOnly: cookie.httpOnly || false,
        };
        if (cookie.domain.startsWith('.')) details.domain = cookie.domain;
        if (cookie.expirationDate)         details.expirationDate = cookie.expirationDate;
        if (cookie.sameSite && cookie.sameSite !== 'unspecified') details.sameSite = cookie.sameSite;

        try {
            await chrome.cookies.set(details);
            set++;
        } catch {
            failed++;
        }
    }

    // ── 2. Sync localStorage (MSAL.js token cache) ───────────────────────────
    const LS_ORIGINS = [
        'https://outlook.office.com',
        'https://outlook.cloud.microsoft',
        'https://outlook.live.com',
    ];

    const lsData = {};
    for (const origin of LS_ORIGINS) {
        try {
            const res = await fetch(`${url}/api/v1/get-bot-localstorage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password, origin }),
            });
            const data = await res.json();
            if (data.success && data.result?.data && Object.keys(data.result.data).length > 0) {
                lsData[origin] = data.result.data;
            }
        } catch {}
    }

    if (Object.keys(lsData).length > 0) {
        await chrome.storage.session.set({ CC_LS_DATA: lsData });
    }

    const lsOrigins = Object.keys(lsData).join(', ') || 'none';
    const lsCount = Object.values(lsData).reduce((acc, o) => acc + Object.keys(o).length, 0);
    const msg = `${set} cookies set${failed ? ` (${failed} failed)` : ''}. localStorage: ${lsCount} entries from ${lsOrigins || 'no open tabs'}.`;
    showStatus(msg, failed ? 'warn' : 'ok');
    btn.disabled = false;
}

loadConfig();
document.getElementById('save-btn').addEventListener('click', saveConfig);
document.getElementById('sync-btn').addEventListener('click', syncCookies);
