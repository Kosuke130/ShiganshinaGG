//! Cache local SQLite : parties déjà téléchargées et historique des LP.

use crate::riot::MatchLite;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

pub fn open(path: &std::path::Path) -> rusqlite::Result<Connection> {
    let c = Connection::open(path)?;
    c.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA synchronous=NORMAL;
         CREATE TABLE IF NOT EXISTS matches(
            id TEXT PRIMARY KEY, creation INTEGER NOT NULL, queue INTEGER NOT NULL, data TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS match_players(
            puuid TEXT NOT NULL, match_id TEXT NOT NULL, PRIMARY KEY(puuid, match_id)) WITHOUT ROWID;
         CREATE TABLE IF NOT EXISTS lp_snapshots(
            puuid TEXT NOT NULL, queue TEXT NOT NULL, tier TEXT NOT NULL, rank TEXT NOT NULL,
            lp INTEGER NOT NULL, wins INTEGER NOT NULL, losses INTEGER NOT NULL, ts INTEGER NOT NULL);
         CREATE INDEX IF NOT EXISTS lp_idx ON lp_snapshots(puuid, queue, ts);
         CREATE TABLE IF NOT EXISTS meta_matches(
            match_id TEXT PRIMARY KEY, tier TEXT NOT NULL, patch TEXT NOT NULL, ts INTEGER NOT NULL);
         CREATE TABLE IF NOT EXISTS timelines(match_id TEXT PRIMARY KEY, data TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS meta_scanned(puuid TEXT PRIMARY KEY, ts INTEGER NOT NULL);
         CREATE TABLE IF NOT EXISTS premades(match_id TEXT PRIMARY KEY, data TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS recent_ids(puuid TEXT NOT NULL, t0 INTEGER NOT NULL, t1 INTEGER NOT NULL, ids TEXT NOT NULL);
         CREATE INDEX IF NOT EXISTS recent_idx ON recent_ids(puuid);
         CREATE TABLE IF NOT EXISTS meta_parts(
            match_id TEXT NOT NULL, patch TEXT NOT NULL, champ_id INTEGER NOT NULL, pos TEXT NOT NULL, win INTEGER NOT NULL, data TEXT NOT NULL);
         CREATE INDEX IF NOT EXISTS meta_parts_idx ON meta_parts(patch, champ_id);
         CREATE INDEX IF NOT EXISTS meta_parts_m ON meta_parts(match_id);
         CREATE TABLE IF NOT EXISTS meta_bans(match_id TEXT NOT NULL, patch TEXT NOT NULL, champ_id INTEGER NOT NULL);
         CREATE INDEX IF NOT EXISTS meta_bans_idx ON meta_bans(patch);",
    )?;
    Ok(c)
}

pub fn get_match(c: &Connection, id: &str) -> Option<MatchLite> {
    c.query_row("SELECT data FROM matches WHERE id=?1", [id], |r| r.get::<_, String>(0))
        .optional()
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str(&s).ok())
}

/// Vrai si la partie est en cache dans le format actuel (sinon on la retélécharge).
pub fn has_fresh(c: &Connection, id: &str) -> bool {
    get_match(c, id).is_some_and(|m| m.v >= crate::riot::MATCH_V)
}

pub fn save_match(c: &Connection, m: &MatchLite) {
    let Ok(data) = serde_json::to_string(m) else { return };
    let _ = c.execute(
        "INSERT OR REPLACE INTO matches(id, creation, queue, data) VALUES(?1, ?2, ?3, ?4)",
        params![m.id, m.creation, m.queue, data],
    );
    for p in &m.parts {
        let _ = c.execute(
            "INSERT OR IGNORE INTO match_players(puuid, match_id) VALUES(?1, ?2)",
            params![p.puuid, m.id],
        );
    }
}

pub fn matches_for(c: &Connection, puuid: &str, queue: Option<i64>, limit: i64) -> Vec<MatchLite> {
    let sql = "SELECT m.data FROM matches m JOIN match_players p ON p.match_id = m.id
               WHERE p.puuid = ?1 AND (?2 IS NULL OR m.queue = ?2)
               ORDER BY m.creation DESC LIMIT ?3";
    let Ok(mut st) = c.prepare(sql) else { return vec![] };
    let Ok(rows) = st.query_map(params![puuid, queue, limit], |r| r.get::<_, String>(0)) else {
        return vec![];
    };
    rows.filter_map(Result::ok)
        .filter_map(|s| serde_json::from_str(&s).ok())
        .collect()
}

#[derive(Serialize, Clone, PartialEq)]
pub struct Snap {
    pub queue: String,
    pub tier: String,
    pub rank: String,
    pub lp: i64,
    pub wins: i64,
    pub losses: i64,
    pub ts: i64,
}

/// Enregistre un point seulement si quelque chose a changé depuis le dernier.
pub fn record(c: &Connection, puuid: &str, s: &Snap) {
    let last: Option<(String, String, i64, i64, i64)> = c
        .query_row(
            "SELECT tier, rank, lp, wins, losses FROM lp_snapshots
             WHERE puuid=?1 AND queue=?2 ORDER BY ts DESC LIMIT 1",
            params![puuid, s.queue],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .optional()
        .ok()
        .flatten();
    if last == Some((s.tier.clone(), s.rank.clone(), s.lp, s.wins, s.losses)) {
        return;
    }
    let _ = c.execute(
        "INSERT INTO lp_snapshots(puuid, queue, tier, rank, lp, wins, losses, ts)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![puuid, s.queue, s.tier, s.rank, s.lp, s.wins, s.losses, s.ts],
    );
}

pub fn history(c: &Connection, puuid: &str) -> Vec<Snap> {
    let Ok(mut st) = c.prepare(
        "SELECT queue, tier, rank, lp, wins, losses, ts FROM lp_snapshots WHERE puuid=?1 ORDER BY ts",
    ) else {
        return vec![];
    };
    let Ok(rows) = st.query_map([puuid], |r| {
        Ok(Snap {
            queue: r.get(0)?,
            tier: r.get(1)?,
            rank: r.get(2)?,
            lp: r.get(3)?,
            wins: r.get(4)?,
            losses: r.get(5)?,
            ts: r.get(6)?,
        })
    }) else {
        return vec![];
    };
    rows.filter_map(Result::ok).collect()
}

// ---------------------------------------------------------------- méta (builds)

pub fn meta_has(c: &Connection, id: &str) -> bool {
    c.query_row("SELECT 1 FROM meta_matches WHERE match_id=?1", [id], |_| Ok(()))
        .optional()
        .ok()
        .flatten()
        .is_some()
}

pub fn meta_save(c: &Connection, id: &str, tier: &str, patch: &str, ts: i64) {
    let _ = c.execute(
        "INSERT OR REPLACE INTO meta_matches(match_id, tier, patch, ts) VALUES(?1, ?2, ?3, ?4)",
        params![id, tier, patch, ts],
    );
}

pub fn timeline_save(c: &Connection, id: &str, data: &str) {
    let _ = c.execute("INSERT OR REPLACE INTO timelines(match_id, data) VALUES(?1, ?2)", params![id, data]);
}

pub fn scanned_get(c: &Connection) -> std::collections::HashMap<String, i64> {
    let Ok(mut st) = c.prepare("SELECT puuid, ts FROM meta_scanned") else { return Default::default() };
    st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
        .map(|rows| rows.filter_map(Result::ok).collect())
        .unwrap_or_default()
}

pub fn scanned_set(c: &Connection, puuid: &str, ts: i64) {
    let _ = c.execute("INSERT OR REPLACE INTO meta_scanned(puuid, ts) VALUES(?1, ?2)", params![puuid, ts]);
}

/// Parties méta (avec chronologie si disponible) : (partie, chronologie, palier).
pub fn meta_all(c: &Connection, patch: Option<&str>) -> Vec<(MatchLite, Option<String>, String)> {
    let sql = "SELECT m.data, t.data, mm.tier FROM meta_matches mm
               JOIN matches m ON m.id = mm.match_id
               LEFT JOIN timelines t ON t.match_id = mm.match_id
               WHERE (?1 IS NULL OR mm.patch = ?1)";
    let Ok(mut st) = c.prepare(sql) else { return vec![] };
    let Ok(rows) = st.query_map(params![patch], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, String>(2)?))
    }) else {
        return vec![];
    };
    rows.filter_map(Result::ok)
        .filter_map(|(m, t, tier)| Some((serde_json::from_str(&m).ok()?, t, tier)))
        .collect()
}

