// Runs under Electron's Node (npm test sets ELECTRON_RUN_AS_NODE) so better-sqlite3's native build matches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db.js';

const zone = {x: 100, y: 200, w: 170, h: 230};
const pitch = (x, extra = {}) => ({type: 'FB', glove: {x: 185, y: 315, t: 1.5}, manual: null, loc: {x, y: 320, t: 2.1}, zone, ...extra});

test('athletes, sessions and pitches round-trip', () => {
  const db = openDb(':memory:');
  const a = db.createAthlete({name: '  Sam Ortiz ', throws: 'L', level: 'HS'});
  assert.equal(a.name, 'Sam Ortiz'); assert.equal(a.throws, 'L');
  const s = db.createSession({athleteId: a.id, videoPath: '/tmp/pen.mov', title: 'pen.mov', fps: 120});
  assert.equal(s.fps, 120); assert.equal(s.cameraView, 'pitcher'); assert.match(s.recordedOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(db.updateSession(s.id, {zone, crop: {cx: 1, cy: 2, w: 3}}).zone.w, 170);

  const p1 = db.addPitch(s.id, pitch(200)), p2 = db.addPitch(s.id, pitch(210, {manual: {x: 190, y: 300, t: 1.5}}));
  assert.equal(p1.n, 1); assert.equal(p2.n, 2);
  assert.deepEqual(p2.manual, {x: 190, y: 300, t: 1.5}); assert.equal(p1.manual, null);
  assert.deepEqual(db.updatePitch(p1.id, {...p1, type: 'SL'}).type, 'SL');

  const got = db.getSession(s.id);
  assert.equal(got.athlete.id, a.id); assert.equal(got.pitches.length, 2); assert.deepEqual(got.pitches[0].zone, zone);
  const roster = db.listAthletes();
  assert.equal(roster[0].sessionCount, 1); assert.equal(roster[0].latest.pitches.length, 2);
  assert.ok(db.hasVideo('/tmp/pen.mov')); assert.ok(!db.hasVideo('/etc/passwd'));
});

test('listLibrary returns every athlete with sessions newest first', () => {
  const db = openDb(':memory:');
  db.createAthlete({name: 'Zed'});
  const amy = db.createAthlete({name: 'amy'});
  const older = db.createSession({athleteId: amy.id, recordedOn: '2026-10-01'});
  const newer = db.createSession({athleteId: amy.id, recordedOn: '2026-10-20'});
  db.addPitch(older.id, pitch(200));
  db.addPitch(newer.id, pitch(200)); db.addPitch(newer.id, pitch(210));
  const lib = db.listLibrary();
  assert.deepEqual(lib.map(a => a.name), ['amy', 'Zed']);
  assert.deepEqual(lib[0].sessions.map(s => s.recordedOn), ['2026-10-20', '2026-10-01']);
  assert.equal(lib[0].sessions[0].pitches.length, 2);
  assert.deepEqual(lib[1].sessions, []);
});

test('deleting a pitch renumbers the rest', () => {
  const db = openDb(':memory:');
  const s = db.createSession({athleteId: db.createAthlete({name: 'A'}).id});
  const ids = [1, 2, 3].map(i => db.addPitch(s.id, pitch(200 + i)).id);
  const rest = db.deletePitch(ids[0]);
  assert.deepEqual(rest.map(p => p.n), [1, 2]);
  assert.equal(db.addPitch(s.id, pitch(250)).n, 3);
});

test('rescaling to a different resolution scales every stored coordinate', () => {
  const db = openDb(':memory:');
  const s = db.createSession({athleteId: db.createAthlete({name: 'A'}).id});
  db.rescaleSession(s.id, 1080, 1920);          // first load just records the size
  db.updateSession(s.id, {zone, crop: {cx: 500, cy: 900, w: 400}});
  db.addPitch(s.id, pitch(200, {path: {pts: [[1.8, 300, 250], [2.1, 200, 320]]}}));
  db.addPitch(s.id, pitch(210, {path: {pts: []}}));
  const {session, pitches} = db.rescaleSession(s.id, 2160, 3840);
  assert.equal(session.frameW, 2160); assert.equal(session.zone.w, 340); assert.equal(session.crop.cx, 1000);
  assert.equal(pitches[0].loc.x, 400); assert.equal(pitches[0].zone.x, 200); assert.equal(pitches[0].glove.t, 1.5);
  assert.deepEqual(pitches[0].path.pts, [[1.8, 600, 500], [2.1, 400, 640]]);
  assert.deepEqual(pitches[1].path, {pts: []});
});

test('a pitch keeps its ball path until an update replaces or clears it', () => {
  const db = openDb(':memory:');
  const s = db.createSession({athleteId: db.createAthlete({name: 'A'}).id});
  const p = db.addPitch(s.id, pitch(200));
  assert.equal(p.path, null); // not traced yet
  const path = {pts: [[1.9, 260, 280], [2.1, 200, 320]]};
  assert.deepEqual(db.updatePitch(p.id, {...p, path}).path, path);
  assert.deepEqual(db.updatePitch(p.id, {...db.getSession(s.id).pitches[0], type: 'SL'}).path, path);
  assert.equal(db.updatePitch(p.id, {...p, path: null}).path, null);
  const set = db.setPitchPath(p.id, {pts: []});
  assert.deepEqual(set.path, {pts: []}); assert.equal(set.type, 'FB');
  assert.equal(db.setPitchPath(9999, path), null); // the pitch was deleted while it was being traced
});

test('a model-proposed target round-trips, updates and scales with the session', () => {
  const db = openDb(':memory:');
  const s = db.createSession({athleteId: db.createAthlete({name: 'A'}).id});
  db.rescaleSession(s.id, 1080, 1920);
  const hand = db.addPitch(s.id, pitch(200));
  assert.equal(hand.auto, null); // a hand-placed target has no proposal
  const auto = {x: 205, y: 290, score: 0.71, state: 'proposed'};
  const p = db.addPitch(s.id, pitch(210, {auto}));
  assert.deepEqual(p.auto, auto);
  assert.deepEqual(db.updatePitch(p.id, {...p, auto: {...auto, state: 'confirmed'}}).auto.state, 'confirmed');
  const {pitches} = db.rescaleSession(s.id, 2160, 3840);
  assert.deepEqual(pitches[1].auto, {x: 410, y: 580, score: 0.71, state: 'confirmed'});
  assert.equal(pitches[0].auto, null);
});

test('deleting an athlete removes their sessions and pitches', () => {
  const db = openDb(':memory:');
  const a = db.createAthlete({name: 'A'}), s = db.createSession({athleteId: a.id});
  db.addPitch(s.id, pitch(200));
  db.deleteAthlete(a.id);
  assert.equal(db.getSession(s.id), null); assert.equal(db.listAthletes().length, 0);
});

test('unknown fields are rejected', () => {
  const db = openDb(':memory:');
  const a = db.createAthlete({name: 'A'});
  assert.throws(() => db.updateAthlete(a.id, {id: 99}), /Unknown athletes field/);
  assert.throws(() => db.createAthlete({name: ' '}), /required/);
});
