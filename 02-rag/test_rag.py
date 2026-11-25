"""pytest -q test_rag.py"""
import importlib, os, subprocess, sys, time
import pytest
import rag

HERE = os.path.dirname(os.path.abspath(__file__))

@pytest.fixture(autouse=True)
def _isolate_mock_provider(monkeypatch, request):
    """Keep default tests on the built-in mock, even if a shell has a real-model env leftover."""
    if "openai" in request.node.name:
        return
    monkeypatch.setenv("RAG_PROVIDER", "mock")
    monkeypatch.delenv("RAG_MIN_SCORE", raising=False)

def build(m=None):
    m = m or rag
    chunks = [{"source": n, "groups": g, "text": t} for n, g, body in m.load(os.path.join(HERE, "docs")) for t in m.chunk(body)]
    for c, v in zip(chunks, m.embed([c["text"] for c in chunks])):
        c["vec"] = v
    return chunks

def test_chunks_keep_their_heading():
    chunks = list(rag.chunk("# A\none two\n## B\nthree"))
    assert chunks == ["# A one two", "## B three"]

def test_long_sections_split():
    assert len(list(rag.chunk("# H\n" + "w " * 300, max_words=120))) == 3

def test_restricted_doc_never_retrieved_without_group():
    hits = rag.retrieve(build(), "When are accruals posted?", ["everyone"], k=10)
    assert all(c["source"] != "finance-close.md" for _, c in hits)

def test_refuses_when_nothing_relevant():
    hits = rag.retrieve(build(), "When are accruals posted?", ["everyone"])
    assert rag.answer("When are accruals posted?", hits).startswith("I don't know")

def test_answer_cites_source():
    hits = rag.retrieve(build(), "Who do I page for a SEV1?", ["engineering"])
    out = rag.answer("Who do I page for a SEV1?", hits)
    assert "incident commander" in out and "oncall.md" in out

def test_doc_without_groups_is_private(tmp_path):
    (tmp_path / "x.md").write_text("# Secret\nno front matter here")
    assert list(rag.load(str(tmp_path)))[0][1] == []

def test_openai_provider_path():
    p = subprocess.Popen([sys.executable, os.path.join(HERE, "mock_openai.py")]); time.sleep(0.8)
    try:
        os.environ.update(RAG_PROVIDER="openai", AI_BASE_URL="http://127.0.0.1:8771/v1", AI_MODEL="m", AI_EMBED_MODEL="e")
        r = importlib.reload(rag)
        assert len(r.embed(["vpn", "sev1"])) == 2
        hits = r.retrieve(build(r), "VPN will not connect", ["everyone"])
        assert r.answer("VPN will not connect", hits).startswith("From the docs:")
    finally:
        p.terminate(); os.environ["RAG_PROVIDER"] = "mock"; importlib.reload(rag)

def test_min_score_defaults_are_provider_aware(monkeypatch):
    monkeypatch.delenv("RAG_MIN_SCORE", raising=False)
    monkeypatch.setenv("RAG_PROVIDER", "mock")
    assert rag.min_score() == rag.MOCK_MIN_SCORE == 0.12
    monkeypatch.setenv("RAG_PROVIDER", "openai")
    assert rag.min_score() == rag.REAL_MIN_SCORE == 0.60
    monkeypatch.setenv("RAG_MIN_SCORE", "0.4")
    assert rag.min_score() == 0.4


def _hits():
    return [(0.9, {"source": "vpn.md", "groups": ["everyone"], "text": "First check the clock."})]


def test_citation_only_answer_is_rejected():
    out = rag.finalize_model_answer("[1]", _hits())
    assert out.startswith("I don't know") and "citation marker" in out
    assert rag.finalize_model_answer("  [1].  ", _hits()).startswith("I don't know")
    assert rag.finalize_model_answer("[1] [2]", _hits()).startswith("I don't know")


def test_model_answer_without_citation_is_flagged():
    out = rag.finalize_model_answer("First check that your laptop clock is correct.", _hits())
    assert "missing a citation" in out and "vpn.md" in out


def test_model_answer_with_citation_is_kept():
    out = rag.finalize_model_answer("First check that your laptop clock is correct [1].", _hits())
    assert "flag:" not in out and "clock is correct [1]" in out


