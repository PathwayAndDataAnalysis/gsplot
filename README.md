# GSPlot

GSPlot is an interactive web application for analyzing and visualizing gene set enrichment results as a 2D map of related gene sets.

Live deployment: https://gsplot.cs.umb.edu

## Project Overview

Gene Set Enrichment Analysis (GSEA) can produce long result tables with many overlapping gene sets, which makes interpretation difficult. GSPlot helps address this problem by converting enrichment results into an interactive map where related gene sets are placed near each other.

GSPlot allows users to provide ranked, thresholded, or scored gene input, run enrichment analysis, measure gene-set similarity, reduce the results into a 2D embedding, and explore the output through an interactive graph. The goal of the project is to make large enrichment results easier to compare, filter, cluster, and interpret.

Main features include:

- Gene set enrichment analysis from user-provided gene input.
- Support for ranked, thresholded, and scored input modes.
- Built-in support for human and mouse MSigDB-derived gene set resources.
- Support for custom uploaded gene set collections.
- Pairwise gene-set distance calculation using similarity measures such as Jaccard distance and overlap coefficient.
- Dimensionality reduction using UMAP, t-SNE, or Isomap.
- Interactive visualization with point selection, filtering, clustering, and result export.
- Optional cluster label generation support.

## Repository Structure

Important project files and folders include:

- `manage.py`: Django project entry point.
- `gsplot/settings.py`: Django settings and environment configuration.
- `graph/views.py`: API endpoints and analysis workflow orchestration.
- `graph/dataReduction.py`: enrichment, distance calculation, and dimensionality-reduction logic.
- `graph/static/resources/`: local gene set resource files used by the application.
- `requirements.txt`: pinned Python dependencies.
- `.gitignore`: ignored local files, environment files, and sensitive files.

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/PathwayAndDataAnalysis/gsplot.git
cd gsplot
```

### 2. Create and activate a virtual environment

```bash
python3 -m venv .venv
source .venv/bin/activate
```

On Windows, use:

```bash
.venv\Scripts\activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure environment variables

GSPlot requires a Django secret key. Create a local `.env` file in the project root:

```bash
DJANGO_SECRET_KEY=replace-with-a-strong-secret
```

If optional cluster label generation is used, also configure the Gemini API key.

Example:

```bash
GEMINI_API_KEY=replace-with-your-api-key
```

Do not commit `.env` files, API keys, tokens, or secret keys to the repository.

### 5. Run database migrations

```bash
python manage.py migrate
```

### 6. Start the development server

```bash
python manage.py runserver
```

Open the local development site at:

```text
http://127.0.0.1:8000
```

## Required Dependencies

The required Python packages are listed in `requirements.txt`.

Main dependencies include:

- Django
- numpy
- pandas
- scipy
- scikit-learn
- statsmodels
- umap-learn
- hdbscan
- gseapy
- python-dotenv
- google-genai and google-api-core for optional cluster label generation support

For reproducible results, use the pinned package versions in `requirements.txt`.

## Basic Usage

1. Open the app.
2. Choose an input mode:
   - Ranked Genes
   - Thresholded Genes
   - Scored Genes
3. Select the directional hypothesis where supported:
   - Positive
   - Negative
   - Two-Sided
4. Choose a gene set resource:
   - Human MSigDB-derived resource
   - Mouse MSigDB-derived resource
   - Custom uploaded gene set resource
5. Select one or more gene set collections.
6. Set the minimum number of matched or relevant genes required for each gene set.
7. Submit the analysis.
8. Explore the interactive graph.
9. Select points, inspect gene sets, apply clustering options, and export the results.

## Supported Input Formats

### Ranked Genes

Ranked gene input accepts pasted text or uploaded `.txt` / `.tsv` files.

Each line should contain one gene symbol. If multiple columns are provided, the first column is used as the gene symbol.

Example:

```text
TP53
MYC
STAT1
CXCL10
BRCA1
```

### Thresholded Genes

Thresholded input uses two gene lists:

- Significant genes
- Background or insignificant genes

