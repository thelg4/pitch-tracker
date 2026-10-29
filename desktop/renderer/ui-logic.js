// Pure UI logic for the pro-tool interface: toolbar state, timeline clips, avatars and selection.
// No DOM access, so the renderer and the tests share one implementation.

export const AVATAR_COLORS = ['#0a84ff','#ff9f0a','#30d158','#bf5af2','#ff375f','#64d2ff','#ffd60a','#5e5ce6'];
export const HUD = {zone:'Drag a box over the strike zone', target:'Click the glove at release', manual:'Click the intended target', catch:'Click where the ball is caught', noVideo:'Load the bullpen video'};
export const MIN_CLIP = 0.012;

const TOOL_FOR_MODE = {zone:'zone', target:'target', manual:'manual', location:'catch'};
const TOOL_FOR_FIELD = {glove:'target', manual:'manual', loc:'catch'};

export function initials(name){
  const w = name.trim().split(/\s+/).filter(Boolean);
  if(!w.length) return '?';
  return (w[0][0] + (w.length > 1 ? w[w.length-1][0] : '')).toUpperCase();
}

export function avatarColor(name){
  let h = 0; for(let i = 0; i < name.length; i++) h += name.charCodeAt(i);
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

// Which toolbar tool is active and what the HUD says. Video, then editing, then zone, then mode decide.
// Catch is enabled once a target is placed, or while a selected pitch's location is being re-marked.
export function toolState({mode, hasZone, hasVideo, selected, editField}){
  const catchEnabled = mode === 'location' || editField === 'loc';
  if(!hasVideo) return {active:null, catchEnabled, hud:HUD.noVideo};
  if(selected) return {active: TOOL_FOR_FIELD[editField] ?? null, catchEnabled, hud:`Editing #${selected.n}`};
  const tool = hasZone ? TOOL_FOR_MODE[mode] : 'zone';
  return {active: tool, catchEnabled, hud: HUD[tool]};
}

// Timeline clip for a pitch as fractions of the video. A pitch with no glove release, or one whose
// release is not before the catch, is a fixed-width marker centred on the catch.
export function clipFor(pitch, duration){
  const loc = pitch.loc.t / duration;
  const g = pitch.glove ? pitch.glove.t / duration : null;
  if(g === null || g >= loc) return place(loc - MIN_CLIP / 2, MIN_CLIP, true);
  return place(g, Math.max(MIN_CLIP, loc - g), false);
}

const place = (left, width, marker) => ({left: Math.min(Math.max(left, 0), 1 - width), width, marker});

// The item to select after removing one: the next, else the previous, else null.
export function nextSelection(ids, removedId){
  const i = ids.indexOf(removedId);
  if(i < 0) return null;
  return ids[i+1] ?? ids[i-1] ?? null;
}

// Whether the welcome sheet opens at launch: the first time this version runs, or every launch if asked for.
export const welcomeDue = ({seen, always} = {}, version) => !!always || seen !== version;
