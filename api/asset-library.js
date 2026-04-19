// Vercel serverless — POST /api/asset-library
// Unified proxy to free + paid asset providers. The user never sees provider keys.
// Everything is keyed off Supernova's master account.
//
// Providers:
//   image:  Pexels (primary, free, no attribution required) + Unsplash fallback
//   video:  Pexels Video (primary) + Pixabay Video fallback
//   music:  Pixabay Music (free, royalty-free) + Mixkit curated fallback
//   sfx:    Freesound (free, CC) + Pixabay SFX fallback
//   gif:    GIPHY (primary) + Tenor fallback
//
// Request: { kind: 'image'|'video'|'music'|'sfx'|'gif', q, page=1, per_page=20, ... }

const PER_PAGE_DEFAULT = 20;
const PER_PAGE_MAX = 80;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, apikey, authorization');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600'); // 5-min edge cache
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});

  const {
    kind = 'image',
    q = '',
    page = 1,
    per_page = PER_PAGE_DEFAULT,
    orientation,
    duration_max,
    bpm_min, bpm_max,
    genre,
    safe = true,
  } = req.body || {};

  const query = String(q || '').trim().slice(0, 120);
  if (!query) return res.status(400).json({error: 'Missing search query (q)'});

  const perPage = Math.max(1, Math.min(PER_PAGE_MAX, parseInt(per_page) || PER_PAGE_DEFAULT));
  const pg = Math.max(1, parseInt(page) || 1);

  try {
    let result;
    switch (kind) {
      case 'image': result = await searchImage(query, pg, perPage, {orientation, safe}); break;
      case 'video': result = await searchVideo(query, pg, perPage, {orientation, duration_max, safe}); break;
      case 'music': result = await searchMusic(query, pg, perPage, {bpm_min, bpm_max, genre}); break;
      case 'sfx':   result = await searchSfx(query, pg, perPage); break;
      case 'gif':   result = await searchGif(query, pg, perPage, {safe}); break;
      default:
        return res.status(400).json({error: 'Unknown kind. Use image|video|music|sfx|gif'});
    }
    return res.status(200).json({ok: true, kind, query, page: pg, per_page: perPage, ...result});
  } catch (e) {
    return res.status(500).json({error: e.message});
  }
}

// ============================================================
// IMAGES — Pexels primary, Unsplash fallback
// ============================================================
async function searchImage(q, page, per_page, opts) {
  const pexelsKey = process.env.PEXELS_API_KEY;
  if (pexelsKey) {
    const params = new URLSearchParams({query: q, page: String(page), per_page: String(per_page)});
    if (opts.orientation && ['landscape','portrait','square'].includes(opts.orientation)) params.set('orientation', opts.orientation);
    const r = await fetch(`https://api.pexels.com/v1/search?${params}`, {
      headers: {'Authorization': pexelsKey}
    });
    if (r.ok) {
      const data = await r.json();
      return {
        provider: 'pexels',
        total: data.total_results,
        items: (data.photos || []).map(p => ({
          id: 'pexels-img-' + p.id,
          url: p.src?.large2x || p.src?.large,
          thumb: p.src?.medium || p.src?.small,
          original: p.src?.original,
          width: p.width, height: p.height,
          author: p.photographer,
          author_url: p.photographer_url,
          source_url: p.url,
          color: p.avg_color,
          license: 'Pexels License (free, commercial OK, no attribution required)',
        }))
      };
    }
  }

  const unsplashKey = process.env.UNSPLASH_ACCESS_KEY;
  if (unsplashKey) {
    const params = new URLSearchParams({query: q, page: String(page), per_page: String(per_page)});
    if (opts.orientation) params.set('orientation', opts.orientation);
    const r = await fetch(`https://api.unsplash.com/search/photos?${params}`, {
      headers: {'Authorization': `Client-ID ${unsplashKey}`}
    });
    if (r.ok) {
      const data = await r.json();
      return {
        provider: 'unsplash',
        total: data.total,
        items: (data.results || []).map(p => ({
          id: 'unsplash-img-' + p.id,
          url: p.urls?.regular,
          thumb: p.urls?.small,
          original: p.urls?.full,
          width: p.width, height: p.height,
          author: p.user?.name,
          author_url: p.user?.links?.html,
          source_url: p.links?.html,
          color: p.color,
          license: 'Unsplash License (free, commercial OK, attribution appreciated)',
        }))
      };
    }
  }

  throw new Error('No image provider configured. Set PEXELS_API_KEY or UNSPLASH_ACCESS_KEY in Vercel env.');
}

