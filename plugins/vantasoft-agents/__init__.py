"""Bundled directory-plugin entry point."""

if __package__:
    from .vantasoft_hermes_plugin import register
else:
    from vantasoft_hermes_plugin import register

__all__ = ["register"]
