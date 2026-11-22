import re
import unicodedata

# Таблица транслитерации (упрощенная, для имен файлов)
TRANSLIT_MAP = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo',
    'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
    'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
    'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch',
    'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
}


def transliterate(text: str) -> str:
    """
    Транслитерация кириллицы в латиницу для имён файлов.
    Пример: 'Иванов' -> 'ivanov', 'Смирнова Анна' -> 'smirnova_anna'
    """
    if not text:
        return 'unknown'

    text = text.lower().strip()
    result = []
    for char in text:
        if char in TRANSLIT_MAP:
            result.append(TRANSLIT_MAP[char])
        elif char.isalnum():
            result.append(char)
        else:
            result.append('_')

    # Убираем повторяющиеся подчеркивания
    text = ''.join(result)
    text = re.sub(r'_+', '_', text).strip('_')
    return text or 'unknown'


def generate_filename(surname: str, name: str, task_order: int, date_str: str) -> str:
    """
    Формирует имя файла по шаблону:
    YYYY-MM-DD_Фамилия_Имя_taskN.py

    Пример: '2026-11-20_ivanov_ivan_task1.py'
    """
    safe_surname = transliterate(surname)
    safe_name = transliterate(name)
    return f"{date_str}_{safe_surname}_{safe_name}_task{task_order}.py"


def get_student_display_name(session) -> str:
    """
    Возвращает отображаемое имя ученика.
    Берёт либо гостевые ФИО, либо данные из Down ID.
    """
    # Если есть гостевые данные
    if session.guest_surname and session.guest_name:
        return f"{session.guest_surname} {session.guest_name}"

    # Если есть данные из Down ID (предполагаем, что они сохранены в guest_ полях при входе)
    if hasattr(session, 'down_user_id') and session.down_user_id:
        # Если в сессии сохранились ФИО из Down ID
        if session.guest_surname or session.guest_name:
            return f"{session.guest_surname or ''} {session.guest_name or ''}".strip()
        return f"Ученик #{session.id[:8]}"

    # Фоллбэк
    return f"Ученик #{session.id[:8]}"