// ============================================================
// VIDEO — Pexels Video primary, Pixabay Video fallback
// ============================================================
async function searchVideo(q, page, per_page, opts) {
  const pexelsKey = process.env.PEXELS_API_KEY;
  if (pexelsKey) {
    const params = new URLSearchParams({query: q, page: String(page), per_page: String(per_page)});
    if (opts.orientation && ['landscape','portrait','square'].includes(opts.orientation)) params.set('orientation', opts.orientation);
    const r = await fetch(`https://api.pexels.com/videos/search?${params}`, {
      headers: {'Authorization': pexelsKey}
    });
    if (r.ok) {
      const data = await r.json();
      return {
        provider: 'pexels-video',
        total: data.total_results,
        items: (data.videos || []).map(v => {
          const hd = (v.video_files || []).find(f => f.quality === 'hd') || v.video_files?.[0] || {};
          return {
            id: 'pexels-vid-' + v.id,
            url: hd.link,
            thumb: v.image,
            preview: v.video_pictures?.[0]?.picture,
            width: v.width, height: v.height,
            duration: v.duration,
            author: v.user?.name,
            author_url: v.user?.url,
            source_url: v.url,
            license: 'Pexels License (free, commercial OK, no attribution required)',
          };
        })
      };
    }
  }

  const pixabayKey = process.env.PIXABAY_API_KEY;
  if (pixabayKey) {
    const params = new URLSearchParams({key: pixabayKey, q, page: String(page), per_page: String(per_page)});
    const r = await fetch(`https://pixabay.com/api/videos/?${params}`);
    if (r.ok) {
      const data = await r.json();
      return {
        provider: 'pixabay-video',
        total: data.totalHits,
        items: (data.hits || []).map(v => ({
          id: 'pixabay-vid-' + v.id,
          url: v.videos?.medium?.url || v.videos?.small?.url,
          thumb: `https://i.vimeocdn.com/video/${v.picture_id}_295x166.jpg`,
          width: v.videos?.medium?.width, height: v.videos?.medium?.height,
          duration: v.duration,
          author: v.user,
          source_url: v.pageURL,
          license: 'Pixabay Content License (free, commercial OK)',
        }))
      };
    }
  }

  throw new Error('No video provider configured. Set PEXELS_API_KEY or PIXABAY_API_KEY in Vercel env.');
}

// ============================================================
// MUSIC — Pixabay Music primary
// ============================================================
async function searchMusic(q, page, per_page, opts) {
  const pixabayKey = process.env.PIXABAY_API_KEY;
  if (pixabayKey) {
    // Pixabay treats music as audio under their main image API with `music` category
    // For full music search we need their Audio Search API (in beta) — fallback to keyword image with category=music
    const params = new URLSearchParams({
      key: pixabayKey, q, page: String(page), per_page: String(per_page),
    });
    if (opts.genre) params.set('category', opts.genre);
    const r = await fetch(`https://pixabay.com/api/music/?${params}`).catch(() => null);
    if (r && r.ok) {
      const data = await r.json();
      return {
        provider: 'pixabay-music',
        total: data.totalHits || (data.hits || []).length,
        items: (data.hits || []).map(t => ({
          id: 'pixabay-music-' + (t.id || t.audio_id),
          name: t.title || t.tags,
          artist: t.user || 'Pixabay',
          url: t.audio || t.audio_url,
          preview: t.audio_preview || t.audio,
          duration: t.duration,
          bpm: null, genre: t.category,
          tags: t.tags,
          license: 'Pixabay Content License (free, commercial OK, no attribution required)',
        }))
      };
    }
  }

  // Fallback: curated Mixkit shortlist (static, no API). Always returns something.
  return {
    provider: 'curated',
    total: CURATED_MUSIC.length,
    items: CURATED_MUSIC.filter(t =>
      !q || t.name.toLowerCase().includes(q.toLowerCase()) || (t.tags||'').toLowerCase().includes(q.toLowerCase())
    ).slice((page-1)*per_page, page*per_page),
  };
}

