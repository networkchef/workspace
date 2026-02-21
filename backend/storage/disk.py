"""
storage/disk.py — all file-system operations, per-user folder layout

/data/users/{username}/
    auth.json
    notebooks/
        index.json
        {notebook_id}/
            content.html
            images/
                img_xxx.png
    tasks/
        tasks.json
"""

import json
import re
import aiofiles
import aiofiles.os as aios
from pathlib import Path
from config import settings


def _safe_username(username: str) -> str:
    """Sanitize username for use as a folder name."""
    return re.sub(r"[^a-zA-Z0-9_-]", "_", username)


def user_root(username: str) -> Path:
    return settings.data_root / "users" / _safe_username(username)


async def init_user_dirs(username: str) -> Path:
    root = user_root(username)
    for sub in ["", "notebooks", "tasks"]:
        await aios.makedirs(root / sub, exist_ok=True)
    return root


# ── Generic helpers ──────────────────────────────────────────────────────────

async def read_json(path: Path, default):
    try:
        async with aiofiles.open(path, "r", encoding="utf-8") as f:
            return json.loads(await f.read())
    except (FileNotFoundError, json.JSONDecodeError):
        return default


async def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    async with aiofiles.open(path, "w", encoding="utf-8") as f:
        await f.write(json.dumps(data, indent=2, ensure_ascii=False))


async def read_text(path: Path, default: str = "") -> str:
    try:
        async with aiofiles.open(path, "r", encoding="utf-8") as f:
            return await f.read()
    except FileNotFoundError:
        return default


async def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    async with aiofiles.open(path, "w", encoding="utf-8") as f:
        await f.write(content)


async def read_bytes(path: Path) -> bytes | None:
    try:
        async with aiofiles.open(path, "rb") as f:
            return await f.read()
    except FileNotFoundError:
        return None


async def write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    async with aiofiles.open(path, "wb") as f:
        await f.write(data)


# ── Auth ─────────────────────────────────────────────────────────────────────

async def read_user_auth(username: str) -> dict | None:
    return await read_json(user_root(username) / "auth.json", None)


async def write_user_auth(username: str, data: dict) -> None:
    await write_json(user_root(username) / "auth.json", data)


async def user_exists(username: str) -> bool:
    return (user_root(username) / "auth.json").exists()


# ── Notebooks ────────────────────────────────────────────────────────────────

async def read_notebook_index(username: str) -> list:
    return await read_json(user_root(username) / "notebooks" / "index.json", [])


async def write_notebook_index(username: str, data: list) -> None:
    await write_json(user_root(username) / "notebooks" / "index.json", data)


async def read_notebook_content(username: str, nb_id: str) -> str:
    return await read_text(user_root(username) / "notebooks" / nb_id / "content.html")


async def write_notebook_content(username: str, nb_id: str, html: str) -> None:
    path = user_root(username) / "notebooks" / nb_id / "content.html"
    await write_text(path, html)


async def delete_notebook(username: str, nb_id: str) -> None:
    import shutil
    nb_dir = user_root(username) / "notebooks" / nb_id
    if nb_dir.exists():
        shutil.rmtree(nb_dir)


async def save_notebook_image(username: str, nb_id: str, filename: str, data: bytes) -> None:
    path = user_root(username) / "notebooks" / nb_id / "images" / filename
    await write_bytes(path, data)


async def read_notebook_image(username: str, nb_id: str, filename: str) -> bytes | None:
    return await read_bytes(user_root(username) / "notebooks" / nb_id / "images" / filename)


async def delete_notebook_image(username: str, nb_id: str, filename: str) -> None:
    path = user_root(username) / "notebooks" / nb_id / "images" / filename
    try:
        path.unlink()
    except FileNotFoundError:
        pass


# ── Tasks ─────────────────────────────────────────────────────────────────────

async def read_tasks(username: str) -> list:
    return await read_json(user_root(username) / "tasks" / "tasks.json", [])


async def write_tasks(username: str, tasks: list) -> None:
    await write_json(user_root(username) / "tasks" / "tasks.json", tasks)
