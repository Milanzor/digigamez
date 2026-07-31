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
  const result = await match.render(mountEl, match.params);
  if (typeof result === 'function') currentCleanup = result;
}

export function startRouter(el) {
  mountEl = el;
  window.addEventListener('hashchange', handleChange);
  handleChange();
}
