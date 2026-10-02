"""Serve the mobile viewer with explicitly labeled synthetic WebSocket frames."""
import argparse
import base64
import hashlib
import json
import math
import socket
import struct
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

WEB = Path(__file__).resolve().parents[1] / "web"
SCENARIOS = {"normal", "offline", "sensor-error", "stale", "malformed"}


def websocket_message(payload, opcode):
    length = len(payload)
    header = bytes([0x80 | opcode, length]) if length < 126 else bytes([0x80 | opcode, 126]) + struct.pack(">H", length)
    return header + payload


class PreviewServer(ThreadingHTTPServer):
    daemon_threads = True
    scenario = "normal"


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):
        pass

    def respond(self, data, content_type):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/__test/camera":
            # Browser integration fixture; never included in the Arduino UI.
            html = (WEB / "index.html").read_text(encoding="utf-8")
            fixture = (WEB.parent / "tests/mock_camera.js").read_text(encoding="utf-8")
            html = html.replace('<script src="/camera.js"></script>', '<script>' + fixture + '</script><script src="/camera.js"></script>')
            html = html.replace('カメラ映像は端末内で表示します。', 'このページのカメラも模擬映像です。実際のカメラは使いません。')
            self.respond(html.encode(), "text/html; charset=utf-8")
        elif path.startswith("/__test/"):
            scenario = path.rsplit("/", 1)[1]
            if scenario not in SCENARIOS:
                self.send_error(404)
                return
            self.server.scenario = scenario
            self.respond(scenario.encode(), "text/plain")
        elif path == "/ws" and self.headers.get("Upgrade", "").lower() == "websocket":
            self.stream()
        elif path in {"/", "/style.css", "/frame.js", "/fusion.js", "/camera.js", "/viewer.js"}:
            filename = "index.html" if path == "/" else path[1:]
            content_type = {"html": "text/html; charset=utf-8", "css": "text/css", "js": "text/javascript"}[filename.rsplit(".", 1)[1]]
            self.respond((WEB / filename).read_bytes(), content_type)
        else:
            self.send_error(404)

    def stream(self):
        key = self.headers.get("Sec-WebSocket-Key", "")
        accept = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
        self.send_response(101)
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept)
        self.end_headers()
        self.close_connection = True
        self.connection.settimeout(1)
        sequence = 0
        started = time.monotonic()
        try:
            while True:
                scenario = self.server.scenario
                if scenario == "offline":
                    self.connection.shutdown(socket.SHUT_RDWR)
                    return
                state = "read_error" if scenario == "sensor-error" else "waiting" if scenario == "stale" else "ok"
                status = json.dumps({"type": "status", "sensor": state, "hasFrame": sequence > 0, "demo": True}).encode()
                self.wfile.write(websocket_message(status, 1))
                if state == "ok":
                    sequence += 1
                    elapsed = time.monotonic() - started
                    pixels = []
                    for y in range(24):
                        for x in range(32):
                            distance = ((x - 16 - 5 * math.sin(elapsed / 2)) / 5) ** 2 + ((y - 12) / 5) ** 2
                            pixels.append(round((22 + 17 * math.exp(-distance)) * 50))
                    packet = struct.pack("<4sHHIIhH768h", b"THM1", 32, 24, sequence, int(elapsed * 1000), 2450, 0, *pixels)
                    if scenario == "malformed":
                        packet = packet[:100]
                    self.wfile.write(websocket_message(packet, 2))
                time.sleep(.125)
        except (BrokenPipeError, ConnectionResetError, TimeoutError, OSError):
            pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    server = PreviewServer(("127.0.0.1", args.port), Handler)
    print(f"DEMO ONLY: http://127.0.0.1:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
