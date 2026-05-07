"""DDL for the embedded Kuzu collaborator graph.

The graph uses three node tables and three relationship tables:

- ``Collaborator(name)``
- ``Sector(name)``
- ``Affiliation(name, address, latitude, longitude, crs)``
- ``(:Collaborator)-[:AFFILIATED_WITH]->(:Affiliation)``
- ``(:Collaborator)-[:WORKS_IN]->(:Sector)``
- ``(:Sector)-[:PRESENT_AT]->(:Affiliation)``
"""

from __future__ import annotations

NODE_TABLE_STATEMENTS: tuple[tuple[str, str], ...] = (
    (
        "Collaborator",
        "CREATE NODE TABLE Collaborator(name STRING, PRIMARY KEY(name))",
    ),
    (
        "Sector",
        "CREATE NODE TABLE Sector(name STRING, PRIMARY KEY(name))",
    ),
    (
        "Affiliation",
        (
            "CREATE NODE TABLE Affiliation("
            "name STRING, "
            "address STRING, "
            "latitude DOUBLE, "
            "longitude DOUBLE, "
            "crs STRING, "
            "PRIMARY KEY(name)"
            ")"
        ),
    ),
)

REL_TABLE_STATEMENTS: tuple[tuple[str, str], ...] = (
    (
        "AFFILIATED_WITH",
        "CREATE REL TABLE AFFILIATED_WITH(FROM Collaborator TO Affiliation)",
    ),
    (
        "WORKS_IN",
        "CREATE REL TABLE WORKS_IN(FROM Collaborator TO Sector)",
    ),
    (
        "PRESENT_AT",
        "CREATE REL TABLE PRESENT_AT(FROM Sector TO Affiliation)",
    ),
)


def all_schema_statements() -> tuple[tuple[str, str], ...]:
    """Return ``(table_name, ddl)`` pairs for every node and rel table."""
    return NODE_TABLE_STATEMENTS + REL_TABLE_STATEMENTS
