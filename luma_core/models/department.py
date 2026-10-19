import enum

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from luma_core.db.session import Base


class DepartmentStatus(str, enum.Enum):
    active = "active"
    archived = "archived"


class Department(Base):
    __tablename__ = "departments"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    status: Mapped[DepartmentStatus] = mapped_column(
        default=DepartmentStatus.active,
    )
    created_at: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
    )
    updated_at: Mapped[str | None] = mapped_column(
        String(32),
        nullable=True,
    )

    agents: Mapped[list["Agent"]] = relationship(
        back_populates="department",
        lazy="selectin",
        cascade="all, delete-orphan",
        foreign_keys="Agent.department_id",
    )
    manager: Mapped["Agent | None"] = relationship(
        "Agent",
        back_populates="managed_department",
        lazy="selectin",
        uselist=False,
        foreign_keys="Agent.managed_department_id",
    )
