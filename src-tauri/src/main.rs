#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod riot;

use db::Snap;
use riot::MatchLite;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct Settings {
    pub api_key: String,
    pub platform: String,
    pub main_riot_id: String,
    pub league_path: String,
    pub rp_to_eur: f64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            platform: "euw1".into(),
            main_riot_id: String::new(),
            league_path: String::new(),
            rp_to_eur: 0.00725, // ≈ 10 € pour 1 380 RP
        }
    }
}

#[derive(Default)]
pub struct Cache {
    champs: Option<Value>,
}

pub struct AppState {
    pub http: reqwest::Client,
    pub db: Mutex<rusqlite::Connection>,
    pub limiter: tokio::sync::Mutex<VecDeque<Instant>>,
    pub settings: Mutex<Settings>,
    pub cache: tokio::sync::Mutex<Cache>,
    pub dir: PathBuf,
    pub meta_running: std::sync::atomic::AtomicBool,
    pub meta_cancel: std::sync::atomic::AtomicBool,
    pub premade_queue: Mutex<VecDeque<(String, String)>>,
    pub premade_running: std::sync::atomic::AtomicBool,
}

type R<T> = Result<T, String>;

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

// ---------------------------------------------------------------- Paramètres

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
fn save_settings(state: State<'_, AppState>, settings: Settings) -> R<()> {
    let txt = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(state.dir.join("settings.json"), txt).map_err(|e| e.to_string())?;
    *state.settings.lock().unwrap() = settings;
    Ok(())
}

// ---------------------------------------------------------------- Profil & LP

#[derive(Serialize)]
struct Profile {
    puuid: String,
    game_name: String,
    tag_line: String,
    platform: String,
    icon: i64,
    level: i64,
    ranks: Vec<Snap>,
}

async fn fetch_ranks(st: &AppState, puuid: &str, platform: &str) -> R<Vec<Snap>> {
    let v = riot::get(st, &format!("https://{platform}.api.riotgames.com/lol/league/v4/entries/by-puuid/{puuid}")).await?;
    let ts = now_ms();
    let snaps: Vec<Snap> = v
        .as_array()
        .map(|a| a.as_slice())
        .unwrap_or_default()
        .iter()
        .map(|e| Snap {
            queue: e["queueType"].as_str().unwrap_or_default().into(),
            tier: e["tier"].as_str().unwrap_or_default().into(),
            rank: e["rank"].as_str().unwrap_or_default().into(),
            lp: e["leaguePoints"].as_i64().unwrap_or(0),
            wins: e["wins"].as_i64().unwrap_or(0),
            losses: e["losses"].as_i64().unwrap_or(0),
            ts,
        })
        .collect();
    let db = st.db.lock().unwrap();
    for s in &snaps {
        db::record(&db, puuid, s);
    }
    Ok(snaps)
}

#[tauri::command]
async fn lookup(state: State<'_, AppState>, game_name: String, tag_line: String, platform: String) -> R<Profile> {
    let acc = riot::get(
        &state,
        &format!(
            "https://{}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/{}/{}",
            riot::account_region(&platform),
            riot::enc(game_name.trim()),
            riot::enc(tag_line.trim().trim_start_matches('#'))
        ),
    )
    .await?;
    let puuid = acc["puuid"].as_str().ok_or("Compte introuvable.")?.to_string();
    let summ = riot::get(&state, &format!("https://{platform}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/{puuid}")).await?;
    let ranks = fetch_ranks(&state, &puuid, &platform).await?;
    Ok(Profile {
        game_name: acc["gameName"].as_str().unwrap_or(&game_name).into(),
        tag_line: acc["tagLine"].as_str().unwrap_or(&tag_line).into(),
        icon: summ["profileIconId"].as_i64().unwrap_or(29),
        level: summ["summonerLevel"].as_i64().unwrap_or(0),
        puuid,
        platform,
        ranks,
    })
}

#[tauri::command]
async fn refresh_ranks(state: State<'_, AppState>, puuid: String, platform: String) -> R<Vec<Snap>> {
    fetch_ranks(&state, &puuid, &platform).await
}

#[tauri::command]
fn lp_history(state: State<'_, AppState>, puuid: String) -> Vec<Snap> {
    db::history(&state.db.lock().unwrap(), &puuid)
}

// ---------------------------------------------------------------- Parties

#[derive(Serialize, Clone)]
struct SyncProgress {
    done: usize,
    total: usize,
}

