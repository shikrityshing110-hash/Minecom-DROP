require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { supabase, db, canAccessRole, seedAdmin, seedAccounts, seedRoleSettings, seedCategoryDrops, getRoleBypass, getRoleCooldownBypass, getAnnouncement, upsertAnnouncement, getUserClaimsToday, updateRoleBypass, updateRoleCooldownBypass, getAllRoleSettings, getAllLinks, addLink, updateLink, deleteLink, recordLinkCompletion, getLinkStats, getAllDropConfigs, addDropConfig, updateDropConfig, deleteDropConfig, getDropStats } = require('./database');
const { generateToken } = require('./lib/tokenGenerator');
const { getCooldownMs, formatCooldown } = require('./lib/cooldownCheck');
const { getOptimizedRedirectUrl } = require('./lib/linkOptimizer');
const { selectDrop, getCategoryCardsData } = require('./lib/dropSelector');

const app = express();
const JWT_SECRET = 'accdrop-secret-key-2024-change-in-production';
const TOKEN_TTL_MS = 10 * 60 * 1000;
const REPORT_THRESHOLD = 3;
const LINKVERTISE_STEP1_URL = process.env.LINKVERTISE_STEP1_URL || '';
const LINKVERTISE_STEP2_URL = process.env.LINKVERTISE_STEP2_URL || '';

