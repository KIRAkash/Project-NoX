class Settings:
    JWT_SECRET: str = "apex-demo-secret-key-123"
    ALGORITHM: str = "HS256"
    DATABASE_URL: str = "postgresql://localhost:5432/auth_db"

settings = Settings()
