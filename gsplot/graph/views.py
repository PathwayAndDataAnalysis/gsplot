from django.shortcuts import render, HttpResponse
import os
import json
from django.http import JsonResponse, FileResponse
from django.conf import settings
from .dataReduction import umap_reduction
from django.shortcuts import render
from .dataReduction import run_fishers_test
from django.views.decorators.csrf import csrf_exempt


# Create your views here.
def home(request):
    return render(request, 'base.html')

@csrf_exempt
def gene_input_view(request):
    if request.method == 'POST':
        try:
            # Parse JSON body
            data = json.loads(request.body)

            # Get gene inputs
            sig_input = data.get('significant_genes', '')
            insig_input = data.get('insignificant_genes', '')

            # Split inputs into cleaned gene lists
            sig_genes = [gene.strip().upper() for gene in sig_input.replace(',', '\n').splitlines() if gene.strip()]
            insig_genes = [gene.strip().upper() for gene in insig_input.replace(',', '\n').splitlines() if gene.strip()]

            # Remove duplicates and overlaps
            sig_genes = list(set(sig_genes))
            insig_genes = list(set(insig_genes))
            overlap = set(sig_genes) & set(insig_genes)
            sig_genes = [g for g in sig_genes if g not in overlap]
            insig_genes = [g for g in insig_genes if g not in overlap]

            print("Manual gene input received.")

            # Run your analysis
            results = run_fishers_test(sig_genes, insig_genes)

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

def read_graph(request):
    file_path = os.path.join(settings.BASE_DIR, 'graph', 'templates', 'graph.html')
    return FileResponse(open(file_path, 'rb'), content_type='text/html')

def help(request):
    return render(request, 'help.html')

def about(request):
    return render(request, 'about.html')
