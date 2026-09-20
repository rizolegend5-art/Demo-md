const config = require('../config');

function getUrlFromArgs(args) {
  const match = String(args || '').match(/https?:\/\/\S+/i);
  return match ? match[0].replace(/[)>.,]+$/, '') : null;
}

async function shortUrl(url) {
  const endpoint = `${config.SHORT_URL_API_URL}?url=${encodeURIComponent(url)}`;
  const response = await fetch(endpoint);
  const result = await response.text();
  if (!response.ok || !/^https?:\/\//i.test(result.trim())) {
    throw new Error('Short URL service ne valid link return nahi kiya');
  }
  return result.trim();
}

async function screenshotUrl(url) {
  return `${config.SSWEB_BASE_URL}/${encodeURIComponent(url)}`;
}

function mediaHeaders() {
  const headers = { 'content-type': 'application/json', accept: 'application/json' };
  if (config.MEDIA_API_KEY) headers.authorization = `Api-Key ${config.MEDIA_API_KEY}`;
  return headers;
}

async function mediaDownload(url, { audio = false } = {}) {
  if (!config.MEDIA_API_URL) {
    throw new Error('MEDIA_API_URL configure nahi hai');
  }

  const response = await fetch(config.MEDIA_API_URL, {
    method: 'POST',
    headers: mediaHeaders(),
    body: JSON.stringify({
      url,
      downloadMode: audio ? 'audio' : 'auto',
      audioFormat: audio ? 'mp3' : undefined,
      videoQuality: '720',
      filenameStyle: 'basic',
      youtubeVideoCodec: 'h264'
    })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.url) {
    throw new Error(result.error?.code || result.error || 'Media provider ne file return nahi ki');
  }
  return {
    url: result.url,
    filename: result.filename || 'download',
    audio,
    mime: audio ? 'audio/mpeg' : 'video/mp4'
  };
}

module.exports = {
  getUrlFromArgs,
  shortUrl,
  screenshotUrl,
  mediaDownload
};