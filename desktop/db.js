// SQLite store: athletes → sessions (one bullpen video each) → pitches.
// Points are stored as x/y/t columns in frame pixels; zone and crop rectangles as JSON.
import Database from 'better-sqlite3';

const MIGRATIONS = [
  `CREATE TABLE athletes(
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL,
     throws TEXT NOT NULL DEFAULT 'R' CHECK(throws IN ('R','L')),
     level TEXT NOT NULL DEFAULT '',
     notes TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL DEFAULT (datetime('now')));
   CREATE TABLE sessions(
     id INTEGER PRIMARY KEY,
     athlete_id INTEGER NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
     recorded_on TEXT NOT NULL DEFAULT (date('now','localtime')),
     title TEXT NOT NULL DEFAULT '',
     video_path TEXT,
     frame_w INTEGER, frame_h INTEGER,
     fps INTEGER NOT NULL DEFAULT 240,
     hit_radius REAL NOT NULL DEFAULT 6,
     camera_view TEXT NOT NULL DEFAULT 'pitcher' CHECK(camera_view IN ('pitcher','catcher')),
     zone TEXT, crop TEXT,
     notes TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL DEFAULT (datetime('now')));
   CREATE INDEX sessions_athlete ON sessions(athlete_id, recorded_on);
   CREATE TABLE pitches(
     id INTEGER PRIMARY KEY,
     session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
     n INTEGER NOT NULL,
     type TEXT NOT NULL,
     glove_x REAL, glove_y REAL, glove_t REAL,
     manual_x REAL, manual_y REAL, manual_t REAL,
     loc_x REAL NOT NULL, loc_y REAL NOT NULL, loc_t REAL,
     zone TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now')));
   CREATE INDEX pitches_session ON pitches(session_id, n);`,
];

const json = v => v == null ? null : JSON.stringify(v);
const parse = v => v == null ? null : JSON.parse(v);
const pt = (r, k) => r[k+'_x'] == null ? null : {x: r[k+'_x'], y: r[k+'_y'], t: r[k+'_t']};
const ptCols = (p, k) => ({[k+'_x']: p[k]?.x ?? null, [k+'_y']: p[k]?.y ?? null, [k+'_t']: p[k]?.t ?? null});

const athleteRow = r => r && {id: r.id, name: r.name, throws: r.throws, level: r.level, notes: r.notes, createdAt: r.created_at};
const sessionRow = r => r && {id: r.id, athleteId: r.athlete_id, recordedOn: r.recorded_on, title: r.title, videoPath: r.video_path,
  frameW: r.frame_w, frameH: r.frame_h, fps: r.fps, hitRadius: r.hit_radius, cameraView: r.camera_view,
  zone: parse(r.zone), crop: parse(r.crop), notes: r.notes, createdAt: r.created_at};
const pitchRow = r => ({id: r.id, sessionId: r.session_id, n: r.n, type: r.type,
  glove: pt(r,'glove'), manual: pt(r,'manual'), loc: pt(r,'loc'), zone: parse(r.zone)});

// Fields callers may patch, mapped to columns (and an encoder for JSON columns).
const ATHLETE_FIELDS = {name:'name', throws:'throws', level:'level', notes:'notes'};
const SESSION_FIELDS = {recordedOn:'recorded_on', title:'title', videoPath:'video_path', frameW:'frame_w', frameH:'frame_h',
  fps:'fps', hitRadius:'hit_radius', cameraView:'camera_view', zone:['zone',json], crop:['crop',json], notes:'notes'};

function patchSql(table, fields, id, patch){
  const sets = [], vals = {id};
  for(const [k, v] of Object.entries(patch)){
    const f = fields[k]; if(!f) throw new Error(`Unknown ${table} field: ${k}`);
    const [col, enc] = Array.isArray(f) ? f : [f, x => x];
    sets.push(`${col} = @${col}`); vals[col] = enc(v);
  }
  return sets.length ? [`UPDATE ${table} SET ${sets.join(', ')} WHERE id = @id`, vals] : null;
}