#[tauri::command]
async fn fetch_matches(
    app: AppHandle,
    state: State<'_, AppState>,
    puuid: String,
    platform: String,
    start: u32,
    count: u32,
) -> R<Vec<MatchLite>> {
    let reg = riot::regional(&platform);
    let ids: Vec<String> = serde_json::from_value(
        riot::get(
            &state,
            &format!("https://{reg}.api.riotgames.com/lol/match/v5/matches/by-puuid/{puuid}/ids?start={start}&count={}", count.min(100)),
        )
        .await?,
    )
    .map_err(|e| e.to_string())?;

    let missing: Vec<String> = {
        let db = state.db.lock().unwrap();
        ids.iter().filter(|id| !db::has_fresh(&db, id)).cloned().collect()
    };
    let total = missing.len();
    let mut done = 0;
    let mut first_err = None;
    for chunk in missing.chunks(6) {
        let futs = chunk.iter().map(|id| {
            let url = format!("https://{reg}.api.riotgames.com/lol/match/v5/matches/{id}");
            let st = &*state;
            async move { riot::get(st, &url).await }
        });
        let results = futures::future::join_all(futs).await;
        {
            let db = state.db.lock().unwrap();
            for r in results {
                match r {
                    Ok(raw) => db::save_match(&db, &riot::to_lite(&raw)),
                    Err(e) => {
                        first_err.get_or_insert(e);
                    }
                }
            }
        }
        done += chunk.len();
        let _ = app.emit("sync", SyncProgress { done, total });
    }

    let db = state.db.lock().unwrap();
    let out: Vec<MatchLite> = ids.iter().filter_map(|id| db::get_match(&db, id)).collect();
    if out.is_empty() && !ids.is_empty() {
        if let Some(e) = first_err {
            return Err(e);
        }
    }
    Ok(out)
}

#[tauri::command]
fn cached_matches(state: State<'_, AppState>, puuid: String, limit: i64) -> Vec<MatchLite> {
    db::matches_for(&state.db.lock().unwrap(), &puuid, None, limit)
}

#[derive(Serialize, Default)]
struct ChampStat {
    champ: String,
    champ_id: i64,
    games: i64,
    wins: i64,
    k: i64,
    d: i64,
    a: i64,
    cs: i64,
    dmg: i64,
    gold: i64,
    vision: i64,
    secs: i64,
    last: i64,
}

#[tauri::command]
fn champion_stats(state: State<'_, AppState>, puuid: String, queue: Option<i64>) -> Vec<ChampStat> {
    let matches = db::matches_for(&state.db.lock().unwrap(), &puuid, queue, 5000);
    let mut map: HashMap<i64, ChampStat> = HashMap::new();
    for m in matches.iter().filter(|m| !m.remake) {
        let Some(p) = m.parts.iter().find(|p| p.puuid == puuid) else { continue };
        let e = map.entry(p.champ_id).or_default();
        e.champ = p.champ.clone();
        e.champ_id = p.champ_id;
        e.games += 1;
        e.wins += p.win as i64;
        e.k += p.k;
        e.d += p.d;
        e.a += p.a;
        e.cs += p.cs;
        e.dmg += p.dmg;
        e.gold += p.gold;
        e.vision += p.vision;
        e.secs += m.duration;
        e.last = e.last.max(m.creation);
    }
    let mut v: Vec<ChampStat> = map.into_values().collect();
    v.sort_by(|a, b| b.games.cmp(&a.games).then(b.wins.cmp(&a.wins)));
    v
}

// ---------------------------------------------------------------- Maîtrises

#[tauri::command]
async fn masteries(state: State<'_, AppState>, puuid: String, platform: String) -> R<Value> {
    let list = riot::get(
        &state,
        &format!("https://{platform}.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/{puuid}"),
    )
    .await?;
    let score = riot::get(&state, &format!("https://{platform}.api.riotgames.com/lol/champion-mastery/v4/scores/by-puuid/{puuid}"))
        .await
        .unwrap_or(Value::Null);
    let out: Vec<Value> = list
        .as_array()
        .map(|a| a.as_slice())
        .unwrap_or_default()
        .iter()
        .map(|m| {
            json!({
                "champ_id": m["championId"],
                "level": m["championLevel"],
                "points": m["championPoints"],
                "last": m["lastPlayTime"],
                "next": m["championPointsUntilNextLevel"],
                "since": m["championPointsSinceLastLevel"],
                "marks": m["tokensEarned"],
                "season_milestone": m["championSeasonMilestone"],
                "grades": m["milestoneGrades"],
            })
        })
        .collect();
    Ok(json!({ "score": score, "list": out }))
}

// ---------------------------------------------------------------- Groupes (premades)

