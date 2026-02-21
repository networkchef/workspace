"""
routes/tasks.py — task CRUD
"""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from middleware.auth import get_current_user
from storage.disk import read_tasks, write_tasks

router = APIRouter(prefix="/tasks", tags=["tasks"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class TaskCreate(BaseModel):
    text: str
    priority: str = "med"   # high | med | low


class TaskUpdate(BaseModel):
    text: str | None = None
    priority: str | None = None
    done: bool | None = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/")
async def list_tasks(username: str = Depends(get_current_user)):
    return await read_tasks(username)


@router.post("/", status_code=201)
async def add_task(body: TaskCreate, username: str = Depends(get_current_user)):
    if not body.text.strip():
        raise HTTPException(status_code=400, detail="Text required.")
    tasks = await read_tasks(username)
    now = datetime.now(timezone.utc)
    task = {
        "id": str(uuid.uuid4()),
        "text": body.text.strip(),
        "priority": body.priority,
        "done": False,
        "date": now.strftime("%-d %b"),
        "created_at": now.isoformat(),
    }
    tasks.insert(0, task)
    await write_tasks(username, tasks)
    return task


@router.put("/{task_id}")
async def update_task(task_id: str, body: TaskUpdate, username: str = Depends(get_current_user)):
    tasks = await read_tasks(username)
    task = next((t for t in tasks if t["id"] == task_id), None)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")
    if body.done is not None:
        task["done"] = body.done
    if body.text is not None:
        task["text"] = body.text.strip()
    if body.priority is not None:
        task["priority"] = body.priority
    await write_tasks(username, tasks)
    return task


@router.delete("/{task_id}")
async def delete_task(task_id: str, username: str = Depends(get_current_user)):
    tasks = await read_tasks(username)
    if not any(t["id"] == task_id for t in tasks):
        raise HTTPException(status_code=404, detail="Task not found.")
    tasks = [t for t in tasks if t["id"] != task_id]
    await write_tasks(username, tasks)
    return {"ok": True}
