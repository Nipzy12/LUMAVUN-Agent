import enum

from sqlalchemy import String, ForeignKey
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
    )
    tasks: Mapped[list["Task"]] = relationship(
        back_populates="agent",
        lazy="selectin",
        cascade="all, delete-orphan",
    )
