// Microsoft Entra ID (Azure AD) SSO for Relay.
//
// Confidential-client OpenID Connect Authorization Code flow with PKCE. The
// Express server holds the client secret and does the code<->token exchange;
// the browser never sees the secret or the tokens. On success we mint an
// opaque server-side session and hand the browser an HttpOnly cookie.
//
// Tokens come straight from Microsoft's token endpoint over TLS using our
// secret, so we trust them and validate the standard claims (aud/iss/exp/nonce)
// without a separate JWKS signature check — correct for the auth-code flow.

import crypto from 'node:crypto';

// Load .env (no-op if absent or if vars already set in the real environment —
// process.loadEnvFile does not override existing process.env keys).
try { process.loadEnvFile(new URL('../.env', import.meta.url)); } catch { /* no .env, fine */ }

const TENANT         = process.env.RELAY_SSO_TENANT_ID || '';
const CLIENT_ID      = process.env.RELAY_SSO_CLIENT_ID || '';
const CLIENT_SECRET  = process.env.RELAY_SSO_CLIENT_SECRET || '';
const REDIRECT_URI   = process.env.RELAY_SSO_REDIRECT_URI || '';
const ALLOWED_DOMAIN = (process.env.RELAY_SSO_ALLOWED_DOMAIN || '').trim().toLowerCase();
const SECURE         = process.env.RELAY_SSO_SECURE === '1';
const SCOPE          = 'openid profile email';

export const SSO_ENABLED = Boolean(TENANT && CLIENT_ID && CLIENT_SECRET && REDIRECT_URI);

const AUTHORITY = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0`;
const ISSUER    = `https://login.microsoftonline.com/${TENANT}/v2.0`;

const SID_COOKIE   = 'relay_sid';
const STATE_COOKIE = 'relay_oidc_state';
const SESSION_TTL  = 8 * 3600 * 1000;   // 8h
const TX_TTL       = 10 * 60 * 1000;    // 10m to complete the round-trip

const sessions = new Map();  // sid   -> { user, createdAt }
const txs      = new Map();  // state -> { verifier, nonce, createdAt }

// Opportunistic GC so the maps can't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of txs)      if (now - v.createdAt > TX_TTL)      txs.delete(k);
  for (const [k, v] of sessions) if (now - v.createdAt > SESSION_TTL) sessions.delete(k);
}, 60_000).unref();

/* ---------- cookies ---------- */
function parseCookies(req) {
  const out = {};
  const header = req.headers?.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setCookie(res, name, value, maxAgeSec) {
  const bits = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (SECURE) bits.push('Secure');
  if (maxAgeSec != null) bits.push(`Max-Age=${maxAgeSec}`);
  res.append('Set-Cookie', bits.join('; '));
}
function clearCookie(res, name) {
  res.append('Set-Cookie', `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${SECURE ? '; Secure' : ''}`);
}

/* ---------- helpers ---------- */
const b64url = (buf) => buf.toString('base64url');
function pkce() {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}
function decodeJwtPayload(jwt) {
  const payload = String(jwt).split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

/** Returns the SSO user for this request's session cookie, or null. */
export function currentUser(req) {
  const sid = parseCookies(req)[SID_COOKIE];
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_TTL) { sessions.delete(sid); return null; }
  return s.user;
}

/* ---------- routes ---------- */
export function installAuthRoutes(app, { devFallback = false, devUser = null } = {}) {
  app.get('/auth/login', (req, res) => {
    if (!SSO_ENABLED) return res.status(503).send('SSO is not configured on this server.');
    const state = b64url(crypto.randomBytes(16));
    const nonce = b64url(crypto.randomBytes(16));
    const { verifier, challenge } = pkce();
    txs.set(state, { verifier, nonce, createdAt: Date.now() });
    setCookie(res, STATE_COOKIE, state, TX_TTL / 1000);
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      response_mode: 'query',
      scope: SCOPE,
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    res.redirect(`${AUTHORITY}/authorize?${params}`);
  });

  app.get('/auth/callback', async (req, res) => {
    try {
      if (!SSO_ENABLED) return res.status(503).send('SSO is not configured on this server.');
      const { code, state, error, error_description } = req.query;
      if (error) return res.status(400).send(`SSO error: ${error} — ${error_description || ''}`);

      const cookieState = parseCookies(req)[STATE_COOKIE];
      clearCookie(res, STATE_COOKIE);
      if (!code || !state || state !== cookieState || !txs.has(state)) {
        return res.status(400).send('Invalid or expired SSO state. Please try signing in again.');
      }
      const tx = txs.get(state);
      txs.delete(state);
      if (Date.now() - tx.createdAt > TX_TTL) return res.status(400).send('SSO request expired.');

      // Exchange the code for tokens (server-to-server, with the client secret).
      const tokenRes = await fetch(`${AUTHORITY}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          grant_type: 'authorization_code',
          code: String(code),
          redirect_uri: REDIRECT_URI,
          code_verifier: tx.verifier,
          scope: SCOPE,
        }),
      });
      if (!tokenRes.ok) {
        console.error('[auth] token exchange failed:', tokenRes.status, await tokenRes.text());
        return res.status(502).send('SSO token exchange failed.');
      }
      const tokens = await tokenRes.json();
      const claims = decodeJwtPayload(tokens.id_token);

      // Validate the standard claims.
      if (claims.aud !== CLIENT_ID)       return res.status(401).send('Token audience mismatch.');
      if (claims.iss !== ISSUER)          return res.status(401).send('Token issuer mismatch.');
      if (claims.nonce !== tx.nonce)      return res.status(401).send('Token nonce mismatch.');
      if (!claims.exp || claims.exp * 1000 < Date.now()) return res.status(401).send('Token expired.');

      const email = String(claims.preferred_username || claims.email || claims.upn || '').toLowerCase();
      if (ALLOWED_DOMAIN && !email.endsWith(`@${ALLOWED_DOMAIN}`)) {
        return res.status(403).send(`Access restricted to @${ALLOWED_DOMAIN} accounts.`);
      }

      const user = {
        name: claims.name || email || 'User',
        email,
        oid: claims.oid || claims.sub || null,
      };
      const sid = b64url(crypto.randomBytes(24));
      sessions.set(sid, { user, createdAt: Date.now() });
      setCookie(res, SID_COOKIE, sid, SESSION_TTL / 1000);
      res.redirect('/');
    } catch (e) {
      console.error('[auth] callback error:', e);
      res.status(500).send('SSO callback failed.');
    }
  });

  app.get('/auth/me', (req, res) => {
    const user = currentUser(req);
    if (user) return res.json({ user, mode: 'sso' });
    if (devFallback && devUser) return res.json({ user: devUser, mode: 'dev' });
    res.status(401).json({ error: 'not authenticated', loginUrl: '/auth/login' });
  });

  app.post('/auth/logout', (req, res) => {
    const sid = parseCookies(req)[SID_COOKIE];
    if (sid) sessions.delete(sid);
    clearCookie(res, SID_COOKIE);
    res.json({ ok: true });
  });
}
