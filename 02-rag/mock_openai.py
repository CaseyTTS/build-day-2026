"""Test helper only: fake OpenAI-compatible /v1/embeddings and /v1/chat/completions on 127.0.0.1:8771.
Embeddings are 8 numbers derived from letter counts; chat replies with the first context line, cited."""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

def vec(t):
    t = t.lower()
    return [float(t.count(ch)) for ch in "aeiouvps"]

class H(BaseHTTPRequestHandler):
    def do_POST(self):
        req = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if self.path.endswith("/embeddings"):
            out = {"data": [{"index": i, "embedding": vec(t)} for i, t in enumerate(req["input"])]}
        else:
            ctx = req["messages"][1]["content"].split("\n")[1]
            out = {"choices": [{"message": {"role": "assistant", "content": f"From the docs: {ctx[:80]} [1]"}}]}
        b = json.dumps(out).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def log_message(self, *a): pass

if __name__ == "__main__":
    HTTPServer(("127.0.0.1", 8771), H).serve_forever()
