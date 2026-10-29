import json
from unittest.mock import patch

import numpy as np
from django.core.cache import cache
from django.test import RequestFactory, SimpleTestCase

from .dataReduction import calculate_distance_matrix
from .go_semantic import GO_METRIC, WangOntology, _go_collection, get_go_ontology, get_go_terms_by_set, RESOURCE_DIR


class WangSimilarityTests(SimpleTestCase):
    def setUp(self):
        self.ontology = WangOntology({
            "version": "test", "aliases": {"alternate": "a"},
            "terms": {
                "root": ["BP", []],
                "a": ["BP", [["root", 0.8]]],
                "b": ["BP", [["root", 0.8]]],
                "child": ["BP", [["a", 0.6], ["root", 0.8]]],
                "mf": ["MF", []],
            },
        })

    def test_hand_calculated_scores_and_aliases(self):
        self.assertEqual(self.ontology.similarity("a", "alternate"), 1)
        self.assertAlmostEqual(self.ontology.similarity("a", "b"), 4 / 9)
        self.assertAlmostEqual(self.ontology.similarity("a", "root"), 1.8 / 2.8)
        self.assertEqual(self.ontology.similarity("a", "mf"), 0)
        self.assertEqual(self.ontology.similarity("a", "b"), self.ontology.similarity("b", "a"))
        # A direct path wins over the weaker indirect path (0.6 * 0.8).
        self.assertEqual(self.ontology.contributions("child")["root"], 0.8)
        self.assertEqual(self.ontology.contributions("child")["a"], 0.6)
        with self.assertRaisesMessage(ValueError, "unavailable"):
            self.ontology.similarity("missing", "a")

    def test_semantic_distance_works_without_shared_genes(self):
        sets = {"first": ("GENE1", .01, .02), "second": ("GENE2", .01, .02), "third": ("GENE3", .01, .02)}
        with patch("graph.dataReduction.get_go_ontology", return_value=self.ontology):
            matrix = calculate_distance_matrix(sets, GO_METRIC, None, go_terms_by_set={"first": "a", "second": "b", "third": "mf"})
        self.assertAlmostEqual(matrix[0, 1], 1.25)
        self.assertEqual(matrix[0, 2], 100)
        np.testing.assert_array_equal(matrix, matrix.T)
        np.testing.assert_array_equal(matrix.diagonal(), 0)
        self.assertEqual(calculate_distance_matrix(sets, "jaccard_plain", None)[0, 1], 100)

    def test_all_bundled_go_ids_resolve_and_selection_is_validated(self):
        ontology = get_go_ontology()
        self.assertEqual(ontology.version, "releases/2025-10-10")
        for species in ("human", "mouse"):
            selection = [{"name": name, "collection": record[0]} for name, record in _go_collection(species).items()]
            mapping = get_go_terms_by_set(species, selection)
            for go_id in mapping.values():
                self.assertIn(ontology.resolve(go_id), ontology.terms)
            with self.assertRaisesMessage(ValueError, "all selected"):
                get_go_terms_by_set(species, selection[:1] + [{"name": "HALLMARK_TEST", "collection": "H"}])
        with self.assertRaises(ValueError):
            get_go_terms_by_set("custom", [{"name": "a", "collection": "C5:GO:BP"}])


class SemanticAnalysisTests(SimpleTestCase):
    def test_metric_reaches_all_analysis_modes_and_cache_is_separate(self):
        from . import views

        with (RESOURCE_DIR / "msigdb.v2026.1.Hs.json").open() as stream:
            data = json.load(stream)
        selection = [{"name": name, "collection": info["collection"]} for name, info in data.items() if info["collection"] == "C5:GO:BP"][:4]
        genes = sorted({gene for entry in selection for gene in data[entry["name"]]["geneSymbols"]})

        def enrichment(filtered, *args, **kwargs):
            return {entry["gene_set_name"]: (" ".join(entry["matched_genes"]), .01, .02) for entry in filtered}

        def embedding(stats, settings, weights, metric, matrix, **kwargs):
            points = [{"setName": name, "X": i, "Y": i, "pValue": values[1], "qValue": values[2], "molecules": values[0]} for i, (name, values) in enumerate(stats.items())]
            return json.dumps(points), matrix

        for view, path, inputs in [
            (views.gene_input_view, "/gene-input/", {"significant_genes": "\n".join(genes), "insignificant_genes": ""}),
            (views.gene_input_view2, "/gene-input2/", {"ranked_genes": "\n".join(genes)}),
            (views.scored_genes_view, "/scored-genes/", {"scored_genes_raw": "\n".join(f"{gene}\t{i + 1}" for i, gene in enumerate(genes))}),
        ]:
            with self.subTest(path=path):
                cache.clear()
                payload = {**inputs, "selected_genes_sets": selection, "species": "human", "minMembers": 1, "p_thr": 1, "settings": {"cluster-mode": False}, "distance_type": GO_METRIC}
                with patch.object(views, "run_fishers_test", side_effect=enrichment), patch.object(views, "calculate_pvals", side_effect=enrichment), patch.object(views, "run_gseapy", side_effect=enrichment), patch.object(views, "umap_reduction", side_effect=embedding) as reducer, patch.object(views, "calculate_distance_matrix", wraps=calculate_distance_matrix) as distance:
                    for _ in range(2):  # Cold and cached analysis paths.
                        response = view(RequestFactory().post(path, data=json.dumps(payload), content_type="application/json"))
                        self.assertEqual(response.status_code, 200, response.content)
                        self.assertEqual(reducer.call_args.args[3], GO_METRIC)
                        self.assertTrue(reducer.call_args.kwargs["go_terms_by_set"])
                    self.assertEqual(distance.call_count, 1)
                    payload["distance_type"] = "jaccard_plain"
                    response = view(RequestFactory().post(path, data=json.dumps(payload), content_type="application/json"))
                    self.assertEqual(response.status_code, 200, response.content)
                    self.assertEqual(distance.call_count, 2)
        cache.clear()
