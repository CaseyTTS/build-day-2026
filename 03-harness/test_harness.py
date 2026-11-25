"""pytest -q test_harness.py"""
import importlib, json, os, shutil, subprocess, sys, time
import pytest

HERE = os.path.dirname(os.path.abspath(__file__))

@pytest.fixture
def h(tmp_path, monkeypatch, request):
    shutil.copytree(os.path.join(HERE, "workspace_demo"), tmp_path / "ws")
    # write the fixture's own notes.txt so a prior approved demo run can't change test inputs
    (tmp_path / "ws" / "notes.txt").write_text("Teh deploy runs on Fridays.\n")
    monkeypatch.setenv("HARNESS_SANDBOX", str(tmp_path / "ws"))
    monkeypatch.setenv("HARNESS_LOG", str(tmp_path / "audit.jsonl"))
    monkeypatch.delenv("HARNESS_APPROVE", raising=False)
    if "openai" not in request.node.name:
        monkeypatch.setenv("HARNESS_PLANNER", "mock")
    import harness
    return importlib.reload(harness), tmp_path

def decisions(results):
    return [(r["tool"], r["decision"]) for r in results]

def test_default_denies_every_ask_and_changes_nothing(h):
    harness, tmp = h
    res = harness.run("fix typo")
    assert decisions(res) == [("list_dir", "allow"), ("read_file", "allow"), ("write_file", "not-approved"),
                              ("delete_path", "deny"), ("read_file", "deny"), ("shell", "deny")]
    assert (tmp / "ws" / "notes.txt").read_text().startswith("Teh")
    assert (tmp / "ws" / "README.md").exists()

def test_human_yes_allows_the_write_only(h, monkeypatch):
    harness, tmp = h
    monkeypatch.setenv("HARNESS_APPROVE", "cli")
    monkeypatch.setattr("builtins.input", lambda _: "y")
    res = harness.run("fix typo")
    assert ("write_file", "allow") in decisions(res) and ("delete_path", "deny") in decisions(res)
    assert (tmp / "ws" / "notes.txt").read_text() == "The deploy runs on Fridays.\n"

def test_every_node_is_logged(h):
    harness, tmp = h
    harness.run("fix typo")
    nodes = [json.loads(l)["node"] for l in open(tmp / "audit.jsonl")]
    assert nodes[0] == "task" and nodes[1] == "plan" and nodes[-1] == "result" and nodes.count("tool_call") == 6

def test_step_budget(h, monkeypatch):
    harness, _ = h
    monkeypatch.setattr(harness, "plan", lambda t: [{"tool": "list_dir", "args": {}}] * 50)
    assert len(harness.run("loop forever")) == harness.MAX_STEPS

def test_openai_planner_is_still_gated(h, monkeypatch):
    harness, tmp = h
    p = subprocess.Popen([sys.executable, os.path.join(HERE, "mock_openai.py")]); time.sleep(0.8)
    try:
        monkeypatch.setenv("HARNESS_PLANNER", "openai"); monkeypatch.setenv("AI_BASE_URL", "http://127.0.0.1:8772/v1")
        monkeypatch.setenv("AI_MODEL", "m")
        assert decisions(harness.run("anything")) == [("read_file", "allow"), ("write_file", "not-approved"), ("run_shell", "deny")]
    finally:
        p.terminate()

def test_invalid_tool_args_are_a_clear_error_not_a_typeerror(h, monkeypatch):
    harness, tmp = h
    monkeypatch.setattr(harness, "plan", lambda t: [
        {"tool": "read_file", "args": {"file": "notes.txt"}, "why": "wrong name"},
        {"tool": "read_file", "args": {"path": "notes.txt"}, "why": "ok"},
        {"tool": "write_file", "args": {"path": "notes.txt"}, "why": "missing content"},
    ])
    res = harness.run("x")
    assert res[0]["decision"] == "error"
    assert "TypeError" not in str(res[0].get("result", ""))
    assert "file" in str(res[0]["result"]) and "unknown argument" in res[0]["result"]
    assert res[1]["decision"] == "allow"
    assert "Teh" in res[1]["result"]
    assert res[2]["decision"] == "error"
    assert "missing required" in res[2]["result"] and "content" in res[2]["result"]
    # catalog used by the planner lists argument names
    catalog = harness.tool_catalog()
    assert "read_file" in catalog and "path (str, required)" in catalog
    assert "write_file" in catalog and "content (str, required)" in catalog
    assert "list_dir" in catalog and "path (str, optional" in catalog


