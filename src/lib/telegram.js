export class BotApiError extends Error {
  constructor(code, description) {
    super(description);
    this.code = code;
    this.description = description;
  }
}

export function createTelegramApi(token, fetchFn = fetch) {
  async function call(method, data) {
    const multipart = data instanceof FormData;
    let result;
    try {
      const response = await fetchFn(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: multipart ? undefined : { 'Content-Type': 'application/json' },
        body: multipart ? data : JSON.stringify(data),
        signal: AbortSignal.timeout(8000),
      });
      result = await response.json();
    } catch {
      throw new BotApiError(0, 'Telegram API request failed');
    }
    if (!result.ok) {
      throw new BotApiError(result.error_code, result.description);
    }
    return result.result;
  }

  return {
    sendMessage: (data) => call('sendMessage', data),
    editMessageText: (data) => call('editMessageText', data),
    answerCallbackQuery: (data) => call('answerCallbackQuery', data),
    sendDocument: (data) => call('sendDocument', data),
    getMe: () => call('getMe', {}),
    setWebhook: (data) => call('setWebhook', data),
    getWebhookInfo: () => call('getWebhookInfo', {}),
  };
}