// Middleware
app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Auth middleware
async function authenticateToken(req, res, next) {
  const token = req.cookies.token;
  if (!token) {
    req.user = null;
    return next();
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { data: user } = await supabase
      .from('users')
      .select('id, username, email, role, banned')
      .eq('id', decoded.id)
      .single();
    if (user && !user.banned) {
      req.user = user;
    } else {
      req.user = null;
    }
  } catch (e) {
    req.user = null;
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || '';
}

function buildLinkvertiseUrl(req, template, token, destinationPath) {
  const origin = `${req.protocol}://${req.get('host')}`;
  const destination = `${origin}${destinationPath}?token=${encodeURIComponent(token)}`;

  if (template && template.includes('{destination}')) {
    return template.split('{destination}').join(encodeURIComponent(destination));
  }

  if (template && template.includes('{token}')) {
    return template.split('{token}').join(token);
  }

  if (template) {
    const joiner = template.includes('?') ? '&' : '?';
    return `${template}${joiner}destination=${encodeURIComponent(destination)}`;
  }

  return destination;
}

function getCategoryIconUrl(category) {
  if (!category) return null;
  const key = String(category).toLowerCase();
  const icons = {
    minecraft: '/assets/logos/minecraft-cover.jpg',
    crunchyroll: 'https://api.iconify.design/simple-icons:crunchyroll.svg?color=%23F47521',
    steam: '/assets/logos/steam.svg',
    spotify: 'https://api.iconify.design/logos:spotify-icon.svg',
    netflix: 'https://api.iconify.design/logos:netflix-icon.svg',
    discord: 'https://api.iconify.design/logos:discord-icon.svg',
    fortnite: 'https://api.iconify.design/simple-icons:fortnite.svg?color=%2300A4EF'
  };
  return icons[key] || null;
}

// Auth routes
app.post('/api/auth/register', async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .or(`username.eq.${username},email.eq.${email}`)
    .single();

  if (existing) {
    return res.status(400).json({ error: 'Username or email already exists' });
  }

  const hashedPassword = bcrypt.hashSync(password, 10);
  const { data, error } = await supabase.from('users').insert({
    username,
    email,
    password: hashedPassword,
    role: 'user'
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  const token = jwt.sign({ id: data.id, username, role: 'user' }, JWT_SECRET, { expiresIn: '7d' });

  res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
  res.json({ success: true, user: { id: data.id, username, email, role: 'user' } });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .single();

  if (!user) {
    return res.status(400).json({ error: 'Invalid credentials' });
  }

  if (user.banned) {
    return res.status(403).json({ error: 'Your account has been banned' });
  }

  if (!bcrypt.compareSync(password, user.password)) {
    return res.status(400).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

  res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
  res.json({ success: true, user: { id: user.id, username: user.username, email: user.email, role: user.role } });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  if (req.user) {
    res.json({ user: req.user });
  } else {
    res.json({ user: null });
  }
});

// Unlock flow - Step 1 (generate token + redirect to Linkvertise Step 1)
app.post('/api/unlock', authenticateToken, requireAuth, async (req, res) => {
  const { accountId } = req.body;

  if (!accountId) {
    return res.status(400).json({ error: 'Account ID is required' });
  }

  const { data: account } = await supabase.from('accounts').select('*').eq('id', accountId).single();
  if (!account) {
    return res.status(404).json({ error: 'Account not found' });
  }

  // Bypass checks
  const bypass = (await getRoleBypass(req.user.role)) === 1;
  const cooldownBypass = (await getRoleCooldownBypass(req.user.role)) === 1;

  // Cooldown check by IP + category (skip if role bypasses cooldown)
  if (!cooldownBypass) {
    const ipAddress = getClientIp(req);
    const cooldownMs = getCooldownMs(account.category);
    if (cooldownMs > 0) {
      const { data: lastClaim } = await supabase
        .from('claim_history')
        .select('timestamp')
        .eq('ip_address', ipAddress)
        .eq('category', account.category)
        .order('timestamp', { ascending: false })
        .limit(1)
        .single();

      if (lastClaim?.timestamp) {
        const lastTime = Date.parse(lastClaim.timestamp);
        if (!Number.isNaN(lastTime)) {
          const elapsed = Date.now() - lastTime;
          if (elapsed < cooldownMs) {
            const remaining = cooldownMs - elapsed;
            return res.status(429).json({ error: `Cooldown active. Try again in ${formatCooldown(remaining)}.` });
          }
        }
      }
    }
  }

  const { count: availableStock } = await supabase
    .from('account_stock')
    .select('*', { count: 'exact', head: true })
    .eq('category', account.category)
    .eq('status', 'available');

  if (availableStock === 0) {
    return res.status(404).json({ error: 'No accounts available for this category' });
  }

  const token = generateToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

  await supabase.from('unlock_tokens').insert({
    token,
    category: account.category,
    account_id: account.id,
    expires_at: expiresAt,
    used: false
  });

  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.cookie('unlock_token', token, {
    httpOnly: true,
    maxAge: TOKEN_TTL_MS,
    sameSite: 'lax',
    secure: isSecure
  });

  let redirectUrl = '';
  if (bypass) {
    redirectUrl = `/reward?token=${encodeURIComponent(token)}`;
  } else {
    const opt = await getOptimizedRedirectUrl(req, 1, token, '/verify', account.category, LINKVERTISE_STEP1_URL);
    redirectUrl = opt.redirectUrl;
    if (opt.linkId) {
      await supabase.from('unlock_tokens').update({ link_id: opt.linkId }).eq('token', token);
    }
  }

  res.json({ redirectUrl, bypass });
});

// Unlock flow - Step 2 verify token + return Linkvertise Step 2 URL
app.get('/api/verify', async (req, res) => {
  const token = req.query.token || req.cookies.unlock_token;

  if (!token) {
    return res.status(400).json({ error: 'Token is required' });
  }

  const { data: row } = await supabase.from('unlock_tokens').select('*').eq('token', token).single();
  if (!row) {
    return res.status(404).json({ error: 'Invalid token' });
  }

  if (row.used) {
    return res.status(400).json({ error: 'Token already used' });
  }

  const expires_at = Date.parse(row.expires_at);
  if (!Number.isNaN(expires_at) && Date.now() > expires_at) {
    return res.status(400).json({ error: 'Token expired' });
  }

  // Record step 1 completion if link_id is tracked
  if (row.link_id) {
    try { await recordLinkCompletion(row.link_id, row.category); } catch(e) {}
  }

  const { redirectUrl: step2Url, linkId: step2LinkId } = await getOptimizedRedirectUrl(req, 2, token, '/reward', row.category, LINKVERTISE_STEP2_URL);

  // Store step2 link_id for completion tracking at reward
  if (step2LinkId) {
    await supabase.from('unlock_tokens').update({ link_id_step2: step2LinkId }).eq('token', token);
  }

  res.json({ valid: true, step2Url });
});

// Unlock flow - Step 3 reward (claim account)
app.post('/api/reward', authenticateToken, requireAuth, async (req, res) => {
  const token = req.body.token || req.cookies.unlock_token;

  if (!token) {
    return res.status(400).json({ error: 'Token is required' });
  }

  try {
    // Supabase transactions are better handled via RPC or carefully sequenced calls
    // since there's no direct "db.transaction" in the client.
    const { data: tokenRow } = await supabase.from('unlock_tokens').select('*').eq('token', token).single();
    if (!tokenRow) throw new Error('Invalid token');
    if (tokenRow.used) throw new Error('Token already used');

    const expires_at = Date.parse(tokenRow.expires_at);
    if (!Number.isNaN(expires_at) && Date.now() > expires_at) {
      throw new Error('Token expired');
    }

    // Attempt to claim an account
    const { data: account, error: claimError } = await supabase
      .from('account_stock')
      .select('*')
      .eq('category', tokenRow.category)
      .eq('status', 'available')
      .order('id', { ascending: true })
      .limit(1)
      .single();

    if (!account || claimError) {
      throw new Error('No accounts available for this category');
    }

    // Mark as used and claim in a pseudo-transactional way
    const { error: updateError } = await supabase
      .from('account_stock')
      .update({ status: 'used', claimed_at: new Date().toISOString() })
      .eq('id', account.id)
      .eq('status', 'available'); // Ensure it wasn't snatched

    if (updateError) throw new Error('Failed to claim account. Please try again.');

    await supabase.from('unlock_tokens').update({ used: true }).eq('token', token);

    const ipAddress = getClientIp(req);
    await supabase.from('claim_history').insert({ ip_address: ipAddress, category: tokenRow.category });

    let listingId = tokenRow.account_id;
    if (!listingId) {
      const { data: fallback } = await supabase
        .from('accounts')
        .select('id')
        .eq('category', tokenRow.category)
        .order('id', { ascending: true })
        .limit(1)
        .single();
      listingId = fallback ? fallback.id : null;
    }

    if (listingId) {
      await supabase.from('account_claims').insert({ user_id: req.user.id, account_id: listingId });
    }

    res.clearCookie('unlock_token');
    res.json({
      success: true,
      account: {
        id: account.id,
        category: account.category,
        email: account.email,
        password: account.password
      }
    });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to unlock account' });
  }
});

// Report broken account
app.post('/api/report', authenticateToken, requireAuth, async (req, res) => {
  const { accountId } = req.body;

  if (!accountId) {
    return res.status(400).json({ error: 'Account ID is required' });
  }

  const { data: account } = await supabase.from('account_stock').select('*').eq('id', accountId).single();
  if (!account) {
    return res.status(404).json({ error: 'Account not found' });
  }

  await supabase.from('account_reports').insert({ account_id: accountId });
  const { count: reportCount } = await supabase
    .from('account_reports')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', accountId);

  let invalidated = false;
  if (reportCount >= REPORT_THRESHOLD && account.status !== 'invalid') {
    await supabase.from('account_stock').update({ status: 'invalid' }).eq('id', accountId);
    invalidated = true;
  }

  res.json({ success: true, reportCount, invalidated });
});

// Admin tools: stock counters, bulk import, claim history, broken accounts
app.get('/api/admin/stock', authenticateToken, requireRole('droper', 'owner'), async (req, res) => {
  const { data: accounts } = await supabase.from('account_stock').select('category, status');
  
  const stockMap = {};
  if (accounts) {
    accounts.forEach(a => {
      if (!stockMap[a.category]) stockMap[a.category] = { category: a.category, available: 0, used: 0, invalid: 0 };
      stockMap[a.category][a.status]++;
    });
  }

  res.json({ stock: Object.values(stockMap).sort((a,b) => a.category.localeCompare(b.category)) });
});

app.post('/api/admin/account-stock/import', authenticateToken, requireRole('droper', 'owner'), async (req, res) => {
  const { category, lines } = req.body;

  if (!category || !lines) {
    return res.status(400).json({ error: 'Category and lines are required' });
  }

  const entries = String(lines)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      const separatorIndex = line.indexOf(':');
      if (separatorIndex <= 0) return null;
      const email = line.slice(0, separatorIndex).trim();
      const password = line.slice(separatorIndex + 1).trim();
      if (!email || !password) return null;
      return { category, email, password, status: 'available' };
    })
    .filter(Boolean);

  if (entries.length === 0) {
    return res.status(400).json({ error: 'No valid lines provided' });
  }

  const { error } = await supabase.from('account_stock').insert(entries);
  if (error) return res.status(500).json({ error: error.message });

  res.json({ success: true, inserted: entries.length });
});

app.get('/api/admin/claim-history', authenticateToken, requireRole('owner'), async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '200', 10), 500);
  const { data: history } = await supabase
    .from('claim_history')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(limit);

  res.json({ history: history || [] });
});

