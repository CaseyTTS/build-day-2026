"""Test helper only: fake OpenAI-compatible /v1/chat/completions on 127.0.0.1:8770.
Echoes a label chosen by keyword, or an off-list label when the text contains 'OFFLIST',
or non-JSON when the text contains 'PROSE', so the validation path can be tested."""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

class H(BaseHTTPRequestHandler):
    def do_POST(self):
        req = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        text = req["messages"][1]["content"]
        if "OFFLIST" in text:
            content = '{"label": "delete_everything", "confidence": 0.99}'
        elif "PROSE" in text:
            content = "Sounds like a network thing to me!"
        elif "NULLCONTENT" in text:
            content = None
        else:
            content = '```json\n{"label": "network", "confidence": 0.91}\n```'
        b = json.dumps({"choices": [{"message": {"role": "assistant", "content": content}}]}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def log_message(self, *a): pass

if __name__ == "__main__":
    HTTPServer(("127.0.0.1", 8770), H).serve_forever()
