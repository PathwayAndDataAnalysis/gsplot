from __future__ import annotations
from collections import defaultdict, Counter
from typing import Any, Dict, Iterator, List
import json
import hashlib
import os
import re

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


def _strip_markdown_fences(text: str) -> str:
    text = (text or "").strip()
    if not text.startswith("```"):
        return text
    text = text.replace("```json", "```").replace("```JSON", "```")
    parts = text.split("```")
    if len(parts) >= 3:
        return parts[1].strip()
    return text.strip("`").strip()


def _remove_trailing_commas(text: str) -> str:
    # Common malformed JSON pattern from LLMs: trailing commas before } or ]
    return re.sub(r",\s*([}\]])", r"\1", text)


def _normalize_cluster_mapping(parsed: Any) -> Dict[str, Any]:
    # normalize list -> dict when model returns list-like structures
    if isinstance(parsed, list):
        # Case A) list of single-key dicts: [{"7": "..."}, {"2": "..."}]
        if all(isinstance(i, dict) and len(i) == 1 for i in parsed):
            merged = {}
            for i in parsed:
                (k, v), = i.items()
                merged[str(k)] = v
            return merged

        # Case B) list of pairs: [[k,v], [k,v]]
        if all(isinstance(i, (list, tuple)) and len(i) == 2 for i in parsed):
            return {str(k): v for k, v in parsed}

        # Case C) list of records: [{"clusterID":..,"short_name":..}, ...]
        if all(isinstance(i, dict) for i in parsed):
            tmp = {}
            for i in parsed:
                cid = i.get("clusterID", i.get("clusterId", i.get("id")))
                name = i.get("short_name", i.get("name", i.get("label")))
                if cid is None:
                    continue
                tmp[str(cid)] = name if name is not None else ""
            return tmp

        raise TypeError(f"Unexpected JSON list format: {str(parsed)[:200]}")

    if not isinstance(parsed, dict):
        raise TypeError(f"Expected JSON object mapping, got {type(parsed)}: {str(parsed)[:200]}")

    return parsed


def _parse_cluster_mapping_json(raw_text: str) -> Dict[str, Any]:
    text = _strip_markdown_fences(raw_text)
    attempts = [text]

    # If there is extra prose around JSON, try extracting object span.
    a = text.find("{")
    b = text.rfind("}")
    if a != -1 and b != -1 and b > a:
        attempts.append(text[a:b + 1])

    # Retry parse with trailing comma cleanup.
    attempts.extend([_remove_trailing_commas(t) for t in attempts])

    last_error = None
    for candidate in attempts:
        try:
            parsed = json.loads(candidate)
            return _normalize_cluster_mapping(parsed)
        except Exception as e:
            last_error = e
            continue

    if last_error is not None:
        raise last_error
    raise ValueError("Unable to parse cluster mapping JSON.")

from google import genai
from google.genai import types

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
            print("[LLM DEBUG] cached type:", type(cached))
            if isinstance(cached, str):
                print("[LLM DEBUG] cached head:", cached[:200])
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
        # --- Gemini (Google GenAI SDK) settings ---
        model = model or os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
        temperature = os.getenv("LLM_TEMPERATURE")
        max_out = int(os.getenv("LLM_MAX_TOKENS", "12000"))

        client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

        cfg_kwargs = dict(
            system_instruction=instructions,
            response_mime_type="application/json",  
            max_output_tokens=max_out,
        )
        if temperature is not None:
            try:
                cfg_kwargs["temperature"] = float(temperature)
            except Exception:
                pass

        response = client.models.generate_content(
            model=model,
            contents=user_input,
            config=types.GenerateContentConfig(**cfg_kwargs),
        )

        def _extract_text(resp) -> str:
            # 1) preferred
            t = (getattr(resp, "text", None) or "").strip()
            if t:
                return t

            # 2) fallback: dig into candidates/parts
            try:
                parts = resp.candidates[0].content.parts
                t2 = "".join(getattr(p, "text", "") for p in parts).strip()
                return t2
            except Exception:
                return ""

        text = _extract_text(response)
        print("[LLM DEBUG] gemini text head:", text[:200])
        print("[LLM DEBUG] gemini text startswith:", text.strip()[:1])
        if not text:
            raise ValueError("Gemini returned empty text (no JSON). Check prompt_feedback / finish_reason.")

        try:
            parsed = _parse_cluster_mapping_json(text)
            print("[LLM DEBUG] parsed type:", type(parsed))
        except Exception as parse_error:
            print("LLM JSON parse failed, attempting repair:", type(parse_error).__name__, str(parse_error))
            repair_prompt = (
                "Convert the following content into STRICT valid JSON only.\n"
                "Return a single JSON object mapping clusterID -> short_name.\n"
                "No markdown, no comments, no trailing commas.\n\n"
                f"Content:\n{text}"
            )
            repair_response = client.models.generate_content(
                model=model,
                contents=repair_prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    max_output_tokens=max_out,
                ),
            )
            repaired_text = _extract_text(repair_response)
            print("[LLM DEBUG] repaired text head:", repaired_text[:200])
            parsed = _parse_cluster_mapping_json(repaired_text)
            print("[LLM DEBUG] repaired parsed type:", type(parsed))

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
