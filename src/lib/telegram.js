export class BotApiError extends Error {
  constructor(code, description) {
    super(description);
    this.code = code;
    this.description = description;
  }
}

export function createTelegramApi(token, fetchFn = fetch) {
  async function call(method, data, timeout = 8000) {
    const multipart = data instanceof FormData;
    let result;
    try {
      const response = await fetchFn(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: multipart ? undefined : { 'Content-Type': 'application/json' },
        body: multipart ? data : JSON.stringify(data),
        signal: AbortSignal.timeout(timeout),
      });
      result = await response.json();
    } catch (error) {
      const reason = error.name === 'TimeoutError' ? 'timeout' : 'transport or response error';
      throw new BotApiError(0, `Telegram API ${method} failed: ${reason}`);
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
    getMe: () => call('getMe', {}, 20_000),
    setWebhook: (data) => call('setWebhook', data),
    getWebhookInfo: () => call('getWebhookInfo', {}),
  };
}