/// Identifiants des parties récentes de plusieurs joueurs (pour repérer qui joue ensemble).
/// `around` (ms) : centre la recherche sur une date passée (± 4 jours).
#[tauri::command]
async fn recent_ids(
    state: State<'_, AppState>,
    puuids: Vec<String>,
    platform: String,
    around: Option<i64>,
) -> R<HashMap<String, Vec<String>>> {
    let reg = riot::regional(&platform);
    let window = around
        .map(|t| {
            let s = t / 1000;
            format!("&startTime={}&endTime={}", s - 4 * 86400, s + 4 * 86400)
        })
        .unwrap_or_default();
    let st = &*state;
    let res = futures::future::join_all(puuids.iter().filter(|p| !p.is_empty()).map(|pu| {
        let url = format!("https://{reg}.api.riotgames.com/lol/match/v5/matches/by-puuid/{pu}/ids?start=0&count=30{window}");
        async move {
            let ids: Vec<String> = riot::get(st, &url)
                .await
                .ok()
                .and_then(|v| serde_json::from_value(v).ok())
                .unwrap_or_default();
            (pu.clone(), ids)
        }
    }))
    .await;
    Ok(res.into_iter().collect())
}

// ---------------------------------------------------------------- Méta : builds Master+

/// Sorts (Q/W/E/R) et passif d'un champion, pour l'ordre des compétences.
#[tauri::command]
async fn champ_spells(state: State<'_, AppState>, id: String, version: String) -> R<Value> {
    let v = fetch_json(&state, &format!("https://ddragon.leagueoflegends.com/cdn/{version}/data/fr_FR/champion/{id}.json")).await?;
    let c = &v["data"][&id];
    Ok(json!({
        "spells": c["spells"].as_array().map(|a| a.iter().map(|sp| json!({
            "name": sp["name"],
            "img": format!("https://ddragon.leagueoflegends.com/cdn/{version}/img/spell/{}", sp["image"]["full"].as_str().unwrap_or_default()),
        })).collect::<Vec<_>>()).unwrap_or_default(),
        "passive": {
            "name": c["passive"]["name"],
            "img": format!("https://ddragon.leagueoflegends.com/cdn/{version}/img/passive/{}", c["passive"]["image"]["full"].as_str().unwrap_or_default()),
        },
    }))
}

use std::sync::atomic::Ordering;

#[tauri::command]
fn meta_status(state: State<'_, AppState>) -> Value {
    backfill_meta_parts(&state);
    let db = state.db.lock().unwrap();
    let patches = db::meta_patches(&db);
    let total: i64 = patches.iter().map(|p| p.1).sum();
    json!({
        "matches": total,
        "patches": patches.iter().map(|(p, n)| json!({"patch": p, "matches": n})).collect::<Vec<_>>(),
        "running": state.meta_running.load(Ordering::SeqCst),
    })
}

#[tauri::command]
fn meta_cancel(state: State<'_, AppState>) {
    state.meta_cancel.store(true, Ordering::SeqCst);
}

#[tauri::command]
async fn meta_sync(app: AppHandle, state: State<'_, AppState>, platform: String, count: u32, patch: Option<String>) -> R<u32> {
    if state.meta_running.swap(true, Ordering::SeqCst) {
        return Err("Un import est déjà en cours.".into());
    }
    state.meta_cancel.store(false, Ordering::SeqCst);
    let res = meta_sync_inner(&app, &state, &platform, count, patch.as_deref()).await;
    state.meta_running.store(false, Ordering::SeqCst);
    let _ = app.emit("meta", json!({"done": res.as_ref().copied().unwrap_or(0), "total": count, "finished": true}));
    res
}

/// "16.23" < "16.24" (comparaison numérique).
fn patch_older(a: &str, b: &str) -> bool {
    let v = |p: &str| p.split('.').map(|x| x.parse::<u32>().unwrap_or(0)).collect::<Vec<_>>();
    v(a) < v(b)
}

