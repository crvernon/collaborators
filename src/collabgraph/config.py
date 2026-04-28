"""Configuration loading for Neo4j connection settings.

Settings are loaded from environment variables, with values from a
project-local ``.env`` file taking effect when present.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


@dataclass(frozen=True)
class Settings:
    """Neo4j connection settings."""

    uri: str
    user: str
    password: str
    database: str = "neo4j"


def load_settings(env_file: str | Path | None = None) -> Settings:
    """Load Neo4j settings from environment variables.

    Parameters
    ----------
    env_file
        Optional path to a ``.env`` file. When ``None`` (default), the
        nearest ``.env`` discovered by ``python-dotenv`` is used.

    Returns
    -------
    Settings
        Frozen dataclass with ``uri``, ``user``, ``password``, ``database``.

    Raises
    ------
    RuntimeError
        If any required variable (``NEO4J_URI``, ``NEO4J_USER``,
        ``NEO4J_PASSWORD``) is missing.
    """
    if env_file is not None:
        load_dotenv(dotenv_path=str(env_file), override=False)
    else:
        load_dotenv(override=False)

    uri = os.getenv("NEO4J_URI")
    user = os.getenv("NEO4J_USER")
    password = os.getenv("NEO4J_PASSWORD")
    database = os.getenv("NEO4J_DATABASE", "neo4j")

    missing = [
        name
        for name, value in {
            "NEO4J_URI": uri,
            "NEO4J_USER": user,
            "NEO4J_PASSWORD": password,
        }.items()
        if not value
    ]
    if missing:
        raise RuntimeError(
            "Missing required environment variables: " + ", ".join(missing)
        )

    return Settings(uri=uri, user=user, password=password, database=database)
