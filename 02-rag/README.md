# From rags to answers: RAG in one file

Built by the CornerStone AI Research Lab at CornerStone Technology Talent Services.

**Scope:** A starter that shows the five RAG steps on four sample docs, not a production search system.

**Runs in:** any terminal with the listed runtime. Plain VS Code is the baseline; because this is a plain Python project with no editor-specific files, it should work the same opened in Cursor, Claude Code or Codex. No tool-specific features are used or claimed.

**Retrieval-augmented generation (RAG)**: instead of hoping a model memorized your docs, you
fetch the relevant passages at question time and make the model answer from them, with sources.

`docs → chunk → embed → retrieve → answer`

## Files
- `rag.py`: the whole pipeline (stdlib only, Python 3.10+)
- `docs/`: four sample docs; each names the groups allowed to read it (`finance-close.md` is finance-only)
- `questions.jsonl`: retrieval eval cases, including one that must return nothing
- `test_rag.py`, `mock_openai.py`: tests, including a fake OpenAI-compatible endpoint

## Run it (no keys, no model)
```bash
python3 rag.py index docs/
python3 rag.py ask "My VPN won't connect, what should I check first?"
python3 rag.py ask "When are accruals posted?" --groups everyone            # "I don't know..."
python3 rag.py ask "When are accruals posted?" --groups everyone,finance    # answers, cites finance-close.md
python3 rag.py eval questions.jsonl                                         # 5/5, exit 0
pip install pytest && pytest -q test_rag.py
```
`--groups` is passed on the command line only for the demo. In a real system, take the user's groups from your identity provider, never from the request. `index.json` stores every chunk's text, so protect it like the source docs.

The mock "embedding" is hashed word counts: good enough to see the mechanics, far weaker than a real embedding model.

## Use real models
```bash
export RAG_PROVIDER=openai AI_BASE_URL=http://localhost:11434/v1 AI_MODEL=<chat model> AI_EMBED_MODEL=<embedding model>
python3 rag.py index docs/      # re-index whenever you change the embedding model
```
Any OpenAI-compatible endpoint works (set `AI_API_KEY` if needed). The refusal threshold is provider-aware: the mock defaults to `0.12`, real embeddings default to `0.60`. Override either with `RAG_MIN_SCORE` (required to tune for your embedding model; score scales differ). The answer prompt asks for a complete sentence plus a citation such as `[1]`. A reply that is only a citation marker is rejected.

## Five decisions that matter more than the framework
1. **Chunking**: split on structure (headings, sections) and keep the heading with the text.
2. **Embeddings**: pick one model, re-index when you change it, and test on your own questions.
3. **Access control**: filter by permission *before* ranking. A chunk the user can't read should never reach the model.
4. **Evals**: a small file of real questions with the expected source, including ones that must return "I don't know".
5. **Cost**: you pay to embed once per change and per question; cap `k` and chunk size before reaching for a bigger model.

## Setup and proof commands (from a clean copy)
```bash
python3 -m venv .venv && . .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt                  # pytest only; the code itself has no dependencies
python -m pytest -q
python rag.py index docs/ && python rag.py eval questions.jsonl
```
Optional: copy `.env.example` to `.env`, fill it in, then `set -a; . ./.env; set +a` (the code reads environment variables; it does not load `.env` by itself).

License: MIT (see `LICENSE`). No warranty.
