require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Export the client for legacy direct access (to be refactored)
const db = supabase;

// Role hierarchy
const roleHierarchy = {
  'owner': 4,
  'droper': 3,
  'vip': 2,
  'user': 1
};

function canAccessRole(userRole, requiredRole) {
  return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
}

// Seed default admin
async function seedAdmin() {
  const { data: existingAdmin } = await supabase
    .from('users')
    .select('id')
    .eq('role', 'owner')
    .single();

  if (!existingAdmin) {
    const hashedPassword = bcrypt.hashSync('admin123', 10);
    const { error } = await supabase.from('users').insert({
      username: 'Owner',
      email: 'admin@accdrop.com',
      password: hashedPassword,
      role: 'owner'
    });
    
    if (error) {
      console.error('Error seeding admin:', error.message);
    } else {
      console.log('Default admin created: admin@accdrop.com / admin123');
    }
  }
}

// Seed role settings
async function seedRoleSettings() {
  const { count } = await supabase
    .from('role_settings')
    .select('*', { count: 'exact', head: true });

  if (count === 0) {
    const defaultSettings = [
      { role: 'user', linkvertise_bypass: false, cooldown_bypass: false },
      { role: 'vip', linkvertise_bypass: true, cooldown_bypass: false },
      { role: 'droper', linkvertise_bypass: true, cooldown_bypass: true },
      { role: 'owner', linkvertise_bypass: true, cooldown_bypass: true }
    ];
    const { error } = await supabase.from('role_settings').insert(defaultSettings);
    if (error) {
      console.error('Error seeding role settings:', error.message);
    } else {
      console.log('Default role settings seeded');
    }
  }
}

// Get role bypass
async function getRoleBypass(role) {
  const { data } = await supabase
    .from('role_settings')
    .select('linkvertise_bypass')
    .eq('role', role)
    .single();
  
  return data ? (data.linkvertise_bypass ? 1 : 0) : 0;
}

// Get role cooldown bypass
async function getRoleCooldownBypass(role) {
  const { data } = await supabase
    .from('role_settings')
    .select('cooldown_bypass')
    .eq('role', role)
    .single();

  return data ? (data.cooldown_bypass ? 1 : 0) : 0;
}

// Announcement settings
async function getAnnouncement() {
  const { data, error } = await supabase
    .from('site_announcements')
    .select('*')
    .eq('id', 1)
    .single();

  if (error) return null;
  return data;
}

async function upsertAnnouncement(payload) {
  const { error } = await supabase
    .from('site_announcements')
    .upsert({ id: 1, ...payload });
  return { error };
}

// Get user's claims today
async function getUserClaimsToday(userId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { count } = await supabase
    .from('account_claims')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('claimed_at', today.toISOString());

  return count || 0;
}

// Update role bypass
async function updateRoleBypass(role, bypass) {
  await supabase
    .from('role_settings')
    .upsert({ role, linkvertise_bypass: !!bypass });
}

// Update role cooldown bypass
async function updateRoleCooldownBypass(role, bypass) {
  await supabase
    .from('role_settings')
    .upsert({ role, cooldown_bypass: !!bypass });
}

// Get all role settings
async function getAllRoleSettings() {
  const { data } = await supabase
    .from('role_settings')
    .select('*')
    .order('linkvertise_bypass', { ascending: false });
  
  return data || [];
}

