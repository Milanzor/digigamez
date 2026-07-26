// Small DOM helpers that avoid APIs newer than the target digiboard's
// Chromium (which sits in the 64-78 range).

// Stand-in for Element.replaceChildren(), which is Chromium 86+.
export function setChildren(el, ...nodes) {
  while (el.firstChild) el.removeChild(el.firstChild);
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i]) el.appendChild(nodes[i]);
  }
}

// Stand-in for Array.prototype.flatMap(), which is Chromium 69+.
export function flatMap(arr, fn) {
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const r = fn(arr[i], i, arr);
    if (Array.isArray(r)) out.push.apply(out, r);
    else out.push(r);
  }
  return out;
}
