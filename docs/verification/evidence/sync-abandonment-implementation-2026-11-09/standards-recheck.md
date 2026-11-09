## Standards recheck

Reviewed the focused final code delta `dfde742a73d4036a07ed066203cde0dff083ef55...495de590` against the same repository standards and Fowler smell baseline.

No material findings.

The immutable pre-quit receipt uses the existing archival writer. Post-quit autostash evidence is parsed through explicit strict schemas and validated in the existing rebase module, without changing published recovery formats. The option check normalizes the accepted alias spellings while retaining explicit-option detection independently from ordinary defaults. New regressions remain public CLI processes with real Git state; malformed retained evidence and concurrent mutations are negative boundary cases.

No documented-standard violations or actionable material smells were found in this delta. English and attribution/compatibility requirements remain satisfied. This was read-only; no builds, tests, CI or other reviewer output were used.

### Bounded CI timeout adjustment

Reviewed the subsequent working-tree delta limited to `.github/workflows/ci.yml` and `CONTRIBUTING.md`. It changes the existing single Linux job timeout from 10 to 12 minutes and updates the corresponding approximate gross execution bound from $0.06 to $0.07 at the documented $0.006/minute rate (12 × $0.006 = $0.072). It adds no jobs, triggers or matrix execution. No material Standards concern; the cost-control documentation remains consistent with the workflow. No builds, tests or CI were run for this check.
