#!/usr/bin/env python3
"""Serve the production build locally, without Node or npm dependencies."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse
import json
import sys

# Windows pipes may use an ANSI code page; serve and log UTF-8 consistently.
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, 'reconfigure'):
        stream.reconfigure(encoding='utf-8', errors='backslashreplace')

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port', type=int, default=4173)
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent / 'dist'
if not (root / 'index.html').is_file():
    parser.error('找不到 dist/index.html，請先執行 npm run build。')

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

server = ThreadingHTTPServer(('127.0.0.1', args.port), partial(Handler, directory=str(root)))
version = json.loads((root.parent / 'package.json').read_text(encoding='utf-8')).get('version', 'local')
print(f'drag v{version} — http://127.0.0.1:{server.server_port}/\n按 Ctrl+C 結束。', flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
