# Templates

Configuring a machine reads these: the roles of each side's `configure` loop, setup's first step (`worker-config`, `validator-config`), and its apply step (`config-cli.js apply`). The installer copies them to `.contrejour/templates/`; you do not copy them by hand.

| Template | Used by |
| --- | --- |
| [TASK_TEMPLATE.md](TASK_TEMPLATE.md) | `validator-config`. Becomes `task.md`, the only statement of the task; the worker's configuration fetches it through the `task` tool, and `worker-task-manager` fetches it again each round. |
| [ROLE_WORKER.md](ROLE_WORKER.md), [ROLE_VALIDATOR.md](ROLE_VALIDATOR.md) | Apply writes the matching one between the `CONTREJOUR ROLE` markers in `CLAUDE.md`: the rules every role of that side follows. |
| [ENVIRONMENT.md](ENVIRONMENT.md) | Apply starts the `CONTREJOUR ENVIRONMENT` section of `CLAUDE.md` with it; the configuration role, then the memory role, replace it with the machine's facts. |
| [TESTER_FACILITY_CONFIG_TEMPLATE.json](TESTER_FACILITY_CONFIG_TEMPLATE.json) | `validator-config`. Starting point for the benchmark's frozen base layer. |
| [tester-benchmark/](tester-benchmark/) | `validator-config`. A worked lm-evaluation-harness deployment. |

## Benchmark runner protocol

The base layer's `setup`, `healthcheck`, `smoke` and `test` entries are argv arrays with timeouts. Use `python` rather than `python3` so the same config runs on Windows. Runners receive:

| Variable | Value |
| --- | --- |
| `CONTREJOUR_TEST_MODE` | `smoke` or `full` |
| `CONTREJOUR_TEST_ID`, `CONTREJOUR_PROJECT_ID` | Identity of this run |
| `CONTREJOUR_ARTIFACT_REF`, `CONTREJOUR_ARTIFACT_SHA256` | The unpacked deliverable and its digest |
| `CONTREJOUR_ADAPTER_DIR` | The validator agent's adapter for this deliverable |
| `CONTREJOUR_TEST_DIR` | Where to write predictions and native benchmark output |
| `CONTREJOUR_TEST_OUTPUT` | Where to write the result JSON, only after evaluation finishes |

```json
{
  "artifact_sha256": "<CONTREJOUR_ARTIFACT_SHA256>",
  "metrics": {"accuracy": 0.5},
  "samples": [
    {"id": "case-1", "status": "ok", "metrics": {"accuracy": 1}},
    {"id": "case-2", "status": "ok", "metrics": {"accuracy": 0}}
  ],
  "evidence_files": ["predictions.jsonl", "native-results.json"]
}
```

- Each sample is one test. Sample ids are stable and unique; repeats get their own ids. A sample the deliverable crashed on stays in the list with `status: "failed"` and counts as a failed test; the helper rejects runs that drop samples.
- `dataset.expected_samples` is the full protocol count including repeats, never the smoke count.
- Every `ok` sample carries a finite value of the metric named by `validation.pass_rule`; the helper applies the rule to it. Aggregate `metrics` are kept for the record and not published.
- Files listed in the config's `evidence_files` are hashed when the validator's configuration is applied. Changing one stops the validation service until the configuration is applied again (the `configure` loop).
- Layers the `test-extender` role adds later use the same output format (without `metrics` and `evidence_files`); see its role file.
