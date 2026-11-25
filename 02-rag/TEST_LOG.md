# TEST_LOG: drop-2 RAG starter

- Date: 2026-11-18 22:29:35 CST (Linux test machine), Python 3.13.5, pytest in a temp venv (clean copy at <drop>)

## 1. Unit tests: `pytest -v test_rag.py`
```
============================= test session starts ==============================
platform linux -- Python 3.13.5, pytest-9.2.0, pluggy-1.7.0 -- <drop>/.venv/bin/python
cachedir: .pytest_cache
rootdir: <drop>
collecting ... collected 35 items

test_rag.py::test_chunks_keep_their_heading PASSED                       [  2%]
test_rag.py::test_long_sections_split PASSED                             [  5%]
test_rag.py::test_restricted_doc_never_retrieved_without_group PASSED    [  8%]
test_rag.py::test_refuses_when_nothing_relevant PASSED                   [ 11%]
test_rag.py::test_answer_cites_source PASSED                             [ 14%]
test_rag.py::test_doc_without_groups_is_private PASSED                   [ 17%]
test_rag.py::test_openai_provider_path PASSED                            [ 20%]
test_rag.py::test_min_score_defaults_are_provider_aware PASSED           [ 22%]
test_rag.py::test_citation_only_answer_is_rejected PASSED                [ 25%]
test_rag.py::test_model_answer_without_citation_is_flagged PASSED        [ 28%]
test_rag.py::test_model_answer_with_citation_is_kept PASSED              [ 31%]
test_rag.py::test_openai_citation_only_reply_is_rejected_through_answer PASSED [ 34%]
test_rag.py::test_fragment_replies_are_rejected[[1]!] PASSED             [ 37%]
test_rag.py::test_fragment_replies_are_rejected[[1]:] PASSED             [ 40%]
test_rag.py::test_fragment_replies_are_rejected[[1],[2]] PASSED          [ 42%]
test_rag.py::test_fragment_replies_are_rejected[See [1].] PASSED         [ 45%]
test_rag.py::test_fragment_replies_are_rejected[...] PASSED              [ 48%]
test_rag.py::test_fragment_replies_are_rejected[-] PASSED                [ 51%]
test_rag.py::test_fragment_replies_are_rejected[(1)] PASSED              [ 54%]
test_rag.py::test_three_word_refusal_with_citation_is_kept PASSED        [ 57%]
test_rag.py::test_model_written_sources_footer_is_replaced PASSED        [ 60%]
test_rag.py::test_citation_number_not_retrieved_is_flagged PASSED        [ 62%]
test_rag.py::test_dont_know_refusal_is_not_flagged_for_a_missing_citation PASSED [ 65%]
test_rag.py::test_unknown_provider_is_rejected PASSED                    [ 68%]
test_rag.py::test_min_score_must_be_0_to_1 PASSED                        [ 71%]
test_rag.py::test_index_refuses_a_provider_mismatch PASSED               [ 74%]
test_rag.py::test_model_written_footer_variants_are_replaced[sources:] PASSED [ 77%]
test_rag.py::test_model_written_footer_variants_are_replaced[SOURCES:] PASSED [ 80%]
test_rag.py::test_model_written_footer_variants_are_replaced[**Sources:**] PASSED [ 82%]
test_rag.py::test_model_written_footer_variants_are_replaced[Source:] PASSED [ 85%]
test_rag.py::test_model_written_footer_variants_are_replaced[References:] PASSED [ 88%]
test_rag.py::test_model_written_footer_variants_are_replaced[## Sources\n] PASSED [ 91%]
test_rag.py::test_prose_mentions_of_sources_are_kept PASSED              [ 94%]
test_rag.py::test_dont_know_with_unretrieved_citation_is_still_flagged PASSED [ 97%]
test_rag.py::test_long_dont_know_without_a_citation_is_flagged PASSED    [100%]

============================== 35 passed in 0.90s ==============================
```
Covers: chunking; access control (finance-close.md never retrieved without the finance group); refusal when nothing relevant is allowed; citations in mock answers; provider-aware min-score defaults (0.12 mock, 0.60 real, env override, 0-1 validation); citation-only and short fragment replies are rejected; answers missing a citation are flagged; a model-written Sources/References footer (any case, line start) is replaced and citation numbers not retrieved are flagged; a short "I don't know" refusal is not flagged for a missing citation, but an unretrieved citation in that refusal is still flagged; mid-sentence mentions such as "Check the sources:" are kept; an unknown provider or a mismatched index is a hard error; the `openai` provider path against a fake OpenAI-compatible server.

## 2. End-to-end, mock provider
```
$ python3 rag.py index docs
indexed 7 chunks from 4 docs -> index.json

$ python3 rag.py eval questions.jsonl
PASS  "My VPN won't connect, what should I check first?" groups=['everyone'] -> vpn.md
PASS  'Who do I page for a SEV1?' groups=['everyone', 'engineering'] -> oncall.md
PASS  'Where do software purchases go?' groups=['everyone'] -> expenses.md
PASS  'When are accruals posted?' groups=['everyone'] -> None
PASS  'When are accruals posted?' groups=['everyone', 'finance'] -> finance-close.md

retrieval: 5/5 correct

$ python3 rag.py ask "Who do I page for a SEV1?" --groups everyone,engineering
  0.424  oncall.md: ## Severity SEV1 means customers cannot complete a core action such as...
  0.183  oncall.md: # On-call handbook The primary on-call engineer acknowledges a page wi...
  0.000  expenses.md: # Expenses Submit receipts in the expense tool within the month they w...

Page the incident commander for every SEV1. [1]

Sources: [1] oncall.md, [2] oncall.md

$ python3 rag.py ask "When are accruals posted?" --groups everyone
  0.000  expenses.md: # Expenses Submit receipts in the expense tool within the month they w...
  0.000  vpn.md: # VPN access Install the company VPN client from the self-service port...
  0.000  vpn.md: ## When the VPN will not connect First check that your laptop clock is...

I don't know from the documents you can access.
```
Eval exit 0 (0 means every retrieval case passed).

## Not verified here
- Answer quality with a real LLM and real embeddings (see `proof-real-model.txt`).
- The real-embedding default of `RAG_MIN_SCORE=0.60` is a starting point and should be retuned per model and corpus.
- Windows/macOS.

Full captured output: `proof.txt`.

## Addendum 2026-11-18 22:35 CST
D2-L7: footer regex also strips "Sources -", "Sources —" and "Bibliography:". Re-run: pytest test_rag.py -> 38 passed (was 35).
