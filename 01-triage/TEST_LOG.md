# TEST_LOG: drop-1 triage router

- Date: 2026-11-18 22:29:35 CST (Linux test machine), Python 3.13.5, pytest in a temp venv (clean copy at <drop>)

## 1. Unit tests: `pytest -v test_triage.py`
```
============================= test session starts ==============================
platform linux -- Python 3.13.5, pytest-9.2.0, pluggy-1.7.0 -- <drop>/.venv/bin/python
cachedir: .pytest_cache
rootdir: <drop>
collecting ... collected 25 items

test_triage.py::test_every_queue_routes_to_a_known_owner PASSED          [  4%]
test_triage.py::test_urgent_terms_raise_priority PASSED                  [  8%]
test_triage.py::test_low_confidence_goes_to_a_person PASSED              [ 12%]
test_triage.py::test_no_label_goes_to_a_person PASSED                    [ 16%]
test_triage.py::test_resume_queue_is_always_human PASSED                 [ 20%]
test_triage.py::test_unknown_queue_rejected PASSED                       [ 24%]
test_triage.py::test_openai_provider_parses_fenced_json PASSED           [ 28%]
test_triage.py::test_openai_offlist_label_is_rejected PASSED             [ 32%]
test_triage.py::test_openai_prose_is_rejected PASSED                     [ 36%]
test_triage.py::test_security_source_labeled_noise_at_high_confidence_still_goes_to_a_person PASSED [ 40%]
test_triage.py::test_access_request_mislabeled_still_goes_to_a_person PASSED [ 44%]
test_triage.py::test_unreadable_confidence_goes_to_a_person[None] PASSED [ 48%]
test_triage.py::test_unreadable_confidence_goes_to_a_person[high] PASSED [ 52%]
test_triage.py::test_unreadable_confidence_goes_to_a_person[nan] PASSED  [ 56%]
test_triage.py::test_unreadable_confidence_goes_to_a_person[5] PASSED    [ 60%]
test_triage.py::test_unreadable_confidence_goes_to_a_person[-1] PASSED   [ 64%]
test_triage.py::test_unreadable_confidence_goes_to_a_person[True] PASSED [ 68%]
test_triage.py::test_unreadable_confidence_goes_to_a_person[False] PASSED [ 72%]
test_triage.py::test_non_object_model_reply_is_unknown PASSED            [ 76%]
test_triage.py::test_malformed_reply_on_a_security_item_still_writes_a_review_file PASSED [ 80%]
test_triage.py::test_change_request_always_goes_to_a_person PASSED       [ 84%]
test_triage.py::test_confidence_does_not_change_the_route PASSED         [ 88%]
test_triage.py::test_review_below_must_be_0_to_1 PASSED                  [ 92%]
test_triage.py::test_boolean_confidence_is_treated_as_unreadable PASSED  [ 96%]
test_triage.py::test_null_model_content_does_not_crash PASSED            [100%]

============================== 25 passed in 0.86s ==============================
```
Covers: every label in all 9 queues maps to its configured owner (as `route` when auto, or `suggested_route` when a person must review); urgent terms raise priority; low confidence, no label, and always-human queues go to review; a security-source item labeled noise at 0.99 still goes to a person; an access request or change request still goes to a person; unreadable or out-of-range confidence becomes 0.0; a list or malformed reply does not crash the batch and still writes a review file; confidence does not change the owner; `TRIAGE_REVIEW_BELOW` must be 0-1; unknown queue rejected; the `openai` provider path against a fake OpenAI-compatible server (fenced JSON parsed; off-list label rejected; prose answer rejected; a null `content` field does not crash). A boolean `confidence` (including `True`) is treated as unreadable and becomes 0.0. Tests force the mock provider so a leftover real-model environment cannot change the default path.

## 2. End-to-end run, mock provider: `python3 triage.py run samples.jsonl`
```
HD-101         helpdesk             network           1.00 P1  -> netops               auto
HD-102         helpdesk             access            1.00 P3  -> identity-team        auto
HD-103         helpdesk             software          0.67 P3  -> triage-humans        REVIEW: confidence 0.67 < 0.7
SEC-201        security_alerts      phishing          1.00 P1  -> triage-humans        REVIEW: queue is always human-reviewed
SEC-202        security_alerts      malware           1.00 P3  -> triage-humans        REVIEW: queue is always human-reviewed
INC-301        oncall_incidents     availability      1.00 P1  -> primary-oncall       auto
BUG-401        bug_reports          ui                1.00 P3  -> frontend             auto
CHG-501        change_requests      standard          1.00 P3  -> triage-humans        REVIEW: queue is always human-reviewed
ACC-601        access_requests      read              1.00 P3  -> triage-humans        REVIEW: queue is always human-reviewed
INV-701        vendor_invoices      unmatched         1.00 P1  -> triage-humans        REVIEW: label 'unmatched' always gets a person
RES-801        resumes_to_openings  cloud_engineer    1.00 P3  -> triage-humans        REVIEW: queue is always human-reviewed
CX-901         customer_email       billing           1.00 P3  -> billing-desk         auto
CX-902         customer_email       unknown           0.00 P3  -> triage-humans        REVIEW: no confident label

13 items, 5 auto-routed, 8 sent to a person
```
`python3 triage.py correct CX-902 account` -> appended one line to corrections.jsonl.

When `review` is set, the printed `route` is `triage-humans` and `suggested_route` in decisions.jsonl holds the lookup-table owner (for example SEC-201 `soc-tier1`, CHG-501 `auto-approve-window`, INV-701 `ap-exceptions`). Source-queue review still sends every security alert, access request, and change request to a person, including SEC-201 (phishing) and CHG-501 (standard change). Model confidence is advisory.

## Not verified here
- Classification quality with a real LLM (see `proof-real-model.txt` for local Ollama runs).
- Confidence scores from real models are self-reported and not calibrated; they are advisory only.
- Windows/macOS.

Full captured output: `proof.txt`.
