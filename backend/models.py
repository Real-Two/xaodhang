"""
Two tables:

Zone     — a monitored location (village, slope segment, etc). Holds the
           latest structural risk (from the U-Net) and latest rainfall
           readings. The combined risk score is NOT stored here — it's
           computed on the fly in risk_engine.py from these two numbers,
           so changing the combination formula never requires a migration.

Report   — a citizen/field-officer geo-tagged photo report. Independent of
           Zone (a report can exist before any zone covers that exact spot);
           optionally linked to the nearest zone for map clustering.
"""

import datetime

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from database import Base


class Zone(Base):
    __tablename__ = "zones"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    lat = Column(Float, nullable=False)
    lon = Column(Float, nullable=False)

    structural_risk = Column(Float, default=0.0)       # 0-1, from the DeepLabV3+
    structural_updated_at = Column(DateTime, nullable=True)

    rainfall_mm_24h = Column(Float, default=0.0)
    rainfall_mm_48h = Column(Float, default=0.0)
    rainfall_mm_72h = Column(Float, default=0.0)
    rainfall_updated_at = Column(DateTime, nullable=True)

    reports = relationship("Report", back_populates="zone")
    history = relationship("RiskHistory", back_populates="zone", order_by="RiskHistory.recorded_at")
    alerts = relationship("AlertLog", back_populates="zone")


class Report(Base):
    __tablename__ = "reports"

    id = Column(Integer, primary_key=True, index=True)
    zone_id = Column(Integer, ForeignKey("zones.id"), nullable=True)
    lat = Column(Float, nullable=False)
    lon = Column(Float, nullable=False)
    description = Column(Text, nullable=True)
    photo_path = Column(String, nullable=True)
    status = Column(String, default="pending")  # pending / verified / dismissed
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    zone = relationship("Zone", back_populates="reports")


class RiskHistory(Base):
    """
    Time-series log of combined risk scores per zone.
    Appended every time update_all_zones.py runs.
    Powers the 7-day trend chart on the dashboard.
    """
    __tablename__ = "risk_history"

    id = Column(Integer, primary_key=True, index=True)
    zone_id = Column(Integer, ForeignKey("zones.id"), nullable=False, index=True)
    structural_risk = Column(Float)
    rainfall_risk = Column(Float)
    combined_score = Column(Float)
    risk_level = Column(String)
    recorded_at = Column(DateTime, default=datetime.datetime.utcnow, index=True)

    zone = relationship("Zone", back_populates="history")


class AlertLog(Base):
    """
    Record of every alert that was fired — SMS, WhatsApp, or both.
    Used to avoid duplicate alerts on consecutive HIGH/CRITICAL readings
    (only fire when the level is *new*, not on every run).
    """
    __tablename__ = "alert_log"

    id = Column(Integer, primary_key=True, index=True)
    zone_id = Column(Integer, ForeignKey("zones.id"), nullable=False, index=True)
    risk_level = Column(String)        # HIGH / CRITICAL
    combined_score = Column(Float)
    channel = Column(String)           # sms / whatsapp / both
    language = Column(String)          # en / hi / as / mni
    message = Column(Text)
    recipients = Column(Text)          # comma-separated numbers
    sent_at = Column(DateTime, default=datetime.datetime.utcnow)
    status = Column(String, default="sent")  # sent / failed / skipped
    error = Column(Text, nullable=True)

    zone = relationship("Zone", back_populates="alerts")
