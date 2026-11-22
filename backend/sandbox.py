import asyncio
import tempfile
import os
from dataclasses import dataclass

import aiodocker

from config import get_settings

settings = get_settings()

# Семафор для ограничения одновременных запусков
_semaphore = asyncio.Semaphore(settings.SANDBOX_CONCURRENCY)


@dataclass
class ExecutionResult:
    stdout: str
    stderr: str
    execution_time_ms: int
    timed_out: bool = False


# Запрещенные импорты (защита от злоупотреблений)
FORBIDDEN_IMPORTS = {
    "os", "sys", "subprocess", "socket", "requests", "urllib",
    "http", "ftplib", "smtplib", "telnetlib", "xmlrpc",
    "ctypes", "multiprocessing", "shutil", "pathlib",
}


def check_code_safety(code: str) -> Optional[str]:
    """Проверяет код на запрещенные импорты. Возвращает ошибку или None."""
    import ast
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return f"Синтаксическая ошибка: {e}"

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split(".")[0]
                if root in FORBIDDEN_IMPORTS:
                    return f"Импорт модуля '{alias.name}' запрещен в учебных целях"
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                root = node.module.split(".")[0]
                if root in FORBIDDEN_IMPORTS:
                    return f"Импорт модуля '{node.module}' запрещен в учебных целях"
    return None


import sys
import subprocess
import tempfile
import os
from dataclasses import dataclass
import asyncio
import ast

from config import get_settings

settings = get_settings()
_semaphore = asyncio.Semaphore(settings.SANDBOX_CONCURRENCY)

FORBIDDEN_IMPORTS = {
    "os", "sys", "subprocess", "socket", "requests", "urllib",
    "http", "ftplib", "smtplib", "telnetlib", "xmlrpc",
    "ctypes", "multiprocessing", "shutil", "pathlib",
}


@dataclass
class ExecutionResult:
    stdout: str
    stderr: str
    execution_time_ms: int
    timed_out: bool = False


def check_code_safety(code: str):
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return f"Синтаксическая ошибка: {e}"

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split(".")[0]
                if root in FORBIDDEN_IMPORTS:
                    return f"Импорт '{alias.name}' запрещен"
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                root = node.module.split(".")[0]
                if root in FORBIDDEN_IMPORTS:
                    return f"Импорт '{node.module}' запрещен"
    return None


async def run_in_sandbox(code: str) -> ExecutionResult:
    safety_error = check_code_safety(code)
    if safety_error:
        return ExecutionResult(stdout="", stderr=safety_error, execution_time_ms=0)

    async with _semaphore:
        # На Windows или если Docker недоступен — используем subprocess
        if sys.platform == "win32" or not _is_docker_available():
            return await _run_via_subprocess(code)
        else:
            return await _execute_in_docker(code)


def _is_docker_available() -> bool:
    """Проверяет, доступен ли Docker daemon."""
    try:
        result = subprocess.run(
            ["docker", "info"],
            capture_output=True,
            timeout=3
        )
        return result.returncode == 0
    except Exception:
        return False


async def _run_via_subprocess(code: str) -> ExecutionResult:
    """
    Fallback для Windows/локальной разработки.
    Запускает код через subprocess с ограничениями по времени.
    ВНИМАНИЕ: не изолирует от ФС! Только для разработки.
    """
    start_time = asyncio.get_event_loop().time()

    with tempfile.TemporaryDirectory() as tmpdir:
        code_path = os.path.join(tmpdir, "solution.py")
        with open(code_path, "w", encoding="utf-8") as f:
            f.write(code)

        try:
            process = await asyncio.create_subprocess_exec(
                sys.executable, code_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=tmpdir
            )

            try:
                stdout_bytes, stderr_bytes = await asyncio.wait_for(
                    process.communicate(),
                    timeout=settings.SANDBOX_TIMEOUT
                )
                timed_out = False
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()
                stdout_bytes, stderr_bytes = b"", "Превышено время выполнения".encode('utf-8')
                timed_out = True

            elapsed_ms = int((asyncio.get_event_loop().time() - start_time) * 1000)

            return ExecutionResult(
                stdout=stdout_bytes.decode("utf-8", errors="ignore")[:5000],
                stderr=stderr_bytes.decode("utf-8", errors="ignore")[:5000],
                execution_time_ms=elapsed_ms,
                timed_out=timed_out
            )
        except Exception as e:
            elapsed_ms = int((asyncio.get_event_loop().time() - start_time) * 1000)
            return ExecutionResult(
                stdout="",
                stderr=f"Ошибка запуска: {str(e)[:500]}",
                execution_time_ms=elapsed_ms
            )


async def _execute_in_docker(code: str) -> ExecutionResult:
    docker = aiodocker.Docker()
    start_time = asyncio.get_event_loop().time()
    timed_out = False

    try:
        # Создаем временную директорию с кодом
        with tempfile.TemporaryDirectory() as tmpdir:
            code_path = os.path.join(tmpdir, "solution.py")
            with open(code_path, "w", encoding="utf-8") as f:
                f.write(code)

            # Конфигурация контейнера
            config = {
                "Image": settings.SANDBOX_IMAGE,
                "Cmd": ["python", "/code/solution.py"],
                "HostConfig": {
                    "Memory": 128 * 1024 * 1024,  # 128 MB
                    "NanoCPUs": 500_000_000,  # 0.5 CPU
                    "PidsLimit": 50,
                    "NetworkMode": "none",  # Без сети
                    "ReadonlyRootfs": True,
                    "Binds": [f"{tmpdir}:/code:ro"],  # Код только для чтения
                    "Tmpfs": {"/tmp": "rw,noexec,nosuid,size=10m"},
                    "AutoRemove": False,  # Удалим вручную после сбора логов
                },
                "NetworkDisabled": True,
            }

            container = await docker.containers.create_or_replace(
                name=None, config=config
            )

            try:
                await container.start()

                # Ждем завершения с таймаутом
                try:
                    wait_task = asyncio.create_task(container.wait())
                    await asyncio.wait_for(wait_task, timeout=settings.SANDBOX_TIMEOUT)
                except asyncio.TimeoutError:
                    timed_out = True
                    await container.kill()

                # Собираем логи
                logs = await container.log(stdout=True, stderr=True)
                stdout_parts, stderr_parts = [], []
                for line in logs:
                    # aiodocker возвращает строки с префиксом потока
                    if line.startswith("1:"):
                        stdout_parts.append(line[2:])
                    elif line.startswith("2:"):
                        stderr_parts.append(line[2:])
                    else:
                        stdout_parts.append(line)

                stdout = "".join(stdout_parts)
                stderr = "".join(stderr_parts)

                if timed_out:
                    stderr = f"Превышено время выполнения ({settings.SANDBOX_TIMEOUT} сек)\n" + stderr

                elapsed_ms = int((asyncio.get_event_loop().time() - start_time) * 1000)

                return ExecutionResult(
                    stdout=stdout[:5000],  # Ограничиваем размер вывода
                    stderr=stderr[:5000],
                    execution_time_ms=elapsed_ms,
                    timed_out=timed_out
                )
            finally:
                try:
                    await container.delete(force=True)
                except Exception:
                    pass
    except Exception as e:
        elapsed_ms = int((asyncio.get_event_loop().time() - start_time) * 1000)
        return ExecutionResult(
            stdout="",
            stderr=f"Ошибка песочницы: {str(e)[:500]}",
            execution_time_ms=elapsed_ms,
            timed_out=False
        )
    finally:
        await docker.close()