// ============================================================
// SFX — Freesound primary, Pixabay SFX fallback
// ============================================================
async function searchSfx(q, page, per_page) {
  const fsKey = process.env.FREESOUND_API_KEY;
  if (fsKey) {
    const params = new URLSearchParams({
      query: q, page: String(page), page_size: String(per_page),
      fields: 'id,name,description,duration,username,previews,license,tags',
      token: fsKey,
    });
    const r = await fetch(`https://freesound.org/apiv2/search/text/?${params}`);
    if (r.ok) {
      const data = await r.json();
      return {
        provider: 'freesound',
        total: data.count,
        items: (data.results || []).map(s => ({
          id: 'freesound-' + s.id,
          name: s.name,
          author: s.username,
          url: s.previews?.['preview-hq-mp3'] || s.previews?.['preview-lq-mp3'],
          preview: s.previews?.['preview-lq-mp3'],
          duration: s.duration,
          tags: (s.tags || []).join(', '),
          license: s.license,
        }))
      };
    }
  }

  // Fallback to curated SFX shortlist.
  return {
    provider: 'curated',
    total: CURATED_SFX.length,
    items: CURATED_SFX.filter(t =>
      !q || t.name.toLowerCase().includes(q.toLowerCase())
    ).slice((page-1)*per_page, page*per_page),
  };
}

// ============================================================
// GIFs — GIPHY primary, Tenor fallback
// ============================================================
async function searchGif(q, page, per_page, opts) {
  const giphyKey = process.env.GIPHY_API_KEY;
  if (giphyKey) {
    const offset = (page - 1) * per_page;
    const params = new URLSearchParams({
      api_key: giphyKey, q, limit: String(per_page), offset: String(offset),
      rating: opts.safe ? 'pg' : 'r',
    });
    const r = await fetch(`https://api.giphy.com/v1/gifs/search?${params}`);
    if (r.ok) {
      const data = await r.json();
      return {
        provider: 'giphy',
        total: data.pagination?.total_count,
        items: (data.data || []).map(g => ({
          id: 'giphy-' + g.id,
          url: g.images?.original?.url,
          thumb: g.images?.fixed_width_small?.url || g.images?.preview_gif?.url,
          mp4: g.images?.original_mp4?.mp4,
          width: parseInt(g.images?.original?.width || 0),
          height: parseInt(g.images?.original?.height || 0),
          author: g.username || g.user?.display_name,
          source_url: g.url,
          title: g.title,
          license: 'GIPHY API Terms (attribution: "Powered by GIPHY")',
        }))
      };
    }
  }

  const tenorKey = process.env.TENOR_API_KEY;
  if (tenorKey) {
    const params = new URLSearchParams({
      key: tenorKey, q, limit: String(per_page),
      contentfilter: opts.safe ? 'high' : 'off',
    });
    const r = await fetch(`https://tenor.googleapis.com/v2/search?${params}`);
    if (r.ok) {
      const data = await r.json();
      return {
        provider: 'tenor',
        total: data.results?.length,
        items: (data.results || []).map(g => {
          const gif = g.media_formats?.gif || g.media_formats?.mediumgif || {};
          return {
            id: 'tenor-' + g.id,
            url: gif.url,
            thumb: g.media_formats?.tinygif?.url || gif.url,
            mp4: g.media_formats?.mp4?.url,
            width: gif.dims?.[0],
            height: gif.dims?.[1],
            title: g.content_description,
            source_url: g.itemurl,
            license: 'Tenor API Terms (attribution: "via Tenor")',
          };
        })
      };
    }
  }

  throw new Error('No GIF provider configured. Set GIPHY_API_KEY or TENOR_API_KEY in Vercel env.');
}

