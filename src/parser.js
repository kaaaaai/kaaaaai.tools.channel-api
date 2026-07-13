import * as cheerio from 'cheerio';
import sanitizeHtml from 'sanitize-html';

function text($, element) {
  return $(element).text().replace(/\s+/g, ' ').trim();
}

function extractPostId(value = '') {
  const match = String(value).match(/\/(\d+)$/);
  return match ? match[1] : '';
}

function extractTags(plainText = '') {
  const tags = new Set();
  const re = /(^|\s)#([\p{L}\p{N}_-]+)/gu;
  let match;
  while ((match = re.exec(plainText))) tags.add(match[2]);
  return [...tags];
}

function extractBackgroundUrl(style = '') {
  const match = style.match(/url\(['"]?([^'")]+)['"]?\)/);
  return match ? match[1] : '';
}

function proxyUrl(url, staticProxy) {
  if (!url || !staticProxy) return url;
  return `${staticProxy}${encodeURIComponent(url)}`;
}

function sanitizeTelegramHtml(html) {
  return sanitizeHtml(html, {
    allowedTags: ['a', 'b', 'br', 'code', 'em', 'i', 'p', 'pre', 's', 'span', 'strong', 'u'],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      span: ['class'],
      code: ['class'],
    },
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: 'a',
        attribs: {
          href: attribs.href || '',
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      }),
    },
  }).trim();
}

export function parseChannelPage(html, options = {}) {
  const $ = cheerio.load(html);
  const channelTitle = text($, '.tgme_channel_info_header_title') || options.channel || '';
  const channelDescription = text($, '.tgme_channel_info_description');
  const posts = [];

  $('.tgme_widget_message').each((_index, element) => {
    const message = $(element);
    const dataPost = message.attr('data-post') || '';
    const id = extractPostId(dataPost);
    const datetime = message.find('time[datetime]').attr('datetime') || '';
    const timestamp = Date.parse(datetime);
    const textEl = message.find('.tgme_widget_message_text').first();
    const bodyHtml = sanitizeTelegramHtml(textEl.html() || '');
    const plainText = text($, textEl);

    if (!id || Number.isNaN(timestamp)) return;

    const media = [];
    message.find('.tgme_widget_message_photo_wrap').each((_mediaIndex, mediaElement) => {
      const src = extractBackgroundUrl($(mediaElement).attr('style') || '');
      if (src) media.push({ type: 'image', src: proxyUrl(src, options.staticProxy), alt: '' });
    });

    posts.push({
      id,
      datetime: new Date(timestamp).toISOString(),
      timestamp,
      html: `<div class="bb-channel-content">${bodyHtml}</div>`,
      text: plainText,
      tags: extractTags(plainText),
      media,
      source: {
        telegramUrl: `https://t.me/${options.channel}/${id}`,
      },
    });
  });

  return {
    channel: {
      title: channelTitle,
      description: channelDescription,
    },
    posts: posts.sort((a, b) => b.timestamp - a.timestamp),
  };
}
