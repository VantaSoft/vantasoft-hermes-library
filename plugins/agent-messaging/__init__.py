"""Bundled directory-plugin entry point."""

if __package__:
    from .hermes_agent_messaging import register
else:
    from hermes_agent_messaging import register

__all__ = ["register"]
