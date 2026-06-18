'use strict';

const crypto = require('crypto');
const bcrypt = require('bcrypt');

function get_secure_random_string(length) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from(crypto.randomBytes(length), b => chars[b % chars.length]).join('');
}

async function get_hashed_password(password) {
    const rounds = parseInt(process.env.BCRYPT_ROUNDS || '10');
    return bcrypt.hash(password, rounds);
}

function logit(msg) {
    const ts = new Date().toISOString();
    const spacer = msg.startsWith('[') ? '' : ' ';
    console.log(`[${ts}]${spacer}${msg.trim()}`);
}

module.exports = { get_secure_random_string, get_hashed_password, logit };
