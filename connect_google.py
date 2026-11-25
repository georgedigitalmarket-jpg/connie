#!/usr/bin/env python3
"""Connect Connie to George's Google Drive and Google Calendar — run once.
© 2026 George Wederski. All rights reserved. No part of this book/app may be copied, reproduced, or shared without written permission from George Wederski.

Before you run it (one time, about 10 minutes — steps in README, "Connect Google"):
  1. In Google Cloud Console make a project, turn on the "Google Drive API"
     and the "Google Calendar API", and make an OAuth client of type
     "Desktop app". Copy its Client ID and Client secret.
  2. Run:  python3 connect_google.py
     Paste the Client ID and secret when asked. A Google sign-in page opens —
     sign in as yourself and say Allow.

What Connie gets (and only this):
  * drive.file — the files Connie herself makes (her nightly backups)
  * drive.metadata.readonly — the NAMES of your Drive files, so she can find them
    (not what is inside them)
  * calendar.events — read your calendar, and add an event after you say yes

The keys are saved in connie_secrets.json next to server.py, readable only by
you. That file is never sent to the browser, never put in a zip, never logged.
To disconnect: delete connie_secrets.json, or remove Connie at
https://myaccount.google.com/permissions
"""
import json, secrets, sys, threading, urllib.parse, urllib.request, webbrowser, hashlib, base64
from http.server import HTTPServer, BaseHTTPRequestHandler
import connie_plus as plus


def main():
    cid = plus.secret("GOOGLE_CLIENT_ID") or input("Google OAuth Client ID: ").strip()
    csec = plus.secret("GOOGLE_CLIENT_SECRET") or input("Google OAuth Client secret: ").strip()
    if not cid or not csec:
        sys.exit("Need both the Client ID and the Client secret.")
    state = secrets.token_urlsafe(16)
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    got = {}

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            if q.get("state", [""])[0] == state:
                got["code"] = q.get("code", [""])[0]
                got["error"] = q.get("error", [""])[0]
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write("<h2>Done — you can close this tab and go back to Connie.</h2>".encode())

    srv = HTTPServer(("127.0.0.1", 0), H)
    redirect = f"http://127.0.0.1:{srv.server_address[1]}/"
    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
        "client_id": cid, "redirect_uri": redirect, "response_type": "code", "scope": " ".join(plus.GOOGLE_SCOPES),
        "access_type": "offline", "prompt": "consent", "state": state,
        "code_challenge": challenge, "code_challenge_method": "S256"})
    print("\nOpening Google sign-in. If it doesn't open, paste this into your browser:\n\n" + url + "\n")
    webbrowser.open(url)
    t = threading.Thread(target=lambda: [srv.handle_request() for _ in range(5) if "code" not in got], daemon=True)
    t.start()
    t.join(600)
    if not got.get("code"):
        sys.exit("No answer from Google (" + (got.get("error") or "timed out") + "). Nothing was saved.")
    body = urllib.parse.urlencode({"code": got["code"], "client_id": cid, "client_secret": csec, "redirect_uri": redirect,
                                   "grant_type": "authorization_code", "code_verifier": verifier}).encode()
    with urllib.request.urlopen(urllib.request.Request("https://oauth2.googleapis.com/token", data=body,
                                                       headers={"Content-Type": "application/x-www-form-urlencoded"})) as r:
        tok = json.loads(r.read())
    if not tok.get("refresh_token"):
        sys.exit("Google didn't give a long-term key. Remove Connie at https://myaccount.google.com/permissions and run this again.")
    plus.save_secrets({"GOOGLE_CLIENT_ID": cid, "GOOGLE_CLIENT_SECRET": csec, "GOOGLE_REFRESH_TOKEN": tok["refresh_token"]})
    print("Connected. Connie can now back up to your Drive every night and read your Google Calendar.")
    print("Saved in", plus.SECRETS_FILE, "(only you can read it). Restart server.py if it is running.")
    print("Hosting Connie online? Copy those three values into the host's environment settings instead.")


if __name__ == "__main__":
    main()