def test_non_string_args_are_a_clear_error_and_skip_the_approval_gate(h, monkeypatch):
    harness, tmp = h
    called = []
    monkeypatch.setenv("HARNESS_APPROVE", "cli")
    monkeypatch.setattr("builtins.input", lambda prompt: called.append(prompt) or "y")
    monkeypatch.setattr(harness, "plan", lambda t: [
        {"tool": "write_file", "args": {"path": "notes.txt", "content": {"a": 1}}, "why": "bad type"},
    ])
    before = (tmp / "ws" / "notes.txt").read_text()
    res = harness.run("x")
    assert res[0]["decision"] == "error"
    assert "must be strings" in res[0]["result"] and "content" in res[0]["result"]
    assert called == []
    assert (tmp / "ws" / "notes.txt").read_text() == before


def test_denied_tool_with_bad_args_stays_deny(h, monkeypatch):
    harness, _ = h
    monkeypatch.setattr(harness, "plan", lambda t: [
        {"tool": "delete_path", "args": {"pth": "notes.txt"}, "why": "wrong name"},
    ])
    res = harness.run("x")
    assert res[0]["decision"] == "deny"
    assert "unknown argument" in res[0]["result"] and "pth" in res[0]["result"]


def test_non_object_step_is_a_logged_deny(h, monkeypatch):
    harness, tmp = h
    monkeypatch.setattr(harness, "plan", lambda t: ["read_file"])
    res = harness.run("x")
    assert res[0]["decision"] == "deny"
    nodes = [__import__("json").loads(l)["node"] for l in open(tmp / "audit.jsonl")]
    assert nodes[0] == "task" and nodes[1] == "plan" and nodes[-1] == "result"
    assert "tool_call" in nodes


def test_openai_planner_prompt_includes_argument_schemas(h, monkeypatch):
    harness, _ = h
    captured = {}
    class FakeResp:
        def __enter__(self):
            return self
        def __exit__(self, *a):
            return False
        def read(self):
            import json
            return json.dumps({"choices": [{"message": {"content": "{\"steps\": []}"}}]}).encode()
        def __getitem__(self, k):
            # unused; urlopen result is used as context manager then json.load
            raise KeyError(k)
    def fake_urlopen(req, timeout=180):
        captured["body"] = req.data.decode() if hasattr(req, "data") else req
        class R:
            def __enter__(self):
                return self
            def __exit__(self, *a):
                return False
            def read(self):
                import json
                return json.dumps({"choices": [{"message": {"content": "{\"steps\": []}"}}]}).encode()
        # json.load(r) needs a .read() file-like
        return R()
    # json.load uses .read(); we need to hook it properly after urlopen
    import io, json
    def fake_urlopen2(req, timeout=180):
        captured["body"] = req.data.decode()
        return io.BytesIO(json.dumps({"choices": [{"message": {"content": "{\"steps\": []}"}}]}).encode())
    # urllib.request.urlopen as context manager: BytesIO is not a CM in all uses
    class CM:
        def __init__(self, raw):
            self.raw = raw
        def __enter__(self):
            return io.BytesIO(self.raw)
        def __exit__(self, *a):
            return False
    def fake_urlopen3(req, timeout=180):
        captured["body"] = req.data.decode()
        payload = json.dumps({"choices": [{"message": {"content": "{\"steps\": []}"}}]}).encode()
        return CM(payload)
    monkeypatch.setenv("HARNESS_PLANNER", "openai")
    monkeypatch.setenv("AI_BASE_URL", "http://127.0.0.1:9/v1")
    monkeypatch.setenv("AI_MODEL", "m")
    monkeypatch.setattr(harness.urllib.request, "urlopen", fake_urlopen3)
    assert harness.run("x") == []
    assert "path (str, required)" in captured["body"]
    assert "content (str, required)" in captured["body"]
    assert "list_dir" in captured["body"]

def test_list_tool_name_is_a_logged_deny(h, monkeypatch):
    harness, tmp = h
    monkeypatch.setattr(harness, "plan", lambda t: [{"tool": ["read_file"], "args": {"path": "notes.txt"}}])
    res = harness.run("x")
    assert res[0]["decision"] == "deny"
    assert res[0]["tool"] is None
    nodes = [__import__("json").loads(l)["node"] for l in open(tmp / "audit.jsonl")]
    assert "tool_call" in nodes and nodes[-1] == "result"


def test_dict_steps_do_not_crash(h, monkeypatch):
    harness, tmp = h
    monkeypatch.setattr(harness, "plan", lambda t: {"tool": "read_file", "args": {"path": "notes.txt"}})
    res = harness.run("x")
    assert res == []
    nodes = [__import__("json").loads(l)["node"] for l in open(tmp / "audit.jsonl")]
    assert nodes[0] == "task" and nodes[1] == "plan" and nodes[-1] == "result"

