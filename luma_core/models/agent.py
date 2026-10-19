import enum
import json

from sqlalchemy import String, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from luma_core.db.session import Base


class AutonomyLevel(str, enum.Enum):
    supervised = "supervised"
    assisted = "assisted"
    autonomous = "autonomous"


class AgentStatus(str, enum.Enum):
    idle = "idle"
    active = "active"
    paused = "paused"
    offline = "offline"


class AgentType(str, enum.Enum):
    worker = "worker"
    manager = "manager"


class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[int] = mapped_column(primary_key=True)
    department_id: Mapped[int | None] = mapped_column(
        ForeignKey("departments.id", ondelete="set null"),
        nullable=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    autonomy_level: Mapped[AutonomyLevel] = mapped_column(
        default=AutonomyLevel.supervised,
    )
    status: Mapped[AgentStatus] = mapped_column(
        default=AgentStatus.idle,
    )
    model_provider: Mapped[str | None] = mapped_column(
        String(128),
        nullable=True,
    )
    agent_type: Mapped[AgentType] = mapped_column(
        default=AgentType.worker,
    )
    skills: Mapped[str | None] = mapped_column(Text, nullable=True)
    managed_department_id: Mapped[int | None] = mapped_column(
        ForeignKey("departments.id", ondelete="set null"),
        nullable=True,
    )
    created_at: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
    )
    updated_at: Mapped[str | None] = mapped_column(
        String(32),
        nullable=True,
    )

    department: Mapped["Department | None"] = relationship(
        back_populates="agents",
        lazy="selectin",
        foreign_keys=[department_id],
    )
    managed_department: Mapped["Department | None"] = relationship(
        back_populates="manager",
        lazy="selectin",
        foreign_keys=[managed_department_id],
    )
    tasks: Mapped[list["Task"]] = relationship(
        back_populates="agent",
        lazy="selectin",
        cascade="all, delete-orphan",
        foreign_keys="Task.agent_id",
    )

    def get_skills(self) -> list[str]:
        if not self.skills:
            return []
        try:
            parsed = json.loads(self.skills)
        except (json.JSONDecodeError, TypeError):
            return []
        if isinstance(parsed, list):
            return [str(s) for s in parsed if s]
        return []

    def set_skills(self, skills: list[str]) -> None:
        self.skills = json.dumps([str(s) for s in skills if s])

    def get_skills(self) -> list[str]:
        if not self.skills:
            return []
        try:
            parsed = json.loads(self.skills)
        except (json.JSONDecodeError, TypeError):
            return []
        if isinstance(parsed, list):
            return [str(s) for s in parsed if s]
        return []

    def set_skills(self, skills: list[str]) -> None:
        self.skills = json.dumps([str(s) for s in skills if s])
