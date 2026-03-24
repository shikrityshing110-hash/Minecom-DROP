# AccDrop — Master Development Plan v2.0

> **Project**: AccDrop — Account Distribution & Monetization Platform  
> **Status**: Phase 1 Complete · Extending with Advanced Features  
> **Last Updated**: 2026-03-14

---

## TECH STACK (Actual)

| Layer      | Technology                          |
|------------|-------------------------------------|
| Runtime    | Node.js                             |
| Framework  | Express.js                          |
| Database   | SQLite via `better-sqlite3`         |
| Auth       | JWT (`jsonwebtoken`) + `bcryptjs`   |
| Frontend   | Vanilla HTML / CSS / JavaScript     |
| Middleware | `cors`, `cookie-parser`             |

---

## IMPORTANT RULES

- Do **NOT** redesign the existing dashboard UI — only extend it.
- Do **NOT** remove or break the existing unlock flow (token → verify → reward).
- Monetization must only use **Linkvertise**.
- Keep architecture clean, modular, and file-separated.
- All new database tables use SQLite (match existing `better-sqlite3` patterns).
- All new API routes follow existing middleware patterns (`authenticateToken`, `requireAuth`, `requireRole`).

---

## ALREADY IMPLEMENTED (Phase 1) ✅

These features are **live and working** — do not rebuild them.

### Authentication & Authorization
- [x] User registration / login / logout with JWT
- [x] Role hierarchy: `owner > admin > moderator > epic > vip > user`
- [x] Role-based route protection (`requireRole`)
- [x] Ban system

### Multi-Step Linkvertise Unlock Flow
- [x] `POST /api/unlock` → generates time-limited token → redirects to Linkvertise Step 1
- [x] `GET /api/verify` → validates token → redirects to Linkvertise Step 2
- [x] `POST /api/reward` → claims account from `account_stock` pool
- [x] Token TTL (10 minutes), single-use enforcement
- [x] Cooldown per IP + category (`lib/cooldownCheck.js`)

### Account Management
- [x] `accounts` table (listings with title, category, image, min_role)
- [x] `account_stock` table (actual email:password pairs with `available/used/invalid` status)
- [x] Admin bulk import (email:password format)
- [x] Stock counter per category
- [x] Account CRUD for admins

### Report Broken Account
- [x] `POST /api/report` — users flag broken accounts
- [x] Auto-invalidation after threshold (3 reports)

### Admin Panel
- [x] Stock overview (available / used / invalid per category)
- [x] Claim history viewer
- [x] Broken accounts list
- [x] User management (role edit, ban toggle)
- [x] Role-based daily claim limits (configurable)

### Frontend Pages
- [x] `index.html` — main dashboard with category cards
- [x] `login.html` / `register.html` — auth pages
- [x] `verify.html` / `reward.html` — unlock flow pages
- [x] `admin.html` — full admin panel
- [x] `profile.html` — user profile & claim history

---

## PHASE 2 — ADVANCED FEATURES TO BUILD 🚀

---

### FEATURE 1 — LINKVERTISE OPTIMIZATION ENGINE

> Maximize revenue per user by intelligently rotating links and tracking performance.

#### 1.1 Smart Link Rotation

Create `lib/linkOptimizer.js`:

- Store multiple Linkvertise links per step (Step 1 and Step 2)
- A/B test links by rotating them based on:
  - Geographic region (via IP geolocation)
  - Time of day (peak vs. off-peak)
  - Historical completion rate
- Weighted random selection favoring higher-performing links
- Automatic deactivation of links with < 5% completion rate

#### 1.2 Link Performance Analytics

New table: `linkvertise_stats`

```sql
CREATE TABLE IF NOT EXISTS linkvertise_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id TEXT NOT NULL,
  link_url TEXT NOT NULL,
  step INTEGER NOT NULL CHECK(step IN (1, 2)),
  category TEXT,
  visits INTEGER DEFAULT 0,
  completions INTEGER DEFAULT 0,
  revenue_estimate REAL DEFAULT 0.0,
  geo_country TEXT,
  last_used DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

New table: `linkvertise_links`

```sql
CREATE TABLE IF NOT EXISTS linkvertise_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url_template TEXT NOT NULL,
  step INTEGER NOT NULL CHECK(step IN (1, 2)),
  label TEXT,
  weight REAL DEFAULT 1.0,
  active INTEGER DEFAULT 1,
  geo_target TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### 1.3 Admin Link Manager

