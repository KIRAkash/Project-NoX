import os
import subprocess
from pathlib import Path


def test_deploy_gcp_dry_run():
    repo_root = Path(__file__).resolve().parents[3]
    script_path = repo_root / "scripts" / "deploy_gcp.sh"

    env = os.environ.copy()
    env["DRY_RUN"] = "1"
    env["GCP_PROJECT_ID"] = "test-project-123"
    env["NOX_SQL_INSTANCE"] = "proj:region:inst"
    env["CLOUD_REDIS_URL"] = ""  # the demo deployment has no Redis

    res = subprocess.run(
        [str(script_path), "all"],
        cwd=str(repo_root),
        env=env,
        capture_output=True,
        text=True,
        check=True,
    )

    stdout = res.stdout

    # Requirement 1: billingbudgets API enabled
    assert "billingbudgets.googleapis.com" in stdout

    # Requirement 2: billing budget creation with thresholds
    assert "gcloud billing budgets create" in stdout
    assert "--threshold-rule=percent=0.5" in stdout
    assert "--threshold-rule=percent=0.8" in stdout
    assert "--threshold-rule=percent=0.9" in stdout
    assert "--threshold-rule=percent=1.0" in stdout

    # Requirement 3: one API instance (jobs and live events in-process), scale to zero, CPU on while up
    assert "gcloud run deploy nox-api" in stdout
    assert "--max-instances=1" in stdout
    assert "--min-instances 0" in stdout
    assert "--no-cpu-throttling" in stdout
    assert "WORKER_MODE=in_process" in stdout

    # Requirement 4: no worker, no Redis, no VPC egress
    assert "nox-worker" not in stdout
    assert "redis.googleapis.com" not in stdout
    assert "--vpc-egress" not in stdout

    # Requirement 5: consumer quota overrides for aiplatform & modelarmor
    assert "gcloud beta services quota update --service=aiplatform.googleapis.com" in stdout
    assert "gcloud beta services quota update --service=modelarmor.googleapis.com" in stdout
