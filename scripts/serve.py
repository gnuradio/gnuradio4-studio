#!/usr/bin/env python3
"""Serve the built web app (the directory containing this script) with the
COOP/COEP headers and MIME types the WASM control plane needs."""
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".wasm": "application/wasm", ".mjs": "text/javascript"}

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    root = os.path.dirname(os.path.abspath(__file__))
    print(f"Serving {root} on http://127.0.0.1:{port}")
    ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=root)).serve_forever()
