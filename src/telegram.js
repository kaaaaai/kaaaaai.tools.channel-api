export function buildTelegramUrl({ host = 't.me', channel, before = '' }) {
  const url = new URL(`https://${host}/s/${channel}`);
  if (before) url.searchParams.set('before', before);
  return url;
}

export async function fetchTelegramHtml({ host, channel, before, request = {} }) {
  const url = buildTelegramUrl({ host, channel, before });
  const timeout = request.timeout || 15000;
  const retry = request.retry || 2;
  const retryDelay = request.retryDelay || 200;
  let lastError;

  for (let attempt = 0; attempt <= retry; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'user-agent': 'kaaaaai.tools.channel-api/0.1 (+https://github.com/Kaaaaai/kaaaaai.tools.channel-api)',
        },
      });
      if (!response.ok) throw new Error(`Telegram responded ${response.status}`);
      return response.text();
    } catch (error) {
      lastError = error;
      if (attempt < retry) await new Promise((resolve) => setTimeout(resolve, retryDelay));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}
