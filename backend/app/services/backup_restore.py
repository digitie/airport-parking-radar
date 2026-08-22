from __future__ import annotations

import asyncio
import os
import re
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.engine import make_url

BACKUP_NAME_PATTERN = re.compile(r"^parking-radar-[0-9T]{15}Z(?:-[A-Za-z0-9_-]+)?\.dump$")
MAX_BACKUP_BYTES = 2 * 1024 * 1024 * 1024


@dataclass(frozen=True)
class BackupFileInfo:
    filename: str
    size_bytes: int
    created_at: datetime


def _backup_path(backup_dir: str, filename: str) -> Path:
    if not BACKUP_NAME_PATTERN.fullmatch(filename):
        raise ValueError("허용되지 않는 백업 파일명입니다.")
    directory = Path(backup_dir).resolve()
    path = (directory / filename).resolve()
    if path.parent != directory:
        raise ValueError("백업 경로가 올바르지 않습니다.")
    return path


def _database_url_without_async_driver(database_url: str) -> str:
    return database_url.replace("+asyncpg", "", 1)


def _run_command(command: list[str], timeout_seconds: int, env: dict[str, str] | None = None) -> None:
    try:
        completed = subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            env=env,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("PostgreSQL 백업 도구(pg_dump/pg_restore)를 찾지 못했습니다.") from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or "알 수 없는 PostgreSQL 오류").strip()
        raise RuntimeError(f"PostgreSQL 백업 작업에 실패했습니다: {detail[-500:]}") from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("PostgreSQL 백업 작업이 제한 시간 안에 끝나지 않았습니다.") from exc
    if completed.returncode != 0:
        raise RuntimeError("PostgreSQL 백업 작업에 실패했습니다.")


def _list_backups_sync(backup_dir: str) -> list[BackupFileInfo]:
    directory = Path(backup_dir)
    directory.mkdir(parents=True, exist_ok=True)
    items: list[BackupFileInfo] = []
    for path in directory.iterdir():
        if not path.is_file() or not BACKUP_NAME_PATTERN.fullmatch(path.name):
            continue
        stat = path.stat()
        items.append(
            BackupFileInfo(
                filename=path.name,
                size_bytes=stat.st_size,
                created_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc),
            )
        )
    return sorted(items, key=lambda item: item.created_at, reverse=True)


async def list_backups(backup_dir: str) -> list[BackupFileInfo]:
    return await asyncio.to_thread(_list_backups_sync, backup_dir)


def _postgres_command_database(database_url: str) -> tuple[str, dict[str, str]]:
    parsed = make_url(_database_url_without_async_driver(database_url))
    password = parsed.password
    safe_url = parsed.set(password=None).render_as_string(hide_password=True)
    environment = os.environ.copy()
    if password:
        environment["PGPASSWORD"] = password
    return safe_url, environment


def _prune_backups_sync(backup_dir: str, retention_count: int) -> None:
    for item in _list_backups_sync(backup_dir)[max(0, retention_count) :]:
        _backup_path(backup_dir, item.filename).unlink(missing_ok=True)


async def create_backup(
    backup_dir: str,
    database_url: str,
    retention_count: int,
    timeout_seconds: int,
) -> BackupFileInfo:
    def run() -> BackupFileInfo:
        directory = Path(backup_dir)
        directory.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        filename = f"parking-radar-{timestamp}.dump"
        path = _backup_path(backup_dir, filename)
        safe_database_url, environment = _postgres_command_database(database_url)
        _run_command(
            [
                "pg_dump",
                "--format=custom",
                "--no-owner",
                "--no-acl",
                "--file",
                str(path),
                safe_database_url,
            ],
            timeout_seconds,
            environment,
        )
        _prune_backups_sync(backup_dir, retention_count)
        stat = path.stat()
        return BackupFileInfo(filename=filename, size_bytes=stat.st_size, created_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc))

    return await asyncio.to_thread(run)


async def restore_backup(
    backup_dir: str,
    database_url: str,
    filename: str,
    timeout_seconds: int,
) -> BackupFileInfo:
    path = _backup_path(backup_dir, filename)

    def run() -> BackupFileInfo:
        if not path.is_file():
            raise FileNotFoundError(filename)
        if path.stat().st_size > MAX_BACKUP_BYTES:
            raise ValueError("백업 파일 크기가 허용 한도를 초과했습니다.")
        safe_database_url, environment = _postgres_command_database(database_url)
        _run_command(
            [
                "pg_restore",
                "--clean",
                "--if-exists",
                "--no-owner",
                "--no-acl",
                "--exit-on-error",
                "--dbname",
                safe_database_url,
                str(path),
            ],
            timeout_seconds,
            environment,
        )
        stat = path.stat()
        return BackupFileInfo(filename=filename, size_bytes=stat.st_size, created_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc))

    return await asyncio.to_thread(run)


async def save_uploaded_backup(uploaded_file, backup_dir: str) -> BackupFileInfo:
    directory = Path(backup_dir)
    directory.mkdir(parents=True, exist_ok=True)
    safe_stem = re.sub(r"[^A-Za-z0-9_-]", "-", Path(uploaded_file.filename or "upload").stem)[:48] or "upload"
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    filename = f"parking-radar-{timestamp}-{safe_stem}.dump"
    path = _backup_path(backup_dir, filename)

    written = 0
    with path.open("wb") as output:
        while chunk := await uploaded_file.read(1024 * 1024):
            written += len(chunk)
            if written > MAX_BACKUP_BYTES:
                path.unlink(missing_ok=True)
                raise ValueError("업로드 파일 크기가 허용 한도를 초과했습니다.")
            output.write(chunk)
    return BackupFileInfo(
        filename=filename,
        size_bytes=written,
        created_at=datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc),
    )


def backup_path_for_download(backup_dir: str, filename: str) -> Path:
    return _backup_path(backup_dir, filename)
