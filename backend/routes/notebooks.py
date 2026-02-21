"""
routes/notebooks.py — notebook CRUD + image management
"""

import base64
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from pydantic import BaseModel
from jose import JWTError, jwt

from config import settings
from middleware.auth import get_current_user


def get_user_from_token_param(token: str = Query(default="")) -> str:
    """Allow auth via ?token= query string (used by <img> src attributes)."""
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        username = payload.get("sub")
        if not username:
            raise ValueError()
        return username
    except (JWTError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid token.")
from storage.disk import (
    read_notebook_index, write_notebook_index,
    read_notebook_content, write_notebook_content, delete_notebook,
    save_notebook_image, read_notebook_image, delete_notebook_image,
)

router = APIRouter(prefix="/notebooks", tags=["notebooks"])

MIME_MAP = {
    "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
    "gif": "image/gif", "webp": "image/webp",
}


# ── Schemas ──────────────────────────────────────────────────────────────────

class NotebookCreate(BaseModel):
    title: str
    parent_id: str | None = None


class NotebookUpdate(BaseModel):
    title: str | None = None


class ContentUpdate(BaseModel):
    html: str


class ImageUpload(BaseModel):
    filename: str
    data: str   # base64-encoded bytes


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/")
async def list_notebooks(username: str = Depends(get_current_user)):
    return await read_notebook_index(username)


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_notebook(body: NotebookCreate, username: str = Depends(get_current_user)):
    if not body.title.strip():
        raise HTTPException(status_code=400, detail="Title required.")
    nb = {
        "id": str(uuid.uuid4()),
        "title": body.title.strip(),
        "parentId": body.parent_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    index = await read_notebook_index(username)
    index.append(nb)
    await write_notebook_index(username, index)
    await write_notebook_content(username, nb["id"], "")
    return nb


@router.put("/{nb_id}")
async def update_notebook(nb_id: str, body: NotebookUpdate, username: str = Depends(get_current_user)):
    index = await read_notebook_index(username)
    nb = next((n for n in index if n["id"] == nb_id), None)
    if not nb:
        raise HTTPException(status_code=404, detail="Notebook not found.")
    if body.title is not None:
        nb["title"] = body.title.strip()
    await write_notebook_index(username, index)
    return nb


@router.delete("/{nb_id}")
async def remove_notebook(nb_id: str, username: str = Depends(get_current_user)):
    index = await read_notebook_index(username)
    if not any(n["id"] == nb_id for n in index):
        raise HTTPException(status_code=404, detail="Notebook not found.")
    index = [n for n in index if n["id"] != nb_id]
    await write_notebook_index(username, index)
    await delete_notebook(username, nb_id)
    return {"ok": True}


@router.get("/{nb_id}/content")
async def get_content(nb_id: str, username: str = Depends(get_current_user)):
    html = await read_notebook_content(username, nb_id)
    return {"html": html}


@router.put("/{nb_id}/content")
async def save_content(nb_id: str, body: ContentUpdate, username: str = Depends(get_current_user)):
    await write_notebook_content(username, nb_id, body.html)
    return {"ok": True}


@router.post("/{nb_id}/images")
async def upload_image(nb_id: str, body: ImageUpload, username: str = Depends(get_current_user)):
    try:
        raw = base64.b64decode(body.data)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 data.")
    await save_notebook_image(username, nb_id, body.filename, raw)
    return {"ok": True, "filename": body.filename}


@router.get("/{nb_id}/images/{filename}")
async def get_image(
    nb_id: str,
    filename: str,
    username: str = Depends(get_user_from_token_param),
):
    """
    Images are loaded by browser <img> tags which can't send custom headers,
    so we accept the JWT as a ?token= query string here.
    """
    data = await read_notebook_image(username, nb_id, filename)
    if data is None:
        raise HTTPException(status_code=404, detail="Image not found.")
    ext = filename.rsplit(".", 1)[-1].lower()
    mime = MIME_MAP.get(ext, "application/octet-stream")
    return Response(content=data, media_type=mime)


@router.delete("/{nb_id}/images/{filename}")
async def remove_image(nb_id: str, filename: str, username: str = Depends(get_current_user)):
    await delete_notebook_image(username, nb_id, filename)
    return {"ok": True}