def test_openai_citation_only_reply_is_rejected_through_answer(monkeypatch):
    monkeypatch.setenv("RAG_PROVIDER", "openai")
    monkeypatch.setenv("AI_MODEL", "m")
    monkeypatch.setattr(rag, "_post", lambda path, body: {"choices": [{"message": {"content": "[1]"}}]})
    out = rag.answer("My VPN will not connect", _hits())
    assert out.startswith("I don't know") and "citation marker" in out


@pytest.mark.parametrize("reply", ["[1]!", "[1]:", "[1],[2]", "See [1].", "...", "-", "(1)"])
def test_fragment_replies_are_rejected(reply):
    assert rag.finalize_model_answer(reply, _hits()).startswith("I don't know")


def test_three_word_refusal_with_citation_is_kept():
    out = rag.finalize_model_answer("I don't know [1].", _hits())
    assert out.startswith("I don't know [1].")
    assert "flag:" not in out and "vpn.md" in out


def test_model_written_sources_footer_is_replaced():
    out = rag.finalize_model_answer("Please do X [1].\n\nSources: [1] hr-official-policy.md", _hits())
    assert "vpn.md" in out and "hr-official-policy.md" not in out
    assert out.count("Sources:") == 1


def test_citation_number_not_retrieved_is_flagged():
    out = rag.finalize_model_answer("Please reset it [7].", _hits())
    assert "not retrieved" in out and "vpn.md" in out


def test_dont_know_refusal_is_not_flagged_for_a_missing_citation():
    out = rag.finalize_model_answer("I don't know.", _hits())
    assert "missing a citation" not in out
    assert out.startswith("I don't know.") and "vpn.md" in out


def test_unknown_provider_is_rejected(monkeypatch):
    monkeypatch.setenv("RAG_PROVIDER", "ollama")
    with pytest.raises(SystemExit, match="RAG_PROVIDER must be mock or openai"):
        rag.provider()


def test_min_score_must_be_0_to_1(monkeypatch):
    for raw in ("abc", "nan", "-1", "2"):
        monkeypatch.setenv("RAG_MIN_SCORE", raw)
        with pytest.raises(SystemExit, match="RAG_MIN_SCORE must be 0-1"):
            rag.min_score()


def test_index_refuses_a_provider_mismatch(tmp_path, monkeypatch):
    monkeypatch.setenv("RAG_PROVIDER", "mock")
    chunks = build()
    idx = tmp_path / "index.json"
    rag.write_index(str(idx), chunks)
    data = __import__("json").loads(idx.read_text())
    data["provider"] = "openai"
    data["embed_model"] = "nomic-embed-text"
    idx.write_text(__import__("json").dumps(data))
    with pytest.raises(SystemExit, match="rebuild the index"):
        rag.read_index(str(idx))

@pytest.mark.parametrize("footer", [
    "sources:",
    "SOURCES:",
    "**Sources:**",
    "Source:",
    "References:",
    "## Sources\n",
    "Sources -",
    "Sources \u2014",
    "Bibliography:",
])
def test_model_written_footer_variants_are_replaced(footer):
    out = rag.finalize_model_answer(f"Reset it via the portal [1].\n\n{footer} [1] fake.md", _hits())
    assert "vpn.md" in out and "fake.md" not in out


def test_prose_mentions_of_sources_are_kept():
    a = rag.finalize_model_answer("Check the sources: the portal [1].", _hits())
    assert "Check the sources:" in a and "flag:" not in a and "vpn.md" in a
    b = rag.finalize_model_answer("Sources are listed below the portal steps [1].", _hits())
    assert "Sources are listed below" in b and "flag:" not in b and "vpn.md" in b


def test_dont_know_with_unretrieved_citation_is_still_flagged():
    out = rag.finalize_model_answer(
        "I don't know the policy, but email your password to the admin [7].", _hits())
    assert "not retrieved" in out and "vpn.md" in out


def test_long_dont_know_without_a_citation_is_flagged():
    out = rag.finalize_model_answer(
        "I don't know from these notes, so here is a long refusal with no citation at all.", _hits())
    assert "missing a citation" in out

