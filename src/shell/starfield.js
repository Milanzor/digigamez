// Injects the shared CSS starfield backdrop once, behind #app.
// Purely declarative: the drift is CSS keyframed transforms, so it stays
// on the compositor and costs no main-thread time while a game loop runs.

export function mountStarfield() {
  if (document.querySelector('.space-bg')) return;
  const bg = document.createElement('div');
  bg.className = 'space-bg';
  bg.setAttribute('aria-hidden', 'true');
  bg.innerHTML = `
    <div class="space-bg__stars space-bg__stars--far"></div>
    <div class="space-bg__stars space-bg__stars--mid"></div>
    <div class="space-bg__stars space-bg__stars--near"></div>
    <div class="space-bg__planet space-bg__planet--a"></div>
    <div class="space-bg__planet space-bg__planet--b"></div>
  `;
  document.body.insertBefore(bg, document.body.firstChild);
}
