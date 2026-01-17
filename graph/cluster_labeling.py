from __future__ import annotations
from collections import defaultdict, Counter
from typing import Any, Dict, Iterable, Iterator, List, Optional, Tuple
import json
import hashlib
import os
from openai import OpenAI

def _iter_points(payload: Any) -> Iterator[dict]:
    """
    Normalize payload to yield point dicts.

    Supports:
      - list[dict]
      - dict of arrays (X:[], Y:[], setName:[], clusterID:[], ...)
    """
    if payload is None:
        return
        yield  # for type checkers

    # Case 1: list of dicts
    if isinstance(payload, list):
        for p in payload:
            if isinstance(p, dict):
                yield p
        return

    # Case 2: dict of arrays
    if isinstance(payload, dict):
        # require at least X/Y
        X = payload.get("X")
        Y = payload.get("Y")
        if not isinstance(X, list) or not isinstance(Y, list):
            return

        n = min(len(X), len(Y))
        # build point dict at each index using all list-like keys
        keys = [k for k, v in payload.items() if isinstance(v, list) and len(v) >= n]
        for i in range(n):
            p = {k: payload[k][i] for k in keys}
            yield p
        return

def build_cluster_summaries(
    payload: Any,
    top_sets: int = 12,
    top_genes: int = 20,
    max_points_per_cluster_for_genes: int = 80,
) -> Dict[int, dict]:
    """
    Build compact summaries for each clusterID (excluding -1).
    Summary includes:
      - clusterID
      - size
      - top_gene_sets (by pValue if present)
      - top_genes (from molecules frequency)
    """
    clusters: Dict[int, List[dict]] = defaultdict(list)
    for p in _iter_points(payload):
        cid = p.get("clusterID", -1)
        if cid is None or cid == -1:
            continue
        clusters[int(cid)].append(p)

    summaries: Dict[int, dict] = {}
    for cid, pts in clusters.items():
        # sort by pValue if available
        def pval_key(x: dict) -> float:
            try:
                return float(x.get("pValue", 1e9))
            except Exception:
                return 1e9

        pts_sorted = sorted(pts, key=pval_key)

        # top gene sets
        top_gene_sets = []
        for p in pts_sorted[:top_sets * 3]:
            name = p.get("setName")
            if name and name not in top_gene_sets:
                top_gene_sets.append(name)
            if len(top_gene_sets) >= top_sets:
                break

        # top genes from molecules
        gene_counter = Counter()
        # sample to avoid super long molecules cost
        for p in pts_sorted[:max_points_per_cluster_for_genes]:
            mol = p.get("molecules")
            if not mol:
                continue
            # molecules is a space-separated string in your project
            genes = [g for g in str(mol).split() if g]
            gene_counter.update(genes)

        top_genes_list = [g for g, _ in gene_counter.most_common(top_genes)]

        summaries[cid] = {
            "clusterID": cid,
            "size": len(pts),
            "top_gene_sets": top_gene_sets,
            "top_genes": top_genes_list,
        }

    return summaries

def _stable_hash(obj: Any) -> str:
    s = json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.md5(s.encode("utf-8")).hexdigest()

from azure.ai.inference import ChatCompletionsClient
from azure.ai.inference.models import SystemMessage, UserMessage
from azure.core.credentials import AzureKeyCredential

def label_clusters_with_llm(
    summaries: Dict[int, dict],
    cache_obj: Any = None,
    model: str | None = None,
    max_name_words: int = 5,
) -> Dict[int, str]:
    if not summaries:
        return {}

    cache_key = f"cluster_names:{_stable_hash(summaries)}:{model}:{max_name_words}"
    if cache_obj is not None:
        cached = cache_obj.get(cache_key)
        if cached:
            if isinstance(cached, str):
                try:
                    return {int(k): v for k, v in json.loads(cached).items()}
                except Exception:
                    pass
            if isinstance(cached, dict):
                return {int(k): v for k, v in cached.items()}

    items = []
    for cid, s in summaries.items():
        items.append({
            "clusterID": int(cid),
            "size": int(s.get("size", 0)),
            "top_gene_sets": (s.get("top_gene_sets") or [])[:8],
            "top_genes": (s.get("top_genes") or [])[:12],
        })

    instructions = (
        "You are naming biological gene-set clusters.\n"
        "Return ONLY valid JSON mapping clusterID (int or string) -> short_name (string).\n"
        f"Rules:\n"
        f"- short_name max {max_name_words} words\n"
        f"- do not include the word 'Cluster'\n"
        f"- if uncertain, use a neutral pathway-style name (e.g., 'Immune signaling').\n"
    )

    user_input = (
        "Name each cluster using top_gene_sets and top_genes.\n"
        "Input clusters JSON:\n"
        + json.dumps(items, ensure_ascii=False)
    )

    def _clip(name: str) -> str:
        words = name.strip().split()
        return " ".join(words[:max_name_words]).strip()

    try:
        # --- GitHub Models settings ---
        endpoint = os.getenv("GITHUB_MODELS_ENDPOINT", "https://models.github.ai/inference")
        token = os.getenv("GITHUB_TOKEN")
        if not token:
            raise RuntimeError("Missing GITHUB_TOKEN in environment (.env)")

        model = model or os.getenv("GITHUB_MODELS_MODEL", "openai/gpt-4o-mini")

        # Optional knobs (some models may reject temperature; see fallback below)
        temperature = os.getenv("LLM_TEMPERATURE")
        max_out = int(os.getenv("LLM_MAX_TOKENS", "200"))

        client = ChatCompletionsClient(
            endpoint=endpoint,
            credential=AzureKeyCredential(token),
        )

        kwargs = dict(
            messages=[
                SystemMessage(instructions),
                UserMessage(user_input),
            ],
            model=model,
            max_tokens=max_out,
            response_format="json_object",  # JSON mode :contentReference[oaicite:3]{index=3}
        )
        if temperature is not None:
            try:
                kwargs["temperature"] = float(temperature)
            except Exception:
                pass

        # Try once with temperature (if set); if model complains, retry without it
        try:
            response = client.complete(**kwargs)
        except Exception:
            kwargs.pop("temperature", None)
            response = client.complete(**kwargs)

        text = (response.choices[0].message.content or "").strip()

        # Parse JSON robustly
        try:
            parsed = json.loads(text)
        except Exception:
            a = text.find("{")
            b = text.rfind("}")
            parsed = json.loads(text[a:b+1]) if (a != -1 and b != -1 and b > a) else {}

        name_by_id: Dict[int, str] = {}
        for k, v in parsed.items():
            try:
                cid = int(k)
            except Exception:
                continue
            if isinstance(v, str) and v.strip():
                name_by_id[cid] = _clip(v)
            else:
                name_by_id[cid] = "Unknown pathway"

    except Exception as e:
        print("LLM labeling FAILED:", type(e).__name__, str(e))
        name_by_id = {int(cid): f"Pathway {int(cid)}" for cid in summaries.keys()}

    if cache_obj is not None:
        try:
            cache_obj.set(
                cache_key,
                json.dumps({str(k): v for k, v in name_by_id.items()}),
                timeout=60 * 60 * 24 * 7
            )
        except Exception:
            pass

    return name_by_id
