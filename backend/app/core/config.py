from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "parking-radar"
    database_url: str = "postgresql+asyncpg://parking_radar:parking_radar@postgres:5432/parking_radar"
    app_timezone: str = "Asia/Seoul"
    enable_scheduler: bool = False
    seed_sample_data: bool = True
    collect_interval_seconds: int = 300
    manual_collect_min_interval_seconds: int = 300
    upstream_rate_limit_backoff_seconds: int = 3600
    api_timeout_seconds: int = 15
    data_go_kr_service_key: str | None = None
    enable_flight_status_markers: bool = True
    flight_status_cache_seconds: int = 300
    holiday_cache_seconds: int = 86400
    enable_incheon_collection: bool = True
    enable_incheon_fee_collection: bool = False
    enable_fee_collection: bool = False
    airport_codes_csv: str = "CJJ,CJU,GMP,HIN,ICN,KUV,KWJ,MWX,PUS,RSU,TAE,USN,WJU,YNY"
    cors_origins_csv: str = "http://localhost:3000"
    trusted_hosts_csv: str = "localhost,127.0.0.1,testserver,backend"
    enable_api_docs: bool = True
    api_prefix: str = ""
    use_sample_client_when_no_key: bool = True
    backup_dir: str = "/app/backups"
    backup_retention_count: int = 14
    backup_command_timeout_seconds: int = 120

    @property
    def supported_airport_codes(self) -> list[str]:
        return [code.strip().upper() for code in self.airport_codes_csv.split(",") if code.strip()]

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins_csv.split(",") if origin.strip()]

    @property
    def trusted_hosts(self) -> list[str]:
        return [host.strip() for host in self.trusted_hosts_csv.split(",") if host.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
