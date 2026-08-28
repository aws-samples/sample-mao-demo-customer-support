"""Pytest config: put the runtime package dir on sys.path for direct imports."""

import os
import sys

RUNTIME_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if RUNTIME_DIR not in sys.path:
    sys.path.insert(0, RUNTIME_DIR)
