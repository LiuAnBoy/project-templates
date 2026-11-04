"""``make db-status``: list the migrations that are still pending, and never write."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from db.migrate import status_main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(status_main())
