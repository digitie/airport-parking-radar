from __future__ import annotations

from pathlib import Path

import pytest

from app.services.backup_restore import (
    BACKUP_NAME_PATTERN,
    _postgres_command_database,
    list_backups,
    save_uploaded_backup,
)


class FakeUpload:
    filename = "operator export.dump"

    def __init__(self, chunks: list[bytes]) -> None:
        self.chunks = iter(chunks)

    async def read(self, _size: int) -> bytes:
        return next(self.chunks, b"")


@pytest.mark.asyncio
async def test_uploaded_backup_is_safely_named_and_listed(tmp_path: Path) -> None:
    uploaded = await save_uploaded_backup(FakeUpload([b"dump", b"data"]), str(tmp_path))

    assert BACKUP_NAME_PATTERN.fullmatch(uploaded.filename)
    assert uploaded.size_bytes == 8
    items = await list_backups(str(tmp_path))
    assert [item.filename for item in items] == [uploaded.filename]


def test_pg_dump_url_does_not_expose_password_in_argv() -> None:
    safe_url, environment = _postgres_command_database("postgresql+asyncpg://operator:secret@postgres:5432/parking_radar")

    assert "secret" not in safe_url
    assert environment["PGPASSWORD"] == "secret"