app.get('/api/admin/broken-accounts', authenticateToken, requireRole('droper', 'owner'), async (req, res) => {
  const { data: broken } = await supabase
    .from('account_stock')
    .select('*, account_reports(count)')
    .eq('status', 'invalid')
    .order('id', { ascending: false });

  res.json({ broken: broken || [] });
});

// Account routes
app.get('/api/accounts', authenticateToken, async (req, res) => {
  const { data: accounts } = await supabase
    .from('accounts')
    .select('*, account_claims(count)')
    .order('created_at', { ascending: false });

  const { data: stockRows } = await supabase
    .from('account_stock')
    .select('category, status');

  const stockMap = {};
  if (stockRows) {
    stockRows.forEach(row => {
      if (row.status !== 'available') return;
      if (!stockMap[row.category]) stockMap[row.category] = 0;
      stockMap[row.category] += 1;
    });
  }

  const enriched = (accounts || []).map(account => ({
    ...account,
    image_url: getCategoryIconUrl(account.category) || account.image_url || '',
    stock_available: stockMap[account.category] || 0
  }));

  res.json({ accounts: enriched });
});

app.get('/api/accounts/:id', authenticateToken, async (req, res) => {
  const { data: account } = await supabase.from('accounts').select('*').eq('id', req.params.id).single();

  if (!account) {
    return res.status(404).json({ error: 'Account not found' });
  }

  // Increment views
  await supabase.from('accounts').update({ views: (account.views || 0) + 1 }).eq('id', account.id);

  res.json({
    account: {
      ...account,
      image_url: getCategoryIconUrl(account.category) || account.image_url || ''
    },
    canAccess: true
  });
});

