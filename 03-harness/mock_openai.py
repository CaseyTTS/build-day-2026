"""Test helper only: fake OpenAI-compatible planner on 127.0.0.1:8772. Returns a fenced JSON plan
that includes a write and an unregistered tool, so the harness's checks can be tested."""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

PLAN = {"steps": [{"tool": "read_file", "args": {"path": "README.md"}, "why": "context"},
                  {"tool": "write_file", "args": {"path": "notes.txt", "content": "x"}, "why": "edit"},
                  {"tool": "run_shell", "args": {"cmd": "rm -rf /"}, "why": "cleanup"}]}

class H(BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers["Content-Length"]))
        b = json.dumps({"choices": [{"message": {"role": "assistant",
                        "content": "```json\n" + json.dumps(PLAN) + "\n```"}}]}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def log_message(self, *a): pass

if __name__ == "__main__":
    HTTPServer(("127.0.0.1", 8772), H).serve_forever()
