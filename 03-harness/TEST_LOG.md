# TEST_LOG: drop-3 agent harness

- Date: 2026-11-18 22:29:35 CST (Linux test machine), Python 3.13.5, pytest in a temp venv (clean copy at <drop>)

## 1. Unit tests: `pytest -v test_harness.py`
```
============================= test session starts ==============================
platform linux -- Python 3.13.5, pytest-9.2.0, pluggy-1.7.0 -- <drop>/.venv/bin/python
cachedir: .pytest_cache
rootdir: <drop>
collecting ... collected 12 items

test_harness.py::test_default_denies_every_ask_and_changes_nothing PASSED [  8%]
test_harness.py::test_human_yes_allows_the_write_only PASSED             [ 16%]
test_harness.py::test_every_node_is_logged PASSED                        [ 25%]
test_harness.py::test_step_budget PASSED                                 [ 33%]
test_harness.py::test_openai_planner_is_still_gated PASSED               [ 41%]
test_harness.py::test_invalid_tool_args_are_a_clear_error_not_a_typeerror PASSED [ 50%]
test_harness.py::test_non_string_args_are_a_clear_error_and_skip_the_approval_gate PASSED [ 58%]
test_harness.py::test_denied_tool_with_bad_args_stays_deny PASSED        [ 66%]
test_harness.py::test_non_object_step_is_a_logged_deny PASSED            [ 75%]
test_harness.py::test_openai_planner_prompt_includes_argument_schemas PASSED [ 83%]
test_harness.py::test_list_tool_name_is_a_logged_deny PASSED             [ 91%]
test_harness.py::test_dict_steps_do_not_crash PASSED                     [100%]

============================== 12 passed in 0.88s ==============================
```
Covers: default deny of every write (`ask`) and every destructive action; a human yes at the gate allows only the write; every graph node is logged; the step budget is capped; the openai planner path against a fake server is still gated and the planner prompt includes argument schemas; invalid tool args (wrong or missing names, or a non-string where a string is required) are a clear error, not a TypeError, and the tool does not run; a denied tool with bad args stays `deny`; a non-object step is a logged `deny` and does not crash; a list used as a tool name is a logged `deny`; a dict in place of a steps list does not crash. Tests force the mock planner so a leftover real-model environment cannot change the default path.

## 2. End-to-end, mock planner: `python3 harness.py "Fix the typo in notes.txt and tidy up"`
```
1. list_dir     allow            'README.md\nnotes.txt'
2. read_file    allow            'Teh deploy runs on Fridays.\n'
3. write_file   not-approved     ''
4. delete_path  deny             ''
5. read_file    deny             '../../etc/passwd is outside the sandbox'
6. shell        deny             ''

audit log: audit.jsonl
```
Default `HARNESS_APPROVE=deny`: the write is not approved, the delete is denied, the sandbox escape is denied, the unknown tool is denied. Workspace files are unchanged.

## Not verified here
- Planner quality with a real LLM (see `proof-real-model.txt`). The planner prompt now includes each tool's argument schema.
- The in-process sandbox is a seatbelt, not a wall.
- Windows/macOS.

Full captured output: `proof.txt`.