Genes may be separated by commas, spaces, tabs, or new lines.

Example significant gene list:

```text
TP53
MYC
STAT1
CXCL10
```

Example insignificant/background gene list:

```text
GAPDH
ACTB
RPLP0
HPRT1
```

### Scored Genes

Scored input accepts uploaded `.txt` or `.tsv` files with exactly two columns and no header:

```text
gene<TAB>score
```

Example:

```text
TP53    2.84
MYC     1.91
STAT1  -1.32
CXCL10 -2.20
BRCA1   0.75
```

### Custom Gene Set Resources

Users may upload custom gene set collections in supported formats such as:

- `.json`
- `.txt` containing JSON-like content
- `.gmt`

Custom resources are parsed by the application and used in the same enrichment, distance calculation, and visualization workflow as the built-in resources.

## Output File

The application can export an output file named:

```text
analysis_results.tsv
```

The exported result file includes fields such as:

- Gene set name
- p-value
- q-value or adjusted p-value
- Enrichment direction
- Gene set size
- Matched genes

## Main Workflow

GSPlot follows this general workflow:

1. Parse the user-provided gene input.
2. Load the selected gene set resource.
3. Filter gene sets based on the minimum matched-gene requirement.
4. Run enrichment analysis according to the selected input mode.
5. Adjust or report statistical significance values.
6. Keep gene sets that pass the selected threshold.
7. Compute pairwise gene-set similarity or distance.
8. Apply dimensionality reduction using UMAP, t-SNE, or Isomap.
9. Render the significant gene sets as an interactive 2D graph.
10. Support filtering, point selection, clustering, labeling, and export.

## Enrichment Methods

GSPlot supports multiple input modes because users may have different types of gene-level data.

### Ranked Mode

Ranked mode accepts an ordered gene list. The order of the genes is used to test whether members of a gene set are concentrated toward the selected side of the list.

Depending on the selected hypothesis, GSPlot can test for enrichment toward the positive side, negative side, or both sides of the ranked input.

### Thresholded Mode

Thresholded mode accepts significant and insignificant/background gene lists. GSPlot uses Fisher's exact test to evaluate whether each gene set contains more relevant genes than expected.

This mode is useful when the user already has a selected list of significant genes from an earlier analysis.

### Scored Mode

Scored mode accepts genes with numerical scores. GSPlot uses a preranked enrichment workflow through GSEApy to evaluate gene set enrichment based on the score ordering.

This mode is useful when each gene has a continuous value, such as a differential expression score, test statistic, or other ranking metric.

## Gene Set Similarity and Distance

After enrichment analysis, GSPlot compares significant gene sets based on their member overlap. Gene sets with more shared genes are treated as more similar and are placed closer together in the final visualization.

Supported or planned similarity/distance options may include:

- Jaccard distance
- Overlap coefficient
- Weighted variants where applicable

The resulting distance matrix is used as input for dimensionality reduction.

## Dimensionality Reduction

GSPlot supports several dimensionality-reduction methods for placing gene sets in a 2D plot:

- UMAP
- t-SNE
- Isomap

The final coordinates are used only for visualization. Similar or overlapping gene sets should appear near each other, but the exact layout can vary depending on the selected method, parameters, software versions, and random seed behavior.

## Data and Gene Set Resources

GSPlot supports predefined and user-uploaded gene set resources.

The current application uses MSigDB-derived human and mouse gene set resources for built-in analysis support. Example local resource filenames may include:

```text
msigdb.v2026.1.Hs.json
msigdb.v2026.1.Mm.json
```

These files are used by the application to provide built-in human and mouse gene set options.

### MSigDB Licensing and Redistribution Notes

MSigDB gene sets are provided by the Molecular Signatures Database (MSigDB), a joint project of UC San Diego and the Broad Institute.

According to the official MSigDB license information, MSigDB versions v6.0 to v7.5.1 and v2022.1 and later are available under Creative Commons Attribution 4.0-style terms, with additional terms for some gene sets. Some gene sets are derived from third-party sources and may have extra licensing or attribution requirements.

Because of these additional terms, users and developers should review the official MSigDB license terms before redistributing MSigDB-derived files, especially in a public repository or commercial setting.

For safest public distribution, this project may either:

- provide instructions for users to download MSigDB resources directly from the official MSigDB website, or
- include only resources that are confirmed to be redistributable under the intended license and use case.

Users should obtain MSigDB resources from the official MSigDB website and follow MSigDB's registration, license, and citation requirements.

Official MSigDB website:

```text
https://www.gsea-msigdb.org/gsea/msigdb
```

Official MSigDB license terms:

```text
https://www.gsea-msigdb.org/gsea/license_terms_list.jsp
```

## Citation

If you use GSPlot in research, please cite this repository and the related manuscript or preprint when available.

Suggested repository citation format before publication:

```text
Le, T., et al. GSPlot: An interactive visualization tool for gene set enrichment results. GitHub repository: https://github.com/PathwayAndDataAnalysis/gsplot
```

If you use a specific version of the code, please cite the repository URL together with the release tag or commit hash.

When using MSigDB gene sets, please also cite MSigDB according to the official MSigDB citation instructions. MSigDB citation guidance commonly references Subramanian, Tamayo, et al. (2005), along with other MSigDB papers as appropriate for the gene set collections used.

Recommended MSigDB citations may include:

```text
Subramanian, A., Tamayo, P., et al. (2005). Gene set enrichment analysis: A knowledge-based approach for interpreting genome-wide expression profiles. Proceedings of the National Academy of Sciences.

Liberzon, A., et al. (2011). Molecular signatures database (MSigDB) 3.0. Bioinformatics.

Liberzon, A., et al. (2015). The Molecular Signatures Database hallmark gene set collection. Cell Systems.
```

If using Mouse MSigDB, also follow the additional Mouse MSigDB citation instructions listed by MSigDB.

## Reproducibility Notes

To improve reproducibility:

- Use the pinned dependency versions in `requirements.txt`.
- Record the selected input mode.
- Record the selected directional hypothesis.
- Record the selected gene set resource and version.
- Record the selected gene set collections.
- Record the p-value or q-value threshold.
- Record the minimum matched-gene requirement.
- Record the selected similarity/distance metric.
- Record the selected dimensionality-reduction method and relevant parameters.
- Use the same code release, commit hash, or version tag when reproducing published results.

Dimensionality-reduction layouts may differ across software versions, random seeds, and computing environments, even when the enrichment results are the same.

## Security and Sensitive Files

Do not commit sensitive or private files to the repository.

Examples of files and information that should not be committed:

- `.env` files
- API keys
- access tokens
- Django secret keys
- private datasets
- restricted licensed datasets
- local database files
- user-uploaded private data

Use `.env.example` or documentation to show required environment variable names without exposing real values.

## Deployment Notes

The live deployment is available at:

```text
https://gsplot.cs.umb.edu
```

Deployment settings may differ from local development settings. Production deployments should use:

- a secure Django secret key
- `DEBUG=False`
- allowed host configuration
- a production web server setup
- protected environment variables
- appropriate timeout and upload-size settings for larger gene set analyses

## Contact and Issue Reporting

For questions, bugs, or feature requests, please open an issue in this GitHub repository.

Project team:

```text
Tien Le, developer
Ozgun Babur, mentor
```

Network Biology Lab:

```text
https://sites.google.com/view/umb-network-biology
```

## Related Links

Live app/demo:

```text
https://gsplot.cs.umb.edu
```

GitHub repository:

```text
https://github.com/PathwayAndDataAnalysis/gsplot
```

Network Biology Lab:

```text
https://sites.google.com/view/umb-network-biology
```

Paper, preprint, or documentation links can be added here when publicly available.

## License

This project includes a `LICENSE` file at the repository root.

The project source code license applies to the GSPlot code. Third-party resources, including MSigDB-derived gene set files and other external datasets, may be covered by their own licenses and citation requirements. Users are responsible for following the license terms of any external resources used with this project.
