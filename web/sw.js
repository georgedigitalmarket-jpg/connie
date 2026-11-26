/* George's Assistant v1.1 — service worker.
   © 2026 George Wederski. All rights reserved. No part of this book/app may be copied, reproduced, or shared without written permission from George Wederski.
   Caches ONLY the app shell (pages, CSS, JS, icons, manifest) so the
   app opens on a phone even with a flaky connection.
   NEVER caches API responses, sign-in, records, or the database:
   every /api/ request always goes to the server.
   v1.2 offline mode: the app itself (plus.js) keeps George's last-loaded
   records on his own phone and queues changes made offline, sending
   them when the connection comes back. */
"use strict";
const CACHE = "georges-assistant-connie-v1.4-shell";
const SHELL = [
  "/app.html",
  "/",
  "/app.css",
  "/app.js",
  "/plus.js",
  "/music.js",
  "/salesdata.js",
  "/salesdesk.js",
  "/csp-safe.js",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // API, sign-in and records always go to the server — never from cache.
  if (url.pathname.startsWith("/api/")) return;
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.ok && url.origin === self.location.origin) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match("/app.html")))
  );
});