API routes:

- `GET /api/admin/links` — list all Linkvertise links with stats
- `POST /api/admin/links` — add new link
- `PUT /api/admin/links/:id` — update link (weight, active status, geo)
- `DELETE /api/admin/links/:id` — remove link
- `GET /api/admin/link-stats` — aggregated analytics (by link, by day, by country)

Admin panel section: **Linkvertise Manager**
- Table showing all links with completion rate, visits, revenue estimate
- Toggle active/inactive
- Adjust weights with slider
- Performance graphs (bar chart: completions vs visits per link)

---

### FEATURE 2 — CATEGORY DROP SYSTEM (Gamified)

> Add excitement by making account category selection probabilistic with visible odds.

#### 2.1 Drop Configuration

New table: `category_drops`

```sql
CREATE TABLE IF NOT EXISTS category_drops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT UNIQUE NOT NULL,
  drop_weight REAL NOT NULL DEFAULT 1.0,
  display_label TEXT,
  rarity_tier TEXT DEFAULT 'common' CHECK(rarity_tier IN ('common', 'uncommon', 'rare', 'epic', 'legendary')),
  color_hex TEXT DEFAULT '#3b82f6',
  icon_url TEXT,
  active INTEGER DEFAULT 1
);
```

Rarity tiers with visual indicators:
- **Common** (gray) — high drop rate
- **Uncommon** (green) — moderate
- **Rare** (blue) — low
- **Epic** (purple) — very low
- **Legendary** (gold, animated glow) — ultra rare

#### 2.2 Drop Logic

Create `lib/dropSelector.js`:

```
function selectCategory(availableCategories):
  1. Filter categories with stock > 0 and active = true
  2. Normalize weights to probability distribution
  3. Weighted random selection
  4. Return selected category
  5. Log selection to drop_history
```

New table: `drop_history`

```sql
CREATE TABLE IF NOT EXISTS drop_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  ip_address TEXT,
  selected_category TEXT NOT NULL,
  all_candidates TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### 2.3 Enhanced Category Cards

Each category card on the main dashboard now shows:
- Category name + icon
- **Rarity badge** (color-coded: Common / Rare / Epic / Legendary)
- **Stock count** (live)
- **Drop chance** percentage (calculated from weights)
- Pulsing glow animation for Legendary items or low-stock items

#### 2.4 Admin Drop Editor

- `GET /api/admin/drops` — list all category drop configs
- `POST /api/admin/drops` — add category
- `PUT /api/admin/drops/:id` — adjust weight, rarity, toggle active
- `DELETE /api/admin/drops/:id` — remove category

Admin panel section: visual slider editor for drop weights with live percentage preview.

---

### FEATURE 3 — DAILY SPIN WHEEL (Gamification)

> A casino-style spin wheel that drives daily engagement and return visits.

#### 3.1 Spin Rewards Configuration

New table: `spin_rewards`

```sql
CREATE TABLE IF NOT EXISTS spin_rewards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('account', 'bonus_spin', 'premium_role', 'points', 'nothing')),
  value TEXT,
  weight REAL NOT NULL DEFAULT 1.0,
  color_hex TEXT DEFAULT '#3b82f6',
  icon TEXT,
  active INTEGER DEFAULT 1
);
```

Default rewards:
| Reward                   | Type           | Weight | Color    |
|--------------------------|----------------|--------|----------|
| Free Minecraft Account   | `account`      | 5      | #22c55e  |
| Free Steam Account       | `account`      | 3      | #1b2838  |
| Crunchyroll Account      | `account`      | 4      | #f47521  |
| Bonus Spin               | `bonus_spin`   | 8      | #eab308  |
| VIP Role (24h)           | `premium_role` | 6      | #8b5cf6  |
| 50 Points                | `points`       | 15     | #06b6d4  |
| Better Luck Next Time    | `nothing`      | 59     | #6b7280  |

#### 3.2 Spin History & Cooldown

New table: `spin_history`

```sql
CREATE TABLE IF NOT EXISTS spin_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  ip_address TEXT NOT NULL,
  reward_id INTEGER,
  reward_label TEXT NOT NULL,
  reward_type TEXT NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