async fn meta_sync_inner(app: &AppHandle, st: &AppState, platform: &str, count: u32, patch: Option<&str>) -> R<u32> {
    let reg = riot::regional(platform);
    let emit = |done: u32, phase: &str| {
        let _ = app.emit("meta", json!({"done": done, "total": count, "phase": phase}));
    };
    emit(0, "Lecture du classement Master+…");
    // joueurs Challenger, Grand Maître et Maître
    let mut players: Vec<(String, String, i64)> = vec![];
    for (path, tier) in [("challengerleagues", "CHALLENGER"), ("grandmasterleagues", "GRANDMASTER"), ("masterleagues", "MASTER")] {
        let url = format!("https://{platform}.api.riotgames.com/lol/league/v4/{path}/by-queue/RANKED_SOLO_5x5");
        if let Some(v) = riot::get_bg(st, &url).await? {
            for e in v["entries"].as_array().map(|a| a.as_slice()).unwrap_or_default() {
                if let Some(pu) = e["puuid"].as_str() {
                    players.push((pu.to_string(), tier.to_string(), e["leaguePoints"].as_i64().unwrap_or(0)));
                }
            }
        }
        if players.len() > 3000 {
            break;
        }
    }
    if players.is_empty() {
        return Err("Impossible de lire le classement Master+ de cette région.".into());
    }
    // on privilégie les joueurs les moins récemment parcourus, puis les meilleurs LP
    let scanned = db::scanned_get(&st.db.lock().unwrap());
    players.sort_by_key(|(pu, _, lp)| (scanned.get(pu).copied().unwrap_or(0), -lp));

    let since = (now_ms() / 1000) - 14 * 86400;
    let mut done = 0u32;
    for (pu, tier, _) in players {
        if done >= count || st.meta_cancel.load(Ordering::SeqCst) {
            break;
        }
        emit(done, "Import des parties…");
        let url = format!("https://{reg}.api.riotgames.com/lol/match/v5/matches/by-puuid/{pu}/ids?queue=420&type=ranked&start=0&count=100&startTime={since}");
        let ids: Vec<String> = riot::get_bg(st, &url)
            .await?
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();
        db::scanned_set(&st.db.lock().unwrap(), &pu, now_ms());
        for id in ids {
            if done >= count || st.meta_cancel.load(Ordering::SeqCst) {
                break;
            }
            if db::meta_has(&st.db.lock().unwrap(), &id) {
                continue;
            }
            // la détection des groupes de ton historique passe en priorité
            while st.premade_running.load(Ordering::SeqCst) && !st.meta_cancel.load(Ordering::SeqCst) {
                tokio::time::sleep(Duration::from_millis(800)).await;
            }
            let lite = {
                let cached = db::get_match(&st.db.lock().unwrap(), &id).filter(|m| m.v >= riot::MATCH_V && m.parts.first().is_some_and(|p| !p.perks.is_empty()));
                match cached {
                    Some(m) => m,
                    None => {
                        let Some(raw) = riot::get_bg(st, &format!("https://{reg}.api.riotgames.com/lol/match/v5/matches/{id}")).await? else { continue };
                        let m = riot::to_lite(&raw);
                        db::save_match(&st.db.lock().unwrap(), &m);
                        m
                    }
                }
            };
            if lite.remake || lite.queue != 420 {
                continue;
            }
            // seulement le patch en cours : les parties suivantes de ce joueur sont encore plus anciennes
            if patch.is_some_and(|p| patch_older(&lite.patch, p)) {
                break;
            }
            // chronologie (ordre des compétences/objets, écarts à 15 min) sur 1 partie sur 4 :
            // c'est une requête de plus par partie, le quota de la clé est le facteur limitant
            let mut tl_data = None;
            if done % 4 == 0 {
                if let Some(tl) = riot::get_bg(st, &format!("https://{reg}.api.riotgames.com/lol/match/v5/matches/{id}/timeline")).await? {
                    if let Ok(data) = serde_json::to_string(&riot::timeline_lite(&tl)) {
                        db::timeline_save(&st.db.lock().unwrap(), &id, &data);
                        tl_data = Some(data);
                    }
                }
            }
            db::meta_save(&st.db.lock().unwrap(), &id, &tier, &lite.patch, lite.creation);
            save_meta_parts(st, &lite, tl_data.as_deref(), &tier);
            done += 1;
            emit(done, "Import des parties…");
        }
    }
    Ok(done)
}

