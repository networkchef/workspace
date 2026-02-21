from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # Server
    port: int = 3001
    frontend_url: str = "http://localhost:5500"

    # JWT
    jwt_secret: str = "change-this-in-production-please"
    jwt_algorithm: str = "HS256"
    jwt_expire_days: int = 7

    # Storage
    data_root: Path = Path("./data")


settings = Settings()
