from datetime import datetime, timezone


def now_utc() -> datetime:
    """Return the current time as a timezone-aware UTC datetime."""
    return datetime.now(timezone.utc)


def now_utc_naive() -> datetime:
    """Return the current time as a timezone-naive UTC datetime."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def utc_from_timestamp(ts: float | int) -> datetime:
    """Return a timezone-aware UTC datetime from a POSIX timestamp."""
    return datetime.fromtimestamp(float(ts), tz=timezone.utc)
