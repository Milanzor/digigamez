// Minimal hash-based router. Avoids pulling in a framework router for what
// is essentially 4 screens. Each route's render function receives the mount
// element and returns an optional cleanup function, called before the next
// route renders (so games can cancel their rAF loop / remove listeners).

const routes = new Map();
let currentCleanup = null;
let mountEl = null;
let currentPath = '/';
let prevPath = '/';

export function registerRoute(path, render) {
  routes.set(path, render);
}

export function navigate(path) {
  window.location.hash = path;
}

// Where the last navigation came from, so a screen that can be opened from more
// than one place (the settings screen) knows what its ◀ should return to.
export function previousPath() {
  return prevPath;
}

function matchRoute(path) {
  for (const [pattern, render] of routes) {
    if (pattern.includes(':')) {
      const patternParts = pattern.split('/').filter(Boolean);
      const pathParts = path.split('/').filter(Boolean);
      if (patternParts.length !== pathParts.length) continue;
      const params = {};
      let matched = true;
      for (let i = 0; i < patternParts.length; i++) {
        if (patternParts[i].startsWith(':')) {
          params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
        } else if (patternParts[i] !== pathParts[i]) {
          matched = false;
          break;
        }
      }
      if (matched) return { render, params };
    } else if (pattern === path) {
      return { render, params: {} };
    }
  }
  return null;
}

async function handleChange() {
  const path = window.location.hash.replace(/^#/, '') || '/';
  if (path !== currentPath) {
    prevPath = currentPath;
    currentPath = path;
  }

  const match = matchRoute(path);
  if (typeof currentCleanup === 'function') {
    try {
      currentCleanup();
    } catch (err) {
      console.error('Route cleanup error', err);
    }
  }
  currentCleanup = null;
  mountEl.replaceChildren();

  if (!match) {
    navigate('/');
    return;
  }

  let result;
  try {
    result = await match.render(mountEl, match.params);
  } catch (err) {
    // A view that throws used to leave the board on an empty black screen with
    // no way out, which on a kiosk means someone has to find the keyboard. One
    // amber button back to the archive is always recoverable.
    console.error(`Fout bij openen van ${path}`, err);
    renderRouteError();
    return;
  }
  if (typeof result === 'function') currentCleanup = result;
  markEntering();
}

// The router owns the arrival animation rather than each view: it is the thing
// that knows a navigation just happened, and doing it here means a new screen
// gets the transition for free. Re-adding the class on every mount is why it is
// stripped first — a class already present would not restart the animation.
function markEntering() {
  for (const child of mountEl.children) {
    child.classList.remove('screen-enter');
    // Reading offsetWidth forces the removal to take effect before the re-add,
    // so the animation restarts instead of being treated as unchanged.
    void child.offsetWidth;
    child.classList.add('screen-enter');
  }
}

function renderRouteError() {
  mountEl.replaceChildren();
  const el = document.createElement('div');
  el.className = 'loading';
  el.innerHTML = `
    <div class="loading__inner">
      <div class="loading__label">Dit scherm wil niet openen</div>
      <button class="btn">Terug naar de missies</button>
    </div>
  `;
  el.querySelector('button').addEventListener('pointerup', () => navigate('/rooster'));
  mountEl.appendChild(el);
}

export function startRouter(el) {
  mountEl = el;
  window.addEventListener('hashchange', handleChange);
  handleChange();
}