app.post('/api/accounts/:id/claim', authenticateToken, requireAuth, (req, res) => {
  res.status(410).json({ error: 'Direct claim is disabled. Use the unlock flow.' });
});

// Settings routes - Role Settings
app.get('/api/settings/role-settings', authenticateToken, requireRole('owner'), async (req, res) => {
  const settings = await getAllRoleSettings();
  res.json({ settings });
});

app.put('/api/settings/role-settings', authenticateToken, requireRole('owner'), async (req, res) => {
  const { role, bypass, cooldownBypass } = req.body;

  if (!role || (bypass === undefined && cooldownBypass === undefined)) {
    return res.status(400).json({ error: 'Role and at least one setting are required' });
  }

  if (bypass !== undefined) {
    await updateRoleBypass(role, bypass ? 1 : 0);
  }
  if (cooldownBypass !== undefined) {
    await updateRoleCooldownBypass(role, cooldownBypass ? 1 : 0);
  }

  res.json({ success: true });
});

// Public announcement (banner + store card)
app.get('/api/announcement', async (req, res) => {
  const fallback = {
    enabled: false,
    show_banner: true,
    show_card: true,
    title: '',
    message: '',
    cta_text: '',
    cta_url: ''
  };

  const announcement = await getAnnouncement();
  if (!announcement) {
    return res.json({ announcement: fallback });
  }

  res.json({ announcement: { ...fallback, ...announcement } });
});

// Update announcement (owner only)
app.put('/api/admin/announcement', authenticateToken, requireRole('owner'), async (req, res) => {
  const {
    title,
    message,
    cta_text,
    cta_url,
    enabled,
    show_banner,
    show_card
  } = req.body || {};

  const payload = {
    title: String(title || '').trim(),
    message: String(message || '').trim(),
    cta_text: String(cta_text || '').trim(),
    cta_url: String(cta_url || '').trim(),
    enabled: !!enabled,
    show_banner: show_banner !== undefined ? !!show_banner : true,
    show_card: show_card !== undefined ? !!show_card : true,
    updated_at: new Date().toISOString()
  };

  const { error } = await upsertAnnouncement(payload);
  if (error) {
    return res.status(500).json({ error: error.message || 'Failed to update announcement' });
  }

  res.json({ success: true });
});

