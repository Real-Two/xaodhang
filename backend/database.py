"""
SQLite database setup.

Critical fix: switched from default QueuePool to StaticPool.

Why: QueuePool (size=5, max_overflow=10 = 15 max connections) was
getting exhausted — the 5-minute staggered startup pipeline holds one
session open the whole time, while /risk/all polling (every 60s from
every open tab), the NER scan SSE stream, and the chatbot each open
their own sessions concurrently. Once 15 connections were in flight,
every further request queued for 30s then hit:
    sqlalchemy.exc.TimeoutError: QueuePool limit of size 5 overflow 10
    reached, connection timed out, timeout 30.00
That's why the site appeared to "not connect" — it wasn't cold start,
it was every request queuing behind an exhausted connection pool.

StaticPool keeps exactly one connection alive for the life of the
process and serializes access to it — the correct pattern for FastAPI
+ SQLite, since SQLite doesn't support true concurrent connections
anyway. No more queueing, no more 30s timeouts.
"""

import os

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.pool import StaticPool

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./risk.db")
IS_SQLITE    = "sqlite" in DATABASE_URL

if IS_SQLITE:
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,   # single shared connection — no pool exhaustion
    )
else:
    # Postgres or other multi-connection DB — normal pooling is fine,
    # just bump the limits generously for a low-traffic app.
    engine = create_engine(
        DATABASE_URL,
        pool_size=10,
        max_overflow=20,
        pool_timeout=30,
        pool_recycle=1800,
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
