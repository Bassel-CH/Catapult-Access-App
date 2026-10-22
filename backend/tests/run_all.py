"""
Run every backend test and print one summary.

    cd backend && python -m tests.run_all

Runs each test_* function in each tests/test_*.py file. Tests that need the
real JulyPermissions.csv are skipped, not failed, when it isn't present.
Exits 1 if anything failed.
"""
import importlib
import pkgutil
import sys
import traceback
from pathlib import Path

import tests

REAL_CSV = Path(__file__).resolve().parents[2] / "JulyPermissions.csv"


def main() -> int:
    passed, failed, skipped = 0, [], []
    for module_info in sorted(pkgutil.iter_modules(tests.__path__), key=lambda m: m.name):
        if not module_info.name.startswith("test_"):
            continue
        module = importlib.import_module(f"tests.{module_info.name}")
        needs_real_csv = getattr(module, "CSV_PATH", None) == REAL_CSV
        for name in sorted(n for n in dir(module) if n.startswith("test_")):
            label = f"{module_info.name}.{name}"
            if needs_real_csv and not REAL_CSV.exists():
                skipped.append(label)
                print(f"  skip  {label}  (needs JulyPermissions.csv)")
                continue
            try:
                getattr(module, name)()
                passed += 1
                print(f"  ok    {label}")
            except Exception:
                failed.append(label)
                print(f"  FAIL  {label}")
                traceback.print_exc()

    print(f"\n{passed} passed, {len(failed)} failed, {len(skipped)} skipped")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
