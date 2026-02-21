"""
routes/auth.py — signup, signin, change-password
"""

import hashlib
import re
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, status, Depends
from pydantic import BaseModel, field_validator

from middleware.auth import create_token, get_current_user
from storage.disk import read_user_auth, write_user_auth, user_exists, init_user_dirs

router = APIRouter(prefix="/auth", tags=["auth"])


# ── Helpers ──────────────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    return hashlib.sha256(f"{password}_ws_salt".encode()).hexdigest()


def valid_username(username: str) -> bool:
    return bool(re.match(r"^[a-zA-Z0-9_-]{3,32}$", username))


# ── Schemas ──────────────────────────────────────────────────────────────────

class SignupRequest(BaseModel):
    username: str
    password: str

    @field_validator("username")
    @classmethod
    def username_valid(cls, v: str) -> str:
        if not valid_username(v):
            raise ValueError("Username must be 3–32 chars: letters, numbers, _ or -")
        return v

    @field_validator("password")
    @classmethod
    def password_length(cls, v: str) -> str:
        if len(v) < 4:
            raise ValueError("Password must be at least 4 characters.")
        return v


class SigninRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def new_pw_length(cls, v: str) -> str:
        if len(v) < 4:
            raise ValueError("New password must be at least 4 characters.")
        return v


class AuthResponse(BaseModel):
    token: str
    username: str


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/signup", response_model=AuthResponse)
async def signup(body: SignupRequest):
    if await user_exists(body.username):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already taken.")

    await init_user_dirs(body.username)
    await write_user_auth(body.username, {
        "username": body.username,
        "hash": hash_password(body.password),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    return AuthResponse(token=create_token(body.username), username=body.username)


@router.post("/signin", response_model=AuthResponse)
async def signin(body: SigninRequest):
    auth = await read_user_auth(body.username)
    if not auth or auth.get("hash") != hash_password(body.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password.",
        )
    return AuthResponse(token=create_token(body.username), username=body.username)


@router.post("/change-password")
async def change_password(
    body: ChangePasswordRequest,
    username: str = Depends(get_current_user),
):
    auth = await read_user_auth(username)
    if not auth or auth.get("hash") != hash_password(body.current_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Current password is incorrect.")

    auth["hash"] = hash_password(body.new_password)
    await write_user_auth(username, auth)
    return {"ok": True}
