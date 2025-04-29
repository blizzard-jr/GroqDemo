// Конфигурационный файл для API ключей

// Определение среды выполнения
export const IS_VERCEL = process.env.VERCEL === '1' || process.env.VERCEL === 'true';

// Ключ API Groq
export const GROQ_API_KEY = process.env.GROQ_API_KEY || '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';

// Модель для генерации ответа
export const MODEL_ID = 'deepseek-r1-distill-llama-70b';

// Модель для распознавания речи
export const WHISPER_MODEL_ID = 'whisper-large-v3-turbo';

// Простая функция для проверки наличия необходимых ключей
export function validateConfig() {
  if (!GROQ_API_KEY || GROQ_API_KEY === 'ваш_groq_api_ключ') {
    console.error('ОШИБКА: GROQ_API_KEY не настроен. Пожалуйста, укажите действительный ключ API Groq.');
    return false;
  }
  return true;
} 