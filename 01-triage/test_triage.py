"""pytest -q test_triage.py   (mock provider; the openai-provider tests start mock_openai.py)"""
import json, os, subprocess, sys, time
import pytest
import triage


@pytest.fixture(autouse=True)
def _isolate_mock_provider(monkeypatch, request):
    """Keep default tests on the built-in mock, even if a shell has a real-model env leftover."""
    if "openai_mock" in request.fixturenames:
        return
    monkeypatch.setenv("TRIAGE_PROVIDER", "mock")

def t(queue, text, id="X"):
    return triage.triage({"id": id, "queue": queue, "text": text})

def test_every_queue_routes_to_a_known_owner():
    for name, q in triage.QUEUES.items():
        for label, kws in q["labels"].items():
            d = t(name, kws[0])
            assert d["label"] == label
            dest = q["routes"][label]
            if d["review"]:
                assert d["route"] == "triage-humans" and d["suggested_route"] == dest
            else:
                assert d["route"] == dest and "suggested_route" not in d

def test_urgent_terms_raise_priority():
    assert t("helpdesk", "wifi broken for everyone")["priority"] == "P1"
    assert t("helpdesk", "wifi flaky at my desk")["priority"] == "P3"

def test_low_confidence_goes_to_a_person():
    d = t("helpdesk", "Excel crashes over the VPN")
    assert d["review"].startswith("confidence")

def test_no_label_goes_to_a_person():
    d = t("customer_email", "thanks!")
    assert d["label"] == "unknown" and d["route"] == "triage-humans" and d["review"]

def test_resume_queue_is_always_human():
    assert t("resumes_to_openings", "terraform aws kubernetes")["review"] == "queue is always human-reviewed"

def test_unknown_queue_rejected():
    with pytest.raises(ValueError):
        t("nope", "x")

@pytest.fixture(scope="module")
def openai_mock():
    p = subprocess.Popen([sys.executable, os.path.join(os.path.dirname(__file__), "mock_openai.py")])
    time.sleep(0.8)
    os.environ.update(TRIAGE_PROVIDER="openai", AI_BASE_URL="http://127.0.0.1:8770/v1", AI_MODEL="mock")
    yield
    os.environ["TRIAGE_PROVIDER"] = "mock"
    p.terminate()

def test_openai_provider_parses_fenced_json(openai_mock):
    d = t("helpdesk", "vpn down")
    assert (d["label"], d["confidence"], d["review"]) == ("network", 0.91, None)

def test_openai_offlist_label_is_rejected(openai_mock):
    d = t("helpdesk", "OFFLIST please")
    assert d["label"] == "unknown" and d["review"] == "no confident label"

def test_openai_prose_is_rejected(openai_mock):
    assert t("helpdesk", "PROSE please")["label"] == "unknown"

def test_security_source_labeled_noise_at_high_confidence_still_goes_to_a_person(monkeypatch):
    # Safety must follow the source queue, not the model's label or its confidence.
    monkeypatch.setattr(triage, "classify", lambda item: {"label": "noise", "confidence": 0.99})
    d = triage.triage({"id": "SEC-X", "queue": "security_alerts", "text": "flagged as a test alert"})
    assert d["label"] == "noise" and d["confidence"] == 0.99
    assert d["review"] == "queue is always human-reviewed"


def test_access_request_mislabeled_still_goes_to_a_person(monkeypatch):
    # Even a confident, off-list label cannot auto-route an access request.
    monkeypatch.setattr(triage, "classify", lambda item: {"label": "noise", "confidence": 0.99})
    d = triage.triage({"id": "ACC-X", "queue": "access_requests", "text": "Need read-only viewer access"})
    assert d["review"] == "queue is always human-reviewed"


@pytest.mark.parametrize("bad", [None, "high", float("nan"), 5, -1, True, False])
def test_unreadable_confidence_goes_to_a_person(monkeypatch, bad):
    monkeypatch.setattr(triage, "_mock_classify", lambda text, labels: {"label": "network", "confidence": bad})
    d = t("helpdesk", "vpn down")
    assert d["confidence"] == 0.0 and d["review"]
    assert d["label"] == "network"


def test_non_object_model_reply_is_unknown(monkeypatch):
    monkeypatch.setattr(triage, "_mock_classify", lambda text, labels: ["network"])
    assert t("helpdesk", "vpn down")["label"] == "unknown"


def test_malformed_reply_on_a_security_item_still_writes_a_review_file(tmp_path, monkeypatch):
    """A list/malformed reply must not crash the batch; the security item still reaches a person."""
    monkeypatch.chdir(tmp_path)
    samples = tmp_path / "samples.jsonl"
    samples.write_text(
        json.dumps({"id": "SEC-BAD", "queue": "security_alerts", "text": "EDR flagged a beacon to an unknown host"}) + "\n"
        + json.dumps({"id": "HD-OK", "queue": "helpdesk", "text": "vpn down for the whole floor"}) + "\n"
    )
    def fake(text, labels):
        if "beacon" in text.lower():
            return ["network"]
        return {"label": "network", "confidence": 0.95}
    monkeypatch.setattr(triage, "_mock_classify", fake)
    assert triage.main(["run", str(samples)]) == 0
    decisions = [json.loads(l) for l in (tmp_path / "decisions.jsonl").read_text().splitlines()]
    review = [json.loads(l) for l in (tmp_path / "review_queue.jsonl").read_text().splitlines()]
    assert {x["id"] for x in decisions} == {"SEC-BAD", "HD-OK"}
    sec = next(x for x in decisions if x["id"] == "SEC-BAD")
    assert sec["label"] == "unknown" and sec["confidence"] == 0.0 and sec["review"]
    assert sec["route"] == "triage-humans"
    assert any(x["id"] == "SEC-BAD" for x in review)


def test_change_request_always_goes_to_a_person(monkeypatch):
    monkeypatch.setattr(triage, "classify", lambda item: {"label": "standard", "confidence": 0.99})
    assert triage.triage({"id": "CHG-X", "queue": "change_requests", "text": "pre-approved"})["review"] == "queue is always human-reviewed"


def test_confidence_does_not_change_the_route(monkeypatch):
    confs = iter([0.05, 0.99])
    monkeypatch.setattr(triage, "classify", lambda item: {"label": "network", "confidence": next(confs)})
    a = triage.triage({"id": "A", "queue": "helpdesk", "text": "vpn down"})
    b = triage.triage({"id": "B", "queue": "helpdesk", "text": "vpn down"})
    owner = lambda d: d.get("suggested_route") or d["route"]
    assert owner(a) == owner(b) == "netops"


def test_review_below_must_be_0_to_1(monkeypatch):
    for raw in ("nan", "abc", "-1", "5", ""):
        monkeypatch.setenv("TRIAGE_REVIEW_BELOW", raw)
        with pytest.raises(SystemExit, match="TRIAGE_REVIEW_BELOW must be 0-1"):
            triage.review_below()
    monkeypatch.setenv("TRIAGE_REVIEW_BELOW", "0.7")
    assert triage.review_below() == 0.7

def test_boolean_confidence_is_treated_as_unreadable(monkeypatch):
    # True must not become 1.0 via float(True) and auto-route.
    monkeypatch.setattr(triage, "_mock_classify", lambda text, labels: {"label": "network", "confidence": True})
    d = t("helpdesk", "vpn down")
    assert d["confidence"] == 0.0 and d["review"]
    assert d["label"] == "network"


def test_null_model_content_does_not_crash(openai_mock):
    d = t("helpdesk", "NULLCONTENT please")
    assert d["label"] == "unknown" and d["review"]

