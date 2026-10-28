// Small motion helpers. Every animation here is cosmetic: it never blocks input, and it is skipped when
// the user asks for reduced motion.
export const SPRING = 'cubic-bezier(.34,1.56,.64,1)';

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const counting = new WeakMap();

// Count an element's number from its current value to `to` with an ease-out cubic.
export function countTo(el, to, ms = 600){
  cancelAnimationFrame(counting.get(el));
  const from = parseFloat(el.textContent);
  if(reducedMotion() || !Number.isFinite(from) || from === to){ el.textContent = Math.round(to); return; }
  const t0 = performance.now();
  const step = now => {
    const k = Math.min(1, (now - t0) / ms), e = 1 - (1 - k) ** 3;
    el.textContent = Math.round(from + (to - from) * e);
    if(k < 1) counting.set(el, requestAnimationFrame(step)); else counting.delete(el);
  };
  counting.set(el, requestAnimationFrame(step));
}

// Stop a running count on `el`, so a later direct write (such as '–') is not overwritten by it.
// With `text`, the element is left showing that text.
export function settleCount(el, text){
  cancelAnimationFrame(counting.get(el)); counting.delete(el);
  if(text !== undefined) el.textContent = text;
}

// Restart a CSS animation class: remove it, force a reflow, add it back.
export function replayClass(el, cls){
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}
