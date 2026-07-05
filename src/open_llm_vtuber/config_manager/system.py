# config_manager/system.py
from pydantic import Field, model_validator
from typing import Dict, ClassVar
from .i18n import I18nMixin, Description


class SystemConfig(I18nMixin):
    """System configuration settings."""

    conf_version: str = Field(..., alias="conf_version")
    host: str = Field(..., alias="host")
    port: int = Field(..., alias="port")
    config_alts_dir: str = Field(..., alias="config_alts_dir")
    tool_prompts: Dict[str, str] = Field(..., alias="tool_prompts")
    enable_proxy: bool = Field(False, alias="enable_proxy")
    frontend_ws_url: str = Field("", alias="frontend_ws_url")
    frontend_base_url: str = Field("", alias="frontend_base_url")

    DESCRIPTIONS: ClassVar[Dict[str, Description]] = {
        "conf_version": Description(en="Configuration version", zh="配置文件版本"),
        "host": Description(en="Server host address", zh="服务器主机地址"),
        "port": Description(en="Server port number", zh="服务器端口号"),
        "config_alts_dir": Description(
            en="Directory for alternative configurations", zh="备用配置目录"
        ),
        "tool_prompts": Description(
            en="Tool prompts to be inserted into persona prompt",
            zh="要插入到角色提示词中的工具提示词",
        ),
        "enable_proxy": Description(
            en="Enable proxy mode for multiple clients",
            zh="启用代理模式以支持多个客户端使用一個 ws 连接",
        ),
        "frontend_ws_url": Description(
            en="Custom frontend WebSocket URL", zh="自定义前端 WebSocket URL"
        ),
        "frontend_base_url": Description(
            en="Custom frontend Base URL", zh="自定义前端 Base URL"
        ),
    }

    @model_validator(mode="after")
    def check_port(cls, values):
        port = values.port
        if port < 0 or port > 65535:
            raise ValueError("Port must be between 0 and 65535")
        return values