pub fn meta_patches(c: &Connection) -> Vec<(String, i64)> {
    let Ok(mut st) = c.prepare("SELECT patch, COUNT(*) FROM meta_matches GROUP BY patch") else { return vec![] };
    st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
        .map(|rows| rows.filter_map(Result::ok).collect())
        .unwrap_or_default()
}

// ---------------------------------------------------------------- groupes (premades)

pub fn premade_get(c: &Connection, id: &str) -> Option<String> {
    c.query_row("SELECT data FROM premades WHERE match_id=?1", [id], |r| r.get(0)).optional().ok().flatten()
}

pub fn premade_save(c: &Connection, id: &str, data: &str) {
    let _ = c.execute("INSERT OR REPLACE INTO premades(match_id, data) VALUES(?1, ?2)", params![id, data]);
}

/// Parties récentes d'un joueur déjà téléchargées pour une période couvrant [a, b] (secondes).
pub fn recent_ids_get(c: &Connection, puuid: &str, a: i64, b: i64) -> Option<Vec<String>> {
    c.query_row(
        "SELECT ids FROM recent_ids WHERE puuid=?1 AND t0<=?2 AND t1>=?3 LIMIT 1",
        params![puuid, a, b],
        |r| r.get::<_, String>(0),
    )
    .optional()
    .ok()
    .flatten()
    .and_then(|s| serde_json::from_str(&s).ok())
}

