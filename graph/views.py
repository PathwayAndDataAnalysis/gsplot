from django.shortcuts import render, HttpResponse
import os
import json
from django.http import JsonResponse, FileResponse
from django.conf import settings
from django.views.decorators.http import require_GET
from django.views.decorators.csrf import csrf_exempt
from .dataReduction import umap_reduction
from .gene_set_utils import get_selected_gene_sets_with_relevant_members
from django.shortcuts import render
from .dataReduction import run_fishers_test
from django.views.decorators.csrf import csrf_exempt

# Create your views here.
# When someone goes to the website root (/), it shows the homepage (base.html).
def home(request):
    return render(request, 'base.html')

# This is the most important function.
# It receives a POST request with:
    # the uploaded .tsv file (base64 encoded),
    # UMAP settings (neighbors, minDistance, seed).
# Calls umap_reduction() with that data.
# Sends back JSON data (the reduced coordinates + info) to the frontend.


@csrf_exempt
def gene_input_view(request):
    if request.method == 'POST':
        try:
            # Parse JSON body
            data = json.loads(request.body)

            # Get gene inputs
            sig_input = data.get('significant_genes', '')
            insig_input = data.get('insignificant_genes', '')
            selected_gene_sets = data.get("selected_genes_sets", [])
            min_members = int(data.get("minMembers", 5))
            p_thr = (data.get("p_thr"))
            fdr_thr = (data.get("fdr_thr"))

            # Split inputs into cleaned gene lists
            sig_genes = [gene.strip().upper() for gene in sig_input.replace(',', '\n').splitlines() if gene.strip()]
            insig_genes = [gene.strip().upper() for gene in insig_input.replace(',', '\n').splitlines() if gene.strip()]

            # Load MSigDB JSON
            file_path = os.path.join(os.path.dirname(__file__), 'static', 'gene_sets', 'msigdb.v2024.1.Hs.json')
            with open(file_path, 'r') as f:
                gene_sets_data = json.load(f)

            if p_thr:
                p_thr = float(p_thr)
            if fdr_thr:
                fdr_thr = float(fdr_thr)


            filtered = get_selected_gene_sets_with_relevant_members(
                gene_list= set(sig_genes + insig_genes),
                min_members_threshold=min_members,
                selected_gene_sets=selected_gene_sets,
                gene_sets_data=gene_sets_data,
            )

            # Run your analysis
            results = run_fishers_test(filtered,p_thr,fdr_thr,sig_genes, insig_genes)

            # Return result as JSON
            data = json.loads(results)
            return JsonResponse(data, safe=False)

        except Exception as e:
            return JsonResponse({'error': str(e)}, status=400)

    # Method not allowed
    return JsonResponse({'error': 'Method not allowed'}, status=405)

def read_output(request):
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            fileData = data.get('file')
            neighbors = data.get('neighbors')
            seed = data.get('seed')
            minDistance = data.get('minDistance')
            output = umap_reduction(fileData, neighbors, minDistance, seed)
            data = json.loads(output)
            return JsonResponse(data, safe=False)
        except Exception as e:
            error_response = {
                'error': str(e)
            }
            return JsonResponse(error_response, status=400)
    else:
        return JsonResponse({'error': 'Method not allowed'}, status=405)

# Sends the graph.html file to be shown as a webpage — most likely inside an <iframe> on the main page.    
def read_graph(request):
    file_path = os.path.join(settings.BASE_DIR, 'graph', 'templates', 'graph.html')
    return FileResponse(open(file_path, 'rb'), content_type='text/html')

# Just return the Help page
def help(request):
    return render(request, 'help.html')

# Show the About page
def about(request):
    return render(request, 'about.html')

@require_GET
def serve_msigdb(request):
    try:
        file_path = os.path.join(os.path.dirname(__file__), 'static', 'gene_sets', 'msigdb.v2024.1.Hs.json')
        if not os.path.exists(file_path):
            return JsonResponse({"error": "MSigDB file not found"}, status=404)
        with open(file_path, 'r') as f:
            msigdb_data = json.load(f)
        return JsonResponse(msigdb_data)
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)
    
@csrf_exempt
def filter_gene_sets_view(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Only POST allowed'}, status=405)
    
    try:
        data = json.loads(request.body)

        selected_gene_sets = data.get("selectedGeneSets", [])
        user_genes = data.get("userGenes", [])
        min_members = int(data.get("minMembers", 3))

        if not selected_gene_sets:# old code ->  (if not selected_gene_sets or not user_genes:)
            return JsonResponse({"error": "Missing input"}, status=400)

        # Load MSigDB JSON
        file_path = os.path.join(os.path.dirname(__file__), 'static', 'gene_sets', 'msigdb.v2024.1.Hs.json')
        with open(file_path, 'r') as f:
            gene_sets_data = json.load(f)

        filtered = get_selected_gene_sets_with_relevant_members(
            gene_list=set(user_genes),
            min_members_threshold=min_members,
            selected_gene_sets=selected_gene_sets,
            gene_sets_data=gene_sets_data
        )

        return JsonResponse(filtered, safe=False)

    except Exception as e:
        import traceback
        print("BACKEND ERROR:", e)
        traceback.print_exc()
        return JsonResponse({"error": str(e)}, status=500)