export function openDb(file){
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const version = db.pragma('user_version', {simple: true});
  for(let v = version; v < MIGRATIONS.length; v++){
    db.transaction(() => { db.exec(MIGRATIONS[v]); db.pragma(`user_version = ${v+1}`); })();
  }

  const q = {
    athletes: db.prepare(`SELECT a.*, (SELECT count(*) FROM sessions s WHERE s.athlete_id = a.id) AS session_count,
      (SELECT max(recorded_on) FROM sessions s WHERE s.athlete_id = a.id) AS last_session FROM athletes a ORDER BY a.name COLLATE NOCASE`),
    athlete: db.prepare('SELECT * FROM athletes WHERE id = ?'),
    sessionsFor: db.prepare('SELECT * FROM sessions WHERE athlete_id = ? ORDER BY recorded_on DESC, id DESC'),
    session: db.prepare('SELECT * FROM sessions WHERE id = ?'),
    pitchesFor: db.prepare('SELECT * FROM pitches WHERE session_id = ? ORDER BY n'),
    pitch: db.prepare('SELECT * FROM pitches WHERE id = ?'),
    nextN: db.prepare('SELECT coalesce(max(n), 0) + 1 AS n FROM pitches WHERE session_id = ?'),
    insertAthlete: db.prepare('INSERT INTO athletes(name, throws, level, notes) VALUES (@name, @throws, @level, @notes)'),
    insertSession: db.prepare(`INSERT INTO sessions(athlete_id, recorded_on, title, video_path, fps, hit_radius, camera_view)
      VALUES (@athlete_id, coalesce(@recorded_on, date('now','localtime')), @title, @video_path, @fps, @hit_radius, @camera_view)`),
    insertPitch: db.prepare(`INSERT INTO pitches(session_id, n, type, glove_x, glove_y, glove_t, manual_x, manual_y, manual_t, loc_x, loc_y, loc_t, zone)
      VALUES (@session_id, @n, @type, @glove_x, @glove_y, @glove_t, @manual_x, @manual_y, @manual_t, @loc_x, @loc_y, @loc_t, @zone)`),
    updatePitch: db.prepare(`UPDATE pitches SET type=@type, glove_x=@glove_x, glove_y=@glove_y, glove_t=@glove_t,
      manual_x=@manual_x, manual_y=@manual_y, manual_t=@manual_t, loc_x=@loc_x, loc_y=@loc_y, loc_t=@loc_t, zone=@zone WHERE id=@id`),
    hasVideo: db.prepare('SELECT 1 FROM sessions WHERE video_path = ? LIMIT 1'),
  };
  const pitchesFor = id => q.pitchesFor.all(id).map(pitchRow);
  const getSession = id => sessionRow(q.session.get(id));

  const api = {
    listAthletes(){
      return q.athletes.all().map(r => {
        const latest = q.sessionsFor.get(r.id);
        return {...athleteRow(r), sessionCount: r.session_count, lastSession: r.last_session,
          latest: latest ? {...sessionRow(latest), pitches: pitchesFor(latest.id)} : null};
      });
    },
    createAthlete({name, throws = 'R', level = '', notes = ''}){
      if(!name?.trim()) throw new Error('Athlete name is required');
      const {lastInsertRowid} = q.insertAthlete.run({name: name.trim(), throws, level, notes});
      return athleteRow(q.athlete.get(lastInsertRowid));
    },
    updateAthlete(id, patch){
      const sql = patchSql('athletes', ATHLETE_FIELDS, id, patch); if(sql) db.prepare(sql[0]).run(sql[1]);
      return athleteRow(q.athlete.get(id));
    },
    deleteAthlete(id){ db.prepare('DELETE FROM athletes WHERE id = ?').run(id); },
    getAthlete(id){
      const a = athleteRow(q.athlete.get(id)); if(!a) return null;
      return {...a, sessions: q.sessionsFor.all(id).map(r => ({...sessionRow(r), pitches: pitchesFor(r.id)}))};
    },

    createSession({athleteId, recordedOn = null, title = '', videoPath = null, fps = 240, hitRadius = 6, cameraView = 'pitcher'}){
      const {lastInsertRowid} = q.insertSession.run({athlete_id: athleteId, recorded_on: recordedOn, title, video_path: videoPath,
        fps, hit_radius: hitRadius, camera_view: cameraView});
      return getSession(lastInsertRowid);
    },
    getSession(id){
      const s = getSession(id); if(!s) return null;
      return {session: s, athlete: athleteRow(q.athlete.get(s.athleteId)), pitches: pitchesFor(id)};
    },
    updateSession(id, patch){
      const sql = patchSql('sessions', SESSION_FIELDS, id, patch); if(sql) db.prepare(sql[0]).run(sql[1]);
      return getSession(id);
    },
    deleteSession(id){ db.prepare('DELETE FROM sessions WHERE id = ?').run(id); },
    // The video was swapped for a copy at another resolution: scale every stored coordinate to match.
    rescaleSession: db.transaction((id, w, h) => {
      const s = getSession(id);
      if(s.frameW && s.frameW !== w){
        const k = w / s.frameW, sp = o => o && {...o, x: o.x*k, y: o.y*k}, box = b => b && {x: b.x*k, y: b.y*k, w: b.w*k, h: b.h*k};
        const crop = s.crop && {...s.crop, cx: s.crop.cx*k, cy: s.crop.cy*k, w: s.crop.w*k};
        api.updateSession(id, {zone: box(s.zone), crop});
        for(const p of pitchesFor(id)) api.updatePitch(p.id, {...p, glove: sp(p.glove), manual: sp(p.manual), loc: sp(p.loc), zone: box(p.zone)});
      }
      api.updateSession(id, {frameW: w, frameH: h});
      return api.getSession(id);
    }),

    addPitch(sessionId, p){
      const {n} = q.nextN.get(sessionId);
      const {lastInsertRowid} = q.insertPitch.run({session_id: sessionId, n, type: p.type,
        ...ptCols(p,'glove'), ...ptCols(p,'manual'), ...ptCols(p,'loc'), zone: json(p.zone)});
      return pitchRow(q.pitch.get(lastInsertRowid));
    },
    updatePitch(id, p){
      q.updatePitch.run({id, type: p.type, ...ptCols(p,'glove'), ...ptCols(p,'manual'), ...ptCols(p,'loc'), zone: json(p.zone)});
      return pitchRow(q.pitch.get(id));
    },
    // Delete and renumber the rest so pitch numbers stay 1..n.
    deletePitch: db.transaction(id => {
      const p = q.pitch.get(id); if(!p) return [];
      db.prepare('DELETE FROM pitches WHERE id = ?').run(id);
      db.prepare('UPDATE pitches SET n = n - 1 WHERE session_id = ? AND n > ?').run(p.session_id, p.n);
      return pitchesFor(p.session_id);
    }),

    hasVideo: path => !!q.hasVideo.get(path),
    close: () => db.close(),
  };
  return api;
}