Cooldown logic:
- 1 spin per 24 hours per user + per IP
- Bonus spins are granted immediately (bypass cooldown)
- VIP/Epic roles get 1 extra daily spin

#### 3.3 Spin Wheel UI Component

Create `public/spin.html` and `public/js/spin.js`:

Features:
- **CSS3 animated spinning wheel** with segments (no canvas required)
- Smooth easing deceleration animation (3-5 second spin)
- Confetti burst animation on win
- Countdown timer showing time until next spin
- Reward popup modal with claim button
- Sound effects (optional, muted by default)
- Mobile-responsive design

#### 3.4 Spin API Routes

- `GET /api/spin/status` — check eligibility (time remaining, spins available)
- `POST /api/spin` — execute spin (returns reward)
- `GET /api/spin/history` — user's spin history
- `GET /api/admin/spin-stats` — admin analytics (rewards given, spin counts)
- `PUT /api/admin/spin-rewards/:id` — edit reward config
- `POST /api/admin/spin-rewards` — add new reward
- `DELETE /api/admin/spin-rewards/:id` — remove reward

---

### FEATURE 4 — POINTS & ECONOMY SYSTEM

> A virtual currency that rewards engagement and creates additional monetization loops.

#### 4.1 Points System

New table: `user_points`

```sql
CREATE TABLE IF NOT EXISTS user_points (
  user_id INTEGER PRIMARY KEY,
  balance INTEGER DEFAULT 0,
  total_earned INTEGER DEFAULT 0,
  total_spent INTEGER DEFAULT 0,
  last_daily DATETIME,
  streak_days INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

New table: `point_transactions`

```sql
CREATE TABLE IF NOT EXISTS point_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('earn', 'spend', 'bonus', 'admin')),
  reason TEXT NOT NULL,
  balance_after INTEGER NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

Point earning methods:
| Action                     | Points |
|----------------------------|--------|
| Complete Linkvertise step  | +10    |
| Daily login bonus          | +5     |
| Login streak (7 days)      | +50    |
| Login streak (30 days)     | +200   |
| Report valid broken acct   | +15    |
| Refer a friend             | +25    |

Point spending:
| Action                     | Cost   |
|----------------------------|--------|
| Skip Linkvertise step      | 500    |
| Extra spin                 | 100    |
| Category-specific unlock   | 250    |
| Temporary VIP (24h)        | 1000   |

#### 4.2 Daily Login Streak

- Users earn points just for visiting daily
- Streak tracker with visual calendar
- Milestone bonuses at 7, 14, 30, 60, 90 days
- Streak resets after 48h of inactivity

#### 4.3 Points API

- `GET /api/points` — current balance, streak info
- `POST /api/points/daily` — claim daily login bonus
- `POST /api/points/spend` — purchase action with points
- `GET /api/points/history` — transaction log
- `POST /api/admin/points/grant` — admin grant/deduct points

---

### FEATURE 5 — REFERRAL SYSTEM

> Organic growth engine — every user becomes a marketer.

#### 5.1 Referral Tracking

New table: `referrals`

```sql
CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_id INTEGER NOT NULL,
  referred_id INTEGER NOT NULL,
  referral_code TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'rewarded')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  FOREIGN KEY (referrer_id) REFERENCES users(id),
  FOREIGN KEY (referred_id) REFERENCES users(id)
);
```

Add `referral_code TEXT UNIQUE` column to `users` table.

Logic:
- Each user gets a unique referral code at registration
- Referral link: `https://accdrop.com?ref=CODE`
- Referrer earns 25 points when referred user completes first unlock
- Referred user gets 10 bonus points at signup
- Anti-abuse: IP check to prevent self-referral

#### 5.2 Referral Dashboard

In profile page:
- Shareable referral link with copy button
- Referral count + earnings
- Status of each referral (pending / completed)

Admin panel:
- Top referrers leaderboard
- Referral stats (total, conversion rate)

---

