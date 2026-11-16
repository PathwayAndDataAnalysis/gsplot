"""Build the compact Wang graph from an official go-basic.obo snapshot.

Usage: python tools/build_go_resource.py path/to/go-basic.obo
"""
import gzip
import hashlib
import json
import sys
from pathlib import Path


def build(source, destination):
    raw = Path(source).read_bytes()
    text = raw.decode("utf-8")
    version = next(line.split(": ", 1)[1] for line in text.splitlines() if line.startswith("data-version: "))
    terms, aliases = {}, {}
    for block in text.split("\n[Term]\n")[1:]:
        block = block.split("\n[", 1)[0]
        fields = {}
        for line in block.splitlines():
            if ": " in line:
                key, value = line.split(": ", 1)
                fields.setdefault(key, []).append(value)
        if fields.get("is_obsolete") == ["true"]:
            continue
        term = fields["id"][0]
        parents = [[value.split()[0], 0.8] for value in fields.get("is_a", [])]
        parents += [[value.split()[1], 0.6] for value in fields.get("relationship", []) if value.startswith("part_of ")]
        terms[term] = [fields["namespace"][0], parents]
        aliases.update({alias: term for alias in fields.get("alt_id", [])})
    for term, (namespace, parents) in terms.items():
        if any(parent not in terms or terms[parent][0] != namespace for parent, _ in parents):
            raise ValueError(f"Invalid GO parent for {term}")
    release_date = version.rsplit("/", 1)[-1]
    data = {"version": version, "source": f"https://release.geneontology.org/{release_date}/ontology/go-basic.obo",
            "source_sha256": hashlib.sha256(raw).hexdigest(), "terms": terms, "aliases": aliases}
    Path(destination).write_bytes(gzip.compress(json.dumps(data, separators=(",", ":"), sort_keys=True).encode(), mtime=0))
    print(f"Built {len(terms)} terms, {len(aliases)} aliases; ontology {version}")


if __name__ == "__main__":
    build(sys.argv[1], Path(__file__).resolve().parents[1] / "graph/static/resources/go-wang.json.gz")
