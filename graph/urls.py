from django.urls import path
from . import views

urlpatterns = [
    path('', views.home, name='home'),
    path('read-output/', views.read_output, name='read_output'),
    path('read-graph/', views.read_graph, name='read_graph'),
    path('help/', views.help, name='help'),
    path('about/', views.about, name='about'),
    path('api/msigdb/', views.serve_msigdb, name='serve_msigdb'),
    path('gene-input/', views.gene_input_view, name='gene_input'),
    path('gene-input2/', views.gene_input_view2, name='gene_input2'),
    path('api/upload_custom_gene_sets/', views.upload_custom_gene_sets, name='upload_custom_gene_sets'),
    path('preview-threshold/', views.preview_threshold, name='preview_threshold'),
]