### FEATURE 6 — ANNOUNCEMENT & NOTIFICATION SYSTEM

> Keep users informed and drive activity with targeted communications.

#### 6.1 Announcements

New table: `announcements`

```sql
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT DEFAULT 'info' CHECK(type IN ('info', 'warning', 'success', 'promo')),
  priority INTEGER DEFAULT 0,
  starts_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME,
  target_role TEXT,
  active INTEGER DEFAULT 1,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);
```

Features:
- Banner bar at top of dashboard (dismissible)
- Promo type: highlighted cards on main page
- Admin can target by role (e.g., only VIP users see a promo)
- Auto-expire based on `expires_at`

#### 6.2 API Routes

- `GET /api/announcements` — active announcements for current user
- `POST /api/admin/announcements` — create announcement
- `PUT /api/admin/announcements/:id` — edit
- `DELETE /api/admin/announcements/:id` — remove

---

### FEATURE 7 — ADVANCED ANALYTICS DASHBOARD

> Give admins complete visibility into platform health and user behavior.

#### 7.1 Metrics Tracked

- **Revenue Metrics**: Linkvertise completions/day, estimated earnings
- **User Metrics**: DAU, MAU, new registrations, retention rate
- **Engagement Metrics**: avg. unlocks/user, spin participation rate, points economy health
- **Stock Metrics**: burn rate per category, estimated time to depletion
- **Abuse Metrics**: flagged IPs, report frequency, suspicious activity

#### 7.2 Analytics API

- `GET /api/admin/analytics/overview` — summary dashboard data
- `GET /api/admin/analytics/users` — user growth over time
- `GET /api/admin/analytics/claims` — claim trends by category, by day
- `GET /api/admin/analytics/revenue` — Linkvertise performance trends
- `GET /api/admin/analytics/stock-health` — burn rates, depletion forecasts

#### 7.3 Admin Dashboard Widgets

- Line charts: claims/day, registrations/day
- Donut chart: stock distribution by category
- Stat cards: total users, claims today, active stock, flagged accounts
- Activity feed: latest claims with username + category + time

---

### FEATURE 8 — SECURITY & ANTI-ABUSE HARDENING

> Protect revenue and prevent exploitation of the platform.

#### 8.1 Rate Limiting

Create `lib/rateLimiter.js`:

- Per-IP request throttle (max 30 requests/minute for API)
- Per-user unlock throttle (already have daily limits — add hourly bursts)
- Spin attempt rate limit (prevent automated spinning)

#### 8.2 Token Security

- Add HMAC signature to unlock tokens (`lib/tokenGenerator.js`)
- Token binding: tie token to user ID + IP so it can't be shared
- Expire tokens more aggressively for suspicious IPs

#### 8.3 VPN / Proxy Detection

New table: `flagged_ips`

```sql
CREATE TABLE IF NOT EXISTS flagged_ips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_address TEXT NOT NULL,
  reason TEXT NOT NULL,
  flagged_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  blocked INTEGER DEFAULT 0
);
```

- Flag IPs that claim too frequently across users
- Track multi-account patterns (same IP, different users)
- Admin can view and block flagged IPs

#### 8.4 CAPTCHA-Style Gate

- After 5 unlocks in a session, require a simple math challenge
- Prevents bots from bulk-farming accounts

---

### FEATURE 9 — ACCOUNT QUALITY SYSTEM

> Improve user satisfaction by surfacing high-quality accounts and reducing bad ones.

#### 9.1 Account Verification Queue

New table: `account_verifications`

```sql
CREATE TABLE IF NOT EXISTS account_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stock_id INTEGER NOT NULL,
  verified_by INTEGER,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'verified', 'rejected')),
  notes TEXT,
  verified_at DATETIME,
  FOREIGN KEY (stock_id) REFERENCES account_stock(id),
  FOREIGN KEY (verified_by) REFERENCES users(id)
);
```

- Admin or moderator can mark accounts as verified
- Verified accounts show a ✓ badge when revealed
- Unverified accounts show a warning

#### 9.2 User Ratings

New table: `account_ratings`

