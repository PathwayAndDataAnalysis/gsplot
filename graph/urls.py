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
]