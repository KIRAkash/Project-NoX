from nox_api.core.config import settings
from nox_api.workers import tasks


def test_beat_schedule_names_registered_tasks(monkeypatch):
    monkeypatch.setattr(settings, "SOURCE_MONITOR_MODE", "polling")
    monkeypatch.setattr(tasks.celery_app.conf, "beat_schedule", {})

    tasks.configure_beat_schedule()

    schedule = tasks.celery_app.conf.beat_schedule
    assert schedule
    for entry in schedule.values():
        assert entry["task"] in tasks.celery_app.tasks