```sql
CREATE TABLE IF NOT EXISTS account_ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stock_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (stock_id) REFERENCES account_stock(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

- After unlocking, user can rate 1–5 stars
- Category avg rating visible on cards
- Low-rated categories get flagged in admin

---

### FEATURE 10 — SEO & SOCIAL PRESENCE SYSTEM

> Maximize organic traffic and social sharing.

#### 10.1 SEO Optimization

- Dynamic `<title>` and `<meta>` tags per category page
- Sitemap generation (`/sitemap.xml`)
- OpenGraph tags for link previews
- Schema.org structured data

#### 10.2 Social Sharing

- Share buttons on reward reveal page ("I just got a free X from AccDrop!")
- Custom OG images per category
- Discord embed integration

---

## PROJECT STRUCTURE (Extended)

```
/
├── server.js                     # Main Express server (extend, don't rewrite)
├── database.js                   # SQLite setup + helpers (add new tables here)
├── package.json
├── accdrop.db                    # SQLite database file
│
├── /lib
│   ├── tokenGenerator.js         # ✅ Existing
│   ├── cooldownCheck.js          # ✅ Existing
│   ├── linkOptimizer.js          # 🆕 Smart link rotation + A/B testing
│   ├── dropSelector.js           # 🆕 Weighted category selection
│   ├── spinLogic.js              # 🆕 Spin wheel engine
│   ├── pointsEngine.js           # 🆕 Points economy logic
│   ├── referralEngine.js         # 🆕 Referral tracking + rewards
│   └── rateLimiter.js            # 🆕 Anti-abuse rate limiting
│
├── /public
│   ├── index.html                # ✅ Main dashboard
│   ├── login.html                # ✅ Login page
│   ├── register.html             # ✅ Register page
│   ├── verify.html               # ✅ Unlock Step 2
│   ├── reward.html               # ✅ Account reveal
│   ├── admin.html                # ✅ Admin panel (extend)
│   ├── profile.html              # ✅ User profile (extend)
│   ├── spin.html                 # 🆕 Spin wheel page
│   ├── leaderboard.html          # 🆕 Points + referral leaderboard
│   │
│   ├── /css
│   │   └── style.css             # ✅ Main stylesheet (extend)
│   │
│   └── /js
│       ├── main.js               # ✅ Dashboard logic
│       ├── auth.js               # ✅ Auth logic
│       ├── admin.js              # ✅ Admin panel logic (extend)
│       ├── verify.js             # ✅ Verify page logic
│       ├── reward.js             # ✅ Reward page logic
│       ├── spin.js               # 🆕 Spin wheel animation + API
│       ├── points.js             # 🆕 Points dashboard + daily claim
│       ├── referral.js           # 🆕 Referral panel
│       └── leaderboard.js        # 🆕 Leaderboard logic
```

---

## IMPLEMENTATION PRIORITY

| Priority | Feature                          | Effort | Impact |
|----------|----------------------------------|--------|--------|
| P0       | Linkvertise Optimization Engine  | Medium | 🔥🔥🔥   |
| P0       | Category Drop System             | Medium | 🔥🔥🔥   |
| P1       | Daily Spin Wheel                 | High   | 🔥🔥🔥   |
| P1       | Points & Economy System          | High   | 🔥🔥    |
| P2       | Security Hardening               | Medium | 🔥🔥    |
| P2       | Account Quality System           | Low    | 🔥🔥    |
| P3       | Referral System                  | Medium | 🔥🔥    |
| P3       | Announcement System              | Low    | 🔥     |
| P3       | Advanced Analytics               | Medium | 🔥🔥    |
| P4       | SEO & Social                     | Low    | 🔥     |

---

## VERIFICATION PLAN

### Automated
- Start server with `npm run dev`
- Hit every new API endpoint with test requests (successful and error cases)
- Verify database tables create correctly on fresh start

### Manual
- Walk through complete unlock flow with Linkvertise integration
- Spin the wheel and verify cooldown enforcement
- Check admin panel shows all new sections
- Test points earn/spend lifecycle
- Verify referral code generation and tracking
- Test rate limiting by rapid-fire requests
- Confirm anti-abuse IP flagging works

---

> **End of Plan** — All code must be production-ready, follow existing patterns, and integrate seamlessly with the current AccDrop codebase.
