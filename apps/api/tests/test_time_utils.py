from datetime import datetime, timezone

from nox_api.core.time_utils import now_utc, now_utc_naive, utc_from_timestamp


def test_now_utc():
    dt = now_utc()
    assert isinstance(dt, datetime)
    assert dt.tzinfo == timezone.utc


def test_now_utc_naive():
    dt = now_utc_naive()
    assert isinstance(dt, datetime)
    assert dt.tzinfo is None


def test_utc_from_timestamp():
    ts = 1700000000.0
    dt = utc_from_timestamp(ts)
    assert isinstance(dt, datetime)
    assert dt.tzinfo == timezone.utc
    assert dt.timestamp() == ts
