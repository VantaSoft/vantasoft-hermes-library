"""Bounded retention for private peer-agent diagnostic logs."""

from __future__ import annotations

import os
import time
from contextlib import suppress
from pathlib import Path

MAX_FAILURE_LOG_BYTES = 1_048_576
MAX_FAILURE_LOGS = 10
MAX_FAILURE_LOG_AGE_SECONDS = 7 * 24 * 60 * 60
ACTIVE_MARKER_GRACE_SECONDS = 24 * 60 * 60


def active_marker_path(log_path: Path) -> Path:
    return log_path.with_suffix(log_path.suffix + ".active")


def mark_log_active(log_path: Path) -> None:
    marker = active_marker_path(log_path)
    marker.write_text(f"pid={os.getpid()}\n", encoding="utf-8")
    with suppress(OSError):
        marker.chmod(0o600)


def unmark_log_active(log_path: Path) -> None:
    active_marker_path(log_path).unlink(missing_ok=True)


def finalize_log(log_path: Path, exit_code: int) -> None:
    """Delete successful logs and cap one retained failure log."""

    if exit_code == 0:
        log_path.unlink(missing_ok=True)
        return
    try:
        size = log_path.stat().st_size
    except OSError:
        return
    if size <= MAX_FAILURE_LOG_BYTES:
        return
    with log_path.open("rb") as handle:
        handle.seek(-MAX_FAILURE_LOG_BYTES, os.SEEK_END)
        retained = handle.read()
    log_path.write_bytes(retained)
    with suppress(OSError):
        log_path.chmod(0o600)


def prune_failure_logs(runtime_dir: Path, *, now: float | None = None) -> None:
    """Keep at most ten non-active failure logs and remove logs older than seven days."""

    current_time = time.time() if now is None else now
    candidates: list[tuple[float, Path]] = []
    for log_path in runtime_dir.glob("*.log"):
        try:
            modified_at = log_path.stat().st_mtime
        except OSError:
            continue
        marker = active_marker_path(log_path)
        if marker.exists():
            try:
                marker_age = current_time - marker.stat().st_mtime
            except OSError:
                marker_age = 0
            if marker_age <= ACTIVE_MARKER_GRACE_SECONDS:
                continue
            marker.unlink(missing_ok=True)
        candidates.append((modified_at, log_path))

    candidates.sort(key=lambda item: item[0], reverse=True)
    retained = 0
    for modified_at, log_path in candidates:
        expired = current_time - modified_at > MAX_FAILURE_LOG_AGE_SECONDS
        if expired or retained >= MAX_FAILURE_LOGS:
            log_path.unlink(missing_ok=True)
        else:
            retained += 1

    for marker in runtime_dir.glob("*.log.active"):
        try:
            marker_age = current_time - marker.stat().st_mtime
        except OSError:
            continue
        if marker_age > ACTIVE_MARKER_GRACE_SECONDS:
            marker.unlink(missing_ok=True)
