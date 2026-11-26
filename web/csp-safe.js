/* George's Assistant — csp-safe.js (v1.2, 2026-11-21)
   © 2026 George Wederski. All rights reserved. No part of this book/app may be copied, reproduced, or shared without written permission from George Wederski.
   FIX: Connie's security policy (CSP) blocks inline onclick/onsubmit
   handlers, so before v1.2 many buttons and every "Add" form silently did
   nothing (a form even reloaded the page). This file keeps the strict
   security policy AND makes those buttons work: it turns each inline
   handler into a safe listener that may only call one of Connie's own
   named functions with plain values. It never runs arbitrary code. */
"use strict";
(function () {
  const EVENTS = ["click", "submit", "change", "input"];
  function parseArgs(src, el, ev) {
    const out = []; let i = 0;
    const skip = () => { while (i < src.length && /[\s,]/.test(src[i])) i++; };
    for (skip(); i < src.length; skip()) {
      const c = src[i];
      if (c === "'" || c === '"') {
        let j = i + 1, s = "";
        while (j < src.length && src[j] !== c) { if (src[j] === "\\") j++; s += src[j++]; }
        out.push(s); i = j + 1; continue;
      }
      const m = src.slice(i).match(/^(-?\d+(?:\.\d+)?|true|false|null|undefined|event|this(?:\.[A-Za-z_]\w*|\[\d+\])*)/);
      if (!m) throw new Error("unsupported handler argument");
      const t = m[1]; i += t.length;
      if (/^-?\d/.test(t)) out.push(Number(t));
      else if (t === "true" || t === "false") out.push(t === "true");
      else if (t === "null" || t === "undefined") out.push(t === "null" ? null : undefined);
      else if (t === "event") out.push(ev);
      else {
        let v = el;
        for (const part of t.slice(4).match(/\.[A-Za-z_]\w*|\[\d+\]/g) || []) {
          v = v == null ? v : part[0] === "." ? v[part.slice(1)] : v[Number(part.slice(1, -1))];
        }
        out.push(v);
      }
    }
    return out;
  }
  function run(code, el, ev) {
    for (const stmt of code.split(";").map(s => s.trim()).filter(Boolean)) {
      if (stmt === "event.preventDefault()") { ev.preventDefault(); continue; }
      const m = stmt.match(/^([A-Za-z_$][\w$]*)\(([\s\S]*)\)$/);
      if (!m || typeof window[m[1]] !== "function") { console.warn("Connie: skipped handler", stmt); continue; }
      window[m[1]].apply(el, parseArgs(m[2], el, ev));
    }
  }
  function convert(root) {
    const els = root.querySelectorAll ? root.querySelectorAll(EVENTS.map(e => "[on" + e + "]").join(",")) : [];
    const all = (root.nodeType === 1 && EVENTS.some(e => root.hasAttribute("on" + e))) ? [root, ...els] : els;
    for (const el of all) {
      for (const e of EVENTS) {
        const code = el.getAttribute("on" + e);
        if (code == null) continue;
        el.removeAttribute("on" + e);
        el.addEventListener(e, (ev) => {
          if (e === "submit") ev.preventDefault();
          try { run(code, el, ev); } catch (err) { console.error("Connie handler:", err); }
        });
      }
    }
  }
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "attributes") convert(m.target);
      for (const n of m.addedNodes) if (n.nodeType === 1) convert(n);
    }
  }).observe(document.documentElement, {childList: true, subtree: true, attributes: true, attributeFilter: EVENTS.map(e => "on" + e)});
  document.addEventListener("DOMContentLoaded", () => convert(document));
})();