/// Lignes précalculées (une par joueur) d'une partie méta, pour un chargement instantané.
fn build_meta_rows(m: &MatchLite, tl: Option<&str>, tier: &str) -> Vec<db::PartRow> {
    let tl: HashMap<String, riot::TimelineLite> = tl.and_then(|t| serde_json::from_str(t).ok()).unwrap_or_default();
    let mut out = vec![];
    for p in &m.parts {
            let opp = m.parts.iter().find(|o| o.team != p.team && o.pos == p.pos && !p.pos.is_empty()).map(|o| o.champ_id);
            let team: Vec<_> = m.parts.iter().filter(|o| o.team == p.team).collect();
            let tk: i64 = team.iter().map(|o| o.k).sum();
            let td: i64 = team.iter().map(|o| o.dmg).sum();
            let t = tl.get(&p.puuid);
            let o = m.parts.iter().find(|o| o.team != p.team && o.pos == p.pos && !p.pos.is_empty());
            let ot = o.and_then(|o| tl.get(&o.puuid));
            let allies: Vec<Value> = team.iter().filter(|a| a.puuid != p.puuid).map(|a| json!([a.champ_id, a.pos])).collect();
            let extra = json!({
                "phys": p.phys, "magic": p.magic, "true": p.true_dmg, "heal": p.heal, "shield": p.shield, "mitigated": p.mitigated,
                "fb": p.first_blood, "doubles": p.doubles, "triples": p.triples, "quadras": p.quadras, "pentas": p.pentas,
                "turret": p.turret_dmg, "spree": p.spree, "cc": p.cc, "allies": allies,
            });
            let lane = json!({
                "opp_k": o.map(|o| o.k), "opp_d": o.map(|o| o.d), "opp_cs10": o.map(|o| o.cs10), "opp_gold": o.map(|o| o.gold), "opp_dmg": o.map(|o| o.dmg),
                "at10": t.and_then(|t| t.at10), "at15": t.and_then(|t| t.at15),
                "opp_at10": ot.and_then(|t| t.at10), "opp_at15": ot.and_then(|t| t.at15),
            });
            let mut row = json!({
                "champ": p.champ_id, "pos": p.pos, "win": p.win, "tier": tier, "patch": m.patch, "dur": m.duration,
                "k": p.k, "d": p.d, "a": p.a, "cs": p.cs, "dmg": p.dmg, "gold": p.gold, "vision": p.vision,
                "cs10": p.cs10, "dead": p.dead, "wards": p.wards, "pinks": p.pinks, "taken": p.dmg_taken,
                "solo": p.solo_kills, "plates": p.plates, "obj": p.obj_dmg,
                "kp": if tk > 0 { (p.k + p.a) as f64 / tk as f64 } else { 0.0 },
                "dshare": if td > 0 { p.dmg as f64 / td as f64 } else { 0.0 },
                "items": p.items, "spells": p.spells, "style": p.style, "sub": p.sub_style,
                "perks": p.perks, "shards": p.shards, "opp": opp,
                "skills": t.map(|t| t.skills.clone()), "buys": t.map(|t| t.buys.clone()),
            });
            if let Some(obj) = row.as_object_mut() {
                for part in [extra, lane] {
                    if let Value::Object(x) = part {
                        obj.extend(x);
                    }
                }
            }
            out.push(db::PartRow { champ: p.champ_id, pos: p.pos.clone(), win: p.win, data: row.to_string() });
        }
    out
}

fn save_meta_parts(st: &AppState, m: &MatchLite, tl: Option<&str>, tier: &str) {
    let rows = build_meta_rows(m, tl, tier);
    let bans: Vec<i64> = m.teams.iter().flat_map(|t| t.bans.clone()).collect();
    db::meta_parts_save(&st.db.lock().unwrap(), &m.id, &m.patch, &rows, &bans);
}

/// Recalcule la table précalculée à partir des parties méta déjà importées (une seule fois).
fn backfill_meta_parts(st: &AppState) {
    if !db::meta_parts_missing(&st.db.lock().unwrap()) {
        return;
    }
    let all = db::meta_all(&st.db.lock().unwrap(), None);
    for (m, tl, tier) in all {
        save_meta_parts(st, &m, tl.as_deref(), &tier);
    }
}

/// Popularité et winrate de chaque champion par rôle dans les parties méta.
#[tauri::command]
fn meta_overview(state: State<'_, AppState>, patch: Option<String>) -> Value {
    let (matches, list, bans) = db::meta_overview(&state.db.lock().unwrap(), patch.as_deref());
    json!({
        "matches": matches,
        "list": list.into_iter().map(|(c, pos, g, w)| json!({"champ_id": c, "pos": pos, "games": g, "wins": w})).collect::<Vec<_>>(),
        "bans": bans.into_iter().map(|(c, n)| (c.to_string(), json!(n))).collect::<serde_json::Map<_, _>>(),
    })
}

/// Données détaillées (runes, objets, compétences, stats…) des joueurs méta, pour un champion et/ou un rôle.
#[tauri::command]
fn meta_rows(state: State<'_, AppState>, champ_id: Option<i64>, pos: Option<String>, patch: Option<String>) -> Vec<Value> {
    db::meta_part_rows(&state.db.lock().unwrap(), champ_id, pos.as_deref(), patch.as_deref())
        .into_iter()
        .filter_map(|d| serde_json::from_str(&d).ok())
        .collect()
}

// ---------------------------------------------------------------- Groupes automatiques (arrière-plan)

/// Groupes déjà calculés pour ces parties : id -> { puuid: {n, size} }.
#[tauri::command]
fn premades_get(state: State<'_, AppState>, ids: Vec<String>) -> HashMap<String, Value> {
    let db = state.db.lock().unwrap();
    ids.into_iter()
        .filter_map(|id| {
            let v = db::premade_get(&db, &id).and_then(|d| serde_json::from_str(&d).ok())?;
            Some((id, v))
        })
        .collect()
}

/// Ajoute des parties à analyser (les plus récentes en premier) et lance le travail en arrière-plan.
#[tauri::command]
fn premades_queue(app: AppHandle, state: State<'_, AppState>, ids: Vec<String>, platform: String) {
    {
        let db = state.db.lock().unwrap();
        let new: Vec<String> = ids.into_iter().filter(|id| db::premade_get(&db, id).is_none()).collect();
        let mut q = state.premade_queue.lock().unwrap();
        q.retain(|(id, _)| !new.contains(id));
        for id in new.into_iter().rev() {
            q.push_front((id, platform.clone()));
        }
    }
    if !state.premade_running.swap(true, Ordering::SeqCst) {
        tauri::async_runtime::spawn(premade_worker(app.clone()));
    }
}