// Get current user's bypass status
app.get('/api/users/:id/bypass-status', authenticateToken, requireAuth, async (req, res) => {
  // Users can only view their own stats
  if (req.user.id !== parseInt(req.params.id) && req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Access denied' });
  }

  const bypass = await getRoleBypass(req.user.role);

  res.json({
    role: req.user.role,
    bypass: bypass === 1
  });
});

// User routes
app.get('/api/users', authenticateToken, requireRole('owner'), async (req, res) => {
  const { data: users } = await supabase
    .from('users')
    .select('id, username, email, role, banned, created_at, account_claims(count)')
    .order('created_at', { ascending: false });
  res.json({ users: users || [] });
});

app.put('/api/users/:id/role', authenticateToken, requireRole('owner'), async (req, res) => {
  const { role } = req.body;
  const { data: targetUser } = await supabase.from('users').select('role').eq('id', req.params.id).single();

  if (!targetUser) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Prevent modifying owner role unless you're owner
  if (targetUser.role === 'owner' && req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Cannot modify owner' });
  }

  await supabase.from('users').update({ role }).eq('id', req.params.id);
  res.json({ success: true });
});

app.put('/api/users/:id/ban', authenticateToken, requireRole('owner'), async (req, res) => {
  const { banned } = req.body;
  const { data: targetUser } = await supabase.from('users').select('role').eq('id', req.params.id).single();

  if (!targetUser) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (targetUser.role === 'owner' && req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Cannot ban owner' });
  }

  await supabase.from('users').update({ banned: !!banned }).eq('id', req.params.id);
  res.json({ success: true });
});

app.get('/api/users/:id/claims', authenticateToken, requireAuth, async (req, res) => {
  // Users can view their own claims, admins can view all
  if (req.user.id !== parseInt(req.params.id) && req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Access denied' });
  }

  const { data: claims } = await supabase
    .from('account_claims')
    .select('*, accounts(title, category, image_url)')
    .eq('user_id', req.params.id)
    .order('claimed_at', { ascending: false });

  const formattedClaims = (claims || []).map(claim => ({
    ...claim,
    title: claim.accounts?.title,
    category: claim.accounts?.category,
    image_url: getCategoryIconUrl(claim.accounts?.category) || claim.accounts?.image_url || ''
  }));

  res.json({ claims: formattedClaims });
});

// Admin account management
app.post('/api/accounts', authenticateToken, requireRole('droper', 'owner'), async (req, res) => {
  const { title, description, category, image_url, link, task_link, min_role } = req.body;

  if (!title || !category || !link) {
    return res.status(400).json({ error: 'Title, category, and link are required' });
  }

  const { data, error } = await supabase.from('accounts').insert({
    title,
    description: description || '',
    category,
    image_url: image_url || '',
    link,
    task_link: task_link || '',
    min_role: min_role || 'user'
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  res.json({ success: true, id: data.id });
});

app.put('/api/accounts/:id', authenticateToken, requireRole('droper', 'owner'), async (req, res) => {
  const { title, description, category, image_url, link, task_link, min_role } = req.body;

  await supabase.from('accounts').update({
    title,
    description: description || '',
    category,
    image_url: image_url || '',
    link,
    task_link: task_link || '',
    min_role: min_role || 'user'
  }).eq('id', req.params.id);

  res.json({ success: true });
});

app.delete('/api/accounts/:id', authenticateToken, requireRole('droper', 'owner'), async (req, res) => {
  await supabase.from('account_claims').delete().eq('account_id', req.params.id);
  await supabase.from('accounts').delete().eq('id', req.params.id);
  res.json({ success: true });
});

// Stats
app.get('/api/stats', authenticateToken, requireRole('owner'), async (req, res) => {
  const { count: totalUsers } = await supabase.from('users').select('*', { count: 'exact', head: true });
  const { count: totalAccounts } = await supabase.from('accounts').select('*', { count: 'exact', head: true });
  const { count: totalClaims } = await supabase.from('account_claims').select('*', { count: 'exact', head: true });
  
  const { data: recentClaims } = await supabase
    .from('account_claims')
    .select('*, users(username), accounts(title)')
    .order('claimed_at', { ascending: false })
    .limit(10);

  res.json({
    totalUsers,
    totalAccounts,
    totalClaims,
    recentClaims: recentClaims || []
  });
});

// ========== LINKVERTISE LINK MANAGEMENT ==========

app.get('/api/admin/links', authenticateToken, requireRole('owner'), async (req, res) => {
  const links = await getAllLinks();
  res.json({ links });
});

app.get('/api/admin/link-stats', authenticateToken, requireRole('owner'), async (req, res) => {
  const stats = await getLinkStats();
  res.json({ stats });
});

app.post('/api/admin/links', authenticateToken, requireRole('owner'), async (req, res) => {
  const { url_template, step, label, weight, geo_target } = req.body;

  if (!url_template || !step) {
    return res.status(400).json({ error: 'URL template and step are required' });
  }

  if (![1, 2].includes(Number(step))) {
    return res.status(400).json({ error: 'Step must be 1 or 2' });
  }

  const { data, error } = await addLink(url_template, Number(step), label, weight, geo_target);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, id: data[0].id });
});

