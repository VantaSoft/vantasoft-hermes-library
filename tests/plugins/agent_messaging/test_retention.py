from __future__ import annotations

import os

from hermes_agent_messaging import retention


def _write_log(path, *, modified_at):
    path.write_text("private diagnostic")
    os.utime(path, (modified_at, modified_at))


def test_finalize_log_deletes_success_and_caps_failure(tmp_path):
    success_log = tmp_path / "success.log"
    success_log.write_text("private output")
    retention.finalize_log(success_log, 0)
    assert not success_log.exists()

    failure_log = tmp_path / "failure.log"
    failure_log.write_bytes(b"x" * (retention.MAX_FAILURE_LOG_BYTES + 4096))
    retention.finalize_log(failure_log, 1)
    assert failure_log.stat().st_size == retention.MAX_FAILURE_LOG_BYTES


def test_prune_failure_logs_enforces_max_count(tmp_path):
    now = 2_000_000.0
    logs = []
    for index in range(retention.MAX_FAILURE_LOGS + 2):
        log_path = tmp_path / f"{index:02d}.log"
        _write_log(log_path, modified_at=now - index)
        logs.append(log_path)

    retention.prune_failure_logs(tmp_path, now=now)

    assert all(path.exists() for path in logs[: retention.MAX_FAILURE_LOGS])
    assert all(not path.exists() for path in logs[retention.MAX_FAILURE_LOGS :])


def test_prune_failure_logs_enforces_max_age(tmp_path):
    now = 2_000_000.0
    fresh = tmp_path / "fresh.log"
    expired = tmp_path / "expired.log"
    _write_log(fresh, modified_at=now - 60)
    _write_log(
        expired,
        modified_at=now - retention.MAX_FAILURE_LOG_AGE_SECONDS - 1,
    )

    retention.prune_failure_logs(tmp_path, now=now)

    assert fresh.exists()
    assert not expired.exists()


def test_prune_failure_logs_preserves_recent_active_log(tmp_path):
    now = 2_000_000.0
    active = tmp_path / "active.log"
    _write_log(
        active,
        modified_at=now - retention.MAX_FAILURE_LOG_AGE_SECONDS - 1,
    )
    marker = retention.active_marker_path(active)
    marker.write_text("pid=123\n")
    os.utime(marker, (now, now))

    retention.prune_failure_logs(tmp_path, now=now)

    assert active.exists()
    assert marker.exists()
