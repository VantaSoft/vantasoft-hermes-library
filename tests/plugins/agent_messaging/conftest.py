"""Test bootstrap for the Agent Messaging directory plugin."""

from __future__ import annotations

import sys
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[3] / "plugins" / "agent-messaging"
sys.path.insert(0, str(PLUGIN_ROOT))
