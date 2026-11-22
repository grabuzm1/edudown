# backend/test_giga.py
import asyncio
import uuid
import httpx

# === ВСТАВЬ СЮДА ДАННЫЕ ИЗ СВОЕГО .ENV ===
AUTH_KEY = "MDFhMWY5YTItODdkMS03OGI5LThmNDItMzA1NzIwN2JiMzUyOjA5NTAzNTdkLThlNzMtNDE0Ny05NjY5LTFhNjMzMDcxNTE2NA=="  # <-- ЗАМЕНИ ЭТО
SCOPE = "GIGACHAT_API_PERS"  # Или GIGACHAT_API_B2B, если у тебя юрлицо
OAUTH_URL = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth"

# Если у тебя есть сертификат, вставь путь сюда. Пример:
# CERT_PATH = r"C:\chatvibe\notiq\.instance\russian_trusted_root_ca_pem.crt"
# Если сертификата нет или хочешь проигнорировать проверку (для теста):
CERT_PATH = False


# ==========================================

async def main():
    print("🔄 Пытаемся получить токен GigaChat...")

    headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        "RqUID": str(uuid.uuid4()),
        "Authorization": f"Bearer {AUTH_KEY}"
    }
    data = {"scope": SCOPE}

    try:
        async with httpx.AsyncClient(verify=CERT_PATH, timeout=30.0) as client:
            response = await client.post(OAUTH_URL, headers=headers, data=data)

            print(f"\n📡 Статус ответа: {response.status_code}")

            if response.status_code == 200:
                token_data = response.json()
                token = token_data.get("access_token")
                print(f"✅ УСПЕХ! Токен получен:")
                print(f"Токен: {token[:20]}...{token[-10:]}")
                print(f"Время жизни: {token_data.get('expires_at')} сек.")
            else:
                print("❌ ОШИБКА при получении токена:")
                print(response.text)

    except Exception as e:
        print(f"❌ КРИТИЧЕСКАЯ ОШИБКА (сеть/сертификат):")
        print(e)


if __name__ == "__main__":
    asyncio.run(main())