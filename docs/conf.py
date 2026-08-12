# Configuration file for the Sphinx documentation builder.

import os
import sys

sys.path.insert(0, os.path.abspath(".."))

project = "DataLad Desktop"
copyright = "2025-2026, MRI-Lab-Graz"
author = "MRI-Lab-Graz"
release = "0.3.0"

# -- General configuration ---------------------------------------------------
extensions = [
    "myst_parser",
]

templates_path = ["_templates"]
exclude_patterns = [
    "_build",
    "Thumbs.db",
    ".DS_Store",
    # Internal planning docs (superpowers skill working files), not user docs.
    "superpowers/**",
    # German presentation slide deck, not part of the English doc site.
    "presentation-slides-de.md",
]

# -- Options for HTML output -------------------------------------------------
html_theme = "shibuya"
html_static_path = ["_static"]
html_title = "DataLad Desktop Documentation"

html_theme_options = {
    "accent_color": "blue",
    "github_url": "https://github.com/MRI-Lab-Graz/DataLad-desktop",
}

# -- MyST Parser configuration -----------------------------------------------
myst_enable_extensions = [
    "colon_fence",
    "deflist",
]
myst_heading_anchors = 3
