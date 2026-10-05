# Security audit, 2026-10-04

Source-first audit run with the Cloudflare security-audit skill (profile `quick`), against `snapwod/snapwod` @ `82df09f` (docs/) and `salarycliff/snapwod` @ `2343d3e`. One combined report covers both repositories.

- `REPORT.md`: scope, posture, confirmed findings, needs-validation leads, hardening notes, coverage.
- `FINDINGS-DETAIL.md`: full trace and reproduction for confirmed medium-or-higher findings.
- `NEEDS-VALIDATION.md`: leads that depend on deployment or provider facts outside the repo, with owner checks.
- `findings.json`, `coverage-ledger.json`: machine-readable records. A future audit run reads these as prior coverage.

Paths of the form `agents/<id>/artifacts/...` refer to sandbox evidence files in the audit run directory. They are not committed here.
