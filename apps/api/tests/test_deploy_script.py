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
    env["CLOUD_REDIS_URL"] = "redis://localhost:6379"

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

    # Requirement 3: api max-instances=5 and concurrency=80
    assert "--max-instances=5" in stdout
    assert "--concurrency=80" in stdout

    # Requirement 4: worker max-instances=1 and concurrency=1
    assert "--max-instances=1" in stdout
    assert "--concurrency=1" in stdout

    # Requirement 5: consumer quota overrides for aiplatform & modelarmor
    assert "gcloud services consumer-quota overrides create --service=aiplatform.googleapis.com" in stdout
    assert "gcloud services consumer-quota overrides create --service=modelarmor.googleapis.com" in stdout
