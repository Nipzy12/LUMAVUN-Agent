from luma_core.agents.service import AgentService
from luma_core.agents.task_service import TaskService
from luma_core.agents.job_type_registry import JobTypeRegistry

agent_service = AgentService()
job_type_registry = JobTypeRegistry()


def get_task_service() -> TaskService:
    return TaskService(agent_service)


def get_agent_service() -> AgentService:
    return agent_service
