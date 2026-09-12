'use strict';
// Optional link-based media for the public property websites.
// Only providers we can embed canonically are accepted:
// YouTube or Vimeo for listing video, Matterport or Zillow 3D for tours.
// Anything else returns null, so the site never renders a broken or
// unexpected embed. Delivered video files (MP4) stay out of here on
// purpose: that option arrives with persistent storage, and the
// kind/provider/embedUrl shape below is the seam it will plug into.

function ytIdOk(id) { return /^[A-Za-z0-9_-]{6,20}$/.test(id || ''); }

function video(provider, embedUrl) { return { kind: 'video', provider, embedUrl }; }
function tour(provider, embedUrl) { return { kind: 'tour', provider, embedUrl }; }

function parseMediaUrl(raw) {
  const s = String(raw || '').trim();
  if (!s || s.length > 300) return null;
  let u;
  try { u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); }
  catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, '');
  const path = u.pathname;

  if (host === 'youtu.be') {
    const id = path.slice(1).split('/')[0];
    return ytIdOk(id) ? video('YouTube', 'https://www.youtube-nocookie.com/embed/' + id) : null;
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    let id = '';
    if (path === '/watch') id = u.searchParams.get('v') || '';
    else {
      const m = path.match(/^\/(embed|shorts|live)\/([^/?#]+)/);
      if (m) id = m[2];
    }
    return ytIdOk(id) ? video('YouTube', 'https://www.youtube-nocookie.com/embed/' + id) : null;
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const m = path.match(/^(?:\/video)?\/(\d{6,12})/);
    return m ? video('Vimeo', 'https://player.vimeo.com/video/' + m[1]) : null;
  }
  if (host === 'my.matterport.com' || host === 'matterport.com') {
    const model = u.searchParams.get('m') || '';
    if (path.startsWith('/show') && /^[A-Za-z0-9]{6,20}$/.test(model)) {
      return tour('Matterport', 'https://my.matterport.com/show/?m=' + model);
    }
    return null;
  }
  if (host === 'zillow.com') {
    if (path.startsWith('/view-3d-home/') || path.startsWith('/view-imx/')) {
      return tour('Zillow 3D', 'https://www.zillow.com' + path.replace(/\/*$/, '/'));
    }
    return null;
  }
  return null;
}

module.exports = { parseMediaUrl };