app.put('/api/admin/links/:id', authenticateToken, requireRole('owner'), async (req, res) => {
  await updateLink(req.params.id, req.body);
  res.json({ success: true });
});

app.delete('/api/admin/links/:id', authenticateToken, requireRole('owner'), async (req, res) => {
  await deleteLink(req.params.id);
  res.json({ success: true });
});

// ========== CATEGORY DROP SYSTEM ==========

// Public: category cards with rarity + stock + drop chance
app.get('/api/categories', async (req, res) => {
  const categories = await getCategoryCardsData();
  res.json({ categories });
});

app.get('/api/admin/drops', authenticateToken, requireRole('owner'), async (req, res) => {
  const drops = await getAllDropConfigs();
  res.json({ drops });
});

app.get('/api/admin/drop-stats', authenticateToken, requireRole('owner'), async (req, res) => {
  const stats = await getDropStats();
  res.json({ stats });
});

app.post('/api/admin/drops', authenticateToken, requireRole('owner'), async (req, res) => {
  const { category, drop_weight, display_label, rarity_tier, color_hex, icon_url } = req.body;

  if (!category) {
    return res.status(400).json({ error: 'Category is required' });
  }

  try {
    const { data, error } = await addDropConfig(category, drop_weight || 1.0, display_label, rarity_tier, color_hex, icon_url);
    if (error) throw error;
    res.json({ success: true, id: data[0].id });
  } catch (err) {
    if (err.message?.includes('UNIQUE') || err.message?.includes('duplicate')) {
      return res.status(400).json({ error: 'Category already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/drops/:id', authenticateToken, requireRole('owner'), async (req, res) => {
  await updateDropConfig(req.params.id, req.body);
  res.json({ success: true });
});

app.delete('/api/admin/drops/:id', authenticateToken, requireRole('owner'), async (req, res) => {
  await deleteDropConfig(req.params.id);
  res.json({ success: true });
});

// Static unlock pages
app.get('/verify', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'verify.html'));
});

app.get('/reward', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reward.html'));
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize and Start Server
async function startServer() {
  try {
    console.log('Initializing database...');
    await seedAdmin();
    await seedAccounts();
    await seedRoleSettings();
    await seedCategoryDrops();
    console.log('Database initialized.');

    // Only listen if not running in a serverless environment (like Vercel)
    if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
      const PORT = process.env.PORT || 3000;
      app.listen(PORT, () => {
        console.log(`AccDrop running on http://localhost:${PORT}`);
        console.log('Admin login: admin@accdrop.com / admin123');
      });
    }
  } catch (err) {
    console.error('Failed to start server:', err);
    // Don't exit in serverless environment
    if (!process.env.VERCEL) {
      process.exit(1);
    }
  }
}

startServer();

// Export for Vercel
module.exports = app;
