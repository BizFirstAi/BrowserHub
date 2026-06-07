'use strict';

// â”€â”€ Auth module â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Supports: Metamask (EVM wallet), Google OAuth 2.0, Test (dev-only guest)
// User IDs:  evm@{lowercaseAddress}  |  google@{email}  |  test@{uuid}
// JWT is the session token â€” stored in localStorage by the client.
//
// To swap to a different auth provider: replace the relevant verify* function.
// JWT secret is in app.config.json (jwtSecret field).

const jwt   = require('jsonwebtoken');
const { ethers } = require('ethers');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'app.config.json');

// â”€â”€ Nonce store (in-memory, 5-min TTL) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const _nonces = new Map();
const NONCE_TTL = 5 * 60 * 1000;

// â”€â”€ Config helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function readConfig() {
    try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; }
}

function getJwtSecret() {
    return readConfig().jwtSecret || 'change-me-in-production-set-jwtSecret-in-config';
}

function getGoogleConfig() {
    const cfg = readConfig();
    return {
        clientId:     cfg.googleClientId     || '',
        clientSecret: cfg.googleClientSecret || '',
        redirectUri:  cfg.googleRedirectUri  || 'http://localhost:3000/api/auth/google/callback',
    };
}

function isGoogleConfigured() {
    const { clientId, clientSecret } = getGoogleConfig();
    return !!(clientId && clientSecret);
}

// â”€â”€ Nonce management (for Metamask challenge-response) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function generateNonce(address) {
    const addr  = address.toLowerCase();
    const nonce = `Sign in to BrowserHub\nNonce: ${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    _nonces.set(addr, { nonce, at: Date.now() });
    return nonce;
}

function getNonce(address) {
    const addr  = address.toLowerCase();
    const entry = _nonces.get(addr);
    if (!entry || Date.now() - entry.at > NONCE_TTL) { _nonces.delete(addr); return null; }
    return entry.nonce;
}

function clearNonce(address) { _nonces.delete(address.toLowerCase()); }

// â”€â”€ Metamask signature verification â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function verifyMetamask(address, nonce, signature) {
    try {
        const recovered = ethers.verifyMessage(nonce, signature);
        return recovered.toLowerCase() === address.toLowerCase();
    } catch { return false; }
}

// â”€â”€ Google OAuth helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function httpsPost(url, body, headers) {
    return new Promise((resolve, reject) => {
        const u   = new URL(url);
        const buf = Buffer.from(body);
        const req = https.request({
            hostname: u.hostname, path: u.pathname + u.search,
            method: 'POST',
            headers: { 'Content-Length': buf.length, ...headers },
        }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Bad JSON from Google')); } });
        });
        req.on('error', reject);
        req.write(buf);
        req.end();
    });
}

function httpsGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Bad JSON from Google')); } });
        }).on('error', reject);
    });
}

async function exchangeGoogleCode(code) {
    const { clientId, clientSecret, redirectUri } = getGoogleConfig();
    const body = new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }).toString();
    return httpsPost('https://oauth2.googleapis.com/token', body, { 'Content-Type': 'application/x-www-form-urlencoded' });
}

async function getGoogleUser(accessToken) {
    return httpsGet(`https://www.googleapis.com/oauth2/v3/userinfo?access_token=${encodeURIComponent(accessToken)}`);
}

function buildGoogleAuthUrl() {
    const { clientId, redirectUri } = getGoogleConfig();
    const params = new URLSearchParams({
        client_id:     clientId,
        redirect_uri:  redirectUri,
        response_type: 'code',
        scope:         'openid email profile',
        access_type:   'online',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

// â”€â”€ JWT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function signJWT(payload) {
    return jwt.sign(payload, getJwtSecret(), { expiresIn: '7d' });
}

function verifyJWT(token) {
    try { return jwt.verify(token, getJwtSecret()); } catch { return null; }
}

// â”€â”€ API key management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Keys are stored in app.config.json under "apiKeys" array.
// Each entry: { id, name, key, userId, createdAt }

function _newKeyId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function _saveConfig(cfg) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

function listApiKeys(userId) {
    const cfg = readConfig();
    return (cfg.apiKeys || []).filter(k => k.userId === userId);
}

function addApiKey(userId, name) {
    const cfg = readConfig();
    if (!cfg.apiKeys) cfg.apiKeys = [];
    const entry = {
        id:        _newKeyId(),
        name:      name || 'API Key',
        key:       'bfvs_' + require('crypto').randomBytes(24).toString('hex'),
        userId,
        createdAt: new Date().toISOString(),
    };
    cfg.apiKeys.push(entry);
    _saveConfig(cfg);
    return entry;
}

function revokeApiKey(userId, keyId) {
    const cfg = readConfig();
    if (!cfg.apiKeys) return false;
    const before = cfg.apiKeys.length;
    cfg.apiKeys = cfg.apiKeys.filter(k => !(k.id === keyId && k.userId === userId));
    if (cfg.apiKeys.length === before) return false;
    _saveConfig(cfg);
    return true;
}

function resolveApiKey(rawKey) {
    const cfg = readConfig();
    return (cfg.apiKeys || []).find(k => k.key === rawKey) || null;
}

// â”€â”€ Express middleware â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Accepts: Bearer JWT token  OR  X-Api-Key header

function authMiddleware(req, res, next) {
    // 1. Check X-Api-Key header
    const rawApiKey = req.headers['x-api-key'];
    if (rawApiKey) {
        const entry = resolveApiKey(rawApiKey);
        if (!entry) return res.status(401).json({ error: 'Invalid API key' });
        req.user = { userId: entry.userId, displayName: entry.name, authMethod: 'apikey' };
        return next();
    }
    // 2. Check Bearer JWT (header or ?token= query param for media endpoints)
    const auth  = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : (req.query.token || null);
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    const payload = verifyJWT(token);
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });
    req.user = payload; // { userId, displayName, authMethod }
    next();
}

module.exports = {
    generateNonce, getNonce, clearNonce,
    verifyMetamask,
    exchangeGoogleCode, getGoogleUser, buildGoogleAuthUrl, isGoogleConfigured,
    signJWT, verifyJWT,
    authMiddleware,
    listApiKeys, addApiKey, revokeApiKey, resolveApiKey,
};
