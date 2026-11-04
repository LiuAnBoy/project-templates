"""The declarative base every model extends."""

from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase

#: Named constraints, so a migration can drop or alter one by name (SQLite's batch
#: mode needs it) and the generated names are the same on every store.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """Declarative base of the project's models.

    Define each model in its own module under ``db/models/`` and import it from
    ``db/models/__init__.py``. Write every column name explicitly in snake_case.
    """

    metadata = MetaData(naming_convention=NAMING_CONVENTION)