pub fn recent_ids_save(c: &Connection, puuid: &str, t0: i64, t1: i64, ids: &[String]) {
    let _ = c.execute(
        "INSERT INTO recent_ids(puuid, t0, t1, ids) VALUES(?1, ?2, ?3, ?4)",
        params![puuid, t0, t1, serde_json::to_string(ids).unwrap_or_default()],
    );
}

// ---------------------------------------------------------------- méta précalculée (chargement instantané)

pub struct PartRow {
    pub champ: i64,
    pub pos: String,
    pub win: bool,
    pub data: String,
}

pub fn meta_parts_save(c: &Connection, match_id: &str, patch: &str, rows: &[PartRow], bans: &[i64]) {
    let _ = c.execute("DELETE FROM meta_parts WHERE match_id=?1", [match_id]);
    let _ = c.execute("DELETE FROM meta_bans WHERE match_id=?1", [match_id]);
    for r in rows {
        let _ = c.execute(
            "INSERT INTO meta_parts(match_id, patch, champ_id, pos, win, data) VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
            params![match_id, patch, r.champ, r.pos, r.win as i64, r.data],
        );
    }
    for b in bans.iter().filter(|b| **b > 0) {
        let _ = c.execute("INSERT INTO meta_bans(match_id, patch, champ_id) VALUES(?1, ?2, ?3)", params![match_id, patch, b]);
    }
}

pub fn meta_parts_missing(c: &Connection) -> bool {
    let parts: i64 = c.query_row("SELECT COUNT(DISTINCT match_id) FROM meta_parts", [], |r| r.get(0)).unwrap_or(0);
    let metas: i64 = c.query_row("SELECT COUNT(*) FROM meta_matches", [], |r| r.get(0)).unwrap_or(0);
    parts < metas
}

/// (matches, [(champ, pos, games, wins)], [(champ, bans)])
pub fn meta_overview(c: &Connection, patch: Option<&str>) -> (i64, Vec<(i64, String, i64, i64)>, Vec<(i64, i64)>) {
    let matches: i64 = c
        .query_row("SELECT COUNT(*) FROM meta_matches WHERE (?1 IS NULL OR patch = ?1)", params![patch], |r| r.get(0))
        .unwrap_or(0);
    let mut list = vec![];
    if let Ok(mut st) = c.prepare(
        "SELECT champ_id, pos, COUNT(*), SUM(win) FROM meta_parts WHERE (?1 IS NULL OR patch = ?1) GROUP BY champ_id, pos",
    ) {
        if let Ok(rows) = st.query_map(params![patch], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))) {
            list = rows.filter_map(Result::ok).collect();
        }
    }
    let mut bans = vec![];
    if let Ok(mut st) = c.prepare("SELECT champ_id, COUNT(*) FROM meta_bans WHERE (?1 IS NULL OR patch = ?1) GROUP BY champ_id") {
        if let Ok(rows) = st.query_map(params![patch], |r| Ok((r.get(0)?, r.get(1)?))) {
            bans = rows.filter_map(Result::ok).collect();
        }
    }
    (matches, list, bans)
}

pub fn meta_part_rows(c: &Connection, champ: Option<i64>, pos: Option<&str>, patch: Option<&str>) -> Vec<String> {
    let sql = "SELECT data FROM meta_parts WHERE (?1 IS NULL OR champ_id = ?1) AND (?2 IS NULL OR pos = ?2) AND (?3 IS NULL OR patch = ?3)";
    let Ok(mut st) = c.prepare(sql) else { return vec![] };
    st.query_map(params![champ, pos, patch], |r| r.get::<_, String>(0))
        .map(|rows| rows.filter_map(Result::ok).collect())
        .unwrap_or_default()
}
