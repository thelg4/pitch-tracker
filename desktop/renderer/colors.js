// Display colors for the pitch types, retuned to macOS dark system hues so they read on #1c1c1e.
// Same keys as scoring.js's TCOL (which stays the stored/legacy palette); everything drawn on screen uses these.
export const PCOL = {
  FB: '#0a84ff', // blue
  SI: '#64d2ff', // teal
  CT: '#bf5af2', // purple
  SL: '#ff9f0a', // orange
  SW: '#ff6ac1', // pink, lifted off system pink so it stays apart from the curveball's red
  CB: '#ff453a', // red
  CH: '#30d158', // green
  SP: '#ffd60a', // yellow
};

// Text on a pitch-type fill: dark on the light hues, white on the rest.
const LIGHT = new Set(['SI', 'SL', 'CH', 'SP']);
export const pitchInk = t => LIGHT.has(t) ? '#000' : '#fff';