async fn premade_worker(app: AppHandle) {
    let st = app.state::<AppState>();
    loop {
        loop {
            let next = st.premade_queue.lock().unwrap().pop_front();
            let Some((id, platform)) = next else { break };
            if db::premade_get(&st.db.lock().unwrap(), &id).is_some() {
                continue;
            }
            let Some(m) = db::get_match(&st.db.lock().unwrap(), &id) else { continue };
            match compute_premades(&st, &m, &platform).await {
                Ok(groups) => {
                    db::premade_save(&st.db.lock().unwrap(), &id, &groups.to_string());
                    let left = st.premade_queue.lock().unwrap().len();
                    let _ = app.emit("premade", json!({"id": id, "groups": groups, "left": left}));
                }
                Err(_) => {
                    // clé expirée, réseau… : on arrête, la file sera relancée plus tard
                    st.premade_queue.lock().unwrap().clear();
                    break;
                }
            }
        }
        st.premade_running.store(false, Ordering::SeqCst);
        // une demande a pu arriver entre-temps
        if st.premade_queue.lock().unwrap().is_empty() || st.premade_running.swap(true, Ordering::SeqCst) {
            break;
        }
    }
}

async fn compute_premades(st: &AppState, m: &MatchLite, platform: &str) -> R<Value> {
    let reg = riot::regional(platform);
    let t = m.creation / 1000;
    let now = now_ms() / 1000;
    let mut ids: HashMap<String, std::collections::HashSet<String>> = HashMap::new();
    for p in &m.parts {
        if p.puuid.is_empty() || p.puuid == "BOT" {
            continue;
        }
        let cached = db::recent_ids_get(&st.db.lock().unwrap(), &p.puuid, t - 2 * 86400, (t + 2 * 86400).min(now));
        let list = match cached {
            Some(l) => l,
            None => {
                let (a, b) = (t - 4 * 86400, (t + 4 * 86400).min(now));
                let url = format!(
                    "https://{reg}.api.riotgames.com/lol/match/v5/matches/by-puuid/{}/ids?start=0&count=40&startTime={a}&endTime={b}",
                    p.puuid
                );
                let l: Vec<String> = riot::get_bg(st, &url).await?.and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default();
                db::recent_ids_save(&st.db.lock().unwrap(), &p.puuid, a, b, &l);
                l
            }
        };
        ids.insert(p.puuid.clone(), list.into_iter().filter(|x| x != &m.id).collect());
    }
    let arena = m.queue == 1700 || m.queue == 1710;
    let key = |p: &riot::Part| if arena { p.subteam } else { p.team };
    let mut teams: Vec<i64> = m.parts.iter().map(key).collect();
    teams.sort();
    teams.dedup();
    let mut out = serde_json::Map::new();
    let mut n = 0;
    for team in teams {
        let ps: Vec<&riot::Part> = m.parts.iter().filter(|p| key(p) == team && ids.get(&p.puuid).is_some_and(|s| !s.is_empty())).collect();
        let mut parent: Vec<usize> = (0..ps.len()).collect();
        fn find(p: &mut Vec<usize>, x: usize) -> usize {
            if p[x] != x {
                let r = find(p, p[x]);
                p[x] = r;
            }
            p[x]
        }
        for i in 0..ps.len() {
            for j in i + 1..ps.len() {
                let shared = ids[&ps[i].puuid].intersection(&ids[&ps[j].puuid]).count();
                if shared >= 2 {
                    let (a, b) = (find(&mut parent, i), find(&mut parent, j));
                    parent[a] = b;
                }
            }
        }
        let mut groups: HashMap<usize, Vec<usize>> = HashMap::new();
        for i in 0..ps.len() {
            let r = find(&mut parent, i);
            groups.entry(r).or_default().push(i);
        }
        let mut gs: Vec<Vec<usize>> = groups.into_values().filter(|g| g.len() >= 2).collect();
        gs.sort();
        for g in gs {
            for i in &g {
                out.insert(ps[*i].puuid.clone(), json!({"n": n, "size": g.len()}));
            }
            n += 1;
        }
    }
    Ok(Value::Object(out))
}

// ---------------------------------------------------------------- Partie en cours

