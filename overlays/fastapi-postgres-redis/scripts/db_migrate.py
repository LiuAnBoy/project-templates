"""``make db-migrate``: apply every migration the database has not recorded.

The only way a shared database changes. Run it once per deploy, before the new
code starts. It prints names and counts, never a connection value.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from db.migrate import migrate_main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(migrate_main())
