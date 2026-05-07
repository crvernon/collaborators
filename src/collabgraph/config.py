"""Configuration loading for the embedded Kuzu storage.

Settings are loaded from environment variables, with values from a
project-local ``.env`` file taking effect when present.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

DEFAULT_DB_PATH = "data/collabgraph.kuzu"


@dataclass(frozen=True)
class Settings:
    """Runtime settings for collabgraph.

    Attributes
    ----------
    db_path
        Filesystem path to the embedded Kuzu database directory.
    """

    db_path: str

    @property
    def db_path_absolute(self) -> Path:
        """Return the absolute, resolved DB path (does not need to exist)."""
        return Path(self.db_path).expanduser().resolve()


def load_settings(env_file: str | Path | None = None) -> Settings:
    """Load settings from environment variables / ``.env``.

    Parameters
    ----------
    env_file
        Optional path to a ``.env`` file. When ``None`` (default), the
        nearest ``.env`` discovered by ``python-dotenv`` is used.

    Returns
    -------
    Settings
        Frozen dataclass with the embedded ``db_path``.
    """
    if env_file is not None:
        load_dotenv(dotenv_path=str(env_file), override=False)
    else:
        load_dotenv(override=False)

    db_path = os.getenv("COLLABGRAPH_DB_PATH", DEFAULT_DB_PATH)
    return Settings(db_path=db_path)