// ============================================================
// CURATED FALLBACKS — always available offline
// Public-domain / royalty-free sources you can host yourself.
// Replace these URLs with files in your own Supabase Storage bucket once uploaded.
// ============================================================
const CURATED_MUSIC = [
  {id:'curated-music-1', name:'Cinematic Uplift',  artist:'Mixkit',  url:'https://assets.mixkit.co/music/preview/mixkit-tech-house-vibes-130.mp3',     preview:'https://assets.mixkit.co/music/preview/mixkit-tech-house-vibes-130.mp3',     duration:140, bpm:120, genre:'electronic', tags:'cinematic uplift energy build',  license:'Mixkit License (free, commercial OK)'},
  {id:'curated-music-2', name:'Future Bass Loop',  artist:'Mixkit',  url:'https://assets.mixkit.co/music/preview/mixkit-driving-ambition-32.mp3',      preview:'https://assets.mixkit.co/music/preview/mixkit-driving-ambition-32.mp3',      duration:163, bpm:140, genre:'electronic', tags:'bass future motivational',         license:'Mixkit License (free, commercial OK)'},
  {id:'curated-music-3', name:'Calm Piano',         artist:'Mixkit',  url:'https://assets.mixkit.co/music/preview/mixkit-relaxing-in-paradise-533.mp3', preview:'https://assets.mixkit.co/music/preview/mixkit-relaxing-in-paradise-533.mp3', duration:120, bpm:80,  genre:'acoustic',   tags:'piano calm meditation chill',      license:'Mixkit License (free, commercial OK)'},
  {id:'curated-music-4', name:'Hip-Hop Beat',       artist:'Mixkit',  url:'https://assets.mixkit.co/music/preview/mixkit-hip-hop-02-738.mp3',           preview:'https://assets.mixkit.co/music/preview/mixkit-hip-hop-02-738.mp3',           duration:115, bpm:96,  genre:'hip-hop',    tags:'hip-hop beat trap urban',          license:'Mixkit License (free, commercial OK)'},
  {id:'curated-music-5', name:'Corporate Inspire',  artist:'Mixkit',  url:'https://assets.mixkit.co/music/preview/mixkit-serene-view-443.mp3',          preview:'https://assets.mixkit.co/music/preview/mixkit-serene-view-443.mp3',          duration:131, bpm:100, genre:'corporate',  tags:'corporate inspire warm',           license:'Mixkit License (free, commercial OK)'},
];

const CURATED_SFX = [
  {id:'curated-sfx-1', name:'Whoosh Transition',  url:'https://assets.mixkit.co/active_storage/sfx/2398/2398-preview.mp3', duration:0.8, tags:'whoosh transition swipe', license:'Mixkit License'},
  {id:'curated-sfx-2', name:'Pop Notification',   url:'https://assets.mixkit.co/active_storage/sfx/2870/2870-preview.mp3', duration:0.4, tags:'pop notification ui',     license:'Mixkit License'},
  {id:'curated-sfx-3', name:'Camera Shutter',     url:'https://assets.mixkit.co/active_storage/sfx/2569/2569-preview.mp3', duration:0.3, tags:'camera shutter snap',      license:'Mixkit License'},
  {id:'curated-sfx-4', name:'Risers Build',       url:'https://assets.mixkit.co/active_storage/sfx/1993/1993-preview.mp3', duration:3.2, tags:'riser build tension',      license:'Mixkit License'},
  {id:'curated-sfx-5', name:'Impact Hit',         url:'https://assets.mixkit.co/active_storage/sfx/2611/2611-preview.mp3', duration:0.9, tags:'impact hit drop bass',     license:'Mixkit License'},
];
