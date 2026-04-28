"""Cypher schema (constraints and indexes) for the collaborator graph.

The graph uses three node labels and three relationship types:

- ``(:Collaborator {name})``
- ``(:Sector {name})``
- ``(:Affiliation {name, address, latitude, longitude, crs})``
- ``(:Collaborator)-[:AFFILIATED_WITH]->(:Affiliation)``
- ``(:Collaborator)-[:WORKS_IN]->(:Sector)``
- ``(:Sector)-[:PRESENT_AT]->(:Affiliation)``
"""

from __future__ import annotations

CONSTRAINT_STATEMENTS: tuple[str, ...] = (
    "CREATE CONSTRAINT collaborator_name IF NOT EXISTS "
    "FOR (n:Collaborator) REQUIRE n.name IS UNIQUE",
    "CREATE CONSTRAINT affiliation_name IF NOT EXISTS "
    "FOR (n:Affiliation) REQUIRE n.name IS UNIQUE",
    "CREATE CONSTRAINT sector_name IF NOT EXISTS "
    "FOR (n:Sector) REQUIRE n.name IS UNIQUE",
)

INDEX_STATEMENTS: tuple[str, ...] = (
    "CREATE INDEX affiliation_geo IF NOT EXISTS "
    "FOR (n:Affiliation) ON (n.latitude, n.longitude)",
)


def all_schema_statements() -> tuple[str, ...]:
    """Return the full set of schema-creation Cypher statements."""
    return CONSTRAINT_STATEMENTS + INDEX_STATEMENTS
