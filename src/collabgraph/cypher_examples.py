"""Named Cypher snippets for Neo4j Browser and Bloom.

Each snippet is a runnable Cypher query (parameter placeholders use ``$param``
syntax). The Bloom hint at the bottom describes a perspective configuration
that pairs nicely with the schema.
"""

from __future__ import annotations

CYPHER_EXAMPLES: dict[str, str] = {
    "everything": (
        "MATCH (n)\n"
        "OPTIONAL MATCH (n)-[r]->(m)\n"
        "RETURN n, r, m"
    ),
    "collaborators_by_sector": (
        "MATCH (s:Sector {name: $sector})<-[:WORKS_IN]-(c:Collaborator)\n"
        "RETURN c.name AS collaborator\n"
        "ORDER BY collaborator"
    ),
    "collaborators_at_affiliation": (
        "MATCH (a:Affiliation {name: $affiliation})<-[:AFFILIATED_WITH]-"
        "(c:Collaborator)\n"
        "RETURN c.name AS collaborator\n"
        "ORDER BY collaborator"
    ),
    "sectors_at_affiliation": (
        "MATCH (a:Affiliation {name: $affiliation})<-[:PRESENT_AT]-(s:Sector)\n"
        "RETURN s.name AS sector\n"
        "ORDER BY sector"
    ),
    "affiliations_in_sector": (
        "MATCH (s:Sector {name: $sector})-[:PRESENT_AT]->(a:Affiliation)\n"
        "RETURN a.name AS affiliation, a.address AS address,\n"
        "       a.latitude AS latitude, a.longitude AS longitude\n"
        "ORDER BY affiliation"
    ),
    "affiliation_geo": (
        "MATCH (a:Affiliation)\n"
        "RETURN a.name      AS affiliation,\n"
        "       a.address   AS address,\n"
        "       a.latitude  AS latitude,\n"
        "       a.longitude AS longitude,\n"
        "       a.crs       AS crs\n"
        "ORDER BY affiliation"
    ),
    "shortest_path_between_collaborators": (
        "MATCH (a:Collaborator {name: $a}), (b:Collaborator {name: $b}),\n"
        "      p = shortestPath((a)-[*..6]-(b))\n"
        "RETURN p"
    ),
    "co_affiliated_collaborators": (
        "MATCH (c1:Collaborator)-[:AFFILIATED_WITH]->(a:Affiliation)<-"
        "[:AFFILIATED_WITH]-(c2:Collaborator)\n"
        "WHERE c1.name < c2.name\n"
        "RETURN a.name AS affiliation, c1.name AS collaborator_a,\n"
        "       c2.name AS collaborator_b\n"
        "ORDER BY affiliation, collaborator_a"
    ),
    "counts": (
        "MATCH (c:Collaborator) WITH count(c) AS collaborators\n"
        "MATCH (s:Sector)       WITH collaborators, count(s) AS sectors\n"
        "MATCH (a:Affiliation)  RETURN collaborators, sectors,\n"
        "                              count(a) AS affiliations"
    ),
}

BLOOM_PERSPECTIVE_HINT: str = """\
Suggested Bloom perspective:

Categories:
  - Collaborator  (caption: name, color: #4C9AFF)
  - Sector        (caption: name, color: #FF8B00)
  - Affiliation   (caption: name, color: #36B37E,
                   tooltip: address, latitude, longitude)

Relationships:
  - AFFILIATED_WITH : Collaborator -> Affiliation
  - WORKS_IN        : Collaborator -> Sector
  - PRESENT_AT      : Sector       -> Affiliation

Useful search phrases:
  - "Collaborator AFFILIATED_WITH Affiliation"
  - "Sector PRESENT_AT Affiliation"
  - "Collaborator WORKS_IN Sector PRESENT_AT Affiliation"
"""


def list_examples() -> list[str]:
    """Return the sorted list of available Cypher snippet names."""
    return sorted(CYPHER_EXAMPLES)


def get_example(name: str) -> str:
    """Return the Cypher snippet registered under ``name``.

    Raises
    ------
    KeyError
        If ``name`` is not a known snippet.
    """
    if name not in CYPHER_EXAMPLES:
        raise KeyError(
            f"Unknown Cypher example '{name}'. "
            f"Available: {list_examples()}"
        )
    return CYPHER_EXAMPLES[name]