#[tauri::command]
async fn live_game(state: State<'_, AppState>, puuid: String, platform: String) -> R<Value> {
    let Some(g) = riot::get_opt(
        &state,
        &format!("https://{platform}.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/{puuid}"),
    )
    .await?
    else {
        return Ok(Value::Null);
    };
    let parts: Vec<Value> = g["participants"].as_array().cloned().unwrap_or_default();
    let st = &*state;
    let ranks = futures::future::join_all(parts.iter().map(|p| {
        let pu = p["puuid"].as_str().unwrap_or_default().to_string();
        let url = format!("https://{platform}.api.riotgames.com/lol/league/v4/entries/by-puuid/{pu}");
        async move {
            if pu.is_empty() {
                return Value::Array(vec![]);
            }
            riot::get(st, &url).await.unwrap_or(Value::Array(vec![]))
        }
    }))
    .await;
    let players: Vec<Value> = parts
        .iter()
        .zip(ranks)
        .map(|(p, r)| {
            json!({
                "puuid": p["puuid"],
                "name": p["riotId"],
                "champ_id": p["championId"],
                "team": p["teamId"],
                "spells": [p["spell1Id"], p["spell2Id"]],
                "keystone": p["perks"]["perkIds"][0],
                "sub_style": p["perks"]["perkSubStyle"],
                "icon": p["profileIconId"],
                "ranks": r.as_array().map(|a| a.iter().map(|e| json!({
                    "queue": e["queueType"], "tier": e["tier"], "rank": e["rank"],
                    "lp": e["leaguePoints"], "wins": e["wins"], "losses": e["losses"],
                    "hot": e["hotStreak"],
                })).collect::<Vec<_>>()).unwrap_or_default(),
            })
        })
        .collect();
    Ok(json!({
        "queue": g["gameQueueConfigId"],
        "mode": g["gameMode"],
        "start": g["gameStartTime"],
        "length": g["gameLength"],
        "bans": g["bannedChampions"],
        "players": players,
    }))
}

// ---------------------------------------------------------------- Données statiques

async fn fetch_json(st: &AppState, url: &str) -> R<Value> {
    st.http
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())
}

fn cdragon_icon(path: &str) -> String {
    tile_url(path)
}

async fn build_static(st: &AppState) -> R<Value> {
    let versions = fetch_json(st, "https://ddragon.leagueoflegends.com/api/versions.json").await?;
    let ver = versions[0].as_str().ok_or("Data Dragon indisponible")?.to_string();
    let base = format!("https://ddragon.leagueoflegends.com/cdn/{ver}/data/fr_FR");
    let (champs, items, spells) = futures::future::join3(
        fetch_json(st, &format!("{base}/champion.json")),
        fetch_json(st, &format!("{base}/item.json")),
        fetch_json(st, &format!("{base}/summoner.json")),
    )
    .await;
    let champs = champs?;
    let list: Vec<Value> = champs["data"]
        .as_object()
        .map(|o| {
            o.values()
                .map(|c| json!({"id": c["id"], "key": c["key"], "name": c["name"], "title": c["title"], "tags": c["tags"]}))
                .collect()
        })
        .unwrap_or_default();
    let items: serde_json::Map<String, Value> = items
        .ok()
        .and_then(|v| v["data"].as_object().cloned())
        .map(|o| {
            o.into_iter()
                .map(|(k, v)| {
                    let into = v["into"].as_array().map(|a| !a.is_empty()).unwrap_or(false);
                    let boots = v["tags"].as_array().is_some_and(|t| t.iter().any(|x| x == "Boots"));
                    let consumable = v["tags"].as_array().is_some_and(|t| t.iter().any(|x| x == "Consumable" || x == "Trinket"));
                    (k, json!({"name": v["name"], "gold": v["gold"]["total"], "complete": !into, "boots": boots, "consumable": consumable}))
                })
                .collect()
        })
        .unwrap_or_default();
    let spells: serde_json::Map<String, Value> = spells
        .ok()
        .and_then(|v| v["data"].as_object().cloned())
        .map(|o| {
            o.into_values()
                .filter_map(|v| Some((v["key"].as_str()?.to_string(), json!({"id": v["id"], "name": v["name"]}))))
                .collect()
        })
        .unwrap_or_default();
    // Runes : icônes officielles Data Dragon, CommunityDragon en secours (fragments de stats…)
    let mut runes = serde_json::Map::new();
    let cd = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/fr_fr/v1";
    let (reforged, perks, styles) = futures::future::join3(
        fetch_json(st, &format!("{base}/runesReforged.json")),
        fetch_json(st, &format!("{cd}/perks.json")),
        fetch_json(st, &format!("{cd}/perkstyles.json")),
    )
    .await;
    for p in perks.ok().and_then(|v| v.as_array().cloned()).unwrap_or_default() {
        if let (Some(id), Some(icon)) = (p["id"].as_i64(), p["iconPath"].as_str()) {
            runes.insert(id.to_string(), json!({"name": p["name"], "icon": cdragon_icon(icon)}));
        }
    }
    for s in styles.ok().and_then(|v| v["styles"].as_array().cloned()).unwrap_or_default() {
        if let (Some(id), Some(icon)) = (s["id"].as_i64(), s["iconPath"].as_str()) {
            runes.insert(id.to_string(), json!({"name": s["name"], "icon": cdragon_icon(icon)}));
        }
    }
    let dd_img = |icon: &Value| format!("https://ddragon.leagueoflegends.com/cdn/img/{}", icon.as_str().unwrap_or_default());
    let reforged = reforged.ok().and_then(|v| v.as_array().cloned()).unwrap_or_default();
    let trees: Vec<Value> = reforged
        .iter()
        .map(|st| {
            json!({
                "id": st["id"],
                "slots": st["slots"].as_array().map(|sl| sl.iter().map(|x| x["runes"].as_array().map(|r| r.iter().map(|y| y["id"].clone()).collect::<Vec<_>>()).unwrap_or_default()).collect::<Vec<_>>()).unwrap_or_default(),
            })
        })
        .collect();
    for style in reforged {
        if let Some(id) = style["id"].as_i64() {
            runes.insert(id.to_string(), json!({"name": style["name"], "icon": dd_img(&style["icon"])}));
        }
        for slot in style["slots"].as_array().cloned().unwrap_or_default() {
            for r in slot["runes"].as_array().cloned().unwrap_or_default() {
                if let Some(id) = r["id"].as_i64() {
                    runes.insert(id.to_string(), json!({"name": r["name"], "icon": dd_img(&r["icon"])}));
                }
            }
        }
    }
    Ok(json!({ "version": ver, "champs": list, "items": items, "spells": spells, "runes": runes, "trees": trees, "fmt": 5 }))
}

