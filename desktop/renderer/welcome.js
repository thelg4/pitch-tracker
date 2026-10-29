// The welcome sheet: opens at launch the first time a version runs (or every launch, if asked for) and from
// Help > Welcome to Bullpen Command. It names the version and walks through the three steps of a first session.
import { openSheet } from './sheets.js';
import { welcomeDue } from './ui-logic.js';
import { esc } from './util.js';

const KEY = 'bullpen.welcome'; // {seen: version, always: bool}
const load = () => { try{ return JSON.parse(localStorage.getItem(KEY)) || {}; }catch{ return {}; } };
const save = pref => { try{ localStorage.setItem(KEY, JSON.stringify(pref)); }catch{} };

// Resolves once the launch check is done (the sheet is open, or not needed), not when the sheet closes.
export async function welcomeAtLaunch(opts){
  const version = await window.bullpen.appVersion();
  if(welcomeDue(load(), version)) showWelcome(opts, version);
}

// hasAthletes picks the action: an empty library offers to add the first athlete, otherwise it just closes.
export async function showWelcome({hasAthletes, newAthlete}, version){
  version ??= await window.bullpen.appVersion();
  const pref = load();
  save({...pref, seen: version});
  const shown = openSheet({title: 'Welcome to Bullpen Command', className: 'welcome-sheet',
    confirmLabel: hasAthletes ? 'Get Started' : 'Add Your First Athlete', cancelLabel: hasAthletes ? '' : 'Not Now', body: `
    <div class="welcome" tabindex="-1" autofocus>
      <img src="img/icon.png" alt="" width="96" height="96">
      <div class="wname">Bullpen Command</div>
      <div class="wver">Version ${esc(version)} <span class="wpill">Pre-alpha</span></div>
      <p>See how close each pitch lands to where the catcher set up, and track every athlete's command over time.</p>
    </div>
    <ol class="wsteps">
      <li><b>Add an athlete</b><span>File › New Athlete <kbd>⌘N</kbd></span></li>
      <li><b>Start a session from a bullpen video</b><span>File › New Session <kbd>⌘⇧N</kbd>. Film from behind the pitcher, on a tripod.</span></li>
      <li><b>Tag each pitch</b><span>Draw the zone once, then click the glove at release (Target) and where the ball is caught (Catch).</span></li>
    </ol>
    <label class="wcheck"><input type="checkbox" name="always"${pref.always ? ' checked' : ''}> Show this when Bullpen Command opens</label>`});
  const box = document.querySelector('#sheetHost [name=always]');
  box.onchange = () => save({...load(), always: box.checked});
  if(await shown && !hasAthletes) newAthlete();
}
