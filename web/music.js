/* George's Assistant — Connie Music (v1.3, 2026-11-23) — web/music.js
   Owner and creator: George Wederski.
   © 2026 George Wederski. All rights reserved. No part of this book/app may be
   copied, reproduced, or shared without written permission from George Wederski.

   WHY THIS IS BUILT THIS WAY — read before changing it.

   George asked for unlimited music, available all the time. There are only
   three honest ways to do that, and only one of them he can sell:

   1. Bundle real songs. Illegal without a licence for every track, and a
      licence to redistribute inside a product he sells costs far more than
      the product. Not an option.
   2. Stream from Spotify / YouTube / Apple. Their terms do not allow a paid
      third-party app to pipe their catalogue through it, and it breaks the
      moment a customer has no subscription. Not reliable.
   3. GENERATE the music in the app itself. No files, no catalogue, no
      licence, nothing to pay anybody, and it literally never runs out
      because each note is decided as it plays. This is what is built here.

   Everything you hear is made by this file, on the spot, out of nothing but
   maths. It is George's to sell. It never repeats and it never ends.

   Customers can also point at their OWN music files — those stay on their
   own device and are never uploaded anywhere.
*/
"use strict";

(function () {
  const MOODS = {
    calm: {
      label: "Calm",
      scale: [0, 2, 4, 7, 9],            // major pentatonic — nothing sour
      root: 55,                           // low G
      bpm: 58,
      chords: [[0, 4, 7], [-3, 2, 5], [-5, 0, 4], [2, 5, 9]],
      melodyChance: 0.45,
      drums: false,
      wave: "sine",
      reverb: 0.55,
    },
    focus: {
      label: "Focus",
      scale: [0, 2, 3, 5, 7, 10],         // minor-ish, stays out of the way
      root: 49,
      bpm: 72,
      chords: [[0, 3, 7], [-2, 3, 5], [-4, 0, 3], [0, 5, 7]],
      melodyChance: 0.3,
      drums: false,
      wave: "triangle",
      reverb: 0.4,
    },
    upbeat: {
      label: "Upbeat",
      scale: [0, 2, 4, 7, 9, 11],
      root: 60,
      bpm: 104,
      chords: [[0, 4, 7], [5, 9, 12], [-3, 2, 7], [2, 7, 11]],
      melodyChance: 0.7,
      drums: true,
      wave: "square",
      reverb: 0.2,
    },
    night: {
      label: "Night",
      scale: [0, 3, 5, 7, 10],
      root: 43,
      bpm: 46,
      chords: [[0, 3, 7], [-5, 0, 3], [-2, 3, 7], [-7, -3, 0]],
      melodyChance: 0.25,
      drums: false,
      wave: "sine",
      reverb: 0.7,
    },
    workshop: {
      label: "Workshop",
      scale: [0, 2, 4, 5, 7, 9, 10],
      root: 52,
      bpm: 92,
      chords: [[0, 4, 7], [-3, 0, 5], [2, 5, 9], [-5, 0, 4]],
      melodyChance: 0.6,
      drums: true,
      wave: "sawtooth",
      reverb: 0.3,
    },
  };

  const S = {
    ctx: null, master: null, wet: null, timer: null,
    playing: false, mood: "calm", volume: 0.35, step: 0, chord: 0,
    ownAudio: null, ownNames: [], ownIndex: 0, mode: "generated",
  };

  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  function lsGetSafe(k, d) {
    try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); }
    catch (e) { return d; }
  }
  function lsSetSafe(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* full */ }
  }

  /* ---------- audio plumbing ---------- */
  function start() {
    if (S.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    S.ctx = new AC();

    S.master = S.ctx.createGain();
    S.master.gain.value = S.volume;
    S.master.connect(S.ctx.destination);

    // a cheap reverb: a short noise burst as an impulse response
    try {
      const conv = S.ctx.createConvolver();
      const len = Math.floor(S.ctx.sampleRate * 1.6);
      const buf = S.ctx.createBuffer(2, len, S.ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) {
          d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
        }
      }
      conv.buffer = buf;
      S.wet = S.ctx.createGain();
      S.wet.gain.value = 0.35;
      conv.connect(S.wet);
      S.wet.connect(S.master);
      S.conv = conv;
    } catch (e) {
      S.conv = null;   // no reverb is fine, music still plays
    }
    return true;
  }

  function note(freq, when, dur, gain, wave, reverbAmt) {
    const o = S.ctx.createOscillator();
    const g = S.ctx.createGain();
    o.type = wave || "sine";
    o.frequency.value = freq;

    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + Math.min(0.08, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);

    o.connect(g);
    g.connect(S.master);
    if (S.conv && reverbAmt) {
      const r = S.ctx.createGain();
      r.gain.value = reverbAmt * 0.5;
      g.connect(r);
      r.connect(S.conv);
    }
    o.start(when);
    o.stop(when + dur + 0.05);
  }

  function hit(when, kind) {
    const dur = kind === "kick" ? 0.22 : 0.07;
    const b = S.ctx.createBuffer(1, Math.ceil(S.ctx.sampleRate * dur), S.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      const fall = Math.pow(1 - i / d.length, kind === "kick" ? 6 : 3);
      d[i] = (Math.random() * 2 - 1) * fall;
    }
    const src = S.ctx.createBufferSource();
    src.buffer = b;
    const f = S.ctx.createBiquadFilter();
    f.type = kind === "kick" ? "lowpass" : "highpass";
    f.frequency.value = kind === "kick" ? 110 : 6500;
    const g = S.ctx.createGain();
    g.gain.value = kind === "kick" ? 0.5 : 0.12;
    src.connect(f); f.connect(g); g.connect(S.master);
    src.start(when);
  }

  /* ---------- the generator ---------- */
  function schedule() {
    if (!S.playing || S.mode !== "generated") return;
    const m = MOODS[S.mood];
    const beat = 60 / m.bpm;
    const when = S.ctx.currentTime + 0.12;

    const chord = m.chords[S.chord % m.chords.length];
    const bar = S.step % 8;

    // chord pad, once at the top of each bar
    if (bar === 0) {
      chord.forEach((iv, i) => {
        note(midi(m.root + 12 + iv), when, beat * 7.5, 0.055 - i * 0.006,
             m.wave === "square" ? "triangle" : m.wave, m.reverb);
      });
      note(midi(m.root + chord[0]), when, beat * 7.5, 0.085, "sine", m.reverb * 0.4);
    }

    // melody — decided fresh every beat, so it never repeats
    if (Math.random() < m.melodyChance) {
      const deg = pick(m.scale);
      const oct = pick([12, 24, 24, 36]);
      note(midi(m.root + chord[0] + deg + oct), when, beat * pick([0.4, 0.8, 1.4]),
           0.07, m.wave, m.reverb);
    }

    if (m.drums) {
      if (bar % 4 === 0) hit(when, "kick");
      if (bar % 4 === 2) hit(when + beat * 0.5, "snare");
      if (Math.random() < 0.3) hit(when + beat * 0.5, "snare");
    }

    S.step++;
    if (S.step % 8 === 0) {
      // move to a new chord, never the same one twice in a row
      let next = S.chord;
      while (next === S.chord) next = Math.floor(Math.random() * m.chords.length);
      S.chord = next;
    }

    S.timer = setTimeout(schedule, beat * 1000);
  }

  /* ---------- controls ---------- */
  function play() {
    if (S.mode === "own") { playOwn(); return; }
    if (!start()) { say("This phone's browser cannot make audio."); return; }
    if (S.ctx.state === "suspended") S.ctx.resume();
    if (S.playing) return;
    S.playing = true;
    S.step = 0;
    schedule();
    refresh();
  }

  function stop() {
    S.playing = false;
    if (S.timer) { clearTimeout(S.timer); S.timer = null; }
    if (S.ownAudio) { S.ownAudio.pause(); }
    refresh();
  }

  function setVolume(v) {
    S.volume = v;
    if (S.master) S.master.gain.value = v;
    if (S.ownAudio) S.ownAudio.volume = Math.min(1, v * 2);
    lsSetSafe("connie_music_volume", v);
  }

  function setMood(name) {
    S.mood = name;
    lsSetSafe("connie_music_mood", name);
    if (S.playing && S.mode === "generated") {
      S.chord = 0; S.step = 0;
    }
    refresh();
  }

  /* ---------- the customer's own files, kept on their device ---------- */
  function loadOwn(files) {
    if (!files || !files.length) return;
    S.ownFiles = Array.from(files);
    S.ownNames = S.ownFiles.map((f) => f.name);
    S.ownIndex = 0;
    S.mode = "own";
    playOwn();
  }

  function playOwn() {
    if (!S.ownFiles || !S.ownFiles.length) { say("No music files chosen yet."); return; }
    if (S.ownAudio) { S.ownAudio.pause(); URL.revokeObjectURL(S.ownAudio.src); }
    const f = S.ownFiles[S.ownIndex % S.ownFiles.length];
    S.ownAudio = new Audio(URL.createObjectURL(f));
    S.ownAudio.volume = Math.min(1, S.volume * 2);
    S.ownAudio.addEventListener("ended", () => {
      S.ownIndex++;
      playOwn();                       // loops the folder forever
    });
    S.ownAudio.play().catch(() => say("Could not play that file."));
    S.playing = true;
    refresh();
  }

  function say(msg) {
    const el = document.getElementById("music-status");
    if (el) el.textContent = msg;
  }

  /* ---------- the screen ---------- */
  function refresh() {
    const btn = document.getElementById("music-toggle");
    if (btn) btn.textContent = S.playing ? "Stop" : "Play";
    const now = document.getElementById("music-now");
    if (now) {
      if (!S.playing) now.textContent = "Not playing";
      else if (S.mode === "own") now.textContent = "Your file: " +
        (S.ownNames[S.ownIndex % S.ownNames.length] || "");
      else now.textContent = MOODS[S.mood].label + " — made up as it goes";
    }
    document.querySelectorAll("[data-mood]").forEach((b) => {
      b.setAttribute("aria-pressed", b.getAttribute("data-mood") === S.mood &&
                     S.mode === "generated" ? "true" : "false");
    });
  }

  function render(host) {
    host.textContent = "";

    const h = document.createElement("h2");
    h.textContent = "Music";
    host.appendChild(h);

    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Connie makes this music herself, note by note, as it plays. " +
      "It never runs out and it never repeats. Nothing is downloaded and there is " +
      "nothing to pay anyone for it.";
    host.appendChild(p);

    const now = document.createElement("p");
    now.id = "music-now";
    now.style.fontWeight = "600";
    host.appendChild(now);

    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.flexWrap = "wrap";
    row.style.gap = "8px";
    row.style.margin = "10px 0";
    Object.keys(MOODS).forEach((key) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = MOODS[key].label;
      b.setAttribute("data-mood", key);
      b.addEventListener("click", () => {
        S.mode = "generated";
        if (S.ownAudio) S.ownAudio.pause();
        setMood(key);
        if (!S.playing) play();
      });
      row.appendChild(b);
    });
    host.appendChild(row);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.id = "music-toggle";
    toggle.textContent = "Play";
    toggle.addEventListener("click", () => (S.playing ? stop() : play()));
    host.appendChild(toggle);

    const vlabel = document.createElement("label");
    vlabel.style.display = "block";
    vlabel.style.marginTop = "14px";
    vlabel.textContent = "Volume";
    const vol = document.createElement("input");
    vol.type = "range";
    vol.min = "0"; vol.max = "0.8"; vol.step = "0.01";
    vol.value = String(S.volume);
    vol.style.width = "100%";
    vol.addEventListener("input", () => setVolume(parseFloat(vol.value)));
    vlabel.appendChild(vol);
    host.appendChild(vlabel);

    const own = document.createElement("div");
    own.style.marginTop = "22px";
    const oh = document.createElement("h3");
    oh.textContent = "Or play your own music";
    own.appendChild(oh);
    const op = document.createElement("p");
    op.className = "muted";
    op.textContent = "Pick songs from this device. They stay on this device — " +
      "they are never uploaded and Connie never sends them anywhere.";
    own.appendChild(op);
    const file = document.createElement("input");
    file.type = "file";
    file.accept = "audio/*";
    file.multiple = true;
    file.addEventListener("change", () => loadOwn(file.files));
    own.appendChild(file);
    host.appendChild(own);

    const status = document.createElement("p");
    status.id = "music-status";
    status.className = "muted";
    host.appendChild(status);

    refresh();
  }

  /* ---------- hook into Connie ---------- */
  S.volume = lsGetSafe("connie_music_volume", 0.35);
  S.mood = lsGetSafe("connie_music_mood", "calm");

  if (typeof TABS !== "undefined" && Array.isArray(TABS)) {
    TABS.push(["music", "Music"]);
  }

  // Take over the Music tab, hand every other tab back to Connie unchanged.
  if (typeof window.showTab === "function") {
    const previous = window.showTab;
    window.showTab = function (id) {
      if (id !== "music") return previous.apply(this, arguments);
      if (typeof currentTab !== "undefined") { try { currentTab = "music"; } catch (e) {} }
      if (typeof renderTabs === "function") renderTabs();
      const v = document.getElementById("view");
      if (v) render(v);
    };
  }

  window.ConnieMusic = {
    render: render,
    play: play,
    stop: stop,
    setMood: setMood,
    moods: Object.keys(MOODS),
    isPlaying: () => S.playing,
  };

  // let Connie's voice commands drive it: "play music", "stop the music"
  window.ConnieMusicCommand = function (text) {
    const t = String(text || "").toLowerCase();
    if (/\b(stop|pause|quiet|silence).*(music|song)|\bmusic off\b/.test(t)) {
      stop(); return "Music off.";
    }
    for (const key of Object.keys(MOODS)) {
      if (t.includes(key)) { S.mode = "generated"; setMood(key); play();
        return MOODS[key].label + " music on."; }
    }
    if (/\b(play|start|put on).*(music|song)|\bmusic on\b/.test(t)) {
      S.mode = "generated"; play(); return "Music on.";
    }
    return null;
  };
})();
