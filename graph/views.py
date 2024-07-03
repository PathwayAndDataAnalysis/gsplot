from django.shortcuts import render, HttpResponse
import os
import json
from django.http import JsonResponse, FileResponse
from django.conf import settings
from .dataReduction import umap_reduction

# Create your views here.
def home(request):
    return render(request, "base.html")

def read_output(request):
    if request.method == "POST":
        try:
            data = json.loads(request.body)
            fileData = data.get("file")
            neighbors = data.get("neighbors")
            seed = data.get("seed")
            minDistance = data.get("minDistance")        
            data = json.loads(umap_reduction(fileData, neighbors, minDistance, seed))
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
    return render(request, "help.html")