#[tauri::command]
async fn static_data(state: State<'_, AppState>) -> R<Value> {
    let mut cache = state.cache.lock().await;
    if let Some(v) = &cache.champs {
        return Ok(v.clone());
    }
    let st = &*state;
    let path = st.dir.join("static.json");
    let cached: Option<Value> = std::fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str(&s).ok());
    let fresh = std::fs::metadata(&path)
        .and_then(|m| m.modified())
        .map(|t| t.elapsed().unwrap_or_default() < Duration::from_secs(86400))
        .unwrap_or(false);
    let v = match cached {
        Some(v) if fresh && v["fmt"] == 5 => v,
        old => match build_static(st).await {
            Ok(v) => {
                let _ = std::fs::write(&path, v.to_string());
                v
            }
            Err(e) => old.ok_or(e)?,
        },
    };
    cache.champs = Some(v.clone());
    Ok(v)
}

/// Chemin d'asset du client (« /lol-game-data/assets/… ») -> URL CommunityDragon.
fn tile_url(path: &str) -> String {
    let rest = path.trim_start_matches("/lol-game-data/assets/").to_lowercase();
    format!("https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/{rest}")
}

// ---------------------------------------------------------------- Démarrage

/// Reprend les données de l'ancienne version (RiftPulse) au premier lancement.
fn migrate_from_riftpulse(dir: &std::path::Path) {
    if dir.join("settings.json").exists() {
        return;
    }
    let Some(old) = dir.parent().map(|p| p.join("app.riftpulse.desktop")) else { return };
    let Ok(entries) = std::fs::read_dir(&old) else { return };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let target = name.replacen("riftpulse.db", "shiganshinagg.db", 1);
        if e.path().is_file() {
            let _ = std::fs::copy(e.path(), dir.join(target));
        }
    }
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            migrate_from_riftpulse(&dir);
            let settings: Settings = std::fs::read_to_string(dir.join("settings.json"))
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default();
            let conn = db::open(&dir.join("shiganshinagg.db"))?;
            let http = reqwest::Client::builder()
                .timeout(Duration::from_secs(20))
                .user_agent("ShiganshinaGG/1.0")
                .build()?;
            app.manage(AppState {
                http,
                db: Mutex::new(conn),
                limiter: tokio::sync::Mutex::new(VecDeque::new()),
                settings: Mutex::new(settings),
                cache: tokio::sync::Mutex::new(Cache::default()),
                dir,
                meta_running: Default::default(),
                meta_cancel: Default::default(),
                premade_queue: Mutex::new(VecDeque::new()),
                premade_running: Default::default(),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            lookup,
            refresh_ranks,
            lp_history,
            fetch_matches,
            cached_matches,
            champion_stats,
            static_data,
            masteries,
            live_game,
            recent_ids,
            meta_status,
            meta_cancel,
            meta_sync,
            meta_overview,
            meta_rows,
            champ_spells,
            premades_get,
            premades_queue,
        ])
        .run(tauri::generate_context!())
        .expect("impossible de démarrer ShiganshinaGG");
}