// Seed default accounts
async function seedAccounts() {
  const { count } = await supabase
    .from('accounts')
    .select('*', { count: 'exact', head: true });

  if (count === 0) {
    const defaultAccounts = [
      {
        title: 'Minecraft Premium Account',
        description: 'Get free Minecraft Premium account with full access',
        category: 'Minecraft',
        image_url: 'https://cdn.worldvectorlogo.com/logos/minecraft-1.svg',
        link: 'https://account.minecraft.net/manage',
        task_link: 'https://linkvertise.com/example1',
        min_role: 'vip'
      },
      {
        title: 'Crunchyroll Premium',
        description: 'Premium Crunchyroll for anime lovers',
        category: 'Crunchyroll',
        image_url: 'https://upload.wikimedia.org/wikipedia/commons/0/08/Crunchyroll_2024.svg',
        link: 'https://www.crunchyroll.com/account',
        task_link: 'https://linkvertise.com/example2',
        min_role: 'vip'
      },
      {
        title: 'Steam Account with Games',
        description: 'Steam account with multiple games',
        category: 'Steam',
        image_url: 'https://cdn.worldvectorlogo.com/logos/steam-icon.svg',
        link: 'https://steamcommunity.com/my/account',
        task_link: 'https://linkvertise.com/example3',
        min_role: 'vip'
      },
      {
        title: 'Spotify Premium',
        description: 'Free Spotify Premium account',
        category: 'Spotify',
        image_url: 'https://cdn.worldvectorlogo.com/logos/spotify-2.svg',
        link: 'https://www.spotify.com/account/',
        task_link: 'https://linkvertise.com/example4',
        min_role: 'vip'
      },
      {
        title: 'Netflix Premium',
        description: 'Netflix Premium account access',
        category: 'Netflix',
        image_url: 'https://cdn.worldvectorlogo.com/logos/netflix-2.svg',
        link: 'https://www.netflix.com/account',
        task_link: 'https://linkvertise.com/example5',
        min_role: 'vip'
      },
      {
        title: 'Discord Nitro',
        description: 'Discord Nitro subscription',
        category: 'Discord',
        image_url: 'https://cdn.worldvectorlogo.com/logos/discord-icon.svg',
        link: 'https://discord.com/settings',
        task_link: 'https://linkvertise.com/example6',
        min_role: 'user'
      }
    ];

    const { error } = await supabase.from('accounts').insert(defaultAccounts);
    if (error) {
      console.error('Error seeding accounts:', error.message);
    } else {
      console.log('Default accounts seeded');
    }
  }
}

// Seed default category drops
async function seedCategoryDrops() {
  const { count } = await supabase
    .from('category_drops')
    .select('*', { count: 'exact', head: true });

  if (count === 0) {
    const defaults = [
      { category: 'Minecraft', drop_weight: 4.0, display_label: 'Minecraft Accounts', rarity_tier: 'common', color_hex: '#22c55e', icon_url: 'https://cdn.worldvectorlogo.com/logos/minecraft-1.svg' },
      { category: 'Steam', drop_weight: 2.5, display_label: 'Steam Accounts', rarity_tier: 'rare', color_hex: '#1b2838', icon_url: 'https://cdn.worldvectorlogo.com/logos/steam-icon.svg' },
      { category: 'Crunchyroll', drop_weight: 2.0, display_label: 'Crunchyroll Premium', rarity_tier: 'uncommon', color_hex: '#f47521', icon_url: 'https://upload.wikimedia.org/wikipedia/commons/0/08/Crunchyroll_2024.svg' },
      { category: 'Spotify', drop_weight: 1.5, display_label: 'Spotify Premium', rarity_tier: 'rare', color_hex: '#1db954', icon_url: 'https://cdn.worldvectorlogo.com/logos/spotify-2.svg' },
      { category: 'Netflix', drop_weight: 0.8, display_label: 'Netflix Premium', rarity_tier: 'rare', color_hex: '#e50914', icon_url: 'https://cdn.worldvectorlogo.com/logos/netflix-2.svg' },
      { category: 'Discord', drop_weight: 0.5, display_label: 'Discord Nitro', rarity_tier: 'legendary', color_hex: '#5865f2', icon_url: 'https://cdn.worldvectorlogo.com/logos/discord-icon.svg' }
    ];
    const { error } = await supabase.from('category_drops').insert(defaults);
    if (error) {
      console.error('Error seeding category drops:', error.message);
    } else {
      console.log('Default category drops seeded');
    }
  }
}

// --- Linkvertise Link Helpers ---

async function getAllLinks() {
  const { data } = await supabase
    .from('linkvertise_links')
    .select('*')
    .order('step', { ascending: true })
    .order('weight', { ascending: false });
  return data || [];
}

async function getActiveLinksForStep(step) {
  const { data } = await supabase
    .from('linkvertise_links')
    .select('*')
    .eq('step', step)
    .eq('active', true)
    .order('weight', { ascending: false });
  return data || [];
}

async function addLink(url_template, step, label, weight, geo_target) {
  return await supabase.from('linkvertise_links').insert({
    url_template,
    step,
    label: label || null,
    weight: weight || 1.0,
    geo_target: geo_target || null
  }).select();
}

async function updateLink(id, fields) {
  await supabase.from('linkvertise_links').update(fields).eq('id', id);
}

async function deleteLink(id) {
  await supabase.from('linkvertise_links').delete().eq('id', id);
}

