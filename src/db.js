import { Database } from 'bun:sqlite';
import { mkdirSync } from 'fs';

mkdirSync('./data', { recursive: true });

const db = new Database('./data/polymart.db');

// bun:sqlite uses db.exec() for pragmas instead of db.pragma()
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA synchronous = NORMAL');
db.exec('PRAGMA cache_size = -32000');
db.exec('PRAGMA temp_store = MEMORY');
db.exec('PRAGMA mmap_size = 268435456');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS guild_config (
    guild_id            TEXT PRIMARY KEY,
    starting_balance    REAL    NOT NULL DEFAULT 10000,
    trading_fee_pct     REAL    NOT NULL DEFAULT 0.001,
    daily_bonus         REAL    NOT NULL DEFAULT 500,
    trade_channel_id    TEXT,
    alert_channel_id    TEXT,
    announce_channel_id TEXT,
    setup_by            TEXT,
    created_at          INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS users (
    guild_id    TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    balance     REAL NOT NULL DEFAULT 10000,
    last_daily  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (guild_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS holdings (
    guild_id    TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    ticker      TEXT NOT NULL,
    asset_type  TEXT NOT NULL DEFAULT 'stock',
    shares      REAL NOT NULL DEFAULT 0,
    avg_cost    REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id, ticker)
  );

  CREATE TABLE IF NOT EXISTS trades (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id    TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    ticker      TEXT NOT NULL,
    asset_type  TEXT NOT NULL DEFAULT 'stock',
    side        TEXT NOT NULL,
    shares      REAL NOT NULL,
    price       REAL NOT NULL,
    total       REAL NOT NULL,
    fee         REAL NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS watchlist (
    guild_id    TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    ticker      TEXT NOT NULL,
    asset_type  TEXT NOT NULL DEFAULT 'stock',
    added_at    INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (guild_id, user_id, ticker)
  );

  CREATE TABLE IF NOT EXISTS price_alerts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id    TEXT NOT NULL,
    channel_id  TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    ticker      TEXT NOT NULL,
    asset_type  TEXT NOT NULL DEFAULT 'stock',
    direction   TEXT NOT NULL,
    threshold   REAL NOT NULL,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- Polymart account links (global — not per-guild)
  CREATE TABLE IF NOT EXISTS polymart_links (
    discord_user_id TEXT    PRIMARY KEY,
    clerk_user_id   TEXT    NOT NULL,
    portfolio_id    INTEGER NOT NULL,
    display_name    TEXT,
    linked_at       INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- Unlocked achievements (per guild, per user)
  CREATE TABLE IF NOT EXISTS achievements (
    guild_id    TEXT    NOT NULL,
    user_id     TEXT    NOT NULL,
    code        TEXT    NOT NULL,
    unlocked_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (guild_id, user_id, code)
  );

  -- Per-user lifetime casino stats
  CREATE TABLE IF NOT EXISTS casino_stats (
    guild_id    TEXT    NOT NULL,
    user_id     TEXT    NOT NULL,
    games       INTEGER NOT NULL DEFAULT 0,
    wins        INTEGER NOT NULL DEFAULT 0,
    wagered     REAL    NOT NULL DEFAULT 0,
    won         REAL    NOT NULL DEFAULT 0,
    lost        REAL    NOT NULL DEFAULT 0,
    net         REAL    NOT NULL DEFAULT 0,
    biggest_win REAL    NOT NULL DEFAULT 0,
    cur_streak  INTEGER NOT NULL DEFAULT 0,
    best_streak INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  );

  -- Progressive slots jackpot pool (per guild)
  CREATE TABLE IF NOT EXISTS casino_jackpot (
    guild_id TEXT PRIMARY KEY,
    pool     REAL NOT NULL DEFAULT 0
  );

  -- Final standings snapshot when a season is reset
  CREATE TABLE IF NOT EXISTS season_winners (
    guild_id  TEXT    NOT NULL,
    season_no INTEGER NOT NULL,
    user_id   TEXT    NOT NULL,
    rank      INTEGER NOT NULL,
    balance   REAL    NOT NULL,
    ended_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (guild_id, season_no, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_trades_guild_user   ON trades(guild_id, user_id);
  CREATE INDEX IF NOT EXISTS idx_holdings_guild_user ON holdings(guild_id, user_id);
  CREATE INDEX IF NOT EXISTS idx_alerts_ticker       ON price_alerts(ticker, asset_type);
`);

// ── Lightweight column migrations ─────────────────────────────────────────────
// SQLite has no "ADD COLUMN IF NOT EXISTS", so we check PRAGMA table_info first.
// Idempotent: safe to run on every boot.
function addColumnIfMissing(table, column, ddl) {
  // pragma_table_info() (table-valued form) reliably returns rows via prepare().all().
  const cols = db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all();
  if (!cols.some(c => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

addColumnIfMissing('users', 'daily_streak', 'daily_streak INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('users', 'best_streak',  'best_streak INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('users', 'xp',           'xp INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('users', 'level',        'level INTEGER NOT NULL DEFAULT 1');
addColumnIfMissing('users', 'last_beg',     'last_beg INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('users', 'last_work',    'last_work INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('guild_config', 'season_no', 'season_no INTEGER NOT NULL DEFAULT 1');

// Self-heal legacy guild_config tables created before these columns existed.
// Without these, /setup, /config, and /setchannel throw "no such column" on old DBs.
addColumnIfMissing('guild_config', 'starting_balance',    'starting_balance REAL NOT NULL DEFAULT 10000');
addColumnIfMissing('guild_config', 'trading_fee_pct',     'trading_fee_pct REAL NOT NULL DEFAULT 0.001');
addColumnIfMissing('guild_config', 'daily_bonus',         'daily_bonus REAL NOT NULL DEFAULT 500');
addColumnIfMissing('guild_config', 'trade_channel_id',    'trade_channel_id TEXT');
addColumnIfMissing('guild_config', 'alert_channel_id',    'alert_channel_id TEXT');
addColumnIfMissing('guild_config', 'announce_channel_id', 'announce_channel_id TEXT');
addColumnIfMissing('guild_config', 'setup_by',            'setup_by TEXT');

export const stmt = {
  getConfig:    db.prepare('SELECT * FROM guild_config WHERE guild_id = ?'),
  upsertConfig: db.prepare(`
    INSERT INTO guild_config (guild_id, starting_balance, trading_fee_pct, daily_bonus, setup_by)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      starting_balance = excluded.starting_balance,
      trading_fee_pct  = excluded.trading_fee_pct,
      daily_bonus      = excluded.daily_bonus,
      setup_by         = excluded.setup_by
  `),

  getUser:       db.prepare('SELECT * FROM users WHERE guild_id = ? AND user_id = ?'),
  upsertUser:    db.prepare(`
    INSERT INTO users (guild_id, user_id, balance)
    VALUES (?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO NOTHING
  `),
  updateBalance: db.prepare('UPDATE users SET balance = ? WHERE guild_id = ? AND user_id = ?'),
  setLastDaily:  db.prepare('UPDATE users SET last_daily = ? WHERE guild_id = ? AND user_id = ?'),
  adjustBalance: db.prepare('UPDATE users SET balance = MAX(0, balance + ?) WHERE guild_id = ? AND user_id = ?'),

  getHolding:           db.prepare('SELECT * FROM holdings WHERE guild_id = ? AND user_id = ? AND ticker = ?'),
  getAllHoldings:        db.prepare('SELECT * FROM holdings WHERE guild_id = ? AND user_id = ? AND shares > 0'),
  upsertHolding:        db.prepare(`
    INSERT INTO holdings (guild_id, user_id, ticker, asset_type, shares, avg_cost)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id, ticker) DO UPDATE SET
      shares   = excluded.shares,
      avg_cost = excluded.avg_cost
  `),
  deleteHoldingsForUser: db.prepare('DELETE FROM holdings WHERE guild_id = ? AND user_id = ?'),

  insertTrade: db.prepare(`
    INSERT INTO trades (guild_id, user_id, ticker, asset_type, side, shares, price, total, fee)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getTrades: db.prepare(`
    SELECT * FROM trades WHERE guild_id = ? AND user_id = ?
    ORDER BY created_at DESC LIMIT ? OFFSET ?
  `),
  getAllTradesOrdered: db.prepare(`
    SELECT * FROM trades WHERE guild_id = ? AND user_id = ?
    ORDER BY created_at ASC LIMIT 50000
  `),
  deleteTradesForUser: db.prepare('DELETE FROM trades WHERE guild_id = ? AND user_id = ?'),

  getWatchlist:  db.prepare('SELECT * FROM watchlist WHERE guild_id = ? AND user_id = ?'),
  addWatch:      db.prepare('INSERT OR IGNORE INTO watchlist (guild_id, user_id, ticker, asset_type) VALUES (?, ?, ?, ?)'),
  removeWatch:   db.prepare('DELETE FROM watchlist WHERE guild_id = ? AND user_id = ? AND ticker = ?'),

  getAlerts:       db.prepare('SELECT * FROM price_alerts WHERE guild_id = ? AND user_id = ?'),
  countAlerts:     db.prepare('SELECT COUNT(*) as cnt FROM price_alerts WHERE guild_id = ? AND user_id = ?'),
  getAllAlerts:     db.prepare('SELECT * FROM price_alerts'),
  insertAlert:     db.prepare('INSERT INTO price_alerts (guild_id, channel_id, user_id, ticker, asset_type, direction, threshold) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  deleteAlert:     db.prepare('DELETE FROM price_alerts WHERE id = ? AND user_id = ?'),
  deleteAlertById: db.prepare('DELETE FROM price_alerts WHERE id = ?'),

  serverLeaderboard: db.prepare(`
    SELECT user_id, balance FROM users WHERE guild_id = ? ORDER BY balance DESC LIMIT 10
  `),

  // Progression (streaks / XP / level)
  setStreak: db.prepare('UPDATE users SET daily_streak = ?, best_streak = MAX(best_streak, ?) WHERE guild_id = ? AND user_id = ?'),
  setXp:     db.prepare('UPDATE users SET xp = ?, level = ? WHERE guild_id = ? AND user_id = ?'),

  // Casino timed rewards
  setLastBeg:  db.prepare('UPDATE users SET last_beg = ? WHERE guild_id = ? AND user_id = ?'),
  setLastWork: db.prepare('UPDATE users SET last_work = ? WHERE guild_id = ? AND user_id = ?'),

  // Casino stats
  getCasinoStats:    db.prepare('SELECT * FROM casino_stats WHERE guild_id = ? AND user_id = ?'),
  upsertCasinoStats: db.prepare(`
    INSERT INTO casino_stats (guild_id, user_id, games, wins, wagered, won, lost, net, biggest_win, cur_streak, best_streak)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET
      games=excluded.games, wins=excluded.wins, wagered=excluded.wagered, won=excluded.won,
      lost=excluded.lost, net=excluded.net, biggest_win=excluded.biggest_win,
      cur_streak=excluded.cur_streak, best_streak=excluded.best_streak
  `),
  casinoLeaderboard: db.prepare('SELECT user_id, net FROM casino_stats WHERE guild_id = ? ORDER BY net DESC LIMIT 10'),

  // Progressive jackpot
  getJackpot: db.prepare('SELECT pool FROM casino_jackpot WHERE guild_id = ?'),
  addJackpot: db.prepare('INSERT INTO casino_jackpot (guild_id, pool) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET pool = pool + excluded.pool'),
  setJackpot: db.prepare('INSERT INTO casino_jackpot (guild_id, pool) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET pool = excluded.pool'),

  // Achievements
  getAchievements:   db.prepare('SELECT code, unlocked_at FROM achievements WHERE guild_id = ? AND user_id = ?'),
  insertAchievement: db.prepare('INSERT OR IGNORE INTO achievements (guild_id, user_id, code) VALUES (?, ?, ?)'),
  countUserTrades:   db.prepare('SELECT COUNT(*) AS cnt FROM trades WHERE guild_id = ? AND user_id = ?'),

  // Seasons / ROI leaderboard
  allGuildUsers:     db.prepare('SELECT user_id, balance FROM users WHERE guild_id = ?'),
  allGuildHoldings:  db.prepare('SELECT user_id, ticker, asset_type, shares, avg_cost FROM holdings WHERE guild_id = ? AND shares > 0'),
  insertSeasonWinner: db.prepare('INSERT OR IGNORE INTO season_winners (guild_id, season_no, user_id, rank, balance) VALUES (?, ?, ?, ?, ?)'),
  getSeasonWinners:   db.prepare('SELECT * FROM season_winners WHERE guild_id = ? AND season_no = ? ORDER BY rank ASC'),

  // Polymart account links (keyed by Discord user ID — cross-guild)
  getLink:    db.prepare('SELECT * FROM polymart_links WHERE discord_user_id = ?'),
  saveLink:   db.prepare(`
    INSERT INTO polymart_links (discord_user_id, clerk_user_id, portfolio_id, display_name)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(discord_user_id) DO UPDATE SET
      clerk_user_id = excluded.clerk_user_id,
      portfolio_id  = excluded.portfolio_id,
      display_name  = excluded.display_name,
      linked_at     = unixepoch()
  `),
  deleteLink: db.prepare('DELETE FROM polymart_links WHERE discord_user_id = ?'),
};

export function getOrCreateUser(guildId, userId, startingBalance = 10000) {
  stmt.upsertUser.run(guildId, userId, startingBalance);
  return stmt.getUser.get(guildId, userId);
}

export function getConfig(guildId) {
  return stmt.getConfig.get(guildId) ?? {
    starting_balance:    10000,
    trading_fee_pct:     0.001,
    daily_bonus:         500,
    trade_channel_id:    null,
    alert_channel_id:    null,
    announce_channel_id: null,
    setup_by:            null,
  };
}

export function updateChannelConfig(guildId, setupBy, column, channelId) {
  const allowed = ['trade_channel_id', 'alert_channel_id', 'announce_channel_id'];
  if (!allowed.includes(column)) throw new Error('Invalid channel column');
  db.prepare(`
    INSERT INTO guild_config (guild_id, setup_by) VALUES (?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET ${column} = ?
  `).run(guildId, setupBy, channelId);
}

export const executeTrade = db.transaction((guildId, userId, ticker, assetType, side, shares, price, fee) => {
  const user    = stmt.getUser.get(guildId, userId);
  const holding = stmt.getHolding.get(guildId, userId, ticker);
  const total   = shares * price;

  if (side === 'buy') {
    if (user.balance < total + fee) return { ok: false, error: 'Insufficient balance.' };
    const newBalance = user.balance - total - fee;
    const oldShares  = holding?.shares ?? 0;
    const oldCost    = holding?.avg_cost ?? 0;
    const newShares  = oldShares + shares;
    const newAvgCost = (oldShares * oldCost + total) / newShares;
    stmt.updateBalance.run(newBalance, guildId, userId);
    stmt.upsertHolding.run(guildId, userId, ticker, assetType, newShares, newAvgCost);
    stmt.insertTrade.run(guildId, userId, ticker, assetType, 'buy', shares, price, total, fee);
    return { ok: true, newBalance, newShares, avgCost: newAvgCost };
  }

  if (side === 'sell') {
    if (!holding || holding.shares < shares) return { ok: false, error: `You only hold ${holding?.shares ?? 0} shares.` };
    const newBalance = user.balance + total - fee;
    const newShares  = holding.shares - shares;
    stmt.updateBalance.run(newBalance, guildId, userId);
    stmt.upsertHolding.run(guildId, userId, ticker, assetType, newShares, holding.avg_cost);
    stmt.insertTrade.run(guildId, userId, ticker, assetType, 'sell', shares, price, total, fee);
    return { ok: true, newBalance, newShares, pnl: (price - holding.avg_cost) * shares };
  }
});

export const resetUserData = db.transaction((guildId, userId, startingBalance) => {
  stmt.updateBalance.run(startingBalance, guildId, userId);
  stmt.deleteHoldingsForUser.run(guildId, userId);
  stmt.deleteTradesForUser.run(guildId, userId);
});

// Snapshot the current top 10 into season_winners, bump the season number, and
// wipe every player's positions/balance back to the starting line. Atomic.
export const resetSeason = db.transaction((guildId, startingBalance) => {
  const config   = stmt.getConfig.get(guildId);
  const seasonNo = config?.season_no ?? 1;

  const standings = stmt.serverLeaderboard.all(guildId);
  standings.forEach((row, i) =>
    stmt.insertSeasonWinner.run(guildId, seasonNo, row.user_id, i + 1, row.balance)
  );

  for (const u of stmt.allGuildUsers.all(guildId)) {
    stmt.updateBalance.run(startingBalance, guildId, u.user_id);
    stmt.deleteHoldingsForUser.run(guildId, u.user_id);
    stmt.deleteTradesForUser.run(guildId, u.user_id);
    stmt.setStreak.run(0, 0, guildId, u.user_id);
  }

  db.prepare('UPDATE guild_config SET season_no = season_no + 1 WHERE guild_id = ?').run(guildId);
  return { endedSeason: seasonNo, winners: standings.length };
});

export default db;
