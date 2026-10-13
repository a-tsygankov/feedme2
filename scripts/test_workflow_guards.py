"""Pins the deploy workflow's safety rules (incident 2026-10-12: PR #2's merge run was
cancelled by PR #3's and its backend never deployed; a manual dispatch deploys any ref)."""
import re
import unittest
from pathlib import Path

WF = (Path(__file__).resolve().parent.parent / ".github" / "workflows" / "deploy.yml").read_text(encoding="utf-8")


def job_block(name: str) -> str:
    m = re.search(rf"^  {re.escape(name)}:\n(.*?)(?=^  [a-z0-9-]+:\n|\Z)", WF, re.S | re.M)
    if not m:
        raise AssertionError(f"job {name} not found")
    return m.group(1)


class DeployGuards(unittest.TestCase):
    def test_deploy_jobs_only_deploy_main_on_dispatch(self):
        for job in ("backend-deploy", "webapp-deploy"):
            block = job_block(job)
            self.assertRegex(block, r"github\.event_name == 'workflow_dispatch' && github\.ref == 'refs/heads/main'", job)

    def test_pushes_to_main_are_not_cancelled(self):
        self.assertRegex(WF, r"cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}")

    def test_push_diff_starts_at_last_successful_run(self):
        block = job_block("changes")
        self.assertIn("fetch-depth: 0", block)
        self.assertIn("id: lastgood", block)
        self.assertRegex(block, r"base: \$\{\{ steps\.lastgood\.outputs\.sha")
        self.assertIn("actions: read", block)


if __name__ == "__main__":
    unittest.main()