async function recordLinkVisit(linkId, linkUrl, step, category) {
  const { data: existing } = await supabase
    .from('linkvertise_stats')
    .select('id, visits')
    .eq('link_id', linkId)
    .eq('category', category || '')
    .single();

  if (existing) {
    await supabase
      .from('linkvertise_stats')
      .update({ visits: (existing.visits || 0) + 1, last_used: new Date().toISOString() })
      .eq('id', existing.id);
  } else {
    await supabase.from('linkvertise_stats').insert({
      link_id: linkId,
      link_url: linkUrl,
      step: step,
      category: category || '',
      visits: 1
    });
  }
}

async function recordLinkCompletion(linkId, category) {
  const { data: existing } = await supabase
    .from('linkvertise_stats')
    .select('id, completions')
    .eq('link_id', linkId)
    .eq('category', category || '')
    .single();

  if (existing) {
    await supabase
      .from('linkvertise_stats')
      .update({ completions: (existing.completions || 0) + 1 })
      .eq('id', existing.id);
  }
}

async function getLinkStats() {
  // Supabase doesn't support complex joins/aggregations easily via JS client in one call
  // For now, we'll do a simple select and calculate percentages in JS or use a RPC if needed.
  // But to keep it simple, we'll get links and join with stats in JS.
  const { data: links } = await supabase.from('linkvertise_links').select('*');
  const { data: stats } = await supabase.from('linkvertise_stats').select('*');

  return (links || []).map(l => {
    const linkStats = (stats || []).filter(s => s.link_id === l.id);
    const total_visits = linkStats.reduce((sum, s) => sum + (s.visits || 0), 0);
    const total_completions = linkStats.reduce((sum, s) => sum + (s.completions || 0), 0);
    const completion_rate = total_visits > 0 ? Math.round((total_completions / total_visits) * 100 * 10) / 10 : 0;
    
    return {
      ...l,
      total_visits,
      total_completions,
      completion_rate
    };
  }).sort((a, b) => a.step - b.step || b.total_completions - a.total_completions);
}

// --- Category Drop Helpers ---

async function getAllDropConfigs() {
  const { data } = await supabase
    .from('category_drops')
    .select('*')
    .order('drop_weight', { ascending: false });
  return data || [];
}

async function getActiveDropConfigs() {
  const { data } = await supabase
    .from('category_drops')
    .select('*')
    .eq('active', true)
    .order('drop_weight', { ascending: false });
  return data || [];
}

async function addDropConfig(category, drop_weight, display_label, rarity_tier, color_hex, icon_url) {
  return await supabase.from('category_drops').insert({
    category,
    drop_weight: drop_weight || 1.0,
    display_label: display_label || category,
    rarity_tier: rarity_tier || 'common',
    color_hex: color_hex || '#3b82f6',
    icon_url: icon_url || ''
  }).select();
}

async function updateDropConfig(id, fields) {
  await supabase.from('category_drops').update(fields).eq('id', id);
}

async function deleteDropConfig(id) {
  await supabase.from('category_drops').delete().eq('id', id);
}

async function recordDrop(user_id, ip_address, selected_category, all_candidates) {
  await supabase.from('drop_history').insert({
    user_id,
    ip_address,
    selected_category,
    all_candidates: JSON.stringify(all_candidates)
  });
}

async function getDropStats() {
  const { data } = await supabase.rpc('get_drop_stats'); 
  // Note: if RPC is not available, we can aggregate in JS
  if (data) return data;

  const { data: history } = await supabase.from('drop_history').select('selected_category');
  if (!history || history.length === 0) return [];

  const counts = {};
  history.forEach(h => {
    counts[h.selected_category] = (counts[h.selected_category] || 0) + 1;
  });

  return Object.entries(counts).map(([cat, count]) => ({
    selected_category: cat,
    times_dropped: count,
    actual_percentage: Math.round((count / history.length) * 100 * 10) / 10
  })).sort((a, b) => b.times_dropped - a.times_dropped);
}

module.exports = {
  db, supabase, roleHierarchy, canAccessRole,
  seedAdmin, seedAccounts, seedRoleSettings, seedCategoryDrops,
  getRoleBypass, getRoleCooldownBypass, getAnnouncement, upsertAnnouncement,
  getUserClaimsToday, updateRoleBypass, updateRoleCooldownBypass, getAllRoleSettings,
  // Linkvertise
  getAllLinks, getActiveLinksForStep, addLink, updateLink, deleteLink,
  recordLinkVisit, recordLinkCompletion, getLinkStats,
  // Category Drops
  getAllDropConfigs, getActiveDropConfigs, addDropConfig, updateDropConfig, deleteDropConfig,
  recordDrop, getDropStats
};
