import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AVATAR_COLORS, HUD, MIN_CLIP, initials, avatarColor, toolState, clipFor, nextSelection } from '../renderer/ui-logic.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);
const pt = t => ({x: 0, y: 0, t});
const noDraft = {glove: null, manual: null, loc: null};

test('initials take the first and last word, uppercased', () => {
  assert.equal(initials('Sam Ortiz'), 'SO');
});

test('initials of a single word use its first letter only', () => {
  assert.equal(initials('  cher '), 'C');
});

test('initials of a long name still use only the first and last word', () => {
  assert.equal(initials('Mary Jo Van Dyke'), 'MD');
});

test('initials of a blank name are a question mark', () => {
  assert.equal(initials(''), '?');
});

test('avatarColor is stable for the same name and comes from the palette', () => {
  assert.equal(avatarColor('Sam Ortiz'), avatarColor('Sam Ortiz'));
  assert.ok(AVATAR_COLORS.includes(avatarColor('Sam Ortiz')));
});

test('with no zone drawn, the zone tool is active', () => {
  assert.deepStrictEqual(
    toolState({mode: 'zone', hasZone: false, hasVideo: true, draft: noDraft, selected: null, editField: null}),
    {active: 'zone', catchEnabled: false, hud: HUD.zone});
});

test('target mode activates the target tool without catch', () => {
  assert.deepStrictEqual(
    toolState({mode: 'target', hasZone: true, hasVideo: true, draft: noDraft, selected: null, editField: null}),
    {active: 'target', catchEnabled: false, hud: HUD.target});
});

test('location mode with a glove placed activates catch', () => {
  assert.deepStrictEqual(
    toolState({mode: 'location', hasZone: true, hasVideo: true, draft: {...noDraft, glove: pt(1)}, selected: null, editField: null}),
    {active: 'catch', catchEnabled: true, hud: HUD.catch});
});

test('manual mode activates the manual tool', () => {
  const s = toolState({mode: 'manual', hasZone: true, hasVideo: true, draft: noDraft, selected: null, editField: null});
  assert.equal(s.active, 'manual');
  assert.equal(s.hud, HUD.manual);
});

test('editing the location of a selected pitch activates catch with an editing HUD', () => {
  const s = toolState({mode: 'location', hasZone: true, hasVideo: true, draft: noDraft, selected: {n: 4}, editField: 'loc'});
  assert.equal(s.active, 'catch');
  assert.equal(s.hud, 'Editing #4');
});

test('re-marking the location enables catch even when the mode is not location', () => {
  const s = toolState({mode: 'target', hasZone: true, hasVideo: true, draft: noDraft, selected: {n: 4}, editField: 'loc'});
  assert.equal(s.active, 'catch');
  assert.equal(s.catchEnabled, true);
});

test('editing the glove of a selected pitch activates target', () => {
  const s = toolState({mode: 'location', hasZone: true, hasVideo: true, draft: noDraft, selected: {n: 4}, editField: 'glove'});
  assert.equal(s.active, 'target');
  assert.equal(s.hud, 'Editing #4');
});

test('editing the manual target of a selected pitch activates manual', () => {
  const s = toolState({mode: 'location', hasZone: true, hasVideo: true, draft: noDraft, selected: {n: 4}, editField: 'manual'});
  assert.equal(s.active, 'manual');
  assert.equal(s.hud, 'Editing #4');
});

test('a selected pitch with no edit field has no active tool', () => {
  const s = toolState({mode: 'location', hasZone: true, hasVideo: true, draft: noDraft, selected: {n: 4}, editField: null});
  assert.equal(s.active, null);
  assert.equal(s.hud, 'Editing #4');
});

test('without a loaded video no tool is active and the HUD asks for one', () => {
  assert.deepStrictEqual(
    toolState({mode: 'zone', hasZone: false, hasVideo: false, draft: noDraft, selected: null, editField: null}),
    {active: null, catchEnabled: false, hud: HUD.noVideo});
});

test('a glove released before the catch makes a clip from release to catch', () => {
  const c = clipFor({glove: pt(1), manual: null, loc: pt(1.5)}, 10);
  near(c.left, 0.1); near(c.width, 0.05); assert.equal(c.marker, false);
});

test('a pitch with no glove is a marker centred on the catch', () => {
  const c = clipFor({glove: null, manual: {x: 0, y: 0, t: 5}, loc: pt(5)}, 10);
  near(c.left, 0.5 - MIN_CLIP / 2); near(c.width, MIN_CLIP); assert.equal(c.marker, true);
});

test('a glove released after the catch is a fixed-width marker centred on the catch', () => {
  const c = clipFor({glove: pt(2), manual: null, loc: pt(1.5)}, 10);
  near(c.left, 0.15 - MIN_CLIP / 2); near(c.width, MIN_CLIP); assert.equal(c.marker, true);
});

test('a glove released at the same time as the catch is a marker centred on the catch', () => {
  const c = clipFor({glove: pt(1.5), manual: null, loc: pt(1.5)}, 10);
  near(c.left, 0.15 - MIN_CLIP / 2); near(c.width, MIN_CLIP); assert.equal(c.marker, true);
});

test('a clip shorter than the minimum is widened to MIN_CLIP', () => {
  const c = clipFor({glove: pt(1.00), manual: null, loc: pt(1.05)}, 10);
  near(c.width, MIN_CLIP);
});

test('a marker near the end of the video stays inside the track', () => {
  const c = clipFor({glove: null, manual: null, loc: pt(9.999)}, 10);
  assert.ok(c.left + c.width <= 1 + 1e-9);
});

test('nextSelection picks the item after the removed one', () => {
  assert.equal(nextSelection([1, 2, 3], 2), 3);
});

test('nextSelection picks the previous item when the last one is removed', () => {
  assert.equal(nextSelection([1, 2, 3], 3), 2);
});

test('nextSelection is null when the only item is removed', () => {
  assert.equal(nextSelection([5], 5), null);
});
