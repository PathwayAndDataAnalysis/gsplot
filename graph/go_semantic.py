"""GO term similarity using Wang et al. (2007), is_a=0.8, part_of=0.6.

Only these two relationship types contribute. Gene membership and input weights
do not affect the score. The bundled graph is an offline, versioned GO snapshot.
"""

import gzip
import json
from functools import lru_cache
from pathlib import Path

RESOURCE_DIR = Path(__file__).resolve().parent / "static" / "resources"
GO_METRIC = "go_semantic_wang"


class WangOntology:
    def __init__(self, data):
        self.terms = data["terms"]
        self.aliases = data.get("aliases", {})
        self.version = data["version"]
        self._contributions = {}

    def resolve(self, term):
        term = self.aliases.get(term, term)
        if term not in self.terms:
            raise ValueError(f"GO term {term} is unavailable in ontology {self.version}.")
        return term

    def contributions(self, term):
        term = self.resolve(term)
        if term not in self._contributions:
            values = {term: 1.0}
            pending = [term]
            while pending:
                child = pending.pop()
                for parent, weight in self.terms[child][1]:
                    contribution = values[child] * weight
                    if contribution > values.get(parent, 0.0):
                        values[parent] = contribution
                        pending.append(parent)
            self._contributions[term] = values
        return self._contributions[term]

    def similarity(self, first, second):
        first, second = self.resolve(first), self.resolve(second)
        if self.terms[first][0] != self.terms[second][0]:
            # BP, MF, CC are separate ontologies: use maximal distance.
            return 0.0
        a, b = self.contributions(first), self.contributions(second)
        return sum(a[t] + b[t] for t in a.keys() & b.keys()) / (sum(a.values()) + sum(b.values()))


@lru_cache(maxsize=1)
def get_go_ontology():
    with gzip.open(RESOURCE_DIR / "go-wang.json.gz", "rt", encoding="utf-8") as stream:
        return WangOntology(json.load(stream))


@lru_cache(maxsize=2)
def _go_collection(species):
    suffix = {"human": "Hs", "mouse": "Mm"}[species]
    with (RESOURCE_DIR / f"msigdb.v2026.1.{suffix}.json").open(encoding="utf-8") as stream:
        return {
            name: (info["collection"], info.get("exactSource"))
            for name, info in json.load(stream).items()
            if info.get("collection", "").startswith(("C5:GO:", "M5:GO:"))
        }


def get_go_terms_by_set(species, selected_gene_sets):
    """Validate the entire selection against trusted MSigDB metadata."""
    species = str(species).lower()
    if species not in {"human", "mouse"} or not selected_gene_sets:
        raise ValueError("GO semantic similarity requires a human or mouse GO-only collection selection.")
    collection = _go_collection(species)
    result = {}
    for entry in selected_gene_sets:
        name = entry.get("name")
        record = collection.get(name)
        if not record or record[0] != entry.get("collection"):
            raise ValueError("GO semantic similarity is available only when all selected gene sets belong to GO.")
        result[name] = record[1]
